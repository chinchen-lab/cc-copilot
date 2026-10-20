import { useRef, useState } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { LanguageSettings } from "../LanguageSettings"
import { FontScaleSettings } from "../FontScaleSettings"
import { ExpandablePromptEditor } from "../ExpandablePromptEditor"
import { LANGUAGE_KEY, setLanguage } from "@/lib/i18n/language"

afterEach(() => {
  act(() => setLanguage("en"))
  localStorage.removeItem(LANGUAGE_KEY)
})

function Composer() {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  return <>
    <textarea ref={inputRef} aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />
    <ExpandablePromptEditor value={value} onChange={setValue} inputRef={inputRef} />
  </>
}

describe("LanguageSettings", () => {
  it("switches every mounted preference control immediately and saves the choice", () => {
    render(<><LanguageSettings /><LanguageSettings /><FontScaleSettings /></>)
    fireEvent.change(screen.getAllByRole("combobox", { name: "Language" })[0], { target: { value: "zh-TW" } })
    for (const select of screen.getAllByRole("combobox", { name: "語言" })) expect(select).toHaveValue("zh-TW")
    expect(screen.getByRole("slider", { name: "文字大小" })).toBeInTheDocument()
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe("zh-TW")
    expect(document.documentElement.lang).toBe("zh-TW")
    fireEvent.change(screen.getAllByRole("combobox", { name: "語言" })[1], { target: { value: "en" } })
    expect(screen.getByRole("slider", { name: "Text size" })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe("en")
  })

  it("updates an open prompt editor without remounting it or translating the user's draft", async () => {
    render(<><LanguageSettings /><Composer /></>)
    const draft = screen.getByRole("textbox", { name: "Draft" })
    const value = "Settings\n請修改 /work/Language，不要翻譯這段文字"
    fireEvent.change(draft, { target: { value } })
    fireEvent.click(screen.getByRole("button", { name: "Expand prompt editor" }))
    const editor = await screen.findByRole("textbox", { name: "Expanded prompt" })
    act(() => setLanguage("zh-TW"))
    expect(screen.getByRole("textbox", { name: "展開的提示編輯器" })).toBe(editor)
    expect(editor).toHaveValue(value)
    expect(screen.getByRole("button", { name: "完成" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "完成" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft)
    expect(draft).toHaveValue(value)
  })
})
