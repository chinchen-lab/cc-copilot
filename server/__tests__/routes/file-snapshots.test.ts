// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Middleware } from "../../http"
const mocks = vi.hoisted(() => ({ find: vi.fn(), store: vi.fn(), read: vi.fn(), snapshot: vi.fn() }))
vi.mock("../../sessionPaths", () => ({ findJsonlPath: mocks.find }))
vi.mock("../../agents", () => ({ storeForPath: mocks.store }))
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }))
import { registerFileSnapshotRoutes } from "../../routes/file-snapshots"

let handler: Middleware
beforeEach(() => {
  vi.resetAllMocks()
  registerFileSnapshotRoutes((_path, value) => { handler = value })
  mocks.find.mockResolvedValue("/sessions/s.jsonl")
  mocks.store.mockReturnValue({ readFileSnapshot: mocks.snapshot })
  mocks.read.mockResolvedValue("transcript")
  mocks.snapshot.mockResolvedValue({ before: "old", after: "new" })
})
async function request(url: string, method = "GET") {
  const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() }
  const next = vi.fn()
  await handler({ url, method } as never, res as never, next)
  return { res, next, body: res.end.mock.calls[0]?.[0] }
}
describe("file snapshot route", () => {
  it("delegates to the owning store and disables caching for live sessions", async () => {
    const { res, body } = await request("/s?path=%2Frepo%2Fa.ts")
    expect(mocks.snapshot).toHaveBeenCalledWith("/sessions/s.jsonl", "transcript", "/repo/a.ts")
    expect(body).toBe(JSON.stringify({ before: "old", after: "new" }))
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  })
  it("returns null for stores without native snapshots without reading the transcript", async () => {
    mocks.store.mockReturnValue({})
    expect((await request("/s?path=a.ts")).body).toBe("null")
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it("rejects malformed input and reports a missing session", async () => {
    expect((await request("/s")).res.statusCode).toBe(400)
    expect((await request("/%ZZ?path=a")).res.statusCode).toBe(400)
    mocks.find.mockResolvedValue(null)
    expect((await request("/missing?path=a")).res.statusCode).toBe(404)
    expect((await request("/s?path=a", "POST")).next).toHaveBeenCalled()
  })
  it("falls back when backups disappear", async () => {
    mocks.snapshot.mockRejectedValue(new Error("ENOENT"))
    expect((await request("/s?path=a")).body).toBe("null")
  })
})
