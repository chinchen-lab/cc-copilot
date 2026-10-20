import { applyTheme, readSavedTheme } from "./lib/themes"
import { applyFontScale, readSavedFontScale } from "./lib/fontScale"
import { applyLanguage, readSavedLanguage } from "./lib/i18n/language"

applyTheme(readSavedTheme())
applyFontScale(readSavedFontScale())
applyLanguage(readSavedLanguage())

if (navigator.userAgent.includes("Electron")) {
  document.documentElement.classList.add("electron")
  if (navigator.userAgent.includes("Windows")) document.documentElement.classList.add("electron-win")
}
