// Prompts Cogpit writes into a session on someone else's behalf, recognised by
// their opening line. The contracts that format them read these patterns too.
import { parseAgentEnvelope } from "./agentEnvelope"

export const CREW_CHAT_DELIVERY_RE = /^Crew chat · ([^\n]+) · message (\d+)(?:\n|$)/
export const TASK_WAKEUP_START_RE = /^Delegated task \S+ (?:running|completed|error|cancelled|needs attention)\. Child session: /

/** Whether a prompt came from the reader rather than a crew, a child task or another agent. */
export function isReaderPrompt(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (CREW_CHAT_DELIVERY_RE.test(trimmed) || TASK_WAKEUP_START_RE.test(trimmed)) return false
  return parseAgentEnvelope(trimmed).sender === null
}
