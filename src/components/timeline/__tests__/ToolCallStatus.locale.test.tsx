import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { setLanguage } from "@/lib/i18n/language"
import { makeToolCall } from "@/__tests__/fixtures"
import { ToolCallStatus } from "../ToolCallStatus"

afterEach(() => { cleanup(); setLanguage("en") })

it("translates the running label, tooltip and accessible status", () => {
  setLanguage("zh-TW")
  render(<ToolCallStatus toolCall={makeToolCall({ result: null })} isAgentActive />)
  expect(screen.getByText("執行中")).toBeVisible()
  expect(screen.getByTitle("執行中")).toBeVisible()
  expect(screen.getByRole("img", { name: "工具呼叫執行中" })).toBeInTheDocument()
})
