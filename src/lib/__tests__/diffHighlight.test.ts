import { describe, expect, it } from "vitest"
import { canHighlightDiff } from "../diffHighlight"

describe("diff highlighting budget", () => {
  it("keeps ordinary edits highlighted", () => {
    expect(canHighlightDiff("const enabled = false\n", "const enabled = true\n")).toBe(true)
    expect(canHighlightDiff("", "")).toBe(true)
  })

  it("bounds combined input even when each side fits individually", () => {
    const file = ("x".repeat(1000) + "\n").repeat(110)
    expect(canHighlightDiff(file, "")).toBe(true)
    expect(canHighlightDiff(file, file)).toBe(false)
  })

  it("skips many short lines and long minified lines", () => {
    expect(canHighlightDiff("\n".repeat(9999), "\n".repeat(9999))).toBe(true)
    expect(canHighlightDiff("\n".repeat(10_000), "\n".repeat(9999))).toBe(false)
    expect(canHighlightDiff("x".repeat(10_001), "")).toBe(false)
  })
})
