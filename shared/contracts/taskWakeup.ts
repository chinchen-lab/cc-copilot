import { isRecord } from "../objects"
import type { DelegatedTask } from "./orchestration"

/**
 * The prompt that wakes a parent session when a session it delegated to
 * finishes. The parent agent reads it as text; the timeline reads it back.
 */
export interface TaskWakeup {
  taskId: string
  state: DelegatedTask["state"]
  childSessionId: string
  /** The child's session result, or the raw text when it was cut to fit. */
  result: unknown
}

const RESULT_LIMIT = 24000
const WAKEUP_RE = /^Delegated task (\S+) (running|completed|error|cancelled)\. Child session: (\S+)\. Result: ([\s\S]*)\nAcknowledge receipt with cogpit-session tasks \S+ --ack \S+\.$/
const WAKEUP_START_RE = /^Delegated task \S+ (?:running|completed|error|cancelled|needs attention)\. Child session: /
const ATTENTION_RE = /^Delegated task \S+ needs attention\. Child session: (\S+)\./

/** Room a long reply keeps before the changed files give way. */
const REPLY_FLOOR = 4000

/**
 * The child's result without the prompt the parent wrote itself, kept whole
 * JSON when it has to shrink: the changed files give way to the reply, keeping
 * the paths that fit and a count of the rest, and a reply still too long is
 * shortened with a pointer to the full one. Any other shape is cut as text.
 */
function wakeupResult(result: unknown, childSessionId: string): string {
  if (!isRecord(result) || !isRecord(result.turn)) return JSON.stringify(result ?? null).slice(0, RESULT_LIMIT)
  const { userMessage: _prompt, ...turn } = result.turn
  const reply = typeof turn.reply === "string" ? turn.reply : ""
  let compact: Record<string, unknown> = { ...result, turn }
  let text = JSON.stringify(compact)
  if (text.length <= RESULT_LIMIT) return text
  const marker = ` … [cut to fit; read it all with cogpit-session result ${childSessionId}]`
  const replyRoom = JSON.stringify(reply.slice(0, REPLY_FLOOR)).length + marker.length
  if (Array.isArray(result.filesChanged) && JSON.stringify({ ...compact, turn: { ...turn, reply: "" } }).length + replyRoom > RESULT_LIMIT) {
    let room = RESULT_LIMIT - replyRoom - JSON.stringify({ ...compact, turn: { ...turn, reply: "" }, filesChanged: [], filesChangedOmitted: result.filesChanged.length }).length
    const kept: { path: unknown }[] = []
    for (const change of result.filesChanged) {
      const entry = { path: isRecord(change) ? change.path : change }
      room -= JSON.stringify(entry).length + 1
      if (room < 0) break
      kept.push(entry)
    }
    const omitted = result.filesChanged.length - kept.length
    compact = { ...compact, filesChanged: kept, ...(omitted ? { filesChangedOmitted: omitted } : {}) }
    text = JSON.stringify(compact)
  }
  for (let keep = reply.length; text.length > RESULT_LIMIT && keep > 0;) {
    keep = Math.max(0, keep - (text.length - RESULT_LIMIT) - marker.length)
    text = JSON.stringify({ ...compact, turn: { ...turn, reply: reply.slice(0, keep) + marker } })
  }
  return text.slice(0, RESULT_LIMIT)
}

export function formatTaskWakeup(task: Pick<DelegatedTask, "id" | "parentSessionId" | "childSessionId" | "state" | "result">): string {
  return `Delegated task ${task.id} ${task.state}. Child session: ${task.childSessionId}. Result: ${wakeupResult(task.result, task.childSessionId)}\nAcknowledge receipt with cogpit-session tasks ${task.parentSessionId} --ack ${task.id}.`
}

/**
 * The prompt that wakes a parent while a session it delegated to is still
 * working but cannot go on alone: it asked something, or the parent's
 * follow-up is stuck in its queue.
 */
export function formatTaskAttention(task: Pick<DelegatedTask, "id" | "childSessionId">, detail: string, next: readonly string[]): string {
  return [`Delegated task ${task.id} needs attention. Child session: ${task.childSessionId}. ${detail}`, ...next].join("\n")
}

/** The child an attention prompt is about, or null for any other text. */
export function parseTaskAttention(text: string): { childSessionId: string } | null {
  const match = ATTENTION_RE.exec(text.trim())
  return match ? { childSessionId: match[1]! } : null
}

export function parseTaskWakeup(text: string): TaskWakeup | null {
  const match = WAKEUP_RE.exec(text.trim())
  if (!match) return null
  const [, taskId, state, childSessionId, raw] = match as unknown as [string, string, TaskWakeup["state"], string, string]
  let result: unknown = raw
  try { result = JSON.parse(raw) } catch { /* cut at the limit; keep the text */ }
  return { taskId, state, childSessionId, result }
}

/** Whether a prompt, possibly cut short, is a wakeup rather than something a person wrote. */
export function isTaskWakeup(text: string): boolean {
  return WAKEUP_START_RE.test(text.trim())
}
