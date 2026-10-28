import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setFontScale } from "@/lib/fontScale"

const mocks = vi.hoisted(() => ({
  create: vi.fn(), fit: vi.fn(), dispose: vi.fn(), reset: vi.fn(), write: vi.fn(),
  pty: { resize: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), send: vi.fn(), writeInput: vi.fn() },
}))
vi.mock("@/contexts/PtyContext", () => ({ usePty: () => mocks.pty }))
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  options: Record<string, unknown>
  cols = 80
  rows = 24
  buffer = { active: { type: "normal" } }
  keyHandler?: (event: KeyboardEvent) => boolean
  constructor(options: Record<string, unknown>) { this.options = options; mocks.create(this) }
  loadAddon() {}
  open() {}
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { this.keyHandler = handler }
  onData() { return { dispose() {} } }
  onSelectionChange() { return { dispose() {} } }
  reset = mocks.reset
  write = mocks.write
  dispose = mocks.dispose
} }))
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = mocks.fit } }))
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }))

import { TerminalOutput } from "../TerminalOutput"

beforeEach(() => vi.clearAllMocks())
afterEach(() => { act(() => setFontScale(100)); vi.restoreAllMocks() })

describe("TerminalOutput font scale", () => {
  it("resizes existing terminals without reconnecting or disposing them", () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.push(callback); return frames.length })
    render(<TerminalOutput processId="terminal-1" />)
    const terminal = mocks.create.mock.calls[0][0] as { options: { fontSize: number } }
    expect(terminal.options.fontSize).toBe(12)
    act(() => setFontScale(150))
    expect(terminal.options.fontSize).toBe(18)
    act(() => { for (const callback of frames.splice(0)) callback(0) })
    expect(mocks.fit).toHaveBeenCalledTimes(2)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.dispose).not.toHaveBeenCalled()
    expect(mocks.pty.send).toHaveBeenCalledExactlyOnceWith({ type: "attach", id: "terminal-1" })
  })

  it("resets the existing renderer before accepting replayed output after reconnecting", () => {
    render(<TerminalOutput processId="vim" />)
    const terminal = mocks.create.mock.calls[0][0] as { options: { disableStdin?: boolean } }
    const receive = mocks.pty.subscribe.mock.calls[0][1] as (type: string, data: unknown) => void
    act(() => receive("reset", null))
    act(() => receive("output", { data: "\x1b[?1049hVim screen", replay: true }))
    expect(mocks.reset).toHaveBeenCalledOnce()
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith("\x1b[?1049hVim screen", expect.any(Function))
    expect(terminal.options.disableStdin).toBe(true)
    act(() => (mocks.write.mock.calls[0][1] as () => void)())
    expect(terminal.options.disableStdin).toBe(false)
    expect(mocks.reset.mock.invocationCallOrder[0]).toBeLessThan(mocks.write.mock.invocationCallOrder[0])
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it("waits for the latest replay to finish, including an empty replay, before enabling input", () => {
    render(<TerminalOutput processId="vim" />)
    const terminal = mocks.create.mock.calls[0][0] as { options: { disableStdin?: boolean } }
    const receive = mocks.pty.subscribe.mock.calls[0][1] as (type: string, data: unknown) => void
    act(() => receive("output", { data: "old screen", replay: true }))
    act(() => receive("reset", null))
    act(() => receive("output", { data: "", replay: true }))
    act(() => (mocks.write.mock.calls[0][1] as () => void)())
    expect(terminal.options.disableStdin).toBe(true)
    act(() => (mocks.write.mock.calls[1][1] as () => void)())
    expect(terminal.options.disableStdin).toBe(false)
    act(() => receive("output", { data: "live output" }))
    expect(mocks.write).toHaveBeenLastCalledWith("live output")
    expect(terminal.options.disableStdin).toBe(false)
  })
})

interface TestTerminal {
  buffer: { active: { type: "normal" | "alternate" } }
  keyHandler: (event: KeyboardEvent) => boolean
}

describe("TerminalOutput full-screen keyboard input", () => {
  it.each([
    { key: "i" }, { key: "h" }, { key: "j" }, { key: "k" }, { key: "l" },
    { key: "Escape" }, { key: "ArrowDown" }, { key: "Enter" }, { key: " " },
    { key: "w", ctrlKey: true }, { key: "n", ctrlKey: true },
    { key: "b", ctrlKey: true }, { key: "f", ctrlKey: true },
    { key: "j", ctrlKey: true }, { key: "Control" },
  ])("leaves $key (Ctrl: $ctrlKey) to the full-screen app without triggering app shortcuts", (keys) => {
    const onRequestNew = vi.fn()
    const onRequestClose = vi.fn()
    render(<TerminalOutput processId="vim" onRequestNew={onRequestNew} onRequestClose={onRequestClose} />)
    const terminal = mocks.create.mock.calls[0][0] as TestTerminal
    terminal.buffer.active.type = "alternate"
    const region = screen.getByRole("region", { name: "Terminal output" })
    const globalShortcut = vi.fn()
    const accepted: boolean[] = []
    const events: KeyboardEvent[] = []
    for (const type of ["keydown", "keypress", "keyup"]) {
      region.addEventListener(type, (event) => accepted.push(terminal.keyHandler(event as KeyboardEvent)))
      window.addEventListener(type, globalShortcut)
      const event = new KeyboardEvent(type, { ...keys, bubbles: true, cancelable: true })
      events.push(event)
      fireEvent(region, event)
      window.removeEventListener(type, globalShortcut)
    }
    expect(accepted).toEqual([true, true, true])
    expect(events.every(event => !event.defaultPrevented)).toBe(true)
    expect(globalShortcut).not.toHaveBeenCalled()
    expect(onRequestNew).not.toHaveBeenCalled()
    expect(onRequestClose).not.toHaveBeenCalled()
  })

  it("restores terminal shortcuts after leaving the alternate screen and keeps Command shortcuts available", () => {
    const onRequestNew = vi.fn()
    const onRequestClose = vi.fn()
    render(<TerminalOutput processId="vim" onRequestNew={onRequestNew} onRequestClose={onRequestClose} />)
    const terminal = mocks.create.mock.calls[0][0] as TestTerminal
    terminal.buffer.active.type = "alternate"
    expect(terminal.keyHandler(new KeyboardEvent("keydown", { key: "w", metaKey: true }))).toBe(false)
    expect(onRequestClose).toHaveBeenCalledTimes(1)
    terminal.buffer.active.type = "normal"
    expect(terminal.keyHandler(new KeyboardEvent("keydown", { key: "n", ctrlKey: true }))).toBe(false)
    expect(terminal.keyHandler(new KeyboardEvent("keyup", { key: "n", ctrlKey: true }))).toBe(false)
    expect(onRequestNew).toHaveBeenCalledTimes(1)
    expect(terminal.keyHandler(new KeyboardEvent("keydown", { key: "w", ctrlKey: true }))).toBe(false)
    expect(onRequestClose).toHaveBeenCalledTimes(2)
  })
})
