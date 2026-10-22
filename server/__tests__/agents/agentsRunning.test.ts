// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const { activity, agentsWroteSince, storeForDirName } = vi.hoisted(() => {
  const agentsWroteSince = vi.fn(async (_dirName: string, _sessionId: string, _sinceMs: number) => false)
  return {
    activity: vi.fn((_sessionId: string) => ({ live: false, running: false, agentsRunning: false })),
    agentsWroteSince,
    storeForDirName: vi.fn((_dirName: string) => ({ agentsWroteSince })),
  }
})

vi.mock("../../agents/runtimes", () => ({ runtimeForDirName: () => ({ activity }) }))
vi.mock("../../agents", () => ({ storeForDirName }))

import { AGENT_WRITE_WINDOW_MS, sessionAgentsRunning } from "../../agents/agentsRunning"

const NOW = 1_800_000_000_000

beforeEach(() => {
  vi.clearAllMocks()
  activity.mockReturnValue({ live: false, running: false, agentsRunning: false })
  agentsWroteSince.mockResolvedValue(false)
  storeForDirName.mockImplementation(() => ({ agentsWroteSince }))
})

describe("sessionAgentsRunning", () => {
  it("takes the runtime's word when it hosts running agents", async () => {
    activity.mockReturnValue({ live: true, running: false, agentsRunning: true })

    await expect(sessionAgentsRunning("proj", "sess-1", NOW)).resolves.toBe(true)
    expect(activity).toHaveBeenCalledWith("sess-1")
    expect(agentsWroteSince).not.toHaveBeenCalled()
  })

  it("falls back to agent transcripts written within the window", async () => {
    agentsWroteSince.mockResolvedValue(true)

    await expect(sessionAgentsRunning("proj", "sess-1", NOW)).resolves.toBe(true)
    expect(agentsWroteSince).toHaveBeenCalledWith("proj", "sess-1", NOW - AGENT_WRITE_WINDOW_MS)
  })

  it("reports nothing running when neither the runtime nor a transcript says so", async () => {
    await expect(sessionAgentsRunning("proj", "sess-1", NOW)).resolves.toBe(false)
  })

  it("reports nothing running for a transcript whose provider instance is gone", async () => {
    storeForDirName.mockImplementation(() => {
      throw new Error("Provider instance for this transcript no longer exists")
    })

    await expect(sessionAgentsRunning("instance~gone~proj", "sess-1", NOW)).resolves.toBe(false)
  })
})
