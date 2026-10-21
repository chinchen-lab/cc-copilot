import { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { ParsedSession } from "../../../shared/session/types"
import { makeTurn } from "@/__tests__/fixtures"
import { usePromptHistory } from "../usePromptHistory"

type HistorySession = Pick<ParsedSession, "sessionId" | "turns">
const session: HistorySession = {
  sessionId: "first",
  turns: [makeTurn({ userMessage: "older" }), makeTurn({ userMessage: "newer" })],
}

function Composer({ source = session, pending = [] }: { source?: HistorySession | null; pending?: string[] }) {
  const [text, setText] = useState("")
  const { handleHistoryKeyDown, resetHistory } = usePromptHistory(source, pending, setText)
  return <textarea aria-label="Prompt" value={text} onKeyDown={handleHistoryKeyDown} onChange={(event) => { resetHistory(); setText(event.target.value) }} />
}

function input() { return screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement }
function arrow(key: "ArrowUp" | "ArrowDown") { fireEvent.keyDown(input(), { key }) }

describe("prompt history", () => {
  it("browses without wrapping and returns to the unsent draft", () => {
    render(<Composer />)
    fireEvent.change(input(), { target: { value: "unfinished 中文" } })
    arrow("ArrowUp")
    expect(input()).toHaveValue("newer")
    arrow("ArrowUp")
    arrow("ArrowUp")
    expect(input()).toHaveValue("older")
    arrow("ArrowDown")
    expect(input()).toHaveValue("newer")
    arrow("ArrowDown")
    arrow("ArrowDown")
    expect(input()).toHaveValue("unfinished 中文")
  })

  it("recalls text and queued prompts, strips injected context and preserves command arguments", () => {
    const source: HistorySession = {
      sessionId: "blocks",
      turns: [
        makeTurn({ userMessage: [{ type: "text", text: "中文\n第二行" }], contentBlocks: [{ kind: "text", text: ["assistant reply"] }, { kind: "queued_prompt", content: "queued" }] }),
        makeTurn({ userMessage: "<system-reminder>context</system-reminder>visible" }),
        makeTurn({ userMessage: "<command-name>/review</command-name><command-args>fix.ts</command-args>" }),
        makeTurn({ userMessage: "<system-reminder>context only</system-reminder>" }),
        makeTurn({ userMessage: [{ type: "tool_result", tool_use_id: "tool", content: "tool output" }] }),
      ],
    }
    render(<Composer source={source} pending={["/review fix.ts", "fresh"]} />)
    for (const expected of ["fresh", "/review fix.ts", "visible", "queued", "中文\n第二行"]) {
      arrow("ArrowUp")
      expect(input()).toHaveValue(expected)
    }
  })

  it("keeps multiline movement, selection and modified arrows native", () => {
    render(<Composer />)
    fireEvent.change(input(), { target: { value: "first\nlast" } })
    input().setSelectionRange(8, 8)
    arrow("ArrowUp")
    expect(input()).toHaveValue("first\nlast")
    input().setSelectionRange(0, 1)
    arrow("ArrowUp")
    expect(input()).toHaveValue("first\nlast")
    input().setSelectionRange(0, 0)
    for (const modifier of ["shiftKey", "ctrlKey", "metaKey", "altKey"]) fireEvent.keyDown(input(), { key: "ArrowUp", [modifier]: true })
    expect(input()).toHaveValue("first\nlast")
    arrow("ArrowUp")
    expect(input()).toHaveValue("newer")
    arrow("ArrowDown")
    expect(input()).toHaveValue("first\nlast")
  })

  it("does not jump when incoming messages arrive and scopes navigation to the current session", () => {
    const view = render(<Composer />)
    arrow("ArrowUp")
    expect(input()).toHaveValue("newer")
    view.rerender(<Composer pending={["incoming"]} />)
    arrow("ArrowUp")
    expect(input()).toHaveValue("older")
    view.rerender(<Composer source={{ sessionId: "second", turns: [makeTurn({ userMessage: "other session" })] }} />)
    arrow("ArrowUp")
    expect(input()).toHaveValue("other session")
  })

  it("treats an edited recall as the new draft and leaves empty history alone", () => {
    const view = render(<Composer />)
    arrow("ArrowUp")
    fireEvent.change(input(), { target: { value: "edited recall" } })
    arrow("ArrowUp")
    arrow("ArrowDown")
    expect(input()).toHaveValue("edited recall")
    view.rerender(<Composer source={null} />)
    arrow("ArrowUp")
    expect(input()).toHaveValue("edited recall")
  })
})
