import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ModelOption } from "@/lib/utils"
import { ConversationActions } from "../ConversationActions"

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), models: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authFetch: mocks.fetch }))
vi.mock("@/hooks/useModelOptions", () => ({ useModelOptions: mocks.models }))
vi.mock("@/lib/conversationState", () => {
  const state = {
    conversation: { id: "conversation", revision: 1, binding: { agent: "claude", instanceId: "default", sessionId: "source" } },
  }
  const owner = { subscribe: () => () => {}, snapshot: () => state }
  return { conversationStateFor: () => owner }
})

const DEFAULT: ModelOption = { value: "", label: "Default" }
const EFFORTS = [
  { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "xhigh", label: "Extra High" },
]
const CATALOG: ModelOption[] = [
  DEFAULT,
  { value: "opus", label: "Opus 5.5", supportedReasoningEfforts: EFFORTS },
  { value: "fast", label: "Fast model", supportsEffort: false },
]

beforeEach(() => {
  mocks.fetch.mockReset().mockImplementation(async (url: string) => ({ ok: true, json: async () => (
    url === "/api/provider-instances" ? { instances: [{ id: "work", agent: "codex", label: "Work account" }] } : {}
  ) }))
  mocks.models.mockReset().mockImplementation((_agent: string, instanceId: string) => instanceId === "work" ? [
    DEFAULT, { value: "work-model", label: "Work model", supportedReasoningEfforts: [{ value: "low", label: "Light" }] },
  ] : CATALOG)
})

async function openActions() {
  const user = userEvent.setup()
  render(<ConversationActions sessionId="source" open onOpenChange={vi.fn()} onOpen={vi.fn()} />)
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("/api/provider-instances", expect.anything()))
  return user
}

async function select(user: ReturnType<typeof userEvent.setup>, field: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: field }))
  await user.click(await screen.findByRole("option", { name: option }))
}

async function submitted(user: ReturnType<typeof userEvent.setup>, button = "Start context handoff") {
  await user.click(screen.getByRole("button", { name: button }))
  await waitFor(() => expect(mocks.fetch.mock.calls.some(([url]) => url === "/api/conversation-transition")).toBe(true))
  const [, init] = mocks.fetch.mock.calls.find(([url]) => url === "/api/conversation-transition")!
  return JSON.parse(init.body) as Record<string, unknown>
}

describe("provider handoff model settings", () => {
  it("sends the chosen model and effort with the next request", async () => {
    const user = await openActions()
    await select(user, "Model", "Opus 5.5")
    await select(user, "Reasoning effort", "Extra High")
    await user.type(screen.getByRole("textbox", { name: "Next request" }), "Review the changes")
    expect(await submitted(user)).toMatchObject({ agent: "claude", model: "opus", effort: "xhigh", message: "Review the changes" })
  })

  it("uses provider defaults until the user makes an explicit choice", async () => {
    const user = await openActions()
    const body = await submitted(user)
    expect(body).not.toHaveProperty("model")
    expect(body).not.toHaveProperty("effort")
  })

  it("clears incompatible choices when switching provider or account and reads that account's catalog", async () => {
    const user = await openActions()
    await select(user, "Model", "Opus 5.5")
    await select(user, "Reasoning effort", "Extra High")
    await select(user, "Handoff provider", "Work account")
    expect(mocks.models).toHaveBeenLastCalledWith("codex", "work")
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("Default")
    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toHaveTextContent("Default")
    await select(user, "Model", "Work model")
    await select(user, "Reasoning effort", "Light")
    expect(await submitted(user)).toMatchObject({ agent: "codex", instanceId: "work", model: "work-model", effort: "low" })
  })

  it("omits effort for a model that does not support it", async () => {
    const user = await openActions()
    await select(user, "Model", "Opus 5.5")
    await select(user, "Reasoning effort", "High")
    await select(user, "Model", "Fast model")
    expect(screen.queryByRole("combobox", { name: "Reasoning effort" })).not.toBeInTheDocument()
    const body = await submitted(user)
    expect(body.model).toBe("fast")
    expect(body).not.toHaveProperty("effort")
  })

  it("keeps native resume on its original provider without the handoff model settings", async () => {
    const user = await openActions()
    await select(user, "Model", "Opus 5.5")
    await select(user, "Reasoning effort", "High")
    const body = await submitted(user, "Keep current native session")
    expect(body).toMatchObject({ mode: "resume", agent: "claude", instanceId: "default" })
    expect(body).not.toHaveProperty("model")
    expect(body).not.toHaveProperty("effort")
  })
})
