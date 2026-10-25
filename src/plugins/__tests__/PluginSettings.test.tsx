import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PluginSettings } from "../PluginSettings"

const definition = { scope: "plugin" as const, fields: [{ id: "speed", label: "Speech speed", type: "number" as const, min: 0.5, max: 2, default: 1 }] }
describe("declared plugin settings", () => {
  it("loads typed values and saves against the loaded revision", async () => {
    const client = { settings: vi.fn(async () => ({ values: { speed: 1 }, revision: 4 })), saveSettings: vi.fn(async () => ({ values: { speed: 0.75 }, revision: 5 })) }
    render(<PluginSettings client={client} definition={definition} pluginId="example.speech" projectId={null} />)
    const input = await screen.findByLabelText("Speech speed")
    fireEvent.change(input, { target: { value: "0.75" } })
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }))
    await screen.findByText("Settings saved.")
    expect(client.saveSettings).toHaveBeenCalledWith({ pluginId: "example.speech", projectId: null }, { speed: 0.75 }, 4, expect.any(AbortSignal))
  })
  it("explains missing project context without making a request", () => {
    const client = { settings: vi.fn(), saveSettings: vi.fn() }
    render(<PluginSettings client={client} definition={{ ...definition, scope: "project" }} pluginId="example.speech" projectId={null} />)
    expect(screen.getByText(/Choose a project/)).toBeInTheDocument()
    expect(client.settings).not.toHaveBeenCalled()
  })
  it("aborts an old save when the target project changes", async () => {
    let finish!: (value: { values: { speed: number }; revision: number }) => void
    const client = { settings: vi.fn(async () => ({ values: { speed: 1 }, revision: 1 })), saveSettings: vi.fn((_target, _values, _revision, _signal) => new Promise<{ values: { speed: number }; revision: number }>(resolve => { finish = resolve })) }
    const view = render(<PluginSettings client={client} definition={definition} pluginId="example.speech" projectId="first" />)
    await screen.findByLabelText("Speech speed")
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }))
    view.rerender(<PluginSettings client={client} definition={definition} pluginId="example.speech" projectId="second" />)
    expect(client.saveSettings.mock.calls[0][3].aborted).toBe(true)
    finish({ values: { speed: 2 }, revision: 2 })
    await waitFor(() => expect(screen.getByLabelText("Speech speed")).toHaveValue(1))
  })
})
