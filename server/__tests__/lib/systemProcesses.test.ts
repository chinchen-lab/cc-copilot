import { describe, expect, it, vi } from "vitest"

import {
  classifyProcesses,
  parseEtimeSeconds,
  parsePsOutput,
  collectOrphanedAgentSubtrees,
  outputDescriptorPaths,
  processIdentity,
  SystemProcessMonitor,
} from "../../lib/systemProcesses"

// Modeled on a real leak incident: an orphaned claude session (ppid 1) kept a
// runaway bun test script alive for 64 days, and a leaked agent-browser
// headless Chrome burned ~55% CPU for 2 days — none of it visible in Cogpit.
const PS_FIXTURE = [
  "  100     1  0.0  20000 64-02:09:34 claude",
  "  101   100  0.0   1000 64-00:23:44 /bin/zsh -c source /Users/me/.claude/shell-snapshots/snap.sh",
  "  102   101 19.0  90000 63-23:58:56 bun -e process.stdout.write('hi')",
  "  200     1  0.0  40000 01-22:55:47 node /Users/me/.bun/install/global/node_modules/agent-browser/bin/../dist/daemon.js",
  "  201   200  0.0  50000 01-22:55:46 /Users/me/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell --type=browser",
  "  202   201 54.6 150000 01-22:55:46 /Users/me/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell --type=renderer",
  "  300   299  8.1 120000       02:45 claude --dangerously-skip-permissions",
  "  310     1  0.0  25000 30-01:00:00 codex exec resume 0f1e2d3c-4b5a-4968-8877-665544332211",
  "  311   310  0.0   1000 30-00:59:00 /bin/zsh -c ls",
  "  320     1  0.0  22000 20-01:00:00 /Users/me/.local/share/copilot/versions/1.0.81/copilot --resume",
  "  301     1  0.0  30000 09-17:04:03 bun /private/tmp/claude-501/project/scratchpad/ua-echo.ts",
  "  400     1  3.4 400000    14:29:11 /Applications/Cogpit.app/Contents/Frameworks/Cogpit Helper (Renderer).app/Contents/MacOS/Cogpit Helper (Renderer) --type=renderer",
  "  500   499  0.0   5000       01:02 ps -axo pid=,ppid=,pcpu=,rss=,etime=,args=",
  "  600     1  2.0  80000 10-00:00:00 /Applications/Spotify.app/Contents/MacOS/Spotify",
].join("\n")

describe("parseEtimeSeconds", () => {
  it("parses MM:SS, HH:MM:SS, and DD-HH:MM:SS forms", () => {
    expect(parseEtimeSeconds("02:45")).toBe(165)
    expect(parseEtimeSeconds("14:29:11")).toBe(14 * 3600 + 29 * 60 + 11)
    expect(parseEtimeSeconds("64-02:09:34")).toBe(64 * 86400 + 2 * 3600 + 9 * 60 + 34)
  })

  it("returns 0 for malformed input", () => {
    expect(parseEtimeSeconds("")).toBe(0)
    expect(parseEtimeSeconds("garbage")).toBe(0)
  })
})

const PYTHON_COMMAND = "/opt/homebrew/opt/python@3.14/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python -"
function runtimeRow(pid = 53013, cpu = 98, started = "Sat Oct 3 18:48:32 2026", uid = 501, command = PYTHON_COMMAND) {
  return `${pid} 1 ${uid} ${cpu} 40000 15-01:00:00 ${started} ${command}`
}

function runtimeMonitor() {
  let now = 0
  const deps = {
    list: vi.fn(async () => runtimeRow()),
    inspect: vi.fn(async () => ["/tmp/task.output"]),
    owner: vi.fn(async () => undefined),
    read: vi.fn(async (pid: number) => parsePsOutput(runtimeRow(pid))[0]),
    signal: vi.fn(),
    now: () => now,
    uid: 501,
    selfPid: 9999,
  }
  return { monitor: new SystemProcessMonitor(deps), deps, advance: (ms: number) => { now += ms } }
}

describe("sustained runtime monitoring", () => {
  it("parses a native Python stdin process with stable start and user identity", () => {
    const row = parsePsOutput(runtimeRow())[0]
    expect(row).toMatchObject({ pid: 53013, uid: 501, startedAt: "Sat Oct 3 18:48:32 2026", command: PYTHON_COMMAND })
    expect(processIdentity(row)).toHaveLength(64)
    expect(processIdentity({ ...row, startedAt: "Mon Oct 19 10:00:00 2026" })).not.toBe(processIdentity(row))
    expect(processIdentity({ ...row, uid: 502 })).not.toBe(processIdentity(row))
  })

  it("surfaces sustained unknown runtimes for manual stopping, never automatic reaping", async () => {
    const { monitor, deps, advance } = runtimeMonitor()
    expect((await monitor.capture()).processes[0]).toMatchObject({ kind: "script", suspectedLeak: false, canStop: false })
    expect(deps.inspect).not.toHaveBeenCalled()
    advance(30_000)
    const snapshot = await monitor.capture()
    expect(snapshot.processes[0]).toMatchObject({ pid: 53013, label: "Python", suspectedLeak: true, warning: "sustained-cpu", canStop: true })
    expect(collectOrphanedAgentSubtrees(parsePsOutput(runtimeRow()))).toEqual([])
    expect(deps.signal).not.toHaveBeenCalled()
    expect(deps.inspect).toHaveBeenCalledOnce()
    advance(60_000)
    await monitor.capture()
    expect(deps.inspect).toHaveBeenCalledOnce()
    const target = snapshot.processes[0]
    expect(await monitor.stop([{ pid: target.pid, identity: target.identity! }])).toEqual([53013])
    expect(deps.signal).toHaveBeenCalledExactlyOnceWith(53013)
  })

  it("resets sustained observations and owner evidence when a PID is reused", async () => {
    const { monitor, deps, advance } = runtimeMonitor()
    await monitor.capture()
    advance(30_000)
    const original = (await monitor.capture()).processes[0]
    deps.read.mockResolvedValue(parsePsOutput(runtimeRow(53013, 98, "Mon Oct 19 10:00:00 2026"))[0])
    expect(await monitor.stop([{ pid: 53013, identity: original.identity! }])).toEqual([])
    expect(deps.signal).not.toHaveBeenCalled()
    deps.list.mockResolvedValue(runtimeRow(53013, 98, "Mon Oct 19 10:00:00 2026"))
    advance(5_000)
    expect((await monitor.capture()).processes[0]).toMatchObject({ suspectedLeak: false, canStop: false, owner: undefined })
  })

  it("requires server eligibility, the caller's identity, and the current OS user", async () => {
    const { monitor, deps, advance } = runtimeMonitor()
    await monitor.capture()
    advance(30_000)
    const metric = (await monitor.capture()).processes[0]
    expect(await monitor.stop([{ pid: metric.pid, identity: "0".repeat(64) }, { pid: 1, identity: metric.identity! }])).toEqual([])
    deps.read.mockResolvedValue({ ...parsePsOutput(runtimeRow())[0], uid: 502 })
    expect(await monitor.stop([{ pid: metric.pid, identity: metric.identity! }])).toEqual([])
    expect(deps.signal).not.toHaveBeenCalled()
  })

  it("bounds discovery and probes only suspicious runtimes, sharing cached scans", async () => {
    const { monitor, deps, advance } = runtimeMonitor()
    deps.list.mockResolvedValue([
      ...Array.from({ length: 30 }, (_, i) => runtimeRow(1000 + i)),
      runtimeRow(2000, 0), runtimeRow(2001, 99, undefined, 502), runtimeRow(2002, 99, undefined, 501, "/Applications/Spotify.app/Contents/MacOS/Spotify"),
    ].join("\n"))
    deps.read.mockImplementation(async (pid) => parsePsOutput(runtimeRow(pid))[0])
    const [first, same] = await Promise.all([monitor.capture(), monitor.capture()])
    expect(first).toBe(same)
    expect(first.processes).toHaveLength(8)
    expect(deps.list).toHaveBeenCalledOnce()
    advance(30_000)
    await monitor.capture()
    expect(deps.inspect).toHaveBeenCalledTimes(2)
    advance(5_000)
    await monitor.capture()
    expect(deps.inspect).toHaveBeenCalledTimes(4)
  })

  it("does not carry hot observations across cooling, disappearance, or a hidden gap", async () => {
    const { monitor, deps, advance } = runtimeMonitor()
    await monitor.capture()
    advance(180_000)
    expect((await monitor.capture()).suspectedLeakCount).toBe(0)
    deps.list.mockResolvedValue(runtimeRow(53013, 1))
    advance(5_000)
    expect((await monitor.capture()).processes).toEqual([])
    deps.list.mockResolvedValue(runtimeRow())
    advance(30_000)
    expect((await monitor.capture()).suspectedLeakCount).toBe(0)
  })

  it("monitors scratch runtimes too and requires a fresh sustained period after they cool", async () => {
    const { monitor, deps, advance } = runtimeMonitor()
    const row = (cpu: number) => runtimeRow(53013, cpu, undefined, 501, "node -e expensiveWork()")
    deps.list.mockResolvedValue(row(0))
    deps.read.mockImplementation(async () => parsePsOutput(row(98))[0])
    await monitor.capture()
    advance(60_000)
    deps.list.mockResolvedValue(row(98))
    expect((await monitor.capture()).processes[0].warning).toBeUndefined()
    advance(30_000)
    expect((await monitor.capture()).processes[0].warning).toBe("sustained-cpu")
    advance(5_000)
    deps.list.mockResolvedValue(row(0))
    expect((await monitor.capture()).processes[0].warning).toBeUndefined()
    advance(60_000)
    deps.list.mockResolvedValue(row(98))
    expect((await monitor.capture()).processes[0].warning).toBeUndefined()
  })

  it("reads only stdout/stderr descriptor paths, including deleted output files", () => {
    expect(outputDescriptorPaths("p53013\nfcwd\nn/project\nf1w\nn/private/tmp/task.output (deleted)\nf2w\nn/private/tmp/task.output (deleted)\nf3\nn/unrelated\n")).toEqual(["/private/tmp/task.output (deleted)"])
  })
})

describe("parsePsOutput", () => {
  it("parses pid, ppid, cpu, rss, etime, and full command with spaces", () => {
    const rows = parsePsOutput(PS_FIXTURE)
    expect(rows).toHaveLength(14)
    const renderer = rows.find((row) => row.pid === 400)
    expect(renderer).toMatchObject({
      ppid: 1,
      cpuPercent: 3.4,
      rssKb: 400000,
      etime: "14:29:11",
    })
    expect(renderer?.command).toContain("Cogpit Helper (Renderer)")
  })

  it("skips malformed lines", () => {
    expect(parsePsOutput("not a process line\n\n")).toEqual([])
  })
})

describe("classifyProcesses", () => {
  const metrics = classifyProcesses(parsePsOutput(PS_FIXTURE), 9999)
  const byPid = new Map(metrics.map((metric) => [metric.pid, metric]))

  it("keeps agent tooling and Cogpit processes, drops unrelated ones", () => {
    expect(byPid.has(600)).toBe(false) // Spotify
    expect(byPid.has(500)).toBe(false) // the ps invocation itself
    expect(byPid.get(100)?.kind).toBe("claude")
    expect(byPid.get(310)?.kind).toBe("codex")
    expect(byPid.get(320)?.kind).toBe("copilot")
    expect(byPid.get(200)?.kind).toBe("browser-daemon")
    expect(byPid.get(202)?.kind).toBe("headless-browser")
    expect(byPid.get(301)?.kind).toBe("script")
    expect(byPid.get(400)?.kind).toBe("cogpit")
  })

  it("flags orphaned agent sessions and their whole subtree as leaks", () => {
    expect(byPid.get(100)).toMatchObject({ orphaned: true, suspectedLeak: true })
    expect(byPid.get(101)?.suspectedLeak).toBe(true) // zsh under orphaned claude
    expect(byPid.get(102)?.suspectedLeak).toBe(true) // bun script under orphaned claude
  })

  it("flags every agent CLI, not just the one the matcher was written for", () => {
    expect(byPid.get(310)).toMatchObject({ orphaned: true, suspectedLeak: true })
    expect(byPid.get(311)?.suspectedLeak).toBe(true) // zsh under the orphaned codex run
    expect(byPid.get(320)).toMatchObject({ orphaned: true, suspectedLeak: true })
  })

  it("flags high-CPU headless browsers but not idle daemons", () => {
    expect(byPid.get(202)?.suspectedLeak).toBe(true) // 54.6% CPU renderer, 2 days old
    expect(byPid.get(201)?.suspectedLeak).toBe(false) // idle headless main
    expect(byPid.get(200)?.suspectedLeak).toBe(false) // idle daemon
  })

  it("does not flag young busy browsers — they are likely mid-automation", () => {
    const young = classifyProcesses(parsePsOutput(
      "  700   699 80.0 100000       05:00 /Users/me/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell --type=renderer",
    ), 9999)
    expect(young[0]).toMatchObject({ kind: "headless-browser", suspectedLeak: false })
  })

  it("flags orphaned scripts but not attached claude sessions", () => {
    expect(byPid.get(301)?.suspectedLeak).toBe(true) // ppid 1 scratchpad script
    expect(byPid.get(300)).toMatchObject({ orphaned: false, suspectedLeak: false })
  })

  it("orders leaks first, then by CPU, and reports age and memory", () => {
    expect(metrics[0].suspectedLeak).toBe(true)
    expect(metrics[0].pid).toBe(202) // hottest leak first
    const orphan = byPid.get(100)
    expect(orphan?.ageSeconds).toBe(64 * 86400 + 2 * 3600 + 9 * 60 + 34)
    expect(byPid.get(202)?.memoryMb).toBeCloseTo(150000 / 1024, 0)
  })

  it("gives processes readable labels", () => {
    expect(byPid.get(100)?.label).toBe("Claude Code session")
    expect(byPid.get(310)?.label).toBe("Codex session")
    expect(byPid.get(202)?.label).toBe("Headless Chrome")
    expect(byPid.get(200)?.label).toBe("agent-browser daemon")
    expect(byPid.get(301)?.label).toBe("bun ua-echo.ts")
    expect(byPid.get(400)?.label).toBe("Cogpit Helper (Renderer)")
  })
})
