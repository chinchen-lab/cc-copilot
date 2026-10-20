import { act, renderHook, cleanup } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTheme } from "../useTheme"
import { applyTheme, readSavedTheme } from "../../lib/themes"

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = "electron"
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    document.documentElement.removeAttribute("style")
    document.querySelector('meta[name="theme-color"]')?.remove()
    localStorage.clear()
    document.documentElement.className = ""
  })

  it("defaults to light in the browser at startup and after mounting", () => {
    expect(readSavedTheme()).toBe("light")
    applyTheme(readSavedTheme())
    expect(document.documentElement.style.colorScheme).toBe("light")
    const { result } = renderHook(useTheme)
    expect(result.current.theme).toBe("light")
    expect(document.documentElement).not.toHaveClass("dark")
  })

  it("keeps the desktop app's dark default", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Electron/41.0.0")
    const { result } = renderHook(useTheme)
    expect(result.current.theme).toBe("dark")
    expect(document.documentElement).toHaveClass("dark")
  })

  it("falls back to light for an unknown saved theme", () => {
    localStorage.setItem("cogpit-theme", "unknown")
    expect(readSavedTheme()).toBe("light")
  })

  it.each(["dark", "oled", "layered", "light", "layered-light"] as const)("preserves the saved %s theme", (id) => {
    localStorage.setItem("cogpit-theme", id)
    const { result } = renderHook(useTheme)
    expect(result.current.theme).toBe(id)
  })

  it("restores the light/dark selection after remounting", () => {
    const first = renderHook(useTheme)
    act(() => first.result.current.setTheme("dark"))
    first.unmount()
    const second = renderHook(useTheme)
    expect(second.result.current.theme).toBe("dark")
    act(() => second.result.current.setTheme("light"))
    second.unmount()
    const third = renderHook(useTheme)
    expect(third.result.current.theme).toBe("light")
    expect(document.documentElement).not.toHaveClass("dark")
  })

  it("uses the same saved theme for startup, browser chrome, and mounted controls", () => {
    document.head.insertAdjacentHTML("beforeend", '<meta name="theme-color" content="#111">')
    localStorage.setItem("cogpit-theme", "layered-light")
    applyTheme(readSavedTheme())
    expect(document.documentElement).toHaveClass("theme-layered")
    expect(document.documentElement.style.colorScheme).toBe("light")
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#ffffff")
    const { result } = renderHook(useTheme)
    act(() => result.current.setPreview("layered"))
    expect(document.documentElement.style.colorScheme).toBe("dark")
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#000000")
  })

  it("still changes themes when browser storage is unavailable", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("Storage blocked") })
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage blocked") })
    const { result } = renderHook(useTheme)
    expect(result.current.theme).toBe("light")
    act(() => result.current.setTheme("dark"))
    expect(document.documentElement).toHaveClass("dark")
    act(() => result.current.setTheme("layered-light"))
    expect(document.documentElement).toHaveClass("theme-layered")
    expect(document.documentElement).not.toHaveClass("dark")
  })

  it.each(["layered", "layered-light"])("restores %s without removing unrelated root classes", (theme) => {
    localStorage.setItem("cogpit-theme", theme)
    const { result } = renderHook(useTheme)
    expect(result.current.theme).toBe(theme)
    expect(document.documentElement).toHaveClass("electron", "theme-layered")
    expect(document.documentElement.classList.contains("dark")).toBe(theme === "layered")
  })

  it("previews and cancels layering without changing the saved theme", () => {
    localStorage.setItem("cogpit-theme", "oled")
    const { result } = renderHook(useTheme)
    act(() => result.current.setPreview("layered"))
    expect(document.documentElement).toHaveClass("theme-layered")
    expect(document.documentElement).not.toHaveClass("theme-oled")
    expect(localStorage.getItem("cogpit-theme")).toBe("oled")
    act(() => result.current.setPreview(null))
    expect(document.documentElement).toHaveClass("theme-oled")
    expect(document.documentElement).not.toHaveClass("theme-layered")
  })

  it("persists selection and removes the style when switching to light", () => {
    const { result } = renderHook(useTheme)
    act(() => result.current.setTheme("layered"))
    expect(localStorage.getItem("cogpit-theme")).toBe("layered")
    act(() => result.current.setTheme("light"))
    expect(document.documentElement.className).toBe("electron")
    expect(localStorage.getItem("cogpit-theme")).toBe("light")
  })

  it("switches between layered modes and cancels a dark preview back to layered light", () => {
    const { result } = renderHook(useTheme)
    act(() => result.current.setTheme("layered"))
    act(() => result.current.setTheme("layered-light"))
    expect(document.documentElement.className).toBe("electron theme-layered")
    expect(localStorage.getItem("cogpit-theme")).toBe("layered-light")
    act(() => result.current.setPreview("layered"))
    expect(document.documentElement).toHaveClass("dark", "theme-layered")
    act(() => result.current.setPreview(null))
    expect(document.documentElement.className).toBe("electron theme-layered")
    expect(localStorage.getItem("cogpit-theme")).toBe("layered-light")
  })
})
