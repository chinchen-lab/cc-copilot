// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"

const fs = vi.hoisted(() => ({ watch: vi.fn() }))
vi.mock("node:fs", () => ({ watch: fs.watch }))
import { SessionFileMonitor } from "../../lib/sessionFileMonitor"

let changed: (event: string, name: string | null) => void
let watcher: EventEmitter & { close: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> }
let monitor: SessionFileMonitor
beforeEach(() => {
  vi.useFakeTimers()
  watcher = Object.assign(new EventEmitter(), { close: vi.fn(), unref: vi.fn() })
  fs.watch.mockReset().mockImplementation((_root, _options, callback) => { changed = callback; return watcher })
  monitor = new SessionFileMonitor()
})
afterEach(() => { monitor.close(); vi.useRealTimers() })
const storeOf = () => ({ sessionsRoot: vi.fn(() => "/transcripts" as string | null), listSessionFiles: vi.fn(async () => []) })

describe("SessionFileMonitor", () => {
  it("does not rescan quiet history until a transcript changes or the backstop expires", async () => {
    const store = storeOf()
    const first = await monitor.list(store)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(await monitor.list(store)).toBe(first)
    changed("change", "memory.md")
    await monitor.list(store)
    expect(store.listSessionFiles).toHaveBeenCalledOnce()
    changed("change", "session.jsonl")
    await monitor.list(store)
    expect(store.listSessionFiles).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    await monitor.list(store)
    expect(store.listSessionFiles).toHaveBeenCalledTimes(3)
    changed("rename", "new-project")
    await monitor.list(store)
    expect(store.listSessionFiles).toHaveBeenCalledTimes(4)
  })

  it("retains changes that arrive during a scan", async () => {
    const store = storeOf()
    let finish!: (files: []) => void
    store.listSessionFiles.mockImplementationOnce(() => new Promise<[]>((resolve) => { finish = resolve }))
    const initial = monitor.list(store)
    changed("change", "session.jsonl")
    finish([])
    await initial
    await monitor.list(store)
    expect(store.listSessionFiles).toHaveBeenCalledTimes(2)
  })

  it("polls while watching fails and recovers when the root becomes available", async () => {
    fs.watch.mockImplementationOnce(() => { throw new Error("missing") })
    const store = storeOf()
    await monitor.list(store)
    await monitor.list(store)
    expect(fs.watch).toHaveBeenCalledTimes(2)
    await monitor.list(store)
    expect(store.listSessionFiles).toHaveBeenCalledTimes(2)
    watcher.emit("error", new Error("watch unavailable"))
    expect(watcher.close).toHaveBeenCalledOnce()
    fs.watch.mockImplementation(() => { throw new Error("unsupported") })
    await monitor.list(store)
    await monitor.list(store)
    expect(store.listSessionFiles).toHaveBeenCalledTimes(4)
  })

  it("releases removed roots and switches paths without reusing stale listings", async () => {
    const store = storeOf()
    await monitor.list(store)
    store.sessionsRoot.mockReturnValue("/another-root")
    await monitor.list(store)
    expect(watcher.close).toHaveBeenCalledOnce()
    expect(store.listSessionFiles).toHaveBeenCalledTimes(2)
    monitor.retain([])
    expect(watcher.close).toHaveBeenCalledTimes(2)
  })

  it("retries failed listings instead of caching their previous data", async () => {
    const store = storeOf()
    store.listSessionFiles.mockRejectedValueOnce(new Error("unreadable"))
    await expect(monitor.list(store)).rejects.toThrow("unreadable")
    await monitor.list(store)
    expect(store.listSessionFiles).toHaveBeenCalledTimes(2)
  })
})
