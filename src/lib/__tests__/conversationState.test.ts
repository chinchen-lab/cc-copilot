import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CommandReceipt } from "../../../shared/contracts/orchestration"

vi.mock("../auth", () => ({ authFetch: vi.fn(() => new Promise(() => {})), authUrl: (url: string) => url }))
import { admitReceipt, conversationStateFor } from "../conversationState"
import { authFetch } from "../auth"

const receipt: CommandReceipt = { id: "command", conversationId: "conversation", sessionId: "s1", bindingRevision: 1, state: "queued", intent: "queue", message: "hello", createdAt: 1, updatedAt: 1, position: 1 }

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, "random").mockReturnValue(0.5)
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
  vi.mocked(authFetch).mockReset().mockImplementation(() => new Promise(() => {}))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function response(state = "queued") {
  return new Response(JSON.stringify({ conversation: { id: "conversation" }, commands: [{ ...receipt, state }], replay: { cursor: 1 } }))
}

describe("admitReceipt", () => {
  it("keeps the same snapshot and does not notify subscribers for unchanged polls", async () => {
    vi.mocked(authFetch).mockImplementation(async () => response())
    const owner = conversationStateFor("unchanged")
    const changed = vi.fn()
    const stop = owner.subscribe(changed)
    try {
      await vi.advanceTimersByTimeAsync(0)
      const first = owner.snapshot()
      expect(changed).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(authFetch).toHaveBeenCalledTimes(3)
      expect(owner.snapshot()).toBe(first)
      expect(changed).toHaveBeenCalledOnce()
      vi.mocked(authFetch).mockImplementation(async () => response("completed"))
      await vi.advanceTimersByTimeAsync(3_000)
      expect(owner.snapshot().commands[0]?.state).toBe("completed")
      expect(changed).toHaveBeenCalledTimes(2)
    } finally { stop() }
  })

  it("stops queue requests while hidden and resumes on visibility", async () => {
    vi.mocked(authFetch).mockImplementation(async () => response())
    const visibility = vi.spyOn(document, "visibilityState", "get")
    const owner = conversationStateFor("hidden")
    const stop = owner.subscribe(() => {})
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(authFetch).toHaveBeenCalledOnce()
      visibility.mockReturnValue("hidden")
      await vi.advanceTimersByTimeAsync(20_000)
      expect(authFetch).toHaveBeenCalledOnce()
      visibility.mockReturnValue("visible")
      document.dispatchEvent(new Event("visibilitychange"))
      await vi.advanceTimersByTimeAsync(0)
      expect(authFetch).toHaveBeenCalledTimes(2)
    } finally { stop() }
  })

  it("shows an accepted command only in a queue someone is watching, once", () => {
    expect(admitReceipt(receipt)).toBe(false)

    const owner = conversationStateFor("s1")
    const stop = owner.subscribe(() => {})
    expect(admitReceipt(receipt)).toBe(true)
    expect(admitReceipt(receipt)).toBe(true)
    expect(owner.snapshot().commands).toEqual([receipt])

    stop()
    expect(admitReceipt(receipt)).toBe(false)
  })
})
