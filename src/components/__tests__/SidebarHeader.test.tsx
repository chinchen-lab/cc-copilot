import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SidebarHeader } from "@/components/SidebarHeader"

describe("SidebarHeader", () => {
  it("exposes home, search, and collapse with their shortcuts", () => {
    const onToggleSidebar = vi.fn()
    const onGoHome = vi.fn()
    const onOpenCommandPalette = vi.fn()
    const { container } = render(
      <SidebarHeader
        onToggleSidebar={onToggleSidebar}
        onGoHome={onGoHome}
        onOpenCommandPalette={onOpenCommandPalette}
        sidebarShortcut="⌘B"
        commandPaletteShortcut="⌘K"
      />,
    )

    expect(container.firstElementChild).toHaveClass("electron-drag", "window-inset-start")

    const home = screen.getByRole("button", { name: "Home" })
    expect(home).toHaveAttribute("title", "Mission Control")
    expect(home.querySelector("use")).toHaveAttribute("href", "/cogpit.svg#mark")
    expect(screen.getByRole("img", { name: "CC-Copilot" })).toBeVisible()
    expect(screen.queryByText("Pro")).not.toBeInTheDocument()
    expect(
      screen.getAllByRole("button").map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Home", "Search (⌘K)", "Hide sidebar (⌘B)"])

    fireEvent.click(home)
    fireEvent.click(screen.getByRole("button", { name: "Search (⌘K)" }))
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar (⌘B)" }))

    expect(onGoHome).toHaveBeenCalledOnce()
    expect(onOpenCommandPalette).toHaveBeenCalledOnce()
    expect(onToggleSidebar).toHaveBeenCalledOnce()
  })
})
