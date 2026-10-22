import { execFile } from "node:child_process"
import { createHash } from "node:crypto"

import { allDescriptors } from "../../shared/session/agent-descriptors"
import type {
  SystemProcessKind,
  SystemProcessMetric,
  SystemProcessesSnapshot,
  SystemProcessTarget,
} from "../../shared/contracts/performance"

/**
 * System-wide view of agent-related processes (Claude sessions, headless
 * browsers, agent tooling). Cogpit's own metrics only cover its process tree,
 * but macOS attributes energy from every descendant — and leaked descendants
 * (orphaned sessions, unclosed browsers) are exactly what drains the battery
 * while the in-app numbers look idle.
 */

export interface RawProcess {
  pid: number
  ppid: number
  cpuPercent: number
  rssKb: number
  etime: string
  command: string
  uid?: number
  startedAt?: string
}

const MAX_LISTED_PROCESSES = 20
const MAX_COMMAND_CHARS = 200
const HOT_BROWSER_CPU_PERCENT = 10
// A busy browser younger than this is likely mid-automation, not leaked.
const HOT_BROWSER_MIN_AGE_SECONDS = 30 * 60

export function parseEtimeSeconds(etime: string): number {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim())
  if (!match) return 0
  const [, days, hours, minutes, seconds] = match
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds)
  )
}

export function parsePsOutput(text: string): RawProcess[] {
  const rows: RawProcess[] = []
  for (const line of text.split("\n")) {
    const identified = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*\S)/.exec(line)
    if (identified) {
      rows.push({ pid: Number(identified[1]), ppid: Number(identified[2]), uid: Number(identified[3]), cpuPercent: Number(identified[4]), rssKb: Number(identified[5]), etime: identified[6], startedAt: identified[7].replace(/\s+/g, " "), command: identified[8] })
      continue
    }
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*\S)/.exec(line)
    if (!match) continue
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      cpuPercent: Number(match[3]),
      rssKb: Number(match[4]),
      etime: match[5],
      command: match[6],
    })
  }
  return rows
}

/**
 * How to spot each agent CLI in a `ps` line, and what to call it.
 *
 * Driven by the descriptor table so a CLI cannot be left out — the matcher used
 * to hard-code "claude", which meant an orphaned Codex or Copilot session was
 * neither reported as a leak nor reaped.
 */
const AGENT_MATCHERS: ReadonlyArray<{
  kind: SystemProcessKind
  pattern: RegExp
  label: string
}> = allDescriptors().map((descriptor) => ({
  kind: descriptor.kind,
  // Either invoked by name, or run out of a versioned install directory.
  pattern: new RegExp(
    `(?:^|/)${descriptor.binName}(?:\\s|$)|\\.local/share/${descriptor.binName}/versions/`,
  ),
  label: `${descriptor.displayName} session`,
}))

function classifyKind(command: string): SystemProcessKind | null {
  if (/Cogpit Helper|Cogpit\.app/.test(command)) return "cogpit"
  if (/chrome-headless-shell|headless_shell/.test(command)) return "headless-browser"
  if (/agent-browser\/(?:bin|dist)/.test(command)) return "browser-daemon"
  const agent = AGENT_MATCHERS.find((matcher) => matcher.pattern.test(command))
  if (agent) return agent.kind
  if (
    /(?:^|\/)(?:bun|node)(?:\s|$)/.test(command) &&
    /scratchpad|\/tmp\/|\s-e\s/.test(command)
  ) {
    return "script"
  }
  return null
}

function labelFor(kind: SystemProcessKind, command: string): string {
  const agent = AGENT_MATCHERS.find((matcher) => matcher.kind === kind)
  if (agent) return agent.label
  if (kind === "headless-browser") return "Headless Chrome"
  if (kind === "browser-daemon") return "agent-browser daemon"

  if (kind === "cogpit") {
    const helper = /Cogpit Helper(?: \((?:Renderer|GPU|Plugin)\))?/.exec(command)
    return helper ? helper[0].replace("Cogpit", "CC-Copilot") : "CC-Copilot"
  }

  // Scripts and shells: "<runtime> <script-basename>", e.g. "bun ua-echo.ts"
  const [executable, firstArg] = command.split(/\s+/)
  const runtime = executable.split("/").pop() ?? executable
  const script = firstArg && !firstArg.startsWith("-") ? firstArg.split("/").pop() : null
  return script ? `${runtime} ${script}` : runtime
}

function buildChildrenIndex(rows: RawProcess[]): Map<number, RawProcess[]> {
  const childrenOf = new Map<number, RawProcess[]>()
  for (const row of rows) {
    const siblings = childrenOf.get(row.ppid) ?? []
    siblings.push(row)
    childrenOf.set(row.ppid, siblings)
  }
  return childrenOf
}

export interface OrphanedAgentSubtree {
  rootPid: number
  command: string
  ageSeconds: number
  /** Root pid plus every descendant it keeps alive */
  pids: number[]
}

const AGENT_KIND_SET = new Set<SystemProcessKind>(AGENT_MATCHERS.map((matcher) => matcher.kind))

/**
 * An agent session whose parent died (reparented to launchd) is a leak, and
 * so is everything it keeps alive underneath it. These are the only subtrees
 * safe to auto-reap: nothing can still be controlling them.
 */
export function collectOrphanedAgentSubtrees(rows: RawProcess[]): OrphanedAgentSubtree[] {
  const childrenOf = buildChildrenIndex(rows)
  const subtrees: OrphanedAgentSubtree[] = []
  for (const row of rows) {
    const kind = classifyKind(row.command)
    if (row.ppid !== 1 || kind === null || !AGENT_KIND_SET.has(kind)) continue
    const pids: number[] = []
    const collect = (pid: number): void => {
      if (pids.includes(pid)) return
      pids.push(pid)
      for (const child of childrenOf.get(pid) ?? []) collect(child.pid)
    }
    collect(row.pid)
    subtrees.push({
      rootPid: row.pid,
      command: row.command,
      ageSeconds: parseEtimeSeconds(row.etime),
      pids,
    })
  }
  return subtrees
}

export function classifyProcesses(rows: RawProcess[], selfPid: number, runtimes: ReadonlySet<number> = new Set(), sustained: ReadonlySet<number> = new Set()): SystemProcessMetric[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]))

  const isDescendantOf = (row: RawProcess, ancestorPid: number): boolean => {
    let current: RawProcess | undefined = row
    for (let depth = 0; current && depth < 32; depth++) {
      if (current.pid === ancestorPid) return true
      current = byPid.get(current.ppid)
    }
    return false
  }

  const leakedSubtree = new Set<number>(
    collectOrphanedAgentSubtrees(rows).flatMap((subtree) => subtree.pids),
  )

  const metrics: SystemProcessMetric[] = []
  for (const row of rows) {
    if (row.pid === selfPid) continue
    if (/(?:^|\/)ps(?:\s|$)/.test(row.command)) continue

    const inLeakedTree = leakedSubtree.has(row.pid)
    const knownKind = classifyKind(row.command)
    const kind = knownKind ?? (runtimes.has(row.pid) ? "script" :
      (inLeakedTree || isDescendantOf(row, selfPid) ? "other" : null))
    if (!kind) continue

    const ageSeconds = parseEtimeSeconds(row.etime)
    const orphaned = row.ppid === 1 && kind !== "cogpit" && kind !== "browser-daemon"
    const hotBrowser =
      (kind === "headless-browser" || kind === "browser-daemon") &&
      row.cpuPercent >= HOT_BROWSER_CPU_PERCENT &&
      ageSeconds >= HOT_BROWSER_MIN_AGE_SECONDS
    const suspectedLeak = inLeakedTree || hotBrowser || (knownKind === "script" && row.ppid === 1) || sustained.has(row.pid)

    metrics.push({
      pid: row.pid,
      kind,
      label: labelFor(kind, row.command),
      command: row.command.slice(0, MAX_COMMAND_CHARS),
      cpuPercent: row.cpuPercent,
      memoryMb: Math.round(row.rssKb / 1024),
      ageSeconds,
      orphaned,
      suspectedLeak,
      identity: processIdentity(row),
      ...(sustained.has(row.pid) ? { warning: "sustained-cpu" as const } : {}),
    })
  }

  return metrics
    .sort((a, b) => {
      if (a.suspectedLeak !== b.suspectedLeak) return a.suspectedLeak ? -1 : 1
      return b.cpuPercent - a.cpuPercent || b.ageSeconds - a.ageSeconds
    })
    .slice(0, MAX_LISTED_PROCESSES)
}

const PS_COLUMNS = "pid=,ppid=,uid=,pcpu=,rss=,etime=,lstart=,args="

function runProcessCommand(file: string, args: string[], maxBuffer = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { maxBuffer, timeout: 2_000, env: { ...process.env, LC_ALL: "C" } },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
}

export function listSystemProcesses(): Promise<string> {
  return runProcessCommand("ps", ["-axo", PS_COLUMNS])
}

export function processIdentity(row: RawProcess): string | undefined {
  if (!row.startedAt || row.uid === undefined) return undefined
  return createHash("sha256").update(JSON.stringify([row.pid, row.uid, row.startedAt, row.command])).digest("hex")
}

export function isRuntimeCommand(command: string): boolean {
  const executable = command.trim().split(/\s+/, 1)[0].split("/").pop() ?? ""
  return /^(?:bun(?:\.exe)?|node|python(?:\d+(?:\.\d+)*)?|pypy\d*|ruby|perl|php|deno|java)$/i.test(executable)
}

export function outputDescriptorPaths(text: string): string[] {
  const paths = new Set<string>()
  let output = false
  for (const line of text.split("\n")) {
    if (line.startsWith("f")) output = /^[12](?:\D|$)/.test(line.slice(1))
    else if (output && line.startsWith("n")) paths.add(line.slice(1))
  }
  return [...paths]
}

interface Observation {
  identity: string
  hotSince?: number
  lastSeenAt: number
  inspectedAt?: number
  owner?: SystemProcessMetric["owner"]
}

interface MonitorDeps {
  list: () => Promise<string>
  inspect: (pid: number) => Promise<string[]>
  owner: (paths: readonly string[]) => Promise<SystemProcessMetric["owner"]>
  read: (pid: number) => Promise<RawProcess | undefined>
  signal: (pid: number) => void
  now: () => number
  uid: number | undefined
  selfPid: number
}

const CAPTURE_INTERVAL_MS = 5_000
const SUSTAINED_CPU_MS = 30_000
const OWNERSHIP_CACHE_MS = 5 * 60_000

export class SystemProcessMonitor {
  private readonly observations = new Map<number, Observation>()
  private snapshot?: SystemProcessesSnapshot
  private pending?: Promise<SystemProcessesSnapshot>

  constructor(private readonly deps: MonitorDeps) {}

  capture(): Promise<SystemProcessesSnapshot> {
    if (this.pending) return this.pending
    if (this.snapshot && this.deps.now() - this.snapshot.capturedAt < CAPTURE_INTERVAL_MS) return Promise.resolve(this.snapshot)
    this.pending = this.scan().finally(() => { this.pending = undefined })
    return this.pending
  }

  private async scan(): Promise<SystemProcessesSnapshot> {
    const rows = parsePsOutput(await this.deps.list())
    const now = this.deps.now()
    const candidates = rows.filter((row) => {
      if (row.pid === this.deps.selfPid || row.uid !== this.deps.uid || !processIdentity(row) || !isRuntimeCommand(row.command)) return false
      const kind = classifyKind(row.command)
      return (row.cpuPercent >= 25 && parseEtimeSeconds(row.etime) >= 300 && (kind === null || kind === "script")) ||
        (kind === "script" && row.ppid === 1)
    }).sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 8)
    const candidatePids = new Set(candidates.map((row) => row.pid))
    for (const pid of this.observations.keys()) if (!candidatePids.has(pid)) this.observations.delete(pid)
    const sustained = new Set<number>()
    const probes: Promise<void>[] = []
    let inspections = 0
    for (const row of candidates) {
      const identity = processIdentity(row)!
      let observed = this.observations.get(row.pid)
      if (!observed || observed.identity !== identity || now - observed.lastSeenAt > 120_000) {
        observed = { identity, lastSeenAt: now }
        this.observations.set(row.pid, observed)
      }
      observed.lastSeenAt = now
      if (row.cpuPercent >= 25) observed.hotSince ??= now
      else observed.hotSince = undefined
      if (observed.hotSince !== undefined && now - observed.hotSince >= SUSTAINED_CPU_MS) sustained.add(row.pid)
      if (!sustained.has(row.pid) && !(classifyKind(row.command) === "script" && row.ppid === 1)) continue
      if (inspections >= 2 || (observed.inspectedAt !== undefined && now - observed.inspectedAt < OWNERSHIP_CACHE_MS)) continue
      inspections++
      observed.inspectedAt = now
      const observation = observed
      probes.push((async () => {
        try {
          const paths = await this.deps.inspect(row.pid)
          const current = await this.deps.read(row.pid)
          if (current && processIdentity(current) === identity) observation.owner = await this.deps.owner(paths)
        } catch { /* Ownership stays unknown. */ }
      })())
    }
    await Promise.all(probes)
    const byPid = new Map(rows.map((row) => [row.pid, row]))
    const processes = classifyProcesses(rows, this.deps.selfPid, candidatePids, sustained).map((metric) => {
      const row = byPid.get(metric.pid)!
      return { ...metric, owner: this.observations.get(metric.pid)?.owner, canStop: metric.suspectedLeak && metric.kind !== "cogpit" && !!metric.identity && row.uid === this.deps.uid }
    })
    this.snapshot = { capturedAt: now, processes, suspectedLeakCount: processes.filter((metric) => metric.suspectedLeak).length }
    return this.snapshot
  }

  async stop(targets: readonly SystemProcessTarget[]): Promise<number[]> {
    const snapshot = await this.capture()
    const byPid = new Map(snapshot.processes.map((metric) => [metric.pid, metric]))
    const uniqueTargets = new Map(targets.map((target) => [target.pid, target]))
    const stopped = await Promise.all([...uniqueTargets.values()].map(async (target) => {
      const listed = byPid.get(target.pid)
      if (!listed?.canStop || listed.identity !== target.identity || target.pid <= 1 || target.pid === this.deps.selfPid) return null
      try {
        const current = await this.deps.read(target.pid)
        if (!current || current.uid !== this.deps.uid || processIdentity(current) !== target.identity) return null
        this.deps.signal(target.pid)
        return target.pid
      } catch { /* Exited or no longer accessible. */ }
      return null
    }))
    this.snapshot = undefined
    return stopped.filter((pid): pid is number => pid !== null)
  }
}

const monitor = new SystemProcessMonitor({
  list: listSystemProcesses,
  inspect: async (pid) => outputDescriptorPaths(await runProcessCommand("lsof", ["-nP", "-a", "-p", String(pid), "-d", "1,2", "-Ffn"], 64 * 1024)),
  owner: async (paths) => (await import("../agents/processOwnership")).resolveProcessOwner(paths),
  read: async (pid) => parsePsOutput(await runProcessCommand("ps", ["-p", String(pid), "-o", PS_COLUMNS]))[0],
  signal: (pid) => process.kill(pid, "SIGTERM"),
  now: Date.now,
  uid: process.getuid?.(),
  selfPid: process.pid,
})

export async function captureSystemProcesses(): Promise<SystemProcessesSnapshot | undefined> {
  return process.platform === "win32" ? undefined : monitor.capture()
}

export function stopSystemProcesses(targets: readonly SystemProcessTarget[]): Promise<number[]> {
  return monitor.stop(targets)
}
