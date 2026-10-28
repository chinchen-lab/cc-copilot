// @vitest-environment node
import { readFile } from "node:fs/promises"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { parseConnectionDefinition, type ConnectionDefinition } from "@cogpit/plugin-contracts"
import { createConnectionExecutor } from "../../plugins/connectionExecutor"

let definition: ConnectionDefinition
beforeAll(async () => { definition = parseConnectionDefinition(JSON.parse(await readFile(new URL("../../../plugins/tts/connections/speech.json", import.meta.url), "utf8"))) })
function fixture() {
  const transport = vi.fn(async () => ({ mimeType: "audio/mpeg", bytes: new Uint8Array([255, 251, 1]).buffer }))
  const controller = new AbortController()
  const executor = createConnectionExecutor(definition, { label: "Speech", secret: "private-fixture-token", selected: { voice: { id: "af_heart", label: "Heart" } } }, { transport, allowedOperations: ["synthesize"], signal: controller.signal })
  return { executor, transport, controller }
}
const args = { input: "First paragraph.\n\nSecond paragraph.", speed: 0.75, format: "mp3" }
describe("declared speech connection operations", () => {
  it("builds a fixed-origin POST with host-owned voice binding and multiline input", async () => {
    const value = fixture()
    expect(await value.executor.media({ operation: "synthesize", args })).toMatchObject({ ok: true })
    expect(value.transport).toHaveBeenCalledWith(expect.objectContaining({ origin: "https://stt.cogpit.dev", path: "/v1/audio/speech", method: "POST", body: { input: args.input, speed: 0.75, voice: "af_heart", model: "tts-1", response_format: "mp3" }, response: expect.objectContaining({ type: "audio" }) }))
  })
  it.each([{ ...args, speed: 2.1 }, { ...args, voice: "forged" }, { ...args, input: "x".repeat(16385) }, { ...args, input: "bad\u0000text" }, { ...args, format: "html" }])("rejects invalid synthesis arguments before provider traffic", async invalid => {
    const value = fixture()
    expect(await value.executor.media({ operation: "synthesize", args: invalid })).toEqual({ ok: false, error: "INVALID_REQUEST" })
    expect(value.transport).not.toHaveBeenCalled()
  })
  it("keeps setup, JSON and media calls distinct and honors cancellation", async () => {
    const value = fixture()
    expect(await value.executor.request({ operation: "synthesize", args })).toEqual({ ok: false, error: "INVALID_REQUEST" })
    expect(await value.executor.media({ operation: "voices", args: {} })).toEqual({ ok: false, error: "INVALID_REQUEST" })
    value.controller.abort()
    expect(await value.executor.media({ operation: "synthesize", args })).toEqual({ ok: false, error: "CANCELED" })
    expect(value.transport).not.toHaveBeenCalled()
  })
})
