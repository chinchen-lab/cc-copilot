import { useTranslation } from "@/hooks/useTranslation"
import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect } from "react"
import { Play, Server, Square, TerminalSquare } from "lucide-react"
import { useVisiblePolling } from "@/hooks/useVisiblePolling"
import { cn } from "@/lib/utils"
import { authFetch } from "@/lib/auth"
import { SectionHeading } from "@/components/stats/SectionHeading"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Turn } from "../../../shared/session/types"
import { parseTaskNotifications } from "@/lib/userMessageContent"
import type { DiscoveredTask, ProcessEntry } from "@/hooks/useProcessPanel"

// ── Types ───────────────────────────────────────────────────────────────────

interface BgTask {
  id: string
  sessionId?: string
  outputPath: string | null
  ports: number[]
  portStatus: Record<number, boolean>
  preview: string
}

interface BackgroundServersProps {
  cwd: string
  sessionId?: string
  turns: Turn[]
  /** The user may stop this session's processes: offers Stop on each running server. */
  canStop?: boolean
  onToggleServer?: (id: string, outputPath: string, title: string) => void
  onServersChanged?: (servers: DiscoveredTask[]) => void
}

// ── Port Detection ──────────────────────────────────────────────────────────

const PORT_RE = /(?::(\d{4,5}))|(?:port\s+(\d{4,5}))|(?:localhost:(\d{4,5}))/gi

function detectPorts(text: string): number[] {
  const ports = new Set<number>()
  for (const m of text.matchAll(PORT_RE)) {
    const p = parseInt(m[1] || m[2] || m[3], 10)
    if (p > 0 && p < 65536) ports.add(p)
  }
  return [...ports]
}

// ── JSONL Port Extraction ───────────────────────────────────────────────────

function useJsonlPorts(turns: Turn[]): Map<number, { description: string; outputPath: string | null }> {
  return useMemo(() => {
    const portMap = new Map<number, { description: string; outputPath: string | null }>()
    for (let i = 0; i < turns.length; i++) {
      for (const tc of turns[i].toolCalls) {
        if (tc.name !== "Bash" || !tc.input.run_in_background) continue
        const command = (tc.input.command as string) || ""
        const description = (tc.input.description as string) || ""
        const assistantText = turns[i].assistantText?.join(" ") || ""
        const allText = [command, description, tc.result || "", assistantText].join(" ")
        const ports = detectPorts(allText)
        if (ports.length === 0) {
          const devCmd = command.toLowerCase()
          if (devCmd.includes("run dev") || devCmd.includes("next dev") || devCmd.includes("vite")) {
            ports.push(3000)
          }
        }
        const outputMatch = (tc.result || "").match(/Output is being written to:\s*(\S+)/)
        const outputPath = outputMatch ? outputMatch[1] : null
        for (const port of ports) {
          portMap.set(port, { description: description || command.replace(/^cd\s+"[^"]*"\s*&&\s*/, "").slice(0, 60), outputPath })
        }
      }
    }
    return portMap
  }, [turns])
}

// ── Task Title Helper ───────────────────────────────────────────────────────

function getTaskTitle(task: BgTask): string {
  return task.preview.split("\n").find((l) => l.trim())?.trim() || `Task ${task.id}`
}

const STATUS_LABELS: Record<ProcessEntry["status"], string> = {
  running: "Running", stopped: "Stopped", errored: "Failed", completed: "Completed", unknown: "Output available",
}

function taskStatus(task: BgTask, sessionId: string | undefined, states: Map<string, ProcessEntry["status"]>): ProcessEntry["status"] {
  if (task.ports.some(port => task.portStatus[port])) return "running"
  return task.sessionId && task.sessionId === sessionId ? states.get(task.id) ?? "unknown" : "unknown"
}

// ── Port Badge ──────────────────────────────────────────────────────────────

function PortBadge({ port, isActive }: { port: number; isActive: boolean }): React.JSX.Element {
  return (
    <Badge variant="secondary" className="font-mono">
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          isActive ? "bg-success" : "bg-muted-foreground/40"
        )}
      />
      <span className={isActive ? "text-success" : "text-muted-foreground"}>
        :{port}
      </span>
    </Badge>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export function BackgroundServers({
  cwd,
  sessionId,
  turns,
  canStop = false,
  onToggleServer,
  onServersChanged,
}: BackgroundServersProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<BgTask[]>([])
  const jsonlPorts = useJsonlPorts(turns)
  const taskStates = useMemo(() => {
    const states = new Map<string, ProcessEntry["status"]>()
    for (const turn of turns) for (const block of turn.contentBlocks) {
      if (block.kind !== "task_notification") continue
      for (const notice of parseTaskNotifications(block.content).notifications) {
        const label = notice.status === "completed" ? "completed"
          : notice.status === "failed" || notice.status === "error" ? "errored"
          : notice.status === "killed" || notice.status === "cancelled" || notice.status === "stopped" ? "stopped"
          : notice.status === "running" ? "running" : null
        if (label && notice.taskId) states.set(notice.taskId, label)
      }
    }
    return states
  }, [turns])

  const jsonlPortsRef = useRef(jsonlPorts)
  useLayoutEffect(() => { jsonlPortsRef.current = jsonlPorts }, [jsonlPorts])
  const poll = useCallback(async (isActive: () => boolean) => {
    const publish = (next: BgTask[]) => {
      if (isActive()) setTasks((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    }
    let apiTasks: BgTask[] = []
    let receivedTasks = false
    try {
      const res = await authFetch(`/api/background-tasks?cwd=${encodeURIComponent(cwd)}`)
      if (!isActive()) return
      if (res.ok) {
        apiTasks = await res.json()
        receivedTasks = true
        if (!isActive()) return
      }
      const ports = jsonlPortsRef.current
      const listedPorts = new Set(apiTasks.flatMap(task => task.ports))
      const portsToCheck = [...ports.keys()].filter(port => !listedPorts.has(port))
      if (portsToCheck.length === 0) { publish(apiTasks); return }
      const portRes = await authFetch(`/api/check-ports?ports=${portsToCheck.join(",")}`)
      if (!isActive()) return
      if (!portRes.ok) { publish(apiTasks); return }
      const portStatus: Record<number, boolean> = await portRes.json()
      const fallbackTasks: BgTask[] = []
      for (const [port, info] of ports) {
        if (listedPorts.has(port) || !portStatus[port]) continue
        fallbackTasks.push({ id: `port-${port}`, outputPath: info.outputPath, ports: [port], portStatus: { [port]: true }, preview: info.description })
      }
      publish([...apiTasks, ...fallbackTasks])
    } catch {
      if (receivedTasks) publish(apiTasks)
      // The next visible poll retries.
    }
  }, [cwd])
  useVisiblePolling(cwd ? poll : null, 10_000)

  const handleKillPort = useCallback(
    async (port: number) => {
      try {
        await authFetch("/api/kill-port", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ port }),
        })
        setTimeout(() => {
          setTasks((prev) => prev.filter((t) => !t.ports.includes(port)))
        }, 1500)
      } catch {
        /* ignore */
      }
    },
    []
  )

  // Report discovered servers to parent for the ServerPanel badges
  const lastReport = useRef<{ callback: NonNullable<BackgroundServersProps["onServersChanged"]>; value: string } | null>(null)
  useEffect(() => {
    if (!onServersChanged) { lastReport.current = null; return }
    const discovered = tasks
      .filter((t) => t.outputPath)
      .map((t) => ({
        id: t.id,
        outputPath: t.outputPath!,
        title: getTaskTitle(t),
        status: taskStatus(t, sessionId, taskStates),
      }))
    const value = JSON.stringify(discovered)
    if (lastReport.current?.callback === onServersChanged && lastReport.current.value === value) return
    lastReport.current = { callback: onServersChanged, value }
    onServersChanged(discovered)
  }, [tasks, onServersChanged, sessionId, taskStates])

  if (tasks.length === 0) return null

  return (
    <section>
      <SectionHeading>{t("Background Tasks (")}{tasks.length})</SectionHeading>
      <div className="flex flex-col gap-1.5">
        {tasks.map((task) => {
          const activePorts = task.ports.filter((p) => task.portStatus[p])
          const title = getTaskTitle(task)
          const isServer = task.ports.length > 0
          const status = taskStatus(task, sessionId, taskStates)

          return (
            <div
              key={`${task.sessionId ?? ""}:${task.id}`}
              className="border-b border-border px-2 py-2 last:border-b-0"
            >
              <div className="flex items-center gap-1.5">
                  {isServer
                    ? <Server className="size-3 shrink-0 text-success" data-icon="inline-start" />
                    : <Play className="size-3 shrink-0 text-muted-foreground" data-icon="inline-start" />}
                  <span className="truncate text-xs font-medium text-foreground">
                    {title}
                  </span>
              </div>

              <div className="mt-1.5 flex items-center gap-1.5">
                {!isServer && <Badge variant="secondary">{t(STATUS_LABELS[status])}</Badge>}
                {task.ports.map((port) => (
                  <PortBadge key={port} port={port} isActive={task.portStatus[port]} />
                ))}

                <div className="flex-1" />

                {task.outputPath && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onToggleServer?.(task.id, task.outputPath!, title)}
                    title={t(isServer ? "View server output" : "View task output")}
                    aria-label={t(isServer ? "View server output" : "View task output")}
                  >
                    <TerminalSquare data-icon="inline-start" />
                  </Button>
                )}
                {canStop && activePorts.length > 0 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-destructive"
                    onClick={() => activePorts.forEach((p) => handleKillPort(p))}
                    title={t("Stop server")}
                    aria-label={t("Stop server")}
                  >
                    <Square data-icon="inline-start" className="fill-current" />
                    <span>{t("Stop")}</span>
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
