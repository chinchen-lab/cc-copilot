import { applyTheme, readSavedTheme } from "./lib/themes"
import { applyFontScale, readSavedFontScale } from "./lib/fontScale"

applyTheme(readSavedTheme())
applyFontScale(readSavedFontScale())

if (navigator.userAgent.includes("Electron")) {
  document.documentElement.classList.add("electron")
  if (navigator.userAgent.includes("Windows")) document.documentElement.classList.add("electron-win")
}
