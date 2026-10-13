import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react"

interface DragSession {
  id: string
  pointerId: number
  /** Distance from the row's top edge to where the pointer grabbed it. */
  grabOffset: number
  /** The order the drag began from; a drop only commits when it differs. */
  startOrder: string[]
}

export interface DragHandleProps {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export interface UseDragReorder {
  /** `ids` with the in-flight drag applied; render rows in this order. */
  order: string[]
  draggingId: string | null
  /** Ref callback registering a row's element so drags can measure it. */
  rowRef: (id: string) => (element: HTMLElement | null) => void
  handleProps: (id: string) => DragHandleProps
}

const ARROW_STEPS: Partial<Record<string, number>> = { ArrowUp: -1, ArrowDown: 1 }

function moveTo(ids: readonly string[], id: string, index: number): string[] {
  const rest = ids.filter((candidate) => candidate !== id)
  rest.splice(index, 0, id)
  return rest
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/**
 * Pointer-driven vertical reordering for a short list. The caller renders rows
 * in `order`, attaches `rowRef(id)` to each row and `handleProps(id)` to its
 * grip; the grabbed row follows the pointer while the rest reflow around it,
 * and `onCommit` receives the final order once on release. Arrow keys on a
 * focused grip move that row one step and commit.
 */
export function useDragReorder(
  ids: readonly string[],
  onCommit: (ids: string[]) => void,
): UseDragReorder {
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const rows = useRef(new Map<string, HTMLElement>())
  const session = useRef<DragSession | null>(null)
  const pointerY = useRef(0)
  // Mirrors `dragOrder` so pointer handlers read the latest order without
  // running side effects inside a state updater.
  const latestOrder = useRef<string[] | null>(null)
  const order = dragOrder ?? [...ids]

  // Listeners installed at pointer-down outlive that render, so they read the
  // newest inputs through a ref rather than closing over stale ones.
  const inputs = useRef({ ids, onCommit })
  useLayoutEffect(() => {
    inputs.current = { ids, onCommit }
  })

  // The grabbed row keeps its transform relative to wherever layout currently
  // puts it, so re-derive the offset after every reorder as well as on move.
  const followPointer = useCallback(() => {
    const active = session.current
    const element = active && rows.current.get(active.id)
    if (!active || !element) return
    element.style.transform = ""
    const naturalTop = element.getBoundingClientRect().top
    element.style.transform = `translateY(${pointerY.current - active.grabOffset - naturalTop}px)`
  }, [])

  useLayoutEffect(() => {
    followPointer()
  }, [dragOrder, followPointer])

  const rowRef = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element) rows.current.set(id, element)
      else rows.current.delete(id)
    },
    [],
  )

  // Window-level listeners: reordering moves the grabbed row's DOM node, which
  // releases any pointer capture on its handle mid-drag.
  const stopListening = useRef<(() => void) | null>(null)

  const finish = useCallback(
    (commit: boolean) => {
      const active = session.current
      if (!active) return
      session.current = null
      stopListening.current?.()
      stopListening.current = null
      const element = rows.current.get(active.id)
      if (element) element.style.transform = ""
      const dropped = latestOrder.current
      latestOrder.current = null
      setDraggingId(null)
      setDragOrder(null)
      if (commit && dropped && !sameOrder(dropped, active.startOrder)) {
        inputs.current.onCommit(dropped)
      }
    },
    [],
  )

  useEffect(() => () => stopListening.current?.(), [])

  const onWindowMove = useCallback(
    (event: PointerEvent) => {
      const active = session.current
      if (!active || active.pointerId !== event.pointerId) return
      pointerY.current = event.clientY
      const current = latestOrder.current
      if (!current) return
      // The row's slot is decided by how many of the others sit above the
      // pointer, so it lands where it is dropped regardless of row heights.
      const above = current.filter((other) => {
        if (other === active.id) return false
        const rect = rows.current.get(other)?.getBoundingClientRect()
        return !!rect && rect.top + rect.height / 2 < event.clientY
      }).length
      const next = moveTo(current, active.id, above)
      if (!sameOrder(next, current)) {
        latestOrder.current = next
        setDragOrder(next)
      }
      followPointer()
    },
    [followPointer],
  )

  const handleProps = useCallback(
    (id: string): DragHandleProps => ({
      onPointerDown: (event) => {
        if (event.button !== 0 || session.current) return
        const element = rows.current.get(id)
        if (!element) return
        pointerY.current = event.clientY
        session.current = {
          id,
          pointerId: event.pointerId,
          grabOffset: event.clientY - element.getBoundingClientRect().top,
          startOrder: [...ids],
        }
        const start = [...ids]
        latestOrder.current = start
        setDraggingId(id)
        setDragOrder(start)

        const onUp = (up: PointerEvent) => {
          if (up.pointerId === event.pointerId) finish(true)
        }
        const onCancel = (cancel: PointerEvent) => {
          if (cancel.pointerId === event.pointerId) finish(false)
        }
        window.addEventListener("pointermove", onWindowMove)
        window.addEventListener("pointerup", onUp)
        window.addEventListener("pointercancel", onCancel)
        stopListening.current = () => {
          window.removeEventListener("pointermove", onWindowMove)
          window.removeEventListener("pointerup", onUp)
          window.removeEventListener("pointercancel", onCancel)
        }
      },
      onKeyDown: (event) => {
        const step = ARROW_STEPS[event.key]
        if (step === undefined) return
        event.preventDefault()
        const from = ids.indexOf(id)
        const to = from + step
        if (from === -1 || to < 0 || to >= ids.length) return
        onCommit(moveTo(ids, id, to))
      },
    }),
    [ids, onCommit, finish, onWindowMove],
  )

  return { order, draggingId, rowRef, handleProps }
}
