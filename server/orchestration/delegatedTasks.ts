import { createHash } from "node:crypto"
import type { CommandReceipt, DelegatedTask } from "../../shared/contracts/orchestration"
import type { PendingInput } from "../../shared/contracts/pendingInput"
import { formatTaskAttention, formatTaskWakeup } from "../../shared/contracts/taskWakeup"
import { sessionOrigin } from "../lib/sessionOrigins"
import { answerHints, CLI_NAME } from "../sessionCli/hints"
import { beforeOrchestrationClose, orchestrationStore } from "./storage"
import { OrchestrationError } from "./store"

interface TaskHost {
  state(id: string): Promise<{ outcome: string; waiting?: readonly PendingInput[] }>
  result(id: string): Promise<unknown>
  receipt?(commandId: string): Promise<CommandReceipt | null>
  send(id: string, message: string, options: { commandId: string }): Promise<{ receipt?: CommandReceipt }>
  stop(id: string): Promise<boolean>
}
export interface TaskAuthority { authorize(sessionId: string): Promise<boolean>; host(sessionId: string): Promise<TaskHost> }
const authorities = new Map<string, TaskAuthority>()
let timer: ReturnType<typeof setInterval> | undefined
let ticking = false
let generation = 0
export function closeTaskMonitor(): void { generation++; clearInterval(timer); timer = undefined; authorities.clear() }
export function attachTaskAuthority(scope: string, parentSessionId: string, authority: TaskAuthority): void {
  authorities.set(JSON.stringify([scope, parentSessionId]), authority)
  if (!timer) { timer = setInterval(() => { void refreshDelegatedTasks() }, 1000); timer.unref(); beforeOrchestrationClose(closeTaskMonitor) }
  void refreshDelegatedTasks()
}

/** Where a running task stands: still going, stuck on its parent, or over. */
type Progress =
  | { kind: "wait" }
  | { kind: "attention"; keys: string[]; detail: string; next: string[] }
  | { kind: "finish"; state: "completed" | "error"; result?: unknown }
  | { kind: "cancelled" }
const WAIT: Progress = { kind: "wait" }
const ATTENTION_DETAIL_LIMIT = 4000

async function progressOf(task: DelegatedTask, host: TaskHost, told: ReadonlySet<string>): Promise<Progress> {
  const state = await host.state(task.childSessionId)
  if (state.outcome === "needs_input") {
    if ((await sessionOrigin(task.childSessionId))?.asksUser) return WAIT
    const fresh = (state.waiting ?? []).filter((request) => !told.has(request.requestId))
    if (!fresh.length) return WAIT
    return {
      kind: "attention",
      keys: fresh.map((request) => request.requestId),
      detail: `It is waiting on you: ${JSON.stringify(fresh).slice(0, ATTENTION_DETAIL_LIMIT)}`,
      next: answerHints(task.childSessionId, fresh),
    }
  }
  // A follow-up is over only once its own turn is: until then the child's state still describes the turn before it.
  const receipt = task.commandId && host.receipt ? await host.receipt(task.commandId) : null
  if (receipt) {
    if (receipt.state === "cancelled") return { kind: "cancelled" }
    if (receipt.state === "failed") return { kind: "finish", state: "error", result: { receipt } }
    if (receipt.state === "held" || receipt.state === "unknown") {
      const key = `${receipt.state}:${receipt.id}`
      return told.has(key) ? WAIT : {
        kind: "attention",
        keys: [key],
        detail: `Your message ${receipt.id} is ${receipt.state}${receipt.error ? `: ${receipt.error}` : ""}.`,
        next: [`${CLI_NAME} queue ${task.childSessionId}`],
      }
    }
    if (receipt.state !== "completed") return WAIT
  }
  return state.outcome === "completed" || state.outcome === "error" ? { kind: "finish", state: state.outcome } : WAIT
}

const blocked = (task: DelegatedTask) => task.deliveryDisposition === "blocking" && (task.blockingDeadline ?? 0) > Date.now()

export async function refreshDelegatedTasks(): Promise<void> {
  if (ticking) return
  ticking = true
  const current = generation
  try {
    for (const [key, authority] of authorities) {
      const [scope, parentSessionId] = JSON.parse(key) as [string, string]
      const tasks = orchestrationStore().tasks(scope, parentSessionId)
      const stillRunning = (id: string) => orchestrationStore().tasks(scope, parentSessionId).find((value) => value.id === id && value.state === "running" && !value.acknowledgedAt)
      for (const task of tasks) {
        if (task.acknowledgedAt || task.state === "cancelled" || !await authority.authorize(task.parentSessionId) || !await authority.authorize(task.childSessionId)) continue
        try {
          let updated = task
          if (task.state === "running") {
            const host = await authority.host(task.childSessionId)
            const told = new Set(tasks.filter((value) => value.childSessionId === task.childSessionId).flatMap((value) => value.notified ?? []))
            const progress = await progressOf(task, host, told)
            if (generation !== current) return
            if (progress.kind === "wait") continue
            if (progress.kind === "cancelled") {
              if (stillRunning(task.id)) orchestrationStore().updateTask(scope, task.id, { state: "cancelled" }, "running")
              continue
            }
            if (progress.kind === "attention") {
              await notifyParent(scope, task, authority, progress, current)
              continue
            }
            const result = progress.result ?? await host.result(task.childSessionId)
            if (generation !== current) return
            if (!await authority.authorize(task.parentSessionId) || !await authority.authorize(task.childSessionId)) continue
            if (generation !== current) return
            if (!stillRunning(task.id)) continue
            updated = orchestrationStore().updateTask(scope, task.id, { state: progress.state, result }, "running")
          }
          const persisted = orchestrationStore().tasks(scope, parentSessionId).find((value) => value.id === task.id)
          if (!persisted) continue
          updated = persisted
          if (!blocked(updated) && !updated.acknowledgedAt && updated.state !== "cancelled" && !updated.wakeupCommandId) {
            const commandId = `task-result-${task.id}`
            const host = await authority.host(task.parentSessionId)
            if (!await authority.authorize(task.parentSessionId) || !await authority.authorize(task.childSessionId)) continue
            if (generation !== current) return
            const currentTask = orchestrationStore().tasks(scope, parentSessionId).find((value) => value.id === task.id)
            if (!currentTask) continue
            updated = currentTask
            if (updated.acknowledgedAt || updated.state === "cancelled" || updated.wakeupCommandId || blocked(updated)) continue
            const delivered = await host.send(task.parentSessionId, formatTaskWakeup(updated), { commandId })
            if (generation !== current) return
            if (delivered.receipt) orchestrationStore().updateTask(scope, task.id, { wakeupCommandId: commandId })
          }
        } catch { /* Keep the durable result for a later authorized refresh. */ }
      }
    }
  } finally { ticking = false }
}

/** Wakes a parent whose child cannot go on without it, once per request or stuck delivery. */
async function notifyParent(scope: string, task: DelegatedTask, authority: TaskAuthority, progress: Extract<Progress, { kind: "attention" }>, current: number): Promise<void> {
  const host = await authority.host(task.parentSessionId)
  if (!await authority.authorize(task.parentSessionId) || !await authority.authorize(task.childSessionId)) return
  if (generation !== current) return
  const fresh = orchestrationStore().tasks(scope, task.parentSessionId).find((value) => value.id === task.id)
  // A blocking wait returns the request to its caller itself.
  if (!fresh || fresh.state !== "running" || fresh.acknowledgedAt || blocked(fresh)) return
  const commandId = `task-attention-${task.id}-${createHash("sha256").update(progress.keys.join("\n")).digest("hex").slice(0, 16)}`
  const delivered = await host.send(task.parentSessionId, formatTaskAttention(task, progress.detail, progress.next), { commandId })
  if (generation !== current) return
  if (delivered.receipt) orchestrationStore().updateTask(scope, task.id, { notified: [...fresh.notified ?? [], ...progress.keys] })
}

/**
 * Settles the caller's tasks for sessions a `wait` just reported finished:
 * the caller has read the result, so no wakeup should repeat it.
 */
export function settleWaitedTasks(scope: string, parentSessionId: string, reports: readonly { sessionId: string; outcome: string }[]): void {
  const store = orchestrationStore()
  for (const report of reports) {
    if (report.outcome !== "completed" && report.outcome !== "error") continue
    for (const task of store.tasks(scope, parentSessionId)) {
      if (task.childSessionId !== report.sessionId || task.acknowledgedAt || task.state === "cancelled") continue
      // The wait saw the turn before a follow-up that has not run yet.
      if (task.state === "running" && task.commandId && store.command(scope, task.commandId)?.receipt.state !== "completed") continue
      store.updateTask(scope, task.id, { ...(task.state === "running" ? { state: report.outcome, result: report } : {}), acknowledgedAt: Date.now() })
      if (task.wakeupCommandId) {
        try { store.cancel(scope, task.wakeupCommandId) } catch { /* Already delivered. */ }
      }
    }
  }
}

export function acknowledgeTask(scope: string, parentSessionId: string, id: string): DelegatedTask {
  const task = orchestrationStore().tasks(scope, parentSessionId).find((value) => value.id === id)
  if (!task) throw new OrchestrationError(404, "Delegated task not found")
  if (task.state === "running") throw new OrchestrationError(409, "The task has not completed")
  return task.acknowledgedAt ? task : orchestrationStore().updateTask(scope, id, { acknowledgedAt: Date.now() })
}
export async function cancelTask(scope: string, parentSessionId: string, id: string, authority: TaskAuthority): Promise<DelegatedTask> {
  const task = orchestrationStore().tasks(scope, parentSessionId).find((value) => value.id === id)
  if (!task || !await authority.authorize(task.childSessionId)) throw new OrchestrationError(404, "Delegated task not found")
  if (task.state !== "running") return task
  const host = await authority.host(task.childSessionId)
  if (!await authority.authorize(parentSessionId) || !await authority.authorize(task.childSessionId)) throw new OrchestrationError(403, "Session access changed before cancellation")
  const current = orchestrationStore().tasks(scope, parentSessionId).find((value) => value.id === id)
  if (!current || current.state !== "running") return current ?? task
  await host.stop(task.childSessionId)
  return orchestrationStore().updateTask(scope, id, { state: "cancelled" }, "running")
}
