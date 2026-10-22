import { readFile } from "node:fs/promises"
import { sendJson, type UseFn } from "../http"
import { findJsonlPath } from "../sessionPaths"
import { storeForPath } from "../agents"

export function registerFileSnapshotRoutes(use: UseFn) {
  use("/api/file-snapshots/", async (req, res, next) => {
    if (req.method !== "GET") return next()
    const url = new URL(req.url || "/", "http://localhost")
    const parts = url.pathname.split("/").filter(Boolean)
    if (parts.length !== 1) return next()
    let sessionId: string
    try { sessionId = decodeURIComponent(parts[0]) } catch {
      return sendJson(res, 400, { error: "Invalid session ID" })
    }
    const filePath = url.searchParams.get("path")
    if (!filePath || filePath.includes("\0")) return sendJson(res, 400, { error: "File path required" })
    try {
      const transcriptPath = await findJsonlPath(sessionId)
      if (!transcriptPath) return sendJson(res, 404, { error: "Session not found" })
      const store = storeForPath(transcriptPath)
      res.setHeader("Cache-Control", "no-store")
      if (!store?.readFileSnapshot) return sendJson(res, 200, null)
      const transcript = await readFile(transcriptPath, "utf8")
      return sendJson(res, 200, await store.readFileSnapshot(transcriptPath, transcript, filePath))
    } catch {
      // Missing/expired backups are normal; callers retain recorded edit diffs.
      return sendJson(res, 200, null)
    }
  })
}
