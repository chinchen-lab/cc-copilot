import { allStores } from "./index"
import { readTranscriptHead } from "./transcriptHead"
import type { AgentStore } from "./types"
import type { SystemProcessMetric } from "../../shared/contracts/performance"

type ProcessOwner = NonNullable<SystemProcessMetric["owner"]>

export function taskOutputOwner(paths: readonly string[]): { dirName: string; sessionId: string; taskId: string } | undefined {
  const owners = new Map<string, { dirName: string; sessionId: string; taskId: string }>()
  for (const path of paths) {
    const match = /^\/(?:private\/)?tmp\/claude-\d+\/([^/]+)\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\/tasks\/([\w-]+)\.output(?: \(deleted\))?$/i.exec(path)
    if (!match || match[1] === "." || match[1] === "..") continue
    const owner = { dirName: match[1], sessionId: match[2], taskId: match[3] }
    owners.set(JSON.stringify(owner), owner)
  }
  return owners.size === 1 ? owners.values().next().value : undefined
}

export async function resolveProcessOwner(paths: readonly string[], stores: readonly AgentStore[] = allStores()): Promise<ProcessOwner | undefined> {
  const evidence = taskOutputOwner(paths)
  if (!evidence) return undefined
  const owner: ProcessOwner = { sessionId: evidence.sessionId, taskId: evidence.taskId }
  const matches: ProcessOwner[] = []
  for (const store of stores) {
    if (store.kind !== "claude") continue
    try {
      const fileName = store.descriptor.sessionFile.name(evidence.sessionId)
      const path = await store.resolveSessionFile(evidence.dirName, fileName)
      if (!path) continue
      const meta = await store.readSessionMeta(path, await readTranscriptHead(path))
      const address = await store.sessionAddress(path)
      if (!address || meta.sessionId !== evidence.sessionId) continue
      matches.push({ ...owner, ...address, title: (meta.customTitle || meta.aiTitle || meta.firstUserMessage || meta.slug).slice(0, 200) || undefined })
    } catch {
      // The output descriptor still identifies a session whose transcript is unavailable.
    }
  }
  return matches.length === 1 ? matches[0] : owner
}
