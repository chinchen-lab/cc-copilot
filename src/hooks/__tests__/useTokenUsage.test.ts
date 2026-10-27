import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({
  authFetch: vi.fn(),
}))

import { authFetch } from "@/lib/auth"
import { __resetCapabilitiesForTest, setMe } from "@/lib/capabilities"
import type { AgentKind } from "@/lib/agents"
import { NO_CAPABILITIES } from "../../../shared/contracts/identity"
import {
  mapClaudeRuntimeResponse,
  mapCodexRuntimeResponse,
  mapCopilotRuntimeResponse,
} from "@/lib/agents/quota"
import { useTokenUsage } from "../useTokenUsage"
import { announceUsageRefresh } from "@/lib/usageRefreshEvents"

const mockedAuthFetch = vi.mocked(authFetch)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function jsonResponse(data: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response
}

describe("mapCodexRuntimeResponse", () => {
  it.each([
    ["promax", "Pro (Max)"],
    ["prolite", "Pro"],
    ["some_future_plan", "some_future_plan"],
  ])("names the %s plan the way Codex does", (planType, name) => {
    const usage = mapCodexRuntimeResponse({
      available: true,
      rateLimits: { rateLimits: { planType, primary: { usedPercent: 1, windowDurationMins: 300 } } },
    })

    expect(usage?.subscriptionType).toBe(name)
  })


  it("maps native rate-limit windows, plan, credits, and token history", () => {
    const usage = mapCodexRuntimeResponse({
      available: true,
      account: { account: { type: "chatgpt", planType: "plus" } },
      usage: { summary: { lifetimeTokens: 1_234_567 } },
      rateLimits: {
        rateLimits: {
          planType: "plus",
          primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 17, windowDurationMins: 10_080, resetsAt: 1_800_086_400 },
          credits: { hasCredits: true, unlimited: false, balance: "25.5" },
        },
      },
    })

    expect(usage).toMatchObject({
      subscriptionType: "Plus",
      lifetimeTokens: 1_234_567,
      creditBalance: "25.5",
      fiveHour: { utilization: 42, label: "5-hour" },
      sevenDay: { utilization: 17, label: "7-day" },
    })
    expect(usage?.fiveHour?.resetsAt).toBe("2027-01-15T08:00:00.000Z")
  })

  it("returns null when Codex is unavailable or has no usage information", () => {
    expect(mapCodexRuntimeResponse({ available: false })).toBeNull()
    expect(mapCodexRuntimeResponse({ available: true })).toBeNull()
  })
})

describe("mapClaudeRuntimeResponse", () => {
  it("maps SDK-backed plan windows and account information", () => {
    expect(mapClaudeRuntimeResponse({
      available: true,
      account: { subscriptionType: "max" },
      usage: {
        rate_limits: {
          five_hour: { utilization: 31, resets_at: "2027-01-01T00:00:00Z" },
          seven_day: { utilization: 12 },
          extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 8 },
        },
      },
    })).toMatchObject({
      subscriptionType: "max",
      fiveHour: { utilization: 31 },
      sevenDay: { utilization: 12 },
      extraUsage: { isEnabled: true, monthlyLimit: 100, usedCredits: 8 },
    })
  })
})

describe("mapCopilotRuntimeResponse", () => {
  it("prefers chat quota and maps remaining percentage to utilization", () => {
    expect(mapCopilotRuntimeResponse({
      available: true,
      quota: {
        quotaSnapshots: {
          chat: {
            entitlementRequests: 200,
            usedRequests: 11,
            remainingPercentage: 94.5,
            resetDate: "2026-10-01T00:00:00Z",
          },
          premium_interactions: { remainingPercentage: 20 },
        },
      },
    })).toEqual({
      fiveHour: {
        utilization: 5.5,
        resetsAt: "2026-10-01T00:00:00Z",
        label: "Chat",
        remaining: 189, limit: 200,
      },
    })
  })

  it("falls back to premium quota and clamps malformed percentages", () => {
    expect(mapCopilotRuntimeResponse({
      available: true,
      quota: {
        quotaSnapshots: {
          chat: {},
          premium_interactions: { remainingPercentage: -20 },
        },
      },
    })?.fiveHour).toEqual({ utilization: 100, resetsAt: undefined, label: "Premium interactions" })

    expect(mapCopilotRuntimeResponse({
      available: true,
      quota: { quotaSnapshots: { chat: { remainingPercentage: 140 } } },
    })?.fiveHour?.utilization).toBe(0)
  })

  it("returns null when Copilot is unavailable or has no usable quota", () => {
    expect(mapCopilotRuntimeResponse({ available: false })).toBeNull()
    expect(mapCopilotRuntimeResponse({ available: true, quota: {} })).toBeNull()
  })

  it("uses the finite premium quota for Business accounts with unlimited Chat", () => {
    expect(mapCopilotRuntimeResponse({
      available: true,
      quota: {
        account: { login: "company-user", plan: "business" },
        quotaSnapshots: {
          chat: { isUnlimitedEntitlement: true, entitlementRequests: -1, remainingPercentage: 100 },
          premium_interactions: { entitlementRequests: 300, usedRequests: 90, remainingPercentage: 70 },
        },
      },
    })).toEqual({
      accountLogin: "company-user", subscriptionType: "business",
      fiveHour: { utilization: 30, label: "Premium interactions", remaining: 210, limit: 300 },
    })
  })

  it("does not turn disabled or unlimited Business placeholders into a percentage", () => {
    expect(mapCopilotRuntimeResponse({
      available: true,
      quota: { quotaSnapshots: {
        chat: { isUnlimitedEntitlement: true, entitlementRequests: 0, remainingPercentage: 100 },
        premium_interactions: { hasQuota: false, entitlementRequests: 0, remainingPercentage: 0 },
      } },
    })).toBeNull()
    expect(mapCopilotRuntimeResponse({
      available: true,
      quota: { quotaSnapshots: {
        chat: { hasQuota: false, remainingPercentage: 100 },
        premium_interactions: { entitlementRequests: 300, usedRequests: 120 },
      } },
    })?.fiveHour).toEqual({ utilization: 40, label: "Premium interactions", remaining: 180, limit: 300 })
  })

  it("keeps account details available when an organization reports no personal quota", () => {
    expect(mapCopilotRuntimeResponse({
      available: true,
      quota: {
        account: { login: "company-user", plan: "business" },
        quotaSnapshots: { chat: { isUnlimitedEntitlement: true, entitlementRequests: 0, remainingPercentage: 100 } },
      },
    })).toEqual({ accountLogin: "company-user", subscriptionType: "business", quotaUnavailable: true })
  })

  it.each([
    ["chat", "Chat"],
    ["premium_interactions", "Premium interactions"],
    ["completions", "Completions"],
  ])("selects the finite %s allowance instead of zero-entitlement placeholders", (key, label) => {
    expect(mapCopilotRuntimeResponse({
      available: true,
      quota: { quotaSnapshots: {
        chat: { entitlementRequests: 0, usedRequests: 0, remainingPercentage: 100 },
        completions: { entitlementRequests: 0, usedRequests: 0, remainingPercentage: 100 },
        premium_interactions: { entitlementRequests: 0, usedRequests: 0, remainingPercentage: 100 },
        [key]: { entitlementRequests: 8000, usedRequests: 2000, remainingPercentage: 75 },
      } },
    })?.fiveHour).toEqual({ utilization: 25, label, remaining: 6000, limit: 8000 })
  })

  it("prefers a known finite allowance over an incomplete zero-usage Chat snapshot", () => {
    expect(mapCopilotRuntimeResponse({
      available: true,
      quota: { quotaSnapshots: {
        chat: { remainingPercentage: 100 },
        premium_interactions: { entitlementRequests: 8000, usedRequests: 2000, remainingPercentage: 75 },
      } },
    })?.fiveHour).toEqual({ utilization: 25, label: "Premium interactions", remaining: 6000, limit: 8000 })
  })

  it("keeps an exhausted finite allowance visible even when hasQuota is false", () => {
    expect(mapCopilotRuntimeResponse({
      available: true,
      quota: { quotaSnapshots: {
        premium_interactions: { entitlementRequests: 8000, usedRequests: 8000, remainingPercentage: 0, hasQuota: false },
      } },
    })?.fiveHour).toEqual({ utilization: 100, label: "Premium interactions", remaining: 0, limit: 8000 })
  })
})

describe("useTokenUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCapabilitiesForTest()
  })

  afterEach(() => {
    __resetCapabilitiesForTest()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("does not fetch or schedule polling when provider usage is unavailable to a member", async () => {
    setMe({
      authenticated: true,
      edition: "team",
      user: { id: "member-1", username: "bob", displayName: "Bob" },
      capabilities: NO_CAPABILITIES,
    })
    const intervalSpy = vi.spyOn(globalThis, "setInterval")

    const { result } = renderHook(() => useTokenUsage("claude"))
    await act(async () => { await Promise.resolve() })
    result.current.refresh()

    expect(mockedAuthFetch).not.toHaveBeenCalled()
    expect(intervalSpy).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ usage: null, loading: false, available: false })
  })

  it("fetches and maps Copilot quota from its own runtime endpoint", async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({
      available: true,
      quota: {
        quotaSnapshots: {
          chat: { remainingPercentage: 94.5 },
        },
      },
    }))
    const intervalSpy = vi.spyOn(globalThis, "setInterval")
    const { result } = renderHook(() => useTokenUsage("copilot"))

    await vi.waitFor(() => {
      expect(result.current.usage).toMatchObject({
        agentKind: "copilot",
        fiveHour: { utilization: 5.5, label: "Chat" },
      })
    })

    expect(mockedAuthFetch).toHaveBeenCalledWith(
      "/api/copilot/runtime",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(intervalSpy).toHaveBeenCalled()
    expect(result.current).toMatchObject({ loading: false, available: true })
  })

  it("bypasses the runtime cache on manual refresh", async () => {
    mockedAuthFetch.mockResolvedValue(jsonResponse({ available: true, quota: { quotaSnapshots: { chat: { remainingPercentage: 75 } } } }))
    const { result } = renderHook(() => useTokenUsage("copilot"))
    await vi.waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { result.current.refresh() })
    expect(mockedAuthFetch).toHaveBeenLastCalledWith("/api/copilot/runtime?refresh=1", expect.objectContaining({ cache: "no-store" }))
  })

  it("refreshes on completion and retries delayed settlement, without crossing providers or devices", async () => {
    vi.useFakeTimers()
    mockedAuthFetch.mockResolvedValue(jsonResponse({ available: true, quota: { quotaSnapshots: { chat: { remainingPercentage: 75 } } } }))
    const { unmount } = renderHook(() => useTokenUsage("copilot"))
    await act(async () => { await Promise.resolve() })
    await act(async () => { announceUsageRefresh("claude"); announceUsageRefresh("copilot", "another-device") })
    expect(mockedAuthFetch).toHaveBeenCalledTimes(1)
    await act(async () => { announceUsageRefresh("copilot") })
    expect(mockedAuthFetch).toHaveBeenLastCalledWith("/api/copilot/runtime?refresh=1", expect.any(Object))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(mockedAuthFetch).toHaveBeenCalledTimes(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(mockedAuthFetch).toHaveBeenCalledTimes(4)
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(mockedAuthFetch).toHaveBeenCalledTimes(5)
    unmount()
    await act(async () => { announceUsageRefresh("copilot"); await vi.advanceTimersByTimeAsync(60000) })
    expect(mockedAuthFetch).toHaveBeenCalledTimes(5)
  })

  it("ignores a stale provider response after the selected agent changes", async () => {
    const claudeResponse = deferred<Response>()
    const codexResponse = deferred<Response>()

    mockedAuthFetch.mockImplementation((input) => {
      return String(input) === "/api/claude/runtime" ? claudeResponse.promise : codexResponse.promise
    })

    const { result, rerender } = renderHook(
      ({ agentKind }) => useTokenUsage(agentKind),
      { initialProps: { agentKind: "claude" as AgentKind } },
    )

    await vi.waitFor(() => {
      expect(mockedAuthFetch).toHaveBeenCalledWith(
        "/api/claude/runtime",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
    const claudeSignal = mockedAuthFetch.mock.calls[0][1]?.signal

    rerender({ agentKind: "codex" })

    await vi.waitFor(() => {
      expect(mockedAuthFetch).toHaveBeenCalledWith(
        "/api/codex/runtime",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })
    expect(claudeSignal?.aborted).toBe(true)

    await act(async () => {
      codexResponse.resolve(jsonResponse({
        available: true,
        rateLimits: {
          rateLimits: {
            primary: { usedPercent: 12, windowDurationMins: 300 },
          },
        },
      }))
    })

    await vi.waitFor(() => {
      expect(result.current.usage?.agentKind).toBe("codex")
    })

    await act(async () => {
      claudeResponse.resolve(jsonResponse({
        available: true,
        usage: { rate_limits: { five_hour: { utilization: 99 } } },
      }))
      await Promise.resolve()
    })

    expect(result.current.usage?.agentKind).toBe("codex")
    expect(result.current.usage?.fiveHour?.utilization).toBe(12)
  })
})
