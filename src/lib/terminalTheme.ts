import type { ITheme } from "@xterm/xterm"

export function readTerminalTheme(element: HTMLElement): ITheme {
  const styles = getComputedStyle(element)
  const color = (name: string) => styles.getPropertyValue(`--${name}`).trim()
  const terminalColor = (name: string, fallback: string) => color(`terminal-${name}`) || color(fallback)
  return {
    background: color("terminal-background") || "#00000000",
    foreground: terminalColor("foreground", "foreground"),
    cursor: terminalColor("foreground", "foreground"),
    cursorAccent: terminalColor("background", "canvas"),
    selectionBackground: color("terminal-selection"),
    black: color("terminal-black"), brightBlack: terminalColor("bright-black", "muted-foreground"),
    red: terminalColor("red", "destructive"), brightRed: terminalColor("red", "destructive"),
    green: terminalColor("green", "success"), brightGreen: terminalColor("green", "success"),
    yellow: terminalColor("yellow", "warning"), brightYellow: terminalColor("yellow", "warning"),
    blue: terminalColor("blue", "info"), brightBlue: terminalColor("blue", "info"),
    magenta: color("terminal-magenta"), brightMagenta: color("terminal-magenta"),
    cyan: color("terminal-cyan"), brightCyan: color("terminal-cyan"),
    white: color("terminal-white"), brightWhite: color("terminal-white"),
  }
}
