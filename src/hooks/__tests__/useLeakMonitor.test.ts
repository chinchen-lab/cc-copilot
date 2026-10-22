import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"

vi.mock("@/lib/auth", () => ({
  authFetch: vi.fn(),
}))

import { authFetch } from "@/lib/auth"
import { useLeakMonitor } from "../useLeakMonitor"

const mockedAuthFetch = vi.mocked(authFetch)

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

const LEAK = {
  pid: 42,
  kind: "headless-browser",
  label: "Headless Chrome",
  command: "chrome-headless-shell --type=renderer",
  cpuPercent: 55,
  memoryMb: 150,
  ageSeconds: 7200,
  orphaned: false,
  suspectedLeak: true,
}

const CLEAN_PROCESS = { ...LEAK, pid: 43, cpuPercent: 1, suspectedLeak: false }

describe("useLeakMonitor", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches on mount and keeps only suspected leaks", async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({
      processes: [LEAK, CLEAN_PROCESS],
      suspectedLeakCount: 1,
      recentlyReaped: [],
    }))

    const { result } = renderHook(() => useLeakMonitor())

    await waitFor(() => expect(result.current.leaks).toHaveLength(1))
    expect(result.current.leaks[0].pid).toBe(42)
    expect(mockedAuthFetch).toHaveBeenCalledWith("/api/system-processes")
  })

  it("skips hidden scans, refreshes on visibility, and discards late unmounted responses", async () => {
    vi.useFakeTimers()
    try {
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
      let finish!: (response: Response) => void
      mockedAuthFetch.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
      const { result, unmount } = renderHook(() => useLeakMonitor())
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
      expect(mockedAuthFetch).not.toHaveBeenCalled()
      visibility.mockReturnValue("visible")
      act(() => { document.dispatchEvent(new Event("visibilitychange")) })
      expect(mockedAuthFetch).toHaveBeenCalledOnce()
      unmount()
      await act(async () => { finish(jsonResponse({ processes: [LEAK] })) })
      expect(result.current.leaks).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
