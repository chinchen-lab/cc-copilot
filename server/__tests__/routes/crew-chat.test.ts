// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn(), post: vi.fn(), listen: vi.fn(), authorize: vi.fn() }))
vi.mock("../../lib/crewChat", () => ({ crewChatContext: mocks.context, readCrewChat: mocks.read, postCrewChat: mocks.post, setCrewChatListening: mocks.listen }))
vi.mock("../../edition", () => ({ authorizeSession: mocks.authorize }))
import { registerCrewChatRoutes } from "../../routes/crew-chat"
import { collectRoutes, createMockReqRes, getRouteHandler } from "../http-fixtures"

async function call(method: string, url = "/lead", body?: unknown) {
  const handler = getRouteHandler(collectRoutes(registerCrewChatRoutes), "/api/crew-chat/")
  const { req, res, next, sendBody } = createMockReqRes(method, url, body === undefined ? {} : { body: JSON.stringify(body) })
  const done = handler(req, res, next)
  sendBody()
  await done
  await vi.waitFor(() => expect(res.end.mock.calls.length + next.mock.calls.length).toBeGreaterThan(0))
  return { status: res._getStatus(), body: JSON.parse(res._getData() || "null") }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockResolvedValue({})
  mocks.context.mockResolvedValue({ rootId: "lead" })
  mocks.read.mockResolvedValue({ rootId: "lead", messages: [] })
  mocks.post.mockResolvedValue({ message: { text: "Hello" }, pending: [] })
  mocks.listen.mockResolvedValue({ listening: false })
})
it("reads pages and checks both the member and lead session", async () => {
  expect((await call("GET", "/parser?after=2&limit=10")).status).toBe(200)
  expect(mocks.authorize.mock.calls.map(([, , session, level]) => [session.sessionId, level])).toEqual([["parser", "view"], ["lead", "view"]])
  expect(mocks.read).toHaveBeenCalledWith("parser", { after: 2, before: undefined, limit: 10 }, expect.anything())
})
it("posts trusted user messages and changes listening", async () => {
  expect((await call("POST", "/lead", { text: "Hello", commandId: "route-chat-001", mentions: ["parser"] })).status).toBe(200)
  expect(mocks.post).toHaveBeenCalledWith("lead", { text: "Hello", commandId: "route-chat-001", mentions: ["parser"], senderSessionId: undefined }, expect.anything())
  expect((await call("PATCH", "/lead", { sessionId: "parser", listening: false })).status).toBe(200)
  expect(mocks.listen).toHaveBeenCalledWith("lead", "parser", false, expect.anything())
})
it("rejects malformed posts and listening settings without performing writes", async () => {
  for (const body of [{ text: "hi" }, { text: "hi", commandId: 1 }, { text: "hi", commandId: "route-chat-001", mentions: [7] }, { text: "hi", commandId: "route-chat-001", senderSessionId: 1 }]) expect((await call("POST", "/lead", body)).status).toBe(400)
  expect((await call("PATCH", "/lead", { sessionId: "parser", listening: "false" })).status).toBe(400)
  expect(mocks.post).not.toHaveBeenCalled()
  expect(mocks.listen).not.toHaveBeenCalled()
})
