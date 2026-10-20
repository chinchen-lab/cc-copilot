/**
 * When a session counts as working, for every view that says so: the session
 * list, the Crew panel and the session CLI's `status` and `wait`.
 */

/** Transcript tail statuses that mean the agent is mid-flight. */
export const WORKING_STATUSES: ReadonlySet<string> = new Set([
  "thinking",
  "tool_use",
  "processing",
  "compacting",
  "awaiting_agents",
])

/**
 * How recently a transcript must have changed to back a mid-flight tail when
 * no process is known to hold the session. A tail stays mid-flight forever on
 * a session killed partway through a turn.
 */
export const RECENT_ACTIVITY_MS = 120_000
