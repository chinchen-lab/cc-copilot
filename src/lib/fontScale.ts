export const FONT_SCALE_KEY = "cogpit-font-scale"
export const DEFAULT_FONT_SCALE = 100
export const MIN_FONT_SCALE = 75
export const MAX_FONT_SCALE = 150
export const FONT_SCALE_STEP = 5

export function readSavedFontScale(): number {
  try {
    const value = localStorage.getItem(FONT_SCALE_KEY)
    if (value === null || value.trim() === "") return DEFAULT_FONT_SCALE
    const percent = Number(value)
    if (Number.isFinite(percent) && percent >= MIN_FONT_SCALE && percent <= MAX_FONT_SCALE) return percent
  } catch { /* Browser storage can be unavailable. */ }
  return DEFAULT_FONT_SCALE
}

export function applyFontScale(percent: number): void {
  if (typeof document === "undefined") return
  // A percentage preserves the browser's own default font preference.
  if (percent === DEFAULT_FONT_SCALE) document.documentElement.style.removeProperty("font-size")
  else document.documentElement.style.fontSize = `${percent}%`
}

let current = readSavedFontScale()
const listeners = new Set<() => void>()

export function getFontScale(): number { return current }

export function setFontScale(percent: number): void {
  current = Number.isFinite(percent)
    ? Math.max(MIN_FONT_SCALE, Math.min(MAX_FONT_SCALE, Math.round(percent / FONT_SCALE_STEP) * FONT_SCALE_STEP))
    : DEFAULT_FONT_SCALE
  try { localStorage.setItem(FONT_SCALE_KEY, String(current)) } catch { /* Keep this session usable. */ }
  applyFontScale(current)
  listeners.forEach((listener) => listener())
}

export function subscribeFontScale(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
