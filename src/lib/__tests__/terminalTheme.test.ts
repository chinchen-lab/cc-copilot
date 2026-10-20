import { afterEach, describe, expect, it } from "vitest"
import { readTerminalTheme } from "../terminalTheme"

afterEach(() => document.documentElement.removeAttribute("style"))

describe("terminal theme", () => {
  it("uses the terminal's dark surface and legible palette over a light application", () => {
    const root = document.documentElement
    root.style.setProperty("--foreground", "#171717")
    root.style.setProperty("--canvas", "#ffffff")
    const surface = document.createElement("div")
    document.body.appendChild(surface)
    const tokens = {
      background: "#202020", foreground: "#f5f5f5", selection: "#525252",
      "bright-black": "#a3a3a3", red: "#f87171", green: "#86efac",
      yellow: "#facc15", blue: "#93c5fd", magenta: "#e879f9", cyan: "#67e8f9",
    }
    for (const [name, value] of Object.entries(tokens)) surface.style.setProperty(`--terminal-${name}`, value)
    expect(readTerminalTheme(surface)).toMatchObject({
      background: "#202020", foreground: "#f5f5f5", cursor: "#f5f5f5", cursorAccent: "#202020",
      selectionBackground: "#525252", brightBlack: "#a3a3a3", red: "#f87171", brightRed: "#f87171",
      green: "#86efac", yellow: "#facc15", blue: "#93c5fd", magenta: "#e879f9", cyan: "#67e8f9",
    })
    surface.style.removeProperty("--terminal-background")
    surface.style.removeProperty("--terminal-foreground")
    expect(readTerminalTheme(surface).background).toBe("#00000000")
    surface.remove()
  })

  it("reads the active CSS colors again after a theme change", () => {
    const root = document.documentElement
    root.style.setProperty("--foreground", "#fafafa")
    root.style.setProperty("--terminal-black", "#171717")
    root.style.setProperty("--terminal-white", "#fafafa")
    root.style.setProperty("--terminal-magenta", "#b83ba4")
    root.style.setProperty("--terminal-cyan", "#008fa3")
    root.style.setProperty("--canvas", "#000")
    root.style.setProperty("--terminal-selection", "#333")
    root.style.setProperty("--destructive", "#f00")
    expect(readTerminalTheme(root)).toMatchObject({ background: "#00000000", foreground: "#fafafa", cursor: "#fafafa", cursorAccent: "#000", selectionBackground: "#333", red: "#f00", black: "#171717", white: "#fafafa", magenta: "#b83ba4", cyan: "#008fa3" })
    root.style.setProperty("--foreground", "#171717")
    root.style.setProperty("--canvas", "#fff")
    expect(readTerminalTheme(root)).toMatchObject({ foreground: "#171717", cursor: "#171717", cursorAccent: "#fff", black: "#171717", white: "#fafafa", magenta: "#b83ba4", cyan: "#008fa3" })
  })
})
