import { afterEach, describe, expect, it, vi } from "vitest"
import { applyFontScale, FONT_SCALE_KEY, getFontScale, readSavedFontScale, setFontScale } from "../fontScale"

afterEach(() => { vi.restoreAllMocks(); setFontScale(100); localStorage.removeItem(FONT_SCALE_KEY) })

describe("font scale preference", () => {
  it("restores a valid preference and rejects corrupt or unsafe sizes", () => {
    localStorage.setItem(FONT_SCALE_KEY, "125")
    expect(readSavedFontScale()).toBe(125)
    for (const value of ["", "garbage", "NaN", "Infinity", "0", "74", "151"]) {
      localStorage.setItem(FONT_SCALE_KEY, value)
      expect(readSavedFontScale()).toBe(100)
    }
  })

  it("applies a relative root size, persists it, and resets to the browser default", () => {
    setFontScale(125)
    expect(document.documentElement.style.fontSize).toBe("125%")
    expect(localStorage.getItem(FONT_SCALE_KEY)).toBe("125")
    expect(getFontScale()).toBe(125)
    setFontScale(100)
    expect(document.documentElement.style.fontSize).toBe("")
    expect(readSavedFontScale()).toBe(100)
  })

  it("bounds changes and works when storage is blocked", () => {
    setFontScale(999)
    expect(getFontScale()).toBe(150)
    setFontScale(-1)
    expect(getFontScale()).toBe(75)
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
    expect(() => setFontScale(120)).not.toThrow()
    expect(getFontScale()).toBe(120)
    expect(document.documentElement.style.fontSize).toBe("120%")
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    expect(readSavedFontScale()).toBe(100)
    applyFontScale(100)
  })
})
