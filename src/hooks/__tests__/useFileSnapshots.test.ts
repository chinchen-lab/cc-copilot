import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useFileSnapshots } from "../useFileSnapshots"
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authFetch: mocks.fetch }))
afterEach(() => vi.resetAllMocks())

describe("useFileSnapshots", () => {
  it("is lazy and preserves empty snapshots", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ before: "", after: "" }) })
    const hook = renderHook(({ enabled }) => useFileSnapshots("session", "/a", enabled, "1"), { initialProps: { enabled: false } })
    expect(mocks.fetch).not.toHaveBeenCalled()
    hook.rerender({ enabled: true })
    await waitFor(() => expect(hook.result.current.snapshot).toEqual({ before: "", after: "" }))
  })
  it("clears old content immediately and ignores a stale response after changing files", async () => {
    let resolveOld!: (value: unknown) => void
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ before: "b", after: "B" }) })
    const hook = renderHook(({ file }) => useFileSnapshots("s", file, true, "1"), { initialProps: { file: "/a" } })
    hook.rerender({ file: "/b" })
    expect(hook.result.current.snapshot).toBeNull()
    await waitFor(() => expect(hook.result.current.snapshot?.after).toBe("B"))
    await act(async () => { resolveOld({ ok: true, json: async () => ({ before: "a", after: "A" }) }) })
    expect(hook.result.current.snapshot?.after).toBe("B")
  })
  it("refetches as a session advances and falls back on HTTP errors", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ before: "a", after: "b" }) })
    mocks.fetch.mockResolvedValueOnce({ ok: false })
    const hook = renderHook(({ revision }) => useFileSnapshots("s", "/a", true, revision), { initialProps: { revision: "1" } })
    await waitFor(() => expect(hook.result.current.snapshot?.after).toBe("b"))
    hook.rerender({ revision: "2" })
    expect(hook.result.current.snapshot).toBeNull()
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(hook.result.current.snapshot).toBeNull()
  })
})
