import { storeForDirName } from "."
import { runtimeForDirName } from "./runtimes"

/** How recently an agent must have written its transcript to count as still working. */
export const AGENT_WRITE_WINDOW_MS = 60_000

/**
 * Whether agents a session started are still working.
 *
 * The runtime running the session answers from the process that hosts them.
 * Their transcripts are the fallback, for a session started outside Cogpit or
 * orphaned by a restart, and for a CLI too old to report its agents: an agent
 * that wrote recently counts as working.
 */
export async function sessionAgentsRunning(dirName: string, sessionId: string, now = Date.now()): Promise<boolean> {
  try {
    if (runtimeForDirName(dirName).activity(sessionId).agentsRunning) return true
    return await storeForDirName(dirName).agentsWroteSince(dirName, sessionId, now - AGENT_WRITE_WINDOW_MS)
  } catch {
    // A transcript whose provider instance was removed has no agents left.
    return false
  }
}
