import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { BrandLogo } from "../BrandLogo"

describe("BrandLogo", () => {
  it("exposes the complete brand name and reuses the platform mark", () => {
    render(<BrandLogo />)
    const logo = screen.getByRole("img", { name: "CC Copilot Pro" })
    expect(logo.querySelector("use")).toHaveAttribute("href", "/cogpit.svg#mark")
    expect(screen.getByText("CC")).toBeVisible()
    expect(screen.getByText("Copilot")).toBeVisible()
    expect(screen.getByText("Pro")).toBeVisible()
  })

  it("offers a compact sidebar wordmark without the badge", () => {
    render(<BrandLogo compact />)
    const logo = screen.getByRole("img", { name: "CC Copilot" })
    expect(logo.querySelector("use")).toHaveAttribute("href", "/cogpit.svg#mark")
    expect(screen.getByText("CC")).toBeVisible()
    expect(screen.getByText("Copilot")).toBeVisible()
    expect(screen.queryByText("Pro")).not.toBeInTheDocument()
  })
})
