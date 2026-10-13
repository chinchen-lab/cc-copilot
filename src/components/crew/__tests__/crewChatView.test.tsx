import { cleanup, render } from "@testing-library/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { afterEach, describe, expect, it } from "vitest"
import type { CrewChatMessage } from "../../../../shared/contracts/crewChat"
import { crewChatHandleMap, crewChatRuns, displayUrl, gitHubReference, remarkCrewChat, stripLeadingMentions } from "../crewChatView"

const handles = crewChatHandleMap([{ sessionId: "root", handle: "lead" }, { sessionId: "s-parser", handle: "parser" }])
const html = (text: string) => render(<ReactMarkdown remarkPlugins={[remarkGfm, [remarkCrewChat, { handles }]]}>{text}</ReactMarkdown>).container
afterEach(cleanup)

describe("remarkCrewChat", () => {
  it("keeps an agent's single line breaks as paragraphs", () => {
    expect([...html("First thought\nSecond thought").querySelectorAll("p")].map((p) => p.textContent)).toEqual(["First thought", "Second thought"])
  })

  it("turns an inline (a) … (b) … run into a lettered list after its intro", () => {
    const container = html("round 3: (a) #308 MERGED. (b) PR #310 opened. Read it under (c).")
    expect(container.querySelector("p")).toHaveTextContent("round 3:")
    const list = container.querySelector("ol")!
    expect(list).toHaveAttribute("type", "a")
    expect([...list.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["#308 MERGED.", "PR #310 opened. Read it under (c)."])
  })

  it("joins lines that open with (1), (2) into one numbered list", () => {
    const container = html("Authorized.\n(1) Watchdog check-ins.\n(2) ai-usage check.\nGates: verify.")
    expect([...container.querySelectorAll("ol > li")].map((li) => li.textContent)).toEqual(["Watchdog check-ins.", "ai-usage check."])
    expect(container.querySelector("ol")).not.toHaveAttribute("type")
    expect([...container.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Authorized.", "Gates: verify."])
  })

  it("breaks lines inside list items without loosening the list", () => {
    const container = html("- Summary\n  PASS: checks\n  BLOCKED: deployment\n- [ ] Task\n  next line\n\n1. One\n   more")
    const items = [...container.querySelectorAll("li")]
    expect(items.map((item) => item.querySelectorAll("br").length)).toEqual([2, 1, 1])
    expect(items[0]).toHaveTextContent("Summary PASS: checks BLOCKED: deployment")
    expect(container.querySelector("li > p")).toBeNull()
  })

  it("leaves a lone or out-of-order marker in the text", () => {
    expect(html("plc-cleanup (b): repo vars deleted (c) next").querySelector("ol")).toBeNull()
  })

  it("marks mentions, status words, hashes and paths but not inside links or code", () => {
    const container = html("@parser PASS on fbd95d2e7, see ~/reports/speed.md. ready `@lead FAIL` https://example.com/@lead and @ghost")
    const tokens = [...container.querySelectorAll("[data-crew-token]")].map((node) => [node.getAttribute("data-crew-token"), node.textContent, node.getAttribute("data-session-id") ?? node.getAttribute("data-tone")])
    expect(tokens).toEqual([["mention", "@parser", "s-parser"], ["status", "PASS", "success"], ["sha", "fbd95d2e7", null], ["mention", "@ghost", null]])
    expect([...container.querySelectorAll("code")].map((code) => code.textContent)).toEqual(["~/reports/speed.md", "@lead FAIL"])
  })

  it("treats a whole session id as one hash and relative paths only with an extension", () => {
    const container = html("Codex 01a134d3-e1a7-7bc1-9f72-a902aa75d57a edited scripts/carry-static-assets.ts with PERF_HOME=/tmp/perf, options A/B/C")
    expect([...container.querySelectorAll("[data-crew-token=sha]")].map((node) => node.textContent)).toEqual(["01a134d3-e1a7-7bc1-9f72-a902aa75d57a"])
    expect([...container.querySelectorAll("code")].map((code) => code.textContent)).toEqual(["scripts/carry-static-assets.ts", "/tmp/perf"])
  })
})

describe("stripLeadingMentions", () => {
  it("drops the mentions a message opens with when the header names them", () => {
    expect(stripLeadingMentions("@lead @parser Those are mine", ["root", "s-parser"], handles)).toBe("Those are mine")
  })

  it("keeps the indentation of the lines after them", () => {
    expect(stripLeadingMentions("@lead\n\n    **literal**", ["root"], handles)).toBe("\n    **literal**")
    expect(html(stripLeadingMentions("@lead\n\n    **literal**", ["root"], handles)).querySelector("pre code")).toHaveTextContent("**literal**")
  })

  it("keeps them when one is unknown or untagged, or nothing follows", () => {
    expect(stripLeadingMentions("@lead @ghost hi", ["root"], handles)).toBe("@lead @ghost hi")
    expect(stripLeadingMentions("@parser hi", ["root"], handles)).toBe("@parser hi")
    expect(stripLeadingMentions("@lead", ["root"], handles)).toBe("@lead")
  })
})

describe("crewChatRuns", () => {
  const at = new Date(2026, 9, 13, 10, 0).getTime()
  const message = (sequence: number, sessionId: string | undefined, minutes: number, mentions: string[] = []): CrewChatMessage => ({
    sequence, id: String(sequence), rootId: "root", mentions, createdAt: at + minutes * 60_000, text: "x",
    author: sessionId ? { kind: "agent", sessionId, name: sessionId } : { kind: "user", name: "You" },
  })

  it("groups one author's close messages to the same people and starts each day with a divider", () => {
    const runs = crewChatRuns([
      message(1, "s-parser", 0, ["root"]),
      message(2, "s-parser", 2, ["root"]),
      message(3, "s-parser", 3),
      message(4, "root", 4),
      message(5, undefined, 20),
      message(6, undefined, 24 * 60),
    ], "root")
    expect(runs.map((run) => [run.role, run.messages.map((value) => value.sequence), run.day !== undefined])).toEqual([
      ["agent", [1, 2], true],
      ["agent", [3], false],
      ["lead", [4], false],
      ["user", [5], false],
      ["user", [6], true],
    ])
  })
})

describe("links", () => {
  it("names GitHub pull requests, issues and commits by repository", () => {
    expect(gitHubReference("https://github.com/HonestCMS/cms/pull/311")).toEqual({ kind: "pull", label: "cms#311" })
    expect(gitHubReference("https://github.com/HonestCMS/cms/issues/7#issuecomment-1")).toEqual({ kind: "issue", label: "cms#7" })
    expect(gitHubReference("https://github.com/HonestCMS/cms/commit/5a584affd0c1")).toEqual({ kind: "commit", label: "cms@5a584af" })
    expect(gitHubReference("https://github.com/HonestCMS/cms")).toBeNull()
    expect(displayUrl("https://www.example.com/a/")).toBe("example.com/a")
  })
})
