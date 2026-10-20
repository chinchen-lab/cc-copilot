import { useRef, useState } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { ExpandablePromptEditor } from "../ExpandablePromptEditor"

function Composer({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  return <div>
    <textarea ref={inputRef} aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />
    <ExpandablePromptEditor value={value} onChange={setValue} inputRef={inputRef} />
  </div>
}

describe("ExpandablePromptEditor", () => {
  it("offers expansion only after a newline and preserves the edited draft and caret on Done", async () => {
    render(<Composer />)
    const draft = screen.getByRole("textbox", { name: "Draft" }) as HTMLTextAreaElement
    fireEvent.change(draft, { target: { value: "first" } })
    expect(screen.queryByRole("button", { name: "Expand prompt editor" })).not.toBeInTheDocument()
    fireEvent.change(draft, { target: { value: "first\nsecond" } })
    draft.setSelectionRange(6, 12)
    fireEvent.click(screen.getByRole("button", { name: "Expand prompt editor" }))
    const editor = await screen.findByRole("textbox", { name: "Expanded prompt" }) as HTMLTextAreaElement
    await waitFor(() => expect(editor).toHaveFocus())
    expect(editor.selectionStart).toBe(6)
    expect(editor.selectionEnd).toBe(12)
    fireEvent.change(editor, { target: { value: "first\nrevised" } })
    editor.setSelectionRange(8, 8)
    fireEvent.select(editor)
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(draft).toHaveFocus())
    expect(draft).toHaveValue("first\nrevised")
    expect(draft.selectionStart).toBe(8)
  })

  it("keeps edits when dismissed with Escape", async () => {
    const user = userEvent.setup()
    render(<Composer initial={"first\nsecond"} />)
    await user.click(screen.getByRole("button", { name: "Expand prompt editor" }))
    const editor = await screen.findByRole("textbox", { name: "Expanded prompt" })
    fireEvent.change(editor, { target: { value: "first\nchanged" } })
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("first\nchanged")
  })

  it("stays editable after removing every newline, then hides the expansion button", async () => {
    render(<Composer initial={"first\nsecond"} />)
    fireEvent.click(screen.getByRole("button", { name: "Expand prompt editor" }))
    const editor = await screen.findByRole("textbox", { name: "Expanded prompt" })
    fireEvent.change(editor, { target: { value: "one line" } })
    expect(screen.getByRole("dialog", { name: "Edit prompt" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.queryByRole("button", { name: "Expand prompt editor" })).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("one line")
  })
})
