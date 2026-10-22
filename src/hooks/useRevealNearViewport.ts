import { useEffect, useRef, useState } from "react"

/**
 * One IntersectionObserver per rootMargin, shared by every element waiting to
 * come near the viewport, and disconnected as soon as nothing is waiting.
 *
 * While any IntersectionObserver has targets, Chromium runs a main-thread
 * frame on every display refresh for as long as a CSS animation plays
 * anywhere in the document — so an agent's spinner would keep the whole page
 * re-styling and re-painting at 120 Hz. Watching only what has not been
 * revealed yet keeps the observer short-lived.
 */
const pending = new Map<string, { observer: IntersectionObserver; reveal: Map<Element, () => void> }>()

function watchUntilNear(el: Element, rootMargin: string, reveal: () => void): () => void {
  let entry = pending.get(rootMargin)
  if (!entry) {
    const waiting = new Map<Element, () => void>()
    const observer = new IntersectionObserver((records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue
        const callback = waiting.get(record.target)
        unwatch(record.target, rootMargin)
        callback?.()
      }
    }, { rootMargin })
    entry = { observer, reveal: waiting }
    pending.set(rootMargin, entry)
  }
  entry.reveal.set(el, reveal)
  entry.observer.observe(el)
  return () => unwatch(el, rootMargin)
}

function unwatch(el: Element, rootMargin: string): void {
  const entry = pending.get(rootMargin)
  if (!entry?.reveal.delete(el)) return
  entry.observer.unobserve(el)
  if (entry.reveal.size > 0) return
  entry.observer.disconnect()
  pending.delete(rootMargin)
}

/**
 * Reports whether an element has come within the extended viewport zone —
 * once. Default "100%" reveals it within one viewport height of the screen.
 * Content stays rendered afterwards, so scrolling away never swaps it back
 * to a placeholder.
 */
export function useRevealNearViewport(rootMargin = "100%") {
  const ref = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || revealed) return
    return watchUntilNear(el, rootMargin, () => setRevealed(true))
  }, [rootMargin, revealed])

  return { ref, revealed }
}
