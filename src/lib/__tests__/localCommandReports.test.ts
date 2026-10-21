import { describe, expect, it } from "vitest"
import {
  formatMinorUnits,
  readableContextUsage,
  readableUsageLimits,
  usageLimitLabel,
  usageTextSections,
} from "../localCommandReports"
import type { UsageLimitRow } from "../../../shared/session/types"

const USAGE_TEXT = `You are currently using your subscription to power your Claude Code usage

Current session: 6% used · resets Oct 22 at 3:20am (Europe/Belgrade)
Current week (all models): 11% used · resets Oct 27 at 11pm (Europe/Belgrade)

What's contributing to your limits usage?
Approximate · sessions on this machine only · shares overlap

Last 24h · 2114 requests · 19 sessions
  67%  Start fresh when you switch tasks · run /clear
  51%  Give "general-purpose" subagents a cheaper model
  Top skills: /cogpit-browser 5%, /cogpit-memory 4%`

function row(overrides: Partial<UsageLimitRow>): UsageLimitRow {
  return { kind: "session", group: "session", percent: 6, resets_at: null, severity: "normal", is_active: false, ...overrides }
}

describe("usageLimitLabel", () => {
  it("names the meters the way the CLI prints them", () => {
    expect(usageLimitLabel(row({}))).toBe("Current session")
    expect(usageLimitLabel(row({ kind: "weekly_all", group: "weekly" }))).toBe("Current week (all models)")
    expect(usageLimitLabel(row({ kind: "weekly_scoped", group: "weekly", scope: { model: { display_name: "Fable" }, surface: null } })))
      .toBe("Current week (Fable)")
  })

  it("falls back to the server's group for a meter it does not know", () => {
    expect(usageLimitLabel(row({ kind: "monthly_all", group: "monthly_spend" }))).toBe("Monthly spend")
  })
})

describe("usageTextSections", () => {
  it("drops the meter lines the card draws from data and reads the scan into windows", () => {
    const { lead, details } = usageTextSections(USAGE_TEXT)

    expect(lead).toEqual([
      { kind: "note", lines: ["You are currently using your subscription to power your Claude Code usage"] },
    ])
    expect(details).toEqual([
      {
        kind: "note",
        lines: ["What's contributing to your limits usage?", "Approximate · sessions on this machine only · shares overlap"],
      },
      {
        kind: "window",
        heading: "Last 24h · 2114 requests · 19 sessions",
        recommendations: [
          { pct: 67, title: "Start fresh when you switch tasks", detail: "run /clear" },
          { pct: 51, title: "Give \"general-purpose\" subagents a cheaper model" },
        ],
        notes: ["Top skills: /cogpit-browser 5%, /cogpit-memory 4%"],
      },
    ])
  })

  it("keeps unrecognised text when there are no meter lines to anchor on", () => {
    expect(usageTextSections("Plan usage is unavailable")).toEqual({
      lead: [],
      details: [{ kind: "note", lines: ["Plan usage is unavailable"] }],
    })
  })
})

describe("readable payload guards", () => {
  it("rejects a context payload without categories or a window", () => {
    expect(readableContextUsage(undefined)).toBeNull()
    expect(readableContextUsage({ model: "m", total_tokens: 1, raw_max_tokens: 0, percentage: 0, categories: [] })).toBeNull()
  })

  it("treats a usage report with no meters as absent", () => {
    const session = { total_cost_usd: 0, total_api_duration_ms: 0, total_duration_ms: 0, total_lines_added: 0, total_lines_removed: 0 }
    expect(readableUsageLimits({ session, rate_limits: null })).toBeNull()
    expect(readableUsageLimits({ session, rate_limits: { limits: [] } })).toBeNull()
    expect(readableUsageLimits({ session, rate_limits: { limits: [row({})] } })).toHaveLength(1)
  })
})

describe("formatMinorUnits", () => {
  it("reads extra-usage amounts as minor units", () => {
    expect(formatMinorUnits(1250, "USD")).toContain("12.50")
  })
})
