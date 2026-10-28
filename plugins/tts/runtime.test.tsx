import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PluginClient } from "@cogpit/plugin-sdk"
import { SpeechCard } from "./runtime"

vi.mock("./styles.css", () => ({}))
function fixture(configured = true) {
  const client = { context: { surface: { source: "Listen to this passage." } }, settings: { get: vi.fn(async () => ({ speed: 1, format: "mp3" })) }, connections: {
    status: vi.fn(async () => ({ configured, selected: { voice: { id: "af_heart", label: "Heart" } } })),
    media: vi.fn<PluginClient["connections"]["media"]>(async () => new Blob([new Uint8Array([255, 251, 1])], { type: "audio/mpeg" })),
  } }
  return client
}
const play = vi.fn(async () => {})
const pause = vi.fn()
beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:fixture-audio"), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play)
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause)
  play.mockClear(); pause.mockClear()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe("speech card", () => {
  it("generates on the first press, starts playback and releases audio on unmount", async () => {
    const client = fixture()
    const view = render(<SpeechCard client={client as unknown as PluginClient} />)
    expect(screen.getByText("Listen to this passage.")).toBeInTheDocument()
    expect(screen.getByText("Press play to generate audio.")).toBeInTheDocument()
    expect(client.connections.media).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Listen" }))
    const audio = await screen.findByLabelText("Generated speech")
    expect(audio).toHaveAttribute("src", "blob:fixture-audio")
    expect(client.connections.media).toHaveBeenCalledWith("speech", "synthesize", { input: "Listen to this passage.", speed: 1, format: "mp3" }, { signal: expect.any(AbortSignal) })
    await waitFor(() => expect(play).toHaveBeenCalledOnce())
    expect(screen.getByText("Heart voice")).toBeInTheDocument()
    expect(screen.getByRole("slider", { name: "Position" })).toBeDisabled()
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture-audio")
  })
  it("turns the play button into pause while audio plays and back when it ends", async () => {
    const client = fixture()
    render(<SpeechCard client={client as unknown as PluginClient} />)
    fireEvent.click(screen.getByRole("button", { name: "Listen" }))
    const audio = await screen.findByLabelText("Generated speech")
    fireEvent.play(audio)
    fireEvent.click(screen.getByRole("button", { name: "Pause" }))
    expect(pause).toHaveBeenCalledOnce()
    fireEvent.pause(audio)
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument()
    fireEvent.play(audio)
    fireEvent.ended(audio)
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument()
    expect(client.connections.media).toHaveBeenCalledOnce()
  })
  it("gives setup guidance without sending text to an unconfigured service", async () => {
    const client = fixture(false)
    render(<SpeechCard client={client as unknown as PluginClient} />)
    fireEvent.click(screen.getByRole("button", { name: "Listen" }))
    await screen.findByRole("alert")
    expect(screen.getByRole("alert")).toHaveTextContent("choose a voice")
    expect(client.connections.media).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Listen" })).toBeEnabled()
  })
  it("lets the user cancel while audio is being prepared", async () => {
    const client = fixture()
    client.connections.media.mockImplementation((_handle, _operation, _args, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener("abort", () => reject(new Error("aborted"))) }))
    render(<SpeechCard client={client as unknown as PluginClient} />)
    fireEvent.click(screen.getByRole("button", { name: "Listen" }))
    const preparing = await screen.findByRole("button", { name: "Preparing audio" })
    expect(preparing).toHaveAttribute("aria-busy", "true")
    fireEvent.click(preparing)
    expect(client.connections.media).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(await screen.findByRole("button", { name: "Listen" })).toBeEnabled()
    expect(screen.queryByRole("alert")).toBeNull()
  })
  it("cancels an outstanding generation when the card unmounts", async () => {
    const client = fixture()
    client.connections.media.mockImplementation(() => new Promise(() => {}))
    const view = render(<SpeechCard client={client as unknown as PluginClient} />)
    fireEvent.click(screen.getByRole("button", { name: "Listen" }))
    await waitFor(() => expect(client.connections.media).toHaveBeenCalledOnce())
    const signal = client.connections.media.mock.calls[0][3]!.signal!
    view.unmount()
    expect(signal.aborted).toBe(true)
  })
})
