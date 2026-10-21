import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getHighlighter: vi.fn(), codeToTokens: vi.fn() }))
vi.mock("@/lib/shiki", () => ({
  getLangFromPath: () => "typescript",
  ensureLang: async () => {},
  getHighlighter: mocks.getHighlighter,
}))
vi.mock("@/hooks/useIsDarkMode", () => ({ useIsDarkMode: () => true }))

import { EditDiffView } from "../EditDiffView"

describe("EditDiffView highlighting", () => {
  beforeEach(() => {
    mocks.codeToTokens.mockImplementation((text: string) => ({ tokens: text.split("\n").map(content => [{ content: `highlighted:${content}`, color: "#123456" }]) }))
    mocks.getHighlighter.mockResolvedValue({ codeToTokens: mocks.codeToTokens })
  })
  afterEach(() => vi.clearAllMocks())

  it("keeps oversized diffs readable without loading the highlighter", async () => {
    render(<EditDiffView oldString="before" newString={"x".repeat(10_001)} filePath="large.ts" />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    expect(mocks.getHighlighter).not.toHaveBeenCalled()
    expect(screen.getByText("before")).toBeVisible()
    expect(screen.getByText("x".repeat(10_001))).toBeVisible()
  })

  it("drops stale tokens on file changes and highlights small edits again", async () => {
    const view = render(<EditDiffView oldString="before" newString="after" filePath="small.ts" />)
    await screen.findByText("highlighted:after")
    view.rerender(<EditDiffView oldString="different" newString={"x".repeat(10_001)} filePath="large.ts" />)
    expect(screen.queryByText("highlighted:after")).not.toBeInTheDocument()
    expect(screen.getByText("different")).toBeVisible()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    expect(mocks.codeToTokens).toHaveBeenCalledTimes(2)
    view.rerender(<EditDiffView oldString="again" newString="small" filePath="another.ts" />)
    await waitFor(() => expect(screen.getByText("highlighted:small")).toBeVisible())
    expect(mocks.codeToTokens).toHaveBeenCalledTimes(4)
  })
})
