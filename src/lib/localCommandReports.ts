import type {
  LocalCommandContextUsage,
  LocalCommandUsageReport,
  UsageLimitRow,
} from "../../shared/session/types"

/**
 * The structured `/context` and `/usage` payloads come from the transcript, so
 * a record from a CLI that shaped them differently must fall back to the text
 * card rather than render a broken one.
 */
export function readableContextUsage(raw: LocalCommandContextUsage | undefined): LocalCommandContextUsage | null {
  if (!raw || !Array.isArray(raw.categories)) return null
  if (!Number.isFinite(raw.total_tokens) || !(raw.raw_max_tokens > 0)) return null
  return raw
}

export function readableUsageLimits(report: LocalCommandUsageReport | undefined): UsageLimitRow[] | null {
  const rows = report?.rate_limits?.limits
  if (!Array.isArray(rows)) return null
  const readable = rows.filter((row) => row && Number.isFinite(row.percent))
  return readable.length > 0 ? readable : null
}

const GROUP_LABELS: Record<string, string> = { session: "Current session", weekly: "Current week" }
const UNSCOPED_SUFFIX: Record<string, string> = { weekly_all: "all models" }

/** The rows carry no label of their own, so name them the way the CLI does. */
export function usageLimitLabel(row: UsageLimitRow): string {
  const base = GROUP_LABELS[row.group] ?? capitalize(row.group.replace(/_/g, " "))
  const scope = row.scope?.model?.display_name ?? row.scope?.surface?.display_name ?? UNSCOPED_SUFFIX[row.kind]
  return scope ? `${base} (${scope})` : base
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export type UsageSeverity = "normal" | "warning" | "critical"

/** The server grades every row; an unknown grade reads as normal. */
export function usageSeverity(severity: string): UsageSeverity {
  return severity === "warning" || severity === "critical" ? severity : "normal"
}

export function formatResetTime(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/** Extra-usage amounts arrive in minor units of the currency. */
export function formatMinorUnits(amount: number, currency: string | null | undefined): string {
  const code = currency || "USD"
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(amount / 100)
  } catch {
    return `${(amount / 100).toFixed(2)} ${code}`
  }
}

export interface UsageRecommendation {
  pct: number
  title: string
  detail?: string
}

export type UsageTextSection =
  | { kind: "note"; lines: string[] }
  | { kind: "window"; heading: string; recommendations: UsageRecommendation[]; notes: string[] }

const LIMIT_LINE_RE = /\b\d+(?:\.\d+)?% used\b/
const RECOMMENDATION_RE = /^(\d+(?:\.\d+)?)%\s+(.+)$/

/**
 * What the `/usage` text says beyond the meters. The structured twin carries
 * only the meters, so the scan of what is driving usage (recommendations, top
 * skills and subagents) is read from the text: a window is an unindented
 * heading over indented rows. Paragraphs of meter lines are dropped, since the
 * card draws those from data, and split what precedes them (`lead`) from what
 * follows; anything else stays as plain text.
 */
export function usageTextSections(text: string): { lead: UsageTextSection[]; details: UsageTextSection[] } {
  const lead: UsageTextSection[] = []
  const details: UsageTextSection[] = []
  let sections = lead
  for (const paragraph of text.split(/\n\s*\n/)) {
    const lines = paragraph.split("\n").filter((line) => line.trim())
    if (lines.length === 0) continue
    if (lines.every((line) => LIMIT_LINE_RE.test(line))) {
      sections = details
      continue
    }
    const [heading, ...rows] = lines
    if (rows.length > 0 && !/^\s/.test(heading) && rows.every((line) => /^\s/.test(line))) {
      const recommendations: UsageRecommendation[] = []
      const notes: string[] = []
      for (const row of rows) {
        const trimmed = row.trim()
        const match = RECOMMENDATION_RE.exec(trimmed)
        if (!match) {
          notes.push(trimmed)
          continue
        }
        const [title, ...detailParts] = match[2].split(" · ")
        recommendations.push({
          pct: Number(match[1]),
          title,
          ...(detailParts.length > 0 ? { detail: detailParts.join(" · ") } : {}),
        })
      }
      sections.push({ kind: "window", heading: heading.trim(), recommendations, notes })
      continue
    }
    sections.push({ kind: "note", lines: lines.map((line) => line.trim()) })
  }
  // Without a meter paragraph to anchor on, nothing reads as a preamble.
  return sections === lead ? { lead: [], details: lead } : { lead, details }
}
