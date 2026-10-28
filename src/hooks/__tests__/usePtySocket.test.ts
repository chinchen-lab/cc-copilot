import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { usePtySocket } from "@/hooks/usePtySocket"

// Minimal WebSocket stand-in that records the URL it was constructed with and
// never actually fires open/message/close events.
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  url: string
  readyState = 0
  onopen: null | (() => void) = null
  onmessage: null | ((e: MessageEvent) => void) = null
  onclose: null | (() => void) = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  send = vi.fn()
  close() {
    this.readyState = MockWebSocket.CLOSED
  }
}

function setLocation(pathname: string, hostname = "localhost") {
  Object.defineProperty(window, "location", {
    value: {
      pathname,
      host: "example.host:19384",
      hostname,
      protocol: "http:",
    },
    writable: true,
    configurable: true,
  })
}

describe("usePtySocket buildWsUrl", () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal("WebSocket", MockWebSocket)
    localStorage.clear()
    setLocation("/")
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("connects to /__pty (no prefix) on the local device", () => {
    setLocation("/")
    renderHook(() => usePtySocket())

    expect(MockWebSocket.instances[0]?.url).toBe(
      "ws://example.host:19384/__pty"
    )
  })

  it("does not construct a WebSocket when terminal access is disabled", () => {
    renderHook(() => usePtySocket(false))

    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it("closes the existing socket when terminal access is revoked", () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => usePtySocket(enabled),
      { initialProps: { enabled: true } },
    )
    const ws = MockWebSocket.instances[0]

    act(() => rerender({ enabled: false }))

    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
    result.current.send({ type: "spawn" })
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it("inserts the /hub/<id> device prefix before /__pty on a remote device", () => {
    setLocation("/d/dev_x/-Users-foo/sess")
    renderHook(() => usePtySocket())

    expect(MockWebSocket.instances[0]?.url).toBe(
      "ws://example.host:19384/hub/dev_x/__pty"
    )
  })

  it("never places a browser session token in the WebSocket URL", () => {
    localStorage.setItem("cogpit-network-token", "must-not-leak")
    setLocation("/d/dev_x/", "mb.cogpit.dev")
    renderHook(() => usePtySocket())

    expect(MockWebSocket.instances[0]?.url).toBe(
      "ws://example.host:19384/hub/dev_x/__pty"
    )
    expect(MockWebSocket.instances[0]?.url).not.toContain("token=")
  })

  it("tears the socket down on unmount (device switch remounts App)", () => {
    setLocation("/d/dev_x/")
    const { unmount } = renderHook(() => usePtySocket())

    const ws = MockWebSocket.instances[0]
    expect(ws.readyState).not.toBe(MockWebSocket.CLOSED)

    unmount()
    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
  })

  it("attaches terminals mounted before the connection opens and resets before replaying output", () => {
    const { result } = renderHook(() => usePtySocket())
    const handler = vi.fn()
    result.current.subscribe("vim", handler)
    const ws = MockWebSocket.instances[0]
    ws.readyState = MockWebSocket.OPEN
    act(() => ws.onopen?.())
    expect(ws.send.mock.calls.map(([message]) => JSON.parse(message as string))).toEqual([
      { type: "list" }, { type: "attach", id: "vim" },
    ])
    expect(handler).toHaveBeenCalledExactlyOnceWith("reset", null)
    expect(handler.mock.invocationCallOrder[0]).toBeLessThan(ws.send.mock.invocationCallOrder[1])
  })

  it("reattaches subscribed terminals after reconnecting and resumes their output without replaying removed terminals", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => usePtySocket())
    const oldSocket = MockWebSocket.instances[0]
    oldSocket.readyState = MockWebSocket.OPEN
    act(() => oldSocket.onopen?.())
    const handler = vi.fn()
    const removed = vi.fn()
    result.current.subscribe("vim", handler)
    result.current.subscribe("closed-terminal", removed)
    result.current.unsubscribe("closed-terminal")
    oldSocket.readyState = MockWebSocket.CLOSED
    act(() => oldSocket.onclose?.())
    expect(result.current.status).toBe("disconnected")
    act(() => vi.advanceTimersByTime(500))
    const newSocket = MockWebSocket.instances[1]
    newSocket.readyState = MockWebSocket.OPEN
    act(() => newSocket.onopen?.())
    expect(result.current.status).toBe("connected")
    expect(newSocket.send.mock.calls.map(([message]) => JSON.parse(message as string))).toEqual([
      { type: "list" }, { type: "attach", id: "vim" },
    ])
    act(() => newSocket.onmessage?.({ data: JSON.stringify({ type: "output", id: "vim", data: "\x1b[?1049hVim screen" }) } as MessageEvent))
    expect(handler.mock.calls).toEqual([
      ["reset", null], ["output", { type: "output", id: "vim", data: "\x1b[?1049hVim screen" }],
    ])
    expect(removed).not.toHaveBeenCalled()
  })
})
