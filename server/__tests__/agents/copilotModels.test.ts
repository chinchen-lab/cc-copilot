// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CopilotModel } from "../../agents/copilotTransport"
import { MODEL_FETCH_TIMEOUT_MS } from "../../agents/modelCatalog"

const state = vi.hoisted(() => ({
  models: [] as CopilotModel[],
  failure: null as Error | null,
  hang: false,
  instances: [] as Array<{ listModels: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> }>,
  shared: { listModels: vi.fn(), shutdown: vi.fn() },
}))
vi.mock("../../agents/copilotTransport", () => ({
  copilotRuntime: state.shared,
  CopilotRuntime: class {
    listModels = vi.fn(() => state.hang ? new Promise(() => {}) : state.failure ? Promise.reject(state.failure) : Promise.resolve(state.models))
    shutdown = vi.fn().mockResolvedValue([])
    constructor() { state.instances.push(this) }
  },
}))
import { fetchCopilotModels } from "../../agents/copilotModels"

beforeEach(() => {
  state.models = [{ id: "auto", name: "Auto" }]
  state.failure = null
  state.hang = false
  state.instances = []
  vi.clearAllMocks()
})
afterEach(() => { vi.useRealTimers() })

describe("fetchCopilotModels", () => {
  it("reads a fresh CLI catalog after an upgrade without touching the live session runtime", async () => {
    expect((await fetchCopilotModels())!.map((model) => model.value)).toEqual(["", "auto"])
    state.models = [...state.models, { id: "gemini-4-argon", name: "Gemini 4 Argon" }]
    expect((await fetchCopilotModels())!.map((model) => model.value)).toEqual(["", "auto", "gemini-4-argon"])
    expect(state.instances).toHaveLength(2)
    for (const instance of state.instances) {
      expect(instance.listModels).toHaveBeenCalledOnce()
      expect(instance.shutdown).toHaveBeenCalledOnce()
    }
    expect(state.shared.listModels).not.toHaveBeenCalled()
    expect(state.shared.shutdown).not.toHaveBeenCalled()
  })

  it("cleans up a failed catalog query and allows the next query to recover", async () => {
    state.failure = new Error("not authenticated")
    await expect(fetchCopilotModels()).resolves.toBeNull()
    expect(state.instances[0].shutdown).toHaveBeenCalledOnce()
    state.failure = null
    expect(await fetchCopilotModels()).not.toBeNull()
    expect(state.instances).toHaveLength(2)
  })

  it("cleans up an unresponsive CLI after the catalog timeout", async () => {
    vi.useFakeTimers()
    state.hang = true
    const result = fetchCopilotModels()
    await vi.advanceTimersByTimeAsync(MODEL_FETCH_TIMEOUT_MS)
    await expect(result).resolves.toBeNull()
    expect(state.instances[0].shutdown).toHaveBeenCalledOnce()
  })
})
