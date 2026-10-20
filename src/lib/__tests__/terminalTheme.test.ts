import { afterEach, describe, expect, it } from "vitest"
import { readTerminalTheme } from "../terminalTheme"

afterEach(() => document.documentElement.removeAttribute("style"))

describe("terminal theme", () => {
  it("uses the light terminal surface, distinct cursor and readable normal and bright ANSI colors", () => {
    const root = document.documentElement
    root.style.setProperty("--foreground", "#171717")
    root.style.setProperty("--canvas", "#ffffff")
    const surface = document.createElement("div")
    document.body.appendChild(surface)
    const tokens = {
      background: "#E8EDF3", foreground: "#263445", cursor: "#334155", selection: "#CBD5E1",
      black: "#263445", white: "#263445", "bright-black": "#64748B",
      red: "#B42318", green: "#22764E", yellow: "#8B620C",
      blue: "#245EA8", magenta: "#8B3E85", cyan: "#146C8B",
    }
    for (const [name, value] of Object.entries(tokens)) surface.style.setProperty(`--terminal-${name}`, value)
    expect(readTerminalTheme(surface)).toMatchObject({
      background: "#E8EDF3", foreground: "#263445", cursor: "#334155", cursorAccent: "#E8EDF3",
      selectionBackground: "#CBD5E1", black: "#263445", brightBlack: "#64748B", white: "#263445", brightWhite: "#263445",
      red: "#B42318", brightRed: "#B42318", green: "#22764E", brightGreen: "#22764E",
      yellow: "#8B620C", brightYellow: "#8B620C", blue: "#245EA8", magenta: "#8B3E85",
      cyan: "#146C8B", brightCyan: "#146C8B",
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
