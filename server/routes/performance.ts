import { performance } from "node:perf_hooks"

import { sendJson, type Middleware, type UseFn } from "../http"
import {
  createServerPerformanceSnapshot,
  normalizeApiPath,
  recordRequest,
} from "../lib/activityMonitor"
import { captureSystemProcesses, stopSystemProcesses } from "../lib/systemProcesses"
import { getRecentlyReaped, startLeakReaper } from "../lib/leakReaper"
import { mayActHostWide } from "../edition"
import type { SystemProcessTarget } from "../../shared/contracts/performance"

const requestMonitor: Middleware = (req, res, next) => {
  const label = normalizeApiPath(req.url ?? "/", req.method)
  if (label === "GET /api/performance") {
    next()
    return
  }

  const started = performance.now()
  let recorded = false
  const finish = () => {
    if (recorded) return
    recorded = true
    recordRequest(label, performance.now() - started)
  }
  res.once("finish", finish)
  res.once("close", finish)
  next()
}

export function registerPerformanceRoutes(use: UseFn): void {
  startLeakReaper()

  // Register first so all later API handlers are measured.
  use("/api", requestMonitor)

  use("/api/system-processes", (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost")

    if (req.method === "GET" && url.pathname === "/") {
      if (!mayActHostWide(req)) return sendJson(res, 403, { error: "Host access required" })
      void (async () => {
        try {
          const snapshot = await captureSystemProcesses()
          sendJson(res, 200, { ...snapshot, recentlyReaped: getRecentlyReaped() })
        } catch {
          sendJson(res, 500, { error: "Process listing failed" })
        }
      })()
      return
    }

    if (req.method === "POST" && url.pathname === "/kill") {
      if (!mayActHostWide(req)) return sendJson(res, 403, { error: "Host access required" })
      let body = ""
      let tooLarge = false
      req.on("data", (chunk: string) => {
        if (body.length + chunk.length > 16_384) tooLarge = true
        if (!tooLarge) body += chunk
      })
      req.on("end", () => {
        void (async () => {
          if (tooLarge) return sendJson(res, 413, { error: "Request too large" })
          let requested: SystemProcessTarget[]
          try {
            const parsed = JSON.parse(body)
            if (!Array.isArray(parsed.processes) || parsed.processes.length > 20 || !parsed.processes.every((target: SystemProcessTarget | null) => target && Number.isSafeInteger(target.pid) && target.pid > 1 && typeof target.identity === "string" && /^[a-f0-9]{64}$/.test(target.identity))) {
              return sendJson(res, 400, { error: "Expected processes with PID and start identity" })
            }
            requested = parsed.processes
          } catch {
            return sendJson(res, 400, { error: "Invalid JSON body" })
          }

          try {
            const killed = await stopSystemProcesses(requested)
            sendJson(res, 200, {
              killed,
              skipped: requested.map((target) => target.pid).filter((pid) => !killed.includes(pid)),
            })
          } catch {
            sendJson(res, 500, { error: "Kill failed" })
          }
        })()
      })
      return
    }

    next()
  })

  use("/api/performance", (req, res, next) => {
    if (req.method !== "GET") return next()
    const url = new URL(req.url ?? "/", "http://localhost")
    if (url.pathname !== "/") return next()

    void (async () => {
      const snapshot = createServerPerformanceSnapshot()
      // The system-wide process list mirrors GET /api/system-processes, which
      // is host-wide — gate it the same way here.
      if (mayActHostWide(req)) {
        try {
          snapshot.system = await captureSystemProcesses()
        } catch {
          // System-wide process listing is best-effort; the core snapshot still ships.
        }
      }
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify(snapshot))
    })()
  })
}
