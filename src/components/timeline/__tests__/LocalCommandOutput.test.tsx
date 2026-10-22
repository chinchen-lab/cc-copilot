import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { LocalCommandBlock } from "../LocalCommandOutput"
import type { LocalCommandContextUsage, LocalCommandUsageReport } from "../../../../shared/session/types"

const CONTEXT_TEXT = "<local-command-stdout>## Context Usage\n\n| Category | Tokens |</local-command-stdout>"

const contextUsage: LocalCommandContextUsage = {
  model: "claude-opus-5-5[1m]",
  total_tokens: 17_955,
  raw_max_tokens: 1_000_000,
  percentage: 2,
  categories: [
    { name: "System prompt", tokens: 142, kind: "used" },
    { name: "System tools (deferred)", tokens: 14_176, kind: "deferred" },
    { name: "Messages", tokens: 1_725, kind: "used" },
    { name: "MCP tools", tokens: 0, kind: "used" },
    { name: "Compact buffer", tokens: 3_000, kind: "buffer" },
    { name: "Free space", tokens: 979_045, kind: "free" },
  ],
  mcp_tools: [],
  memory_files: [{ path: "/Users/me/.claude/CLAUDE.md", type: "User", tokens: 5_141 }],
  agents: [],
}

const USAGE_TEXT = "<local-command-stdout>Current session: 6% used · resets Oct 22\n\nLast 24h · 2114 requests · 19 sessions\n  67%  Start fresh when you switch tasks · run /clear</local-command-stdout>"

const usageReport: LocalCommandUsageReport = {
  session: { total_cost_usd: 0.42, total_api_duration_ms: 0, total_duration_ms: 1972, total_lines_added: 0, total_lines_removed: 0 },
  rate_limits: {
    limits: [
      { kind: "session", group: "session", percent: 6, resets_at: "2026-10-22T01:20:00Z", scope: null, severity: "normal", is_active: false },
      { kind: "weekly_scoped", group: "weekly", percent: 93, resets_at: null, scope: { model: { display_name: "Fable" }, surface: null }, severity: "critical", is_active: true },
    ],
    extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1250, utilization: 25, currency: "USD" },
  },
}

describe("LocalCommandBlock", () => {
  it("shows what the command printed, without the transcript tags or terminal styling", () => {
    render(
      <LocalCommandBlock content={"<local-command-stdout>\u001b[1mCurrent session:\u001b[0m 41% used\nCurrent week: 12% used</local-command-stdout>"} />,
    )

    expect(screen.getByText(/Current session: 41% used\s+Current week: 12% used/)).toBeInTheDocument()
  })

  it("renders nothing for a record with no output", () => {
    const { container } = render(<LocalCommandBlock content="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("draws a recorded /context breakdown as a card instead of the markdown table", () => {
    render(<LocalCommandBlock content={CONTEXT_TEXT} contextUsage={contextUsage} />)

    const card = screen.getByRole("region", { name: "Context" })
    expect(within(card).getByText("98% left")).toBeInTheDocument()
    expect(within(card).getByText("18.0k / 1.0M")).toBeInTheDocument()
    expect(within(card).getByText("Messages")).toBeInTheDocument()
    expect(within(card).getByText("0.2%")).toBeInTheDocument()
    expect(within(card).getByText(/outside the window/)).toBeInTheDocument()
    expect(within(card).queryByText("MCP tools")).not.toBeInTheDocument()
    expect(within(card).queryByText(/Context Usage/)).not.toBeInTheDocument()

    fireEvent.click(within(card).getByRole("button", { name: /Breakdown/ }))
    expect(within(card).getByText("/Users/me/.claude/CLAUDE.md")).toBeInTheDocument()
  })

  it("draws a recorded /usage report as meters, keeping the scan's recommendations", () => {
    render(<LocalCommandBlock content={USAGE_TEXT} usageReport={usageReport} />)

    const card = screen.getByRole("region", { name: "Plan usage" })
    expect(within(card).getByRole("progressbar", { name: "Current session" })).toHaveAttribute("aria-valuenow", "6")
    expect(within(card).getByText("93%")).toHaveClass("text-destructive")
    expect(within(card).getByText("Current week (Fable)")).toBeInTheDocument()
    expect(within(card).getByText(/Extra usage: \$12\.50 \/ \$50\.00/)).toBeInTheDocument()
    expect(within(card).getByText(/This session: \$0\.420/)).toBeInTheDocument()
    expect(within(card).getByText("Start fresh when you switch tasks")).toBeInTheDocument()
    expect(within(card).getByText("/clear").tagName).toBe("CODE")
    expect(within(card).queryByText(/Current session: 6% used/)).not.toBeInTheDocument()
  })

  it("keeps the text card for a /usage reply without plan meters", () => {
    render(
      <LocalCommandBlock
        content="<local-command-stdout>Usage is only available for subscription plans</local-command-stdout>"
        usageReport={{ ...usageReport, rate_limits: null }}
      />,
    )

    expect(screen.queryByRole("region", { name: "Plan usage" })).not.toBeInTheDocument()
    expect(screen.getByText("Usage is only available for subscription plans")).toBeInTheDocument()
  })
})
