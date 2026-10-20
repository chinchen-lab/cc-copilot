import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { useRevealNearViewport } from "../useRevealNearViewport"

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly targets = new Set<Element>()
  disconnected = false
  constructor(private readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) { this.targets.add(el) }
  unobserve(el: Element) { this.targets.delete(el) }
  disconnect() { this.disconnected = true; this.targets.clear() }
  report(el: Element, isIntersecting: boolean) {
    this.callback([{ target: el, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

function Card({ id }: { id: string }) {
  const { ref, revealed } = useRevealNearViewport()
  return <div ref={ref} data-testid={id}>{revealed ? "content" : "placeholder"}</div>
}

describe("useRevealNearViewport", () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reveals once near the viewport and stops watching the element", () => {
    render(<Card id="a" />)
    const [observer] = FakeIntersectionObserver.instances
    const el = screen.getByTestId("a")
    expect(el.textContent).toBe("placeholder")
    expect(observer.options?.rootMargin).toBe("100%")

    act(() => observer.report(el, false))
    expect(el.textContent).toBe("placeholder")
    expect(observer.targets.has(el)).toBe(true)

    act(() => observer.report(el, true))
    expect(el.textContent).toBe("content")
    // Nothing is left to watch, so no observer stays alive to force
    // main-thread frames while animations run elsewhere on the page.
    expect(observer.disconnected).toBe(true)

    act(() => observer.report(el, false))
    expect(el.textContent).toBe("content")
  })

  it("shares one observer and keeps it only while something is unrevealed", () => {
    const { unmount } = render(<><Card id="a" /><Card id="b" /></>)
    expect(FakeIntersectionObserver.instances).toHaveLength(1)
    const [observer] = FakeIntersectionObserver.instances
    const a = screen.getByTestId("a")
    const b = screen.getByTestId("b")
    expect(observer.targets.size).toBe(2)

    act(() => observer.report(a, true))
    expect(a.textContent).toBe("content")
    expect(observer.targets.has(a)).toBe(false)
    expect(observer.disconnected).toBe(false)

    unmount()
    expect(observer.disconnected).toBe(true)
    expect(b.textContent).toBe("placeholder")
  })

  it("starts a fresh observer after the previous one disconnected", () => {
    const first = render(<Card id="a" />)
    act(() => FakeIntersectionObserver.instances[0].report(screen.getByTestId("a"), true))
    first.unmount()

    render(<Card id="b" />)
    expect(FakeIntersectionObserver.instances).toHaveLength(2)
    expect(FakeIntersectionObserver.instances[1].targets.has(screen.getByTestId("b"))).toBe(true)
  })
})
