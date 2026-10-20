export type UiLanguage = "en" | "zh-TW"
export const LANGUAGE_KEY = "cogpit-language"
export const DEFAULT_LANGUAGE: UiLanguage = "en"

export function readSavedLanguage(): UiLanguage {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === "zh-TW" ? "zh-TW" : DEFAULT_LANGUAGE
  } catch { return DEFAULT_LANGUAGE }
}

export function applyLanguage(language: UiLanguage): void {
  if (typeof document !== "undefined") document.documentElement.lang = language
}

let current = readSavedLanguage()
const listeners = new Set<() => void>()
export function getLanguage(): UiLanguage { return current }

export function setLanguage(language: UiLanguage): void {
  current = language === "zh-TW" ? language : DEFAULT_LANGUAGE
  try { localStorage.setItem(LANGUAGE_KEY, current) } catch { /* Keep the preference for this session. */ }
  applyLanguage(current)
  listeners.forEach((listener) => listener())
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
