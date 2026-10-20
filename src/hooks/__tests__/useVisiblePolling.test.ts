import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useVisiblePolling } from "../useVisiblePolling"

describe("useVisiblePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("keeps slow remote requests from piling up across ticks and focus events", async () => {
    let finish!: () => void
    const poll = vi.fn<(isActive: () => boolean) => Promise<void>>(() => new Promise<void>((resolve) => { finish = resolve }))
    const { unmount } = renderHook(() => useVisiblePolling(poll, 4_000))
    expect(poll).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    act(() => { document.dispatchEvent(new Event("visibilitychange")) })
    expect(poll).toHaveBeenCalledOnce()
    await act(async () => { finish() })
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(poll).toHaveBeenCalledTimes(2)
    const isActive = poll.mock.calls[1]![0]
    unmount()
    expect(isActive()).toBe(false)
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(8_000) })
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it("skips hidden ticks and refreshes when the window becomes visible", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    const poll = vi.fn(async () => {})
    const { unmount } = renderHook(() => useVisiblePolling(poll, 4_000))
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(poll).not.toHaveBeenCalled()
    visibility.mockReturnValue("visible")
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")) })
    expect(poll).toHaveBeenCalledOnce()
    unmount()
  })
})
