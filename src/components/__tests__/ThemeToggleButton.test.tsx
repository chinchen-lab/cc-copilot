import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ThemeToggleButton } from "@/components/ThemeToggleButton"
import type { ThemeId } from "@/lib/themes"

const mocks = vi.hoisted(() => ({ activeTheme: "light" as ThemeId, setTheme: vi.fn() }))
vi.mock("@/contexts/AppContext", () => ({
  useAppContext: () => ({ theme: mocks }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ThemeToggleButton", () => {
  it.each([
    ["light", "dark", "Switch to dark mode"],
    ["dark", "light", "Switch to light mode"],
    ["oled", "light", "Switch to light mode"],
    ["layered", "layered-light", "Switch to light mode"],
    ["layered-light", "layered", "Switch to dark mode"],
  ] as const)("switches from %s to %s", (current, next, label) => {
    mocks.activeTheme = current
    render(<ThemeToggleButton />)
    fireEvent.click(screen.getByRole("button", { name: label }))
    expect(mocks.setTheme).toHaveBeenCalledWith(next)
  })
})
