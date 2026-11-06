// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IncomingMessage } from "node:http"
import { Socket } from "node:net"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { orchestrationStore } from "../../orchestration/storage"
import { resolveConversationTransition, transitionConversation } from "../../lib/conversationTransition"
import { __resetEditionForTest, PERSONAL_EDITION } from "../../edition"
import { installFakeEdition } from "../edition/fakeEdition"
import { descriptorFor } from "../../../shared/session/agent-descriptors"
import { dirs } from "../../dirs"
import { readSessionConfig } from "../../lib/sessionConfigStore"
let previousConfigDir: string
const mocks = vi.hoisted(() => ({ start: vi.fn(), running: false, missingShortcut: false, paths: new Map<string, string>() }))
vi.mock("../../agents/runtimes", () => ({
  resolveSessionAgent: async (id: string) => ({ kind: id === "source" ? mocks.missingShortcut ? "copilot" : "claude" : "codex", filePath: id === "source" && mocks.missingShortcut ? null : mocks.paths.get(id), instanceId: "default" }),
  runtimeFor: () => ({ start: mocks.start, activity: () => ({ live: true, running: mocks.running }), descriptor: descriptorFor("codex") }),
}))
vi.mock("../../sessionPaths", () => ({ findJsonlPath: async (id: string) => mocks.paths.get(id) ?? null }))
const request = () => new IncomingMessage(new Socket())
beforeEach(async () => {
  __resetEditionForTest(); mocks.running = false; mocks.missingShortcut = false; mocks.start.mockReset(); mocks.paths.clear()
  const cwd = process.env.COGPIT_ORCHESTRATION_ROOT!
  previousConfigDir = dirs.SESSION_CONFIG_DIR
  dirs.SESSION_CONFIG_DIR = join(cwd, "session-config")
  for (const id of ["source", "recovered"]) {
    const path = join(cwd, `${id}.jsonl`); mocks.paths.set(id, path)
    await writeFile(path, JSON.stringify({ type: "user", sessionId: id, cwd, message: { role: "user", content: [{ type: "text", text: "Previous request" }, { type: "image", source: { data: "PRIVATE-IMAGE-DATA" } }] } }) + "\n")
  }
  mocks.start.mockImplementation(async (input) => { input.onSessionId?.("recovered"); return { sessionId: "recovered", dirName: "codex__project", fileName: "recovered.jsonl", filePath: mocks.paths.get("recovered") } })
})
afterEach(() => { __resetEditionForTest(); dirs.SESSION_CONFIG_DIR = previousConfigDir })
const input = () => ({ sessionId: "source", commandId: "handoff-command-1", expectedRevision: 1, mode: "handoff" as const, agent: "codex" as const })
describe("provider transition recovery", () => {
  it("runs the next request with the chosen model and effort and keeps them in the destination composer", async () => {
    await transitionConversation(request(), { ...input(), model: "gpt-6-sol", effort: "xhigh", message: "Review the changes" })
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6-sol", effort: "xhigh" }))
    expect(mocks.start.mock.calls[0][0].message).toContain("Current request: Review the changes")
    expect(await readSessionConfig("recovered.jsonl")).toMatchObject({ model: "gpt-6-sol", effort: "xhigh" })
  })
  it("stores provider defaults so the source composer's choices do not leak into the next send", async () => {
    await transitionConversation(request(), input())
    expect(mocks.start.mock.calls[0][0].model).toBeUndefined()
    expect(mocks.start.mock.calls[0][0].effort).toBeUndefined()
    expect(await readSessionConfig("recovered.jsonl")).toMatchObject({ model: "", effort: "" })
  })
  it("refuses to reuse a handoff command with a different model or effort", async () => {
    const chosen = { ...input(), model: "gpt-6-sol", effort: "high" }
    await transitionConversation(request(), chosen)
    await expect(transitionConversation(request(), { ...chosen, effort: "xhigh" })).rejects.toMatchObject({ status: 409 })
    await expect(transitionConversation(request(), { ...chosen, model: "gpt-6-astra" })).rejects.toMatchObject({ status: 409 })
    expect(mocks.start).toHaveBeenCalledOnce()
  })
  it.each([{ model: 123 }, { effort: null }])("refuses invalid model and effort values: %j", async (invalid) => {
    await expect(transitionConversation(request(), { ...input(), ...invalid } as never)).rejects.toMatchObject({ status: 400 })
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it("resolves an idle managed provider's history when its runtime shortcut has no file path", async () => {
    mocks.missingShortcut = true
    expect(await transitionConversation(request(), input())).toMatchObject({ mode: "handoff", sessionId: "recovered" })
    expect(mocks.start.mock.calls[0][0].message).toContain("Previous request")
  })
  it("hands off text only and returns the same session when its HTTP response was lost", async () => {
    const first = await transitionConversation(request(), input())
    expect(mocks.start.mock.calls[0][0].message).toContain("Previous request")
    expect(mocks.start.mock.calls[0][0].message).not.toContain("PRIVATE-IMAGE-DATA")
    expect(await transitionConversation(request(), input())).toEqual(first)
    expect(mocks.start).toHaveBeenCalledOnce()
    const conversation = orchestrationStore().findConversation({ hostId: "local", agent: "claude", instanceId: "default", sessionId: "source" })!
    expect(conversation.binding.sessionId).toBe("recovered")
  })
  it("keeps an uncertain creation fenced until its reported native session is attached", async () => {
    mocks.start.mockImplementation(async (request) => { request.onSessionId?.("recovered"); throw new Error("Transport disconnected") })
    const chosen = { ...input(), model: "gpt-6-sol", effort: "high" }
    await expect(transitionConversation(request(), chosen)).rejects.toThrow("disconnected")
    await expect(transitionConversation(request(), chosen)).rejects.toThrow("uncertain")
    const resolved = await resolveConversationTransition(request(), { sessionId: "source", commandId: input().commandId })
    expect(resolved).toMatchObject({ sessionId: "recovered", mode: "handoff" })
    expect(mocks.start).toHaveBeenCalledOnce()
    expect(await readSessionConfig("recovered.jsonl")).toMatchObject({ model: "gpt-6-sol", effort: "high" })
    expect(await resolveConversationTransition(request(), { sessionId: "source", commandId: input().commandId })).toEqual(resolved)
  })
  it("requires current access and refuses a switch during a running turn", async () => {
    mocks.running = true
    await expect(transitionConversation(request(), input())).rejects.toThrow("active turn")
    mocks.running = false
    installFakeEdition({ access: { ...PERSONAL_EDITION.access, levelOf: async () => "view" } })
    await expect(transitionConversation(request(), input())).rejects.toMatchObject({ status: 403 })
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
