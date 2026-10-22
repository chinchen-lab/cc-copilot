import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TokenUsageIndicator } from "../TokenUsageWidget"
import type { UsageData } from "@/hooks/useTokenUsage"
import { setLanguage } from "@/lib/i18n/language"

const mocks = vi.hoisted(() => ({ useTokenUsage: vi.fn() }))
vi.mock("@/hooks/useTokenUsage", () => ({ useTokenUsage: mocks.useTokenUsage }))
const fetchedAt = Date.parse("2026-10-21T00:00:00Z")
function usageWithReset(resetsAt: string): UsageData {
  return {
    accountLogin: "company-user", subscriptionType: "business", fetchedAt,
    fiveHour: { utilization: 30, label: "Premium interactions", resetsAt },
  }
}
function setUsage(usage: UsageData) {
  mocks.useTokenUsage.mockReturnValue({ usage, available: true, loading: false, refresh: vi.fn() })
}

beforeEach(() => { mocks.useTokenUsage.mockReset() })
afterEach(() => { cleanup(); setLanguage("en") })

describe("usage tooltip", () => {
  it.each([
    ["2026-10-22T00:00:00Z", "1 Day"],
    ["2026-10-22T01:00:00Z", "1 Day 1h"],
    ["2026-10-23T05:00:00Z", "2 Days 5h"],
    ["2026-10-21T23:59:00Z", "24h"],
  ])("splits the reset countdown into days and hours (%s)", async (reset, expected) => {
    setUsage(usageWithReset(reset))
    render(<TokenUsageIndicator />)
    await userEvent.hover(screen.getByRole("button", { name: "Refresh agent usage" }))
    expect(await screen.findByText(`Resets in ${expected}`)).toBeInTheDocument()
  })

  it("localizes the day unit in Traditional Chinese", async () => {
    setLanguage("zh-TW")
    setUsage(usageWithReset("2026-10-23T05:00:00Z"))
    render(<TokenUsageIndicator />)
    await userEvent.hover(screen.getByRole("button"))
    expect(await screen.findByText(/重設倒數\s*2 天 5h/)).toBeInTheDocument()
  })
  it("identifies the account and uses the billing reset date", async () => {
    setUsage(usageWithReset("2026-11-01T00:00:00Z"))
    render(<TokenUsageIndicator />)
    await userEvent.hover(screen.getByRole("button", { name: "Refresh agent usage" }))
    expect(await screen.findByText("@company-user")).toBeInTheDocument()
    expect(screen.getByText("business")).toBeInTheDocument()
    expect(screen.getByText("Resets in 11 Days")).toBeInTheDocument()
  })

  it.each(["2026-10-21T00:00:00Z", "2026-10-20T23:00:00Z", "invalid-date"])("omits an expired or invalid reset (%s)", async (reset) => {
    setUsage(usageWithReset(reset))
    render(<TokenUsageIndicator />)
    await userEvent.hover(screen.getByRole("button", { name: "Refresh agent usage" }))
    await screen.findByText("@company-user")
    expect(screen.queryByText(/Resets in/)).not.toBeInTheDocument()
  })

  it("does not round a future reset down to zero hours", async () => {
    setUsage(usageWithReset("2026-10-21T00:10:00Z"))
    render(<TokenUsageIndicator />)
    await userEvent.hover(screen.getByRole("button", { name: "Refresh agent usage" }))
    expect(await screen.findByText("Resets in 1h")).toBeInTheDocument()
  })

  it("shows unavailable quota without inventing zero usage for an organization account", async () => {
    setUsage({ accountLogin: "company-user", subscriptionType: "business", quotaUnavailable: true })
    render(<TokenUsageIndicator />)
    const indicator = screen.getByRole("button", { name: "Refresh agent usage" })
    expect(indicator).toHaveTextContent("—")
    expect(indicator).not.toHaveTextContent("0%")
    await userEvent.hover(indicator)
    expect(await screen.findByText("This account does not report a usage quota.")).toBeInTheDocument()
    expect(screen.getByText("@company-user")).toBeInTheDocument()
  })
})
