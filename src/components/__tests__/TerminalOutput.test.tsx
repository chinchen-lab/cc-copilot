import { act, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { setFontScale } from "@/lib/fontScale"

const mocks = vi.hoisted(() => ({
  create: vi.fn(), fit: vi.fn(), dispose: vi.fn(),
  pty: { resize: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), send: vi.fn(), writeInput: vi.fn() },
}))
vi.mock("@/contexts/PtyContext", () => ({ usePty: () => mocks.pty }))
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  options: Record<string, unknown>
  cols = 80
  rows = 24
  constructor(options: Record<string, unknown>) { this.options = options; mocks.create(this) }
  loadAddon() {}
  open() {}
  attachCustomKeyEventHandler() {}
  onData() { return { dispose() {} } }
  onSelectionChange() { return { dispose() {} } }
  dispose = mocks.dispose
} }))
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = mocks.fit } }))
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }))

import { TerminalOutput } from "../TerminalOutput"

afterEach(() => { act(() => setFontScale(100)); vi.restoreAllMocks(); vi.clearAllMocks() })

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
})
