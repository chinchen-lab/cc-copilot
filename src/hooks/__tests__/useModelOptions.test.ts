import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { fallbackModelsFor } from "@/lib/agents/models"
import {
  CATALOG_RETRY_MS,
  CATALOG_TTL_MS,
  loadModelCatalog,
  refreshModelCatalogOnFocus,
  resetModelCatalogFetch,
} from "../useModelOptions"
import {
  getModelOptions,
  resetDynamicModelOptions,
} from "@/lib/utils"
import { authFetch } from "@/lib/auth"

vi.mock("@/lib/auth", () => ({
  authFetch: vi.fn(),
}))

const mockedAuthFetch = vi.mocked(authFetch)

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  resetModelCatalogFetch()
  resetDynamicModelOptions()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("loadModelCatalog", () => {
  it("swaps in dynamic catalogs from /api/models", async () => {
    const claude = [
      { value: "", label: "Default" },
      { value: "claude-fable-5[1m]", label: "Fable" },
    ]
    const codex = [
      { value: "", label: "Default" },
      { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    ]
    const copilot = [
      { value: "", label: "Default" },
      { value: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
    ]
    mockedAuthFetch.mockResolvedValue(jsonResponse({ claude, codex, copilot }))

    await loadModelCatalog()

    expect(mockedAuthFetch).toHaveBeenCalledWith("/api/models")
    expect(getModelOptions("claude")).toEqual(claude)
    expect(getModelOptions("codex")).toEqual(codex)
    expect(getModelOptions("copilot")).toEqual(copilot)
  })

  it("keeps static fallbacks for providers the server could not resolve", async () => {
    const codex = [
      { value: "", label: "Default" },
      { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    ]
    mockedAuthFetch.mockResolvedValue(jsonResponse({ claude: null, codex }))

    await loadModelCatalog()

    expect(getModelOptions("claude")).toBe(fallbackModelsFor("claude"))
    expect(getModelOptions("codex")).toEqual(codex)
    expect(getModelOptions("copilot")).toBe(fallbackModelsFor("copilot"))
  })

  it("keeps static fallbacks when the request fails", async () => {
    mockedAuthFetch.mockRejectedValue(new Error("offline"))

    await loadModelCatalog()

    expect(getModelOptions("claude")).toBe(fallbackModelsFor("claude"))
    expect(getModelOptions("codex")).toBe(fallbackModelsFor("codex"))
    expect(getModelOptions("copilot")).toBe(fallbackModelsFor("copilot"))
  })

  it("ignores malformed catalog entries", async () => {
    mockedAuthFetch.mockResolvedValue(
      jsonResponse({ claude: [{ nope: true }], codex: "not-an-array", copilot: [] }),
    )

    await loadModelCatalog()

    expect(getModelOptions("claude")).toBe(fallbackModelsFor("claude"))
    expect(getModelOptions("codex")).toBe(fallbackModelsFor("codex"))
    expect(getModelOptions("copilot")).toBe(fallbackModelsFor("copilot"))
  })

  it("shares one request between concurrent callers", async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({ claude: null, codex: null }))

    await Promise.all([loadModelCatalog(), loadModelCatalog()])

    expect(mockedAuthFetch).toHaveBeenCalledTimes(1)
  })

  it("does not refetch while the catalog is fresh", async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({ claude: null, codex: null }))

    await loadModelCatalog()
    vi.advanceTimersByTime(CATALOG_TTL_MS - 1)
    await loadModelCatalog()

    expect(mockedAuthFetch).toHaveBeenCalledTimes(1)
  })

  it("bypasses browser and server caches to discover newly available models", async () => {
    const before = [{ value: "auto", label: "Auto" }]
    const after = [...before, { value: "gemini-4-argon", label: "Gemini 4 Argon" }]
    mockedAuthFetch.mockResolvedValueOnce(jsonResponse({ copilot: before }))
      .mockResolvedValueOnce(jsonResponse({ copilot: after }))
    await loadModelCatalog()
    await loadModelCatalog(true)
    expect(mockedAuthFetch).toHaveBeenNthCalledWith(2, "/api/models?refresh=1")
    expect(getModelOptions("copilot")).toEqual(after)
  })

  it("shares a forced refresh after an ordinary request already in flight", async () => {
    let complete!: (response: Response) => void
    mockedAuthFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve }))
      .mockResolvedValueOnce(jsonResponse({ copilot: [{ value: "gemini-4-argon", label: "Gemini 4 Argon" }] }))
    const initial = loadModelCatalog()
    const first = loadModelCatalog(true)
    const second = loadModelCatalog(true)
    complete(jsonResponse({ copilot: [{ value: "auto", label: "Auto" }] }))
    await Promise.all([initial, first, second])
    expect(mockedAuthFetch).toHaveBeenCalledTimes(2)
    expect(mockedAuthFetch).toHaveBeenLastCalledWith("/api/models?refresh=1")
    expect(getModelOptions("copilot").map((model) => model.value)).toEqual(["gemini-4-argon"])
  })

  it("reports a manual refresh failure without breaking background callers or losing the last good list", async () => {
    const models = [{ value: "gemini-4-argon", label: "Gemini 4 Argon" }]
    mockedAuthFetch.mockResolvedValueOnce(jsonResponse({ copilot: models }))
    await loadModelCatalog()
    let fail!: (error: Error) => void
    mockedAuthFetch.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { fail = reject }))
    const refresh = loadModelCatalog(true)
    const background = loadModelCatalog()
    const rejected = expect(refresh).rejects.toThrow("offline")
    fail(new Error("offline"))
    await rejected
    await expect(background).resolves.toBeUndefined()
    expect(getModelOptions("copilot")).toEqual(models)
  })

  it("lets a manual refresh retry immediately after a failed automatic load", async () => {
    mockedAuthFetch.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse({ copilot: [{ value: "auto", label: "Auto" }] }))
    await loadModelCatalog()
    await loadModelCatalog(true)
    expect(mockedAuthFetch).toHaveBeenCalledTimes(2)
    expect(mockedAuthFetch).toHaveBeenLastCalledWith("/api/models?refresh=1")
  })

  it("refetches once the catalog is stale so a CLI upgrade shows up", async () => {
    const before = [{ value: "", label: "Default" }, { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" }]
    const after = [{ value: "", label: "Default" }, { value: "gpt-6-astra", label: "GPT-6 Astra" }]
    mockedAuthFetch
      .mockResolvedValueOnce(jsonResponse({ codex: before }))
      .mockResolvedValueOnce(jsonResponse({ codex: after }))

    await loadModelCatalog()
    expect(getModelOptions("codex")).toEqual(before)

    vi.advanceTimersByTime(CATALOG_TTL_MS)
    await loadModelCatalog()

    expect(mockedAuthFetch).toHaveBeenCalledTimes(2)
    expect(getModelOptions("codex")).toEqual(after)
  })

  it("retries a failed fetch after a short backoff instead of never", async () => {
    const codex = [{ value: "", label: "Default" }, { value: "gpt-6-astra", label: "GPT-6 Astra" }]
    mockedAuthFetch
      .mockRejectedValueOnce(new Error("server not up yet"))
      .mockResolvedValueOnce(jsonResponse({ codex }))

    await loadModelCatalog()
    await loadModelCatalog()
    expect(mockedAuthFetch).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(CATALOG_RETRY_MS)
    await loadModelCatalog()

    expect(mockedAuthFetch).toHaveBeenCalledTimes(2)
    expect(getModelOptions("codex")).toEqual(codex)
  })

  it("treats a non-OK response like a failure and retries after the backoff", async () => {
    mockedAuthFetch
      .mockResolvedValueOnce(jsonResponse(null, false))
      .mockResolvedValueOnce(jsonResponse({ codex: null }))

    await loadModelCatalog()
    vi.advanceTimersByTime(CATALOG_RETRY_MS)
    await loadModelCatalog()

    expect(mockedAuthFetch).toHaveBeenCalledTimes(2)
  })
})

describe("refreshModelCatalogOnFocus", () => {
  it("reloads a stale catalog when the window regains focus", async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({ codex: null }))
    const stop = refreshModelCatalogOnFocus()

    await loadModelCatalog()
    window.dispatchEvent(new Event("focus"))
    expect(mockedAuthFetch).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(CATALOG_TTL_MS)
    window.dispatchEvent(new Event("focus"))
    expect(mockedAuthFetch).toHaveBeenCalledTimes(2)

    stop()
    vi.advanceTimersByTime(CATALOG_TTL_MS)
    window.dispatchEvent(new Event("focus"))
    expect(mockedAuthFetch).toHaveBeenCalledTimes(2)
  })

  it("reloads a stale catalog when the document becomes visible again", async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({ codex: null }))
    const stop = refreshModelCatalogOnFocus()

    await loadModelCatalog()
    vi.advanceTimersByTime(CATALOG_TTL_MS)
    document.dispatchEvent(new Event("visibilitychange"))

    expect(mockedAuthFetch).toHaveBeenCalledTimes(2)
    stop()
  })
})
