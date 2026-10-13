import { nativeBinding } from "../agents/nativeBindings"
import { IncomingMessage } from "node:http"
import { Socket } from "node:net"
import type { CommandIntent, CommandReceipt, NativeBinding } from "../../shared/contracts/orchestration"
import { accessAtLeast } from "../../shared/contracts/sessionAccess"
import { resolveSessionAgent, runtimeFor } from "../agents/runtimes"
import type { AcceptedAnswer, AgentRuntime, SendRequest } from "../agents/runtimeTypes"
import { accessLevelOf, editionModule, getRequestPrincipal, sendTurn, type SendContext } from "../edition"
import { getRequestAuthentication, setRequestAuthentication, type RequestAuthentication } from "../requestAuthentication"
import { setRequestPrincipal } from "../requestPrincipal"
import { isSessionTokenActive } from "../security"
import { SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_MS } from "../sessionConstants"
import { CommandDispatcher } from "../orchestration/dispatcher"
import { beforeOrchestrationClose, orchestrationStore } from "../orchestration/storage"
import { OrchestrationError, type StoredCommand } from "../orchestration/store"
import { setSessionsArchived } from "./sessionArchive"

let active: { store: ReturnType<typeof orchestrationStore>; dispatcher: CommandDispatcher } | undefined
export function commandDispatcher(): CommandDispatcher {
  const store = orchestrationStore()
  if (!active || active.store !== store) {
    active?.dispatcher.close()
    const dispatcher = new CommandDispatcher(store)
    dispatcher.start()
    active = { store, dispatcher }
    beforeOrchestrationClose(closeCommandDispatcher)
  }
  return active.dispatcher
}
export function closeCommandDispatcher(): void { active?.dispatcher.close(); active = undefined }
export function commandScope(req?: IncomingMessage): string {
  const principal = req && getRequestPrincipal(req)
  if (editionModule().auth && !principal) throw new OrchestrationError(403, "A signed-in account is required for durable delivery")
  return principal?.userId ?? "local"
}

function executionRequest(authentication: RequestAuthentication | null, originalScope: string): IncomingMessage | null {
  const request = new IncomingMessage(new Socket())
  request.method = "POST"
  request.url = "/api/send-message"
  const auth = editionModule().auth
  if (!auth) {
    if (authentication?.kind === "session" && !isSessionTokenActive(authentication.token)) return null
    return originalScope === "local" ? request : null
  }
  if (authentication?.kind !== "session" || !isSessionTokenActive(authentication.token)) return null
  const restored = auth.sessions.restore(authentication.token)
  const now = Date.now()
  if (!restored?.principal || restored.principal.userId !== originalScope || now - restored.createdAt > SESSION_ABSOLUTE_TTL_MS || now - restored.lastActivity > SESSION_IDLE_TTL_MS) return null
  setRequestAuthentication(request, { kind: "session", token: authentication.token, principal: restored.principal })
  setRequestPrincipal(request, restored.principal)
  return request
}

export function refreshExecutionRequest(req: IncomingMessage): IncomingMessage | null { return executionRequest(getRequestAuthentication(req), commandScope(req)) }

/** The session a command goes to, and the crew lead it speaks for when it carries one. */
async function mayDeliver(request: IncomingMessage, command: StoredCommand): Promise<boolean> {
  const lead = command.payload.leadSessionId
  for (const sessionId of typeof lead === "string" ? [command.receipt.sessionId, lead] : [command.receipt.sessionId]) {
    const level = await accessLevelOf(request, sessionId)
    if (level === null || !accessAtLeast(level, "interact")) return false
  }
  return true
}

export function attachCommandAuthority(scope: string, conversationId: string, runtime: AgentRuntime, req?: IncomingMessage): void {
  const authentication = req ? getRequestAuthentication(req) : null
  const dispatcher = commandDispatcher()
  dispatcher.attach(scope, conversationId, {
    async authorize(command) {
      const request = executionRequest(authentication, scope)
      return request !== null && await mayDeliver(request, command)
    },
    async deliver(command, currentAttempt) {
      if (command.receipt.intent === "steer" && !runtime.descriptor.capabilities.midTurnSteering && !(command.payload.notification && runtime.descriptor.capabilities.activeNotifications)) throw new OrchestrationError(400, "This provider does not support steering a running turn")
      const request = executionRequest(authentication, scope)
      if (!request) throw new OrchestrationError(403, "Sign in again before delivering queued work")
      if (!await mayDeliver(request, command)) throw new OrchestrationError(403, "Session access changed")
      const assertCurrent = () => { if (!currentAttempt()) throw new OrchestrationError(409, "Dispatcher ownership changed before provider delivery") }
      assertCurrent()
      if (command.receipt.intent === "restart") await runtime.interrupt(command.receipt.sessionId)
      const context: SendContext = {
        receivedAt: command.receipt.createdAt,
        route: typeof command.payload.questionId === "string" ? "answer" : "send-message",
        session: { sessionId: command.receipt.sessionId, agent: runtime.kind },
        ...(typeof command.payload.questionId === "string" ? { toolUseId: command.payload.questionId } : {}),
      }
      const fencedRuntime = { ...runtime, send: (id: string, input: SendRequest) => { assertCurrent(); return runtime.send(id, input) } }
      const outcome = await sendTurn(request, fencedRuntime, command.receipt.sessionId, { ...command.payload, deliveryIntent: command.receipt.intent, commandId: command.receipt.nativeMessageId } as SendRequest, context)
      if (outcome.delivery !== "busy" && outcome.turnId && !outcome.completion && runtime.waitForCompletion) outcome.completion = runtime.waitForCompletion(command.receipt.sessionId, outcome.turnId)
      if (outcome.delivery !== "busy") void setSessionsArchived([command.receipt.sessionId], false).catch(() => {})
      return outcome
    },
    activity: (command) => runtime.activity(command.receipt.sessionId),
  })
}

export async function admitSessionCommand(options: {
  sessionId: string
  commandId: string
  request: SendRequest
  req?: IncomingMessage
  intent?: CommandIntent
  /** The intent when the caller names none; a retry keeps the one its command was first admitted with. */
  defaultIntent?: CommandIntent
  /** A crew lead the command speaks for: delivery keeps requiring access to it too. */
  leadSessionId?: string
  answer?: AcceptedAnswer
  answerInput?: unknown
  binding?: NativeBinding
  runtime?: AgentRuntime
}): Promise<CommandReceipt> {
  const { sessionId, commandId, request, req, answer } = options
  const resolved = options.runtime ? { kind: options.runtime.kind, instanceId: options.runtime.instanceId, filePath: request.filePath } : await resolveSessionAgent(sessionId)
  const runtime = options.runtime ?? runtimeFor(resolved.kind, resolved.instanceId)
  const dispatcher = commandDispatcher()
  const store = dispatcher.store
  const scope = commandScope(req)
  if (req) {
    const level = await accessLevelOf(req, sessionId)
    if (level === null || !accessAtLeast(level, "interact")) throw new OrchestrationError(403, "Session access is required before queueing a message")
  }
  const binding = options.binding ?? await nativeBinding(sessionId, resolved.kind, resolved.filePath, request.cwd)
  const conversation = store.ensureConversation(binding)
  if (conversation.binding.sessionId !== sessionId) throw new OrchestrationError(409, "This conversation moved to another native session; open its current binding")
  attachCommandAuthority(scope, conversation.id, runtime, req)
  const payload: Record<string, unknown> = { ...request, filePath: resolved.filePath ?? binding.filePath, ...(options.leadSessionId ? { leadSessionId: options.leadSessionId } : {}) }
  let receipt: CommandReceipt
  if (answer?.durableQuestion) {
    const { instanceId, sessionId: questionSessionId, requestId } = answer.durableQuestion
    payload.questionId = requestId
    payload.answerInput = options.answerInput
    payload.answerQuestion = answer.durableQuestion
    receipt = store.admitAnswer(scope, commandId, conversation.id, payload, instanceId, questionSessionId, requestId)
  } else receipt = store.admit(scope, commandId, conversation.id, payload, options.intent ?? store.command(scope, commandId)?.receipt.intent ?? options.defaultIntent)
  void dispatcher.tick()
  return receipt
}
