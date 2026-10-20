import { IncomingMessage } from "node:http"
import { Socket } from "node:net"
import { accessLevelOf, editionModule } from "../edition"
import { orchestrationStore } from "../orchestration/storage"
import { accessAtLeast } from "../../shared/contracts/sessionAccess"
import { hostForSession } from "../sessionHosts"
import { attachTaskAuthority, type TaskAuthority } from "../orchestration/delegatedTasks"
import { commandScope, refreshExecutionRequest } from "./durableSend"
export function delegationAuthority(req: IncomingMessage, access: "view" | "interact" = "interact"): TaskAuthority {
  return {
    async authorize(id) { const fresh = refreshExecutionRequest(req); if (!fresh) return false; const level = await accessLevelOf(fresh, id); return level !== null && accessAtLeast(level, access) },
    async host(id) { const fresh = refreshExecutionRequest(req); if (!fresh) throw new Error("Delegation authority expired"); const host = await hostForSession(id); return { state: (sid) => host.state(sid), result: (sid) => host.result(sid), ...(host.receipt && { receipt: (commandId: string) => host.receipt!(commandId, fresh) }), stop: (sid) => host.stop(sid), send: (sid, message, options) => host.send(sid, message, { ...options, req: fresh }) } },
  }
}
export function resumeDelegations(req: IncomingMessage, parentSessionId: string) { attachTaskAuthority(commandScope(req), parentSessionId, delegationAuthority(req)) }

/**
 * Re-arms result delivery for every parent with unread results after a
 * restart, which otherwise waits for the parent's next `new` or `tasks`. Only
 * the personal edition can act without a signed-in request.
 */
export function resumeLocalDelegations(): void {
  if (editionModule().auth) return
  try {
    const parents = new Set(orchestrationStore().tasks("local").filter((task) => !task.acknowledgedAt && task.state !== "cancelled").map((task) => task.parentSessionId))
    for (const parent of parents) resumeDelegations(new IncomingMessage(new Socket()), parent)
  } catch (error) {
    console.error("[orchestration] could not resume delegated results", error)
  }
}
