import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BgAgent } from "../useBackgroundAgents"

const api = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth", () => ({ authFetch: api }))
import { useBackgroundAgents } from "../useBackgroundAgents"

const agent: BgAgent = { agentId: "a", dirName: "project", fileName: "a.jsonl", parentSessionId: "p", modifiedAt: 1, isActive: true, preview: "working" }
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
  api.mockReset().mockImplementation(async () => new Response("[]"))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe("useBackgroundAgents", () => {
  it("preserves the list for unchanged polls and publishes actual activity changes", async () => {
    api.mockImplementation(async () => new Response(JSON.stringify([agent])))
    const { result, unmount } = renderHook(() => useBackgroundAgents("/repo"))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const first = result.current
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(api).toHaveBeenCalledTimes(3)
    expect(result.current).toBe(first)
    api.mockImplementation(async () => new Response(JSON.stringify([{ ...agent, isActive: false }])))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(result.current[0]?.isActive).toBe(false)
    unmount()
  })

  it("ignores old project responses that finish decoding after navigation", async () => {
    let finish!: (agents: BgAgent[]) => void
    api.mockResolvedValueOnce({ ok: true, json: () => new Promise<BgAgent[]>((resolve) => { finish = resolve }) })
    const { result, rerender, unmount } = renderHook(({ cwd }) => useBackgroundAgents(cwd), { initialProps: { cwd: "/first" as string | null } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    rerender({ cwd: "/second" })
    await act(async () => { finish([agent]); await vi.advanceTimersByTimeAsync(0) })
    expect(result.current).toEqual([])
    rerender({ cwd: null })
    expect(result.current).toEqual([])
    unmount()
  })

  it("does not poll while hidden and refreshes when visible", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    const { unmount } = renderHook(() => useBackgroundAgents("/repo"))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(api).not.toHaveBeenCalled()
    visibility.mockReturnValue("visible")
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")) })
    expect(api).toHaveBeenCalledOnce()
    unmount()
  })
})
