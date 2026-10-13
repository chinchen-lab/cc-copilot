import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useDragReorder } from "@/hooks/useDragReorder"

const IDS = ["a", "b", "c"]
const ROW_HEIGHT = 40

/** Rows stacked from y=0, each ROW_HEIGHT tall, in the order they are listed. */
function mountRows(result: { current: ReturnType<typeof useDragReorder> }, ids: string[]) {
  const elements = new Map<string, HTMLElement>()
  for (const id of ids) {
    const element = document.createElement("div")
    element.getBoundingClientRect = () => {
      const index = result.current.order.indexOf(id)
      return { top: index * ROW_HEIGHT, height: ROW_HEIGHT } as DOMRect
    }
    elements.set(id, element)
    result.current.rowRef(id)(element)
  }
  return elements
}

function pointerDown(clientY: number, extra: object = {}) {
  return { button: 0, pointerId: 1, clientY, ...extra } as never
}

/** jsdom has no PointerEvent; a MouseEvent carrying the same fields is enough. */
function windowPointer(type: string, clientY: number) {
  const event = new MouseEvent(type, { clientY, bubbles: true })
  Object.defineProperty(event, "pointerId", { value: 1 })
  window.dispatchEvent(event)
}

describe("useDragReorder", () => {
  it("reflows rows under the pointer and commits the dropped order once", () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useDragReorder(IDS, onCommit))
    mountRows(result, IDS)

    act(() => result.current.handleProps("a").onPointerDown(pointerDown(10)))
    expect(result.current.draggingId).toBe("a")

    // Past the midpoint of b (60) but not c (100).
    act(() => windowPointer("pointermove", 70))
    expect(result.current.order).toEqual(["b", "a", "c"])

    act(() => windowPointer("pointermove", 110))
    expect(result.current.order).toEqual(["b", "c", "a"])

    act(() => windowPointer("pointerup", 110))
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(["b", "c", "a"])
    expect(result.current.draggingId).toBeNull()
  })

  it("does not commit when the row is dropped where it started", () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useDragReorder(IDS, onCommit))
    mountRows(result, IDS)

    act(() => result.current.handleProps("b").onPointerDown(pointerDown(50)))
    act(() => windowPointer("pointermove", 70))
    act(() => windowPointer("pointerup", 70))

    expect(onCommit).not.toHaveBeenCalled()
    expect(result.current.order).toEqual(IDS)
  })

  it("restores the original order when the drag is cancelled", () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useDragReorder(IDS, onCommit))
    mountRows(result, IDS)

    act(() => result.current.handleProps("a").onPointerDown(pointerDown(10)))
    act(() => windowPointer("pointermove", 110))
    act(() => windowPointer("pointercancel", 110))

    expect(onCommit).not.toHaveBeenCalled()
    expect(result.current.order).toEqual(IDS)
    expect(result.current.draggingId).toBeNull()
  })

  it("moves a row one step with the arrow keys and ignores the list edges", () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useDragReorder(IDS, onCommit))
    const key = (name: string) => ({ key: name, preventDefault: vi.fn() }) as never

    act(() => result.current.handleProps("b").onKeyDown(key("ArrowDown")))
    expect(onCommit).toHaveBeenLastCalledWith(["a", "c", "b"])

    act(() => result.current.handleProps("a").onKeyDown(key("ArrowUp")))
    act(() => result.current.handleProps("c").onKeyDown(key("ArrowDown")))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it("does not overwrite a concurrent reorder when an unmoved grip is released", () => {
    const onCommit = vi.fn()
    const { result, rerender } = renderHook(
      ({ ids }) => useDragReorder(ids, onCommit),
      { initialProps: { ids: IDS } },
    )
    mountRows(result, IDS)

    act(() => result.current.handleProps("a").onPointerDown(pointerDown(10)))
    rerender({ ids: ["c", "a", "b"] })
    act(() => windowPointer("pointerup", 10))

    expect(onCommit).not.toHaveBeenCalled()
  })

  it("ignores non-primary buttons", () => {
    const { result } = renderHook(() => useDragReorder(IDS, vi.fn()))
    mountRows(result, IDS)

    act(() => result.current.handleProps("a").onPointerDown(pointerDown(10, { button: 2 })))

    expect(result.current.draggingId).toBeNull()
  })
})
