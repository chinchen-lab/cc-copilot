import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authFetch: mocks.authFetch }))

import { useSlashSuggestions } from "../useSlashSuggestions"

describe("useSlashSuggestions capability gate", () => {
  beforeEach(() => { mocks.authFetch.mockReset() })

  it("does not inspect command files while config access is disabled", () => {
    const { result } = renderHook(() => useSlashSuggestions("/srv/project", false))

    expect(mocks.authFetch).not.toHaveBeenCalled()
    expect(result.current).toEqual({ suggestions: [], loading: false })
  })

  it("loads global suggestions before a project path is available", async () => {
    const suggestions = [{ name: "review", type: "skill" }]
    mocks.authFetch.mockResolvedValue({ ok: true, json: async () => ({ suggestions }) })
    const { result } = renderHook(() => useSlashSuggestions(undefined, true, "copilot"))
    await waitFor(() => expect(result.current.suggestions).toEqual(suggestions))
    expect(mocks.authFetch.mock.calls[0][0]).toBe("/api/slash-suggestions?agentKind=copilot")
  })

  it("refetches for another provider at the same path and ignores late results", async () => {
    let resolveFirst!: (value: unknown) => void
    mocks.authFetch.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
    const suggestions = [{ name: "prompts:review", type: "command" }]
    mocks.authFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ suggestions }) })
    const { result, rerender } = renderHook(({ kind }) => useSlashSuggestions("/repo", true, kind), {
      initialProps: { kind: "copilot" as "copilot" | "codex" },
    })
    const firstSignal = mocks.authFetch.mock.calls[0][1].signal
    rerender({ kind: "codex" })
    await waitFor(() => expect(result.current.suggestions).toEqual(suggestions))
    expect(firstSignal.aborted).toBe(true)
    expect(mocks.authFetch.mock.calls[1][0]).toContain("agentKind=codex")
    await act(async () => { resolveFirst({ ok: true, json: async () => ({ suggestions: [{ name: "stale" }] }) }) })
    expect(result.current.suggestions).toEqual(suggestions)
  })

  it("clears suggestions and cancels the request when access is disabled", async () => {
    mocks.authFetch.mockReturnValue(new Promise(() => {}))
    const { result, rerender } = renderHook(({ enabled }) => useSlashSuggestions("/repo", enabled, "codex"), {
      initialProps: { enabled: true },
    })
    const signal = mocks.authFetch.mock.calls[0][1].signal
    rerender({ enabled: false })
    expect(signal.aborted).toBe(true)
    expect(result.current).toEqual({ suggestions: [], loading: false })
  })
})
