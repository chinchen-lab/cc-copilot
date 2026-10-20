import { EMPTY_OVERLAY, type StreamingOverlay } from "./streamingOverlay"

export function createStreamingOverlayStore() {
  let value = EMPTY_OVERLAY
  const listeners = new Set<() => void>()
  return {
    snapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    publish(next: StreamingOverlay) {
      if (next === value) return
      value = next
      for (const listener of listeners) listener()
    },
  }
}
export type StreamingOverlayStore = ReturnType<typeof createStreamingOverlayStore>
