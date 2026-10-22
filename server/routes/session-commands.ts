import { resolveConversationTransition, transitionConversation, type TransitionInput, type TransitionResolution } from "../lib/conversationTransition"
import type { IncomingMessage, ServerResponse } from "node:http"
import { authorizeSession } from "../edition"
import { commandDispatcher, commandScope } from "../lib/durableSend"
import { applyQueueAction, queueContext } from "../lib/sessionQueue"
import { sendJson, withJsonBody, type UseFn } from "../http"
import { sendAgentError } from "./agentErrors"
import { localHost } from "../sessionHosts/localHost"
import { OrchestrationError } from "../orchestration/store"

async function context(req: IncomingMessage, res: ServerResponse, sessionId: unknown, mutate: boolean) {
  if (typeof sessionId !== "string" || !sessionId) throw new OrchestrationError(400, "sessionId is required")
  if (await authorizeSession(req, res, { sessionId }, mutate ? "interact" : "view") === null) return null
  const ctx = await queueContext(sessionId, req)
  if (ctx.conversation.binding.sessionId !== sessionId && await authorizeSession(req, res, { sessionId: ctx.conversation.binding.sessionId }, mutate ? "interact" : "view") === null) return null
  return ctx
}

export function registerSessionCommandRoutes(use: UseFn): void {
  use("/api/conversation-transition", (req, res, next) => {
    if (req.method !== "POST") return next()
    withJsonBody<TransitionInput & TransitionResolution & { action?: string }>(req, res, async (body) => {
      try {
        if (!await context(req, res, body.sessionId, true)) return
        if (body.targetSessionId && await authorizeSession(req, res, { sessionId: body.targetSessionId }, "interact") === null) return
        sendJson(res, 200, body.action === "resolve" ? await resolveConversationTransition(req, body) : await transitionConversation(req, body))
      } catch (error) { sendAgentError(res, error, "Conversation transition failed") }
    })
  })
  use("/api/session-commands", async (req, res, next) => {
    if (req.method === "GET") {
      try {
        const query = new URL(req.url ?? "/", "http://localhost").searchParams
        const ctx = await context(req, res, query.get("sessionId"), false)
        if (!ctx) return
        const { dispatcher, conversation, scope } = ctx
        sendJson(res, 200, { conversation, currentAddress: await localHost.address(conversation.binding.sessionId), pendingTransition: dispatcher.store.pendingTransition(conversation.id, scope), commands: dispatcher.store.commands(conversation.id, scope), replay: dispatcher.store.events(conversation.id, Number(query.get("after") ?? 0), 200, scope) })
      } catch (error) { sendAgentError(res, error, "Failed to read the queue") }
      return
    }
    if (req.method !== "POST") return next()
    withJsonBody<Record<string, unknown>>(req, res, async (body) => {
      try {
        const ctx = await context(req, res, body.sessionId, true)
        if (!ctx) return
        sendJson(res, 200, { conversation: ctx.conversation, commands: applyQueueAction(ctx, body.sessionId as string, body, req) })
      } catch (error) { sendAgentError(res, error, "Failed to update the queue") }
    })
  })
  use("/api/command-receipt", async (req, res, next) => {
    if (req.method !== "GET") return next()
    try {
      const query = new URL(req.url ?? "/", "http://localhost").searchParams
      const scope = commandScope(req)
      const command = commandDispatcher().store.command(scope, query.get("commandId") ?? "")
      if (!command) return sendJson(res, 404, { error: "Command not found" })
      if (await authorizeSession(req, res, { sessionId: command.receipt.sessionId }, "view") === null) return
      sendJson(res, 200, { receipt: command.receipt })
    } catch (error) { sendAgentError(res, error, "Failed to read receipt") }
  })
}
