import { open } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { parseClaudeSession } from "../../shared/session/claude"
import { expandEditToolCalls } from "../../shared/session/edit-calls"
import type { FileSnapshot } from "../../shared/contracts/fileSnapshots"
import { isSinglePathSegment, resolveCanonicalFileWithinRoot } from "./containment"

const MAX_BYTES = 2 * 1024 * 1024

/** Replay recorded successful edits, never reading today's working copy. */
export async function readClaudeFileSnapshot(
  projectsRoot: string,
  sessionId: string,
  transcript: string,
  filePath: string,
): Promise<FileSnapshot | null> {
  if (!isSinglePathSegment(sessionId)) return null
  const session = parseClaudeSession(transcript)
  if (!session.cwd) return null
  const target = resolve(session.cwd, filePath)
  let backup: string | null | undefined
  // The first tracked entry is the pre-edit baseline; later backups can already
  // include earlier edits, so replaying the whole session on them is incorrect.
  for (const line of transcript.split("\n")) {
    let record
    try { record = JSON.parse(line) } catch { continue }
    if (record?.type !== "file-history-snapshot") continue
    const tracked = record.snapshot?.trackedFileBackups
    if (!tracked || typeof tracked !== "object") continue
    for (const [path, value] of Object.entries(tracked)) {
      if (resolve(session.cwd, path) !== target || !value || typeof value !== "object") continue
      const name = (value as { backupFileName?: unknown }).backupFileName
      if (name === null || typeof name === "string") backup = name
      break
    }
    if (backup !== undefined) break
  }
  if (backup === undefined) return null

  let before = ""
  if (backup !== null) {
    if (!isSinglePathSegment(backup)) return null
    const historyRoot = join(dirname(projectsRoot), "file-history")
    const sessionRoot = join(historyRoot, sessionId)
    const path = await resolveCanonicalFileWithinRoot(historyRoot, sessionRoot, join(sessionRoot, backup))
    if (!path) return null
    const handle = await open(path, "r")
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_BYTES) return null
      const buffer = Buffer.alloc(MAX_BYTES + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead > MAX_BYTES || buffer.subarray(0, bytesRead).includes(0)) return null
      before = buffer.toString("utf8", 0, bytesRead)
    } finally { await handle.close() }
  }

  let after = before
  let applied = false
  const seen = new Set<string>()
  for (const turn of session.turns) {
    const calls = [...turn.toolCalls, ...turn.subAgentActivity.flatMap(message => message.toolCalls)]
    for (const source of calls) {
      if (source.isError || source.result === null) continue
      for (const call of expandEditToolCalls([source], session.cwd)) {
        const path = call.input.file_path ?? call.input.path
        if (typeof path !== "string" || resolve(session.cwd, path) !== target || seen.has(call.id)) continue
        seen.add(call.id)
        if (call.name === "Write" && typeof call.input.content === "string") {
          after = call.input.content
        } else if (call.name === "Edit" && typeof call.input.old_string === "string" && typeof call.input.new_string === "string") {
          const oldText = call.input.old_string
          if (!oldText || !after.includes(oldText)) return null
          if (call.input.replace_all === true) after = after.split(oldText).join(call.input.new_string)
          else {
            // Ambiguous matches cannot safely reconstruct a full file.
            if (after.indexOf(oldText, after.indexOf(oldText) + oldText.length) !== -1) return null
            after = after.replace(oldText, () => call.input.new_string as string)
          }
        } else return null
        applied = true
        if (Buffer.byteLength(after) > MAX_BYTES || after.includes("\0")) return null
      }
    }
  }
  return applied ? { before, after } : null
}
