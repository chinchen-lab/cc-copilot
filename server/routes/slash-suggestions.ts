import { resolve } from "node:path"
import type { UseFn } from "../http"
import { listSlashSuggestions, slashAgentKind, isAllowedCommandPath, expandCommand } from "../agents/slashCommands"
export { BUILTIN_SKILLS } from "../agents/claudeCommands"
export { parseFrontmatter, expandCommand, isAllowedCommandPath } from "../agents/slashCommands"

export function registerSlashSuggestionRoutes(use: UseFn) {
  use("/api/slash-suggestions", async (req, res, next) => {
    if (req.method !== "GET") return next()
    const url = new URL(req.url || "/", "http://localhost")
    const kind = slashAgentKind(url.searchParams.get("agentKind"))
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "no-store")
    if (!kind) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: "Unknown agent kind" }))
      return
    }
    const suggestions = await listSlashSuggestions(kind, url.searchParams.get("cwd") || "")
    res.end(JSON.stringify({ suggestions }))
  })

  // POST /api/expand-command — expand a command file with arguments
  use("/api/expand-command", async (req, res, next) => {
    if (req.method !== "POST") return next()

    let body = ""
    req.on("data", (chunk: Buffer) => { body += chunk.toString() })
    req.on("end", async () => {
      try {
        const { filePath, args, agentKind } = JSON.parse(body)
        const kind = slashAgentKind(agentKind)
        if (!filePath || typeof filePath !== "string") {
          res.statusCode = 400
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "filePath required" }))
          return
        }

        // Security: only allow .md files inside the agent's config directories
        if (!kind || !isAllowedCommandPath(filePath, kind)) {
          res.statusCode = 403
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "Access denied" }))
          return
        }

        const expanded = await expandCommand(resolve(filePath), args || "")
        if (expanded === null) {
          res.statusCode = 404
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "Command file not found" }))
          return
        }

        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ content: expanded }))
      } catch {
        res.statusCode = 400
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ error: "Invalid JSON body" }))
      }
    })
  })
}
