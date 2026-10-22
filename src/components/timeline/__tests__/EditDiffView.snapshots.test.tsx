import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authFetch: mocks.fetch }))
vi.mock("@/lib/shiki", () => ({ getLangFromPath: () => null }))
vi.mock("@/contexts/SessionContext", () => ({ useSessionContextOptional: () => ({ session: { sessionId: "historical", turns: [] } }) }))
import { EditDiffView } from "../EditDiffView"
afterEach(() => vi.resetAllMocks())

describe("expanded historical diffs", () => {
  it("loads complete snapshots on demand even without live git changes", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ before: "header\nold\nfooter", after: "header\nnew\nfooter" }) })
    render(<EditDiffView oldString="old" newString="new" filePath="/repo/a" />)
    expect(mocks.fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Expand diff" }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Full file snapshots · all session edits")
    expect(within(dialog).getAllByText("header")).toHaveLength(2)
    expect(within(dialog).getAllByText("footer")).toHaveLength(2)
    expect(within(dialog).getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(within(dialog).getByRole("button", { name: "Unified" }))
    expect(within(dialog).getAllByText("header")).toHaveLength(1)
  })
  it("keeps recorded edits readable when the snapshot API fails", async () => {
    mocks.fetch.mockResolvedValue({ ok: false })
    render(<EditDiffView oldString="old" newString="new" filePath="/repo/a" />)
    fireEvent.click(screen.getByRole("button", { name: "Expand diff" }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Recorded edits · full file snapshots unavailable")
    expect(within(dialog).getByText("old")).toBeVisible()
    expect(within(dialog).getByText("new")).toBeVisible()
  })
})
