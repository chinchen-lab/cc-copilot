import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { FontScaleSettings } from "../FontScaleSettings"
import { FONT_SCALE_KEY, setFontScale } from "@/lib/fontScale"

afterEach(() => { act(() => setFontScale(100)); localStorage.removeItem(FONT_SCALE_KEY) })

describe("FontScaleSettings", () => {
  it("adjusts size immediately, saves the preference and resets", () => {
    render(<FontScaleSettings />)
    const slider = screen.getByRole("slider", { name: "Text size" })
    fireEvent.change(slider, { target: { value: "125" } })
    expect(slider).toHaveAttribute("aria-valuetext", "125%")
    expect(document.documentElement.style.fontSize).toBe("125%")
    expect(localStorage.getItem(FONT_SCALE_KEY)).toBe("125")
    fireEvent.click(screen.getByRole("button", { name: "Decrease text size" }))
    expect(slider).toHaveValue("120")
    fireEvent.click(screen.getByRole("button", { name: "Reset text size to 100%" }))
    expect(slider).toHaveValue("100")
    expect(document.documentElement.style.fontSize).toBe("")
  })

  it("keeps simultaneous preference controls in sync and enforces bounds", () => {
    render(<><FontScaleSettings /><FontScaleSettings /></>)
    act(() => setFontScale(150))
    for (const button of screen.getAllByRole("button", { name: "Increase text size" })) expect(button).toBeDisabled()
    for (const slider of screen.getAllByRole("slider")) expect(slider).toHaveValue("150")
    act(() => setFontScale(75))
    for (const button of screen.getAllByRole("button", { name: "Decrease text size" })) expect(button).toBeDisabled()
  })
})
