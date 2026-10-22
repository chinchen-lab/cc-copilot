import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { EditDiffView } from "../EditDiffView"

vi.mock("@/lib/shiki", () => ({ getLangFromPath: () => null }))

describe("split diff", () => {
  it("aligns replacements and insertions with independent real line numbers", () => {
    render(<EditDiffView oldString={"same\nold\ntail"} newString={"same\nnew\nextra\ntail"} filePath="a.ts" compact={false} startLine={30} />)
    fireEvent.click(screen.getByRole("button", { name: "Side by side" }))
    const before = screen.getByLabelText("Before"), after = screen.getByLabelText("After")
    expect(within(before).getByText("old")).toBeVisible()
    expect(within(before).queryByText("new")).not.toBeInTheDocument()
    expect(within(after).getByText("new")).toBeVisible()
    expect(within(after).getByText("extra")).toBeVisible()
    expect(within(before).getByText("32")).toBeVisible()
    expect(within(after).getByText("33")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Unified" }))
    expect(screen.queryByLabelText("Before")).not.toBeInTheDocument()
    expect(screen.getByText("old")).toBeVisible()
  })

  it("expands unchanged context on both sides together", () => {
    const prefix = Array.from({ length: 15 }, (_, i) => `line ${i}`).join("\n")
    render(<EditDiffView oldString={`${prefix}\nold`} newString={`${prefix}\nnew`} filePath="a" defaultLayout="split" />)
    expect(screen.queryByText("line 0")).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: /unchanged lines/ })[0])
    expect(screen.getAllByText("line 0")).toHaveLength(2)
  })

  it.each([{ oldString: "", newString: "created" }, { oldString: "deleted", newString: "" }])("supports a single empty side", props => {
    render(<EditDiffView {...props} filePath="a" defaultLayout="split" compact={false} />)
    expect(screen.getByText(props.oldString || props.newString)).toBeVisible()
  })
})
