// SHARED SESSION CORE: edit shared/session only; cogpit-memory copies are generated.
import type { BackgroundAgent, SessionStatusInfo } from "./types"

/** A launched background agent, placed by the transcript records that started and ended it. */
export interface AgentLaunch {
  agent: Omit<BackgroundAgent, "done">
  /** Index of the record that launched it */
  launchedAt: number
  /** Index of the record that completed, failed or stopped it; absent while it runs */
  endedAt?: number
}

/**
 * The awaiting-agents status for a session's background agents, or null when
 * none is still running. The batch is every agent launched since the last
 * moment no agent was running, so agents that already finished in this wait
 * still count toward its progress.
 */
export function awaitingAgentsStatus(
  launches: readonly AgentLaunch[],
  pendingQueue = 0,
): SessionStatusInfo | null {
  if (!launches.some((launch) => launch.endedAt === undefined)) return null

  const ordered = [...launches].sort((a, b) => a.launchedAt - b.launchedAt)
  let batchStart = 0
  let busyUntil = -Infinity
  ordered.forEach((launch, index) => {
    if (busyUntil < launch.launchedAt) batchStart = index
    busyUntil = Math.max(busyUntil, launch.endedAt ?? Infinity)
  })

  const batch = ordered.slice(batchStart).map(({ agent, endedAt }) => ({ ...agent, done: endedAt !== undefined }))
  const running = batch.filter((agent) => !agent.done)
  return {
    status: "awaiting_agents",
    pendingQueue,
    pendingAgents: running.length,
    pendingAgentDescriptions: running.map((agent) => agent.description).filter((description) => description.length > 0),
    backgroundAgents: batch,
  }
}
