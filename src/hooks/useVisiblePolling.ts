import { useEffect } from "react"

/**
 * Run `poll` now and every `intervalMs` while the tab is visible, and again the
 * moment it becomes visible. `isActive` turns false once the poll is replaced
 * or unmounted, so a late answer is dropped. Pass a stable callback; null stops
 * polling.
 */
export function useVisiblePolling(
  poll: ((isActive: () => boolean) => Promise<void>) | null,
  intervalMs: number,
): void {
  useEffect(() => {
    if (!poll) return
    let active = true
    let inFlight = false
    const pollWhenVisible = () => {
      if (document.visibilityState !== "visible" || inFlight) return
      inFlight = true
      void poll(() => active).finally(() => { inFlight = false })
    }
    pollWhenVisible()
    const id = setInterval(pollWhenVisible, intervalMs)
    document.addEventListener("visibilitychange", pollWhenVisible)
    return () => {
      active = false
      clearInterval(id)
      document.removeEventListener("visibilitychange", pollWhenVisible)
    }
  }, [poll, intervalMs])
}
