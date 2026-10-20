import { afterEach, describe, expect, it, vi } from "vitest"
import { translate } from "../i18n"
import { applyLanguage, getLanguage, LANGUAGE_KEY, readSavedLanguage, setLanguage, subscribeLanguage } from "../i18n/language"

afterEach(() => {
  vi.restoreAllMocks()
  setLanguage("en")
  localStorage.removeItem(LANGUAGE_KEY)
})

describe("interface language", () => {
  it("defaults to English and only restores supported saved languages", () => {
    localStorage.removeItem(LANGUAGE_KEY)
    expect(readSavedLanguage()).toBe("en")
    localStorage.setItem(LANGUAGE_KEY, "zh-TW")
    expect(readSavedLanguage()).toBe("zh-TW")
    for (const value of ["", "zh-CN", "unknown", "null"]) {
      localStorage.setItem(LANGUAGE_KEY, value)
      expect(readSavedLanguage()).toBe("en")
    }
  })

  it("persists changes, updates document language and notifies subscribers", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLanguage(listener)
    setLanguage("zh-TW")
    expect(getLanguage()).toBe("zh-TW")
    expect(readSavedLanguage()).toBe("zh-TW")
    expect(document.documentElement.lang).toBe("zh-TW")
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    setLanguage("en")
    expect(listener).toHaveBeenCalledOnce()
    expect(document.documentElement.lang).toBe("en")
  })

  it("still applies changes when browser storage is unavailable", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked") })
    expect(() => setLanguage("zh-TW")).not.toThrow()
    expect(getLanguage()).toBe("zh-TW")
    expect(document.documentElement.lang).toBe("zh-TW")
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked") })
    expect(readSavedLanguage()).toBe("en")
    applyLanguage("en")
    expect(document.documentElement.lang).toBe("en")
  })

  it("translates UI messages with interpolation while retaining English fallback and JSX spacing", () => {
    expect(translate("Settings", undefined, "zh-TW")).toBe("設定")
    expect(translate(" Settings ", undefined, "zh-TW")).toBe(" 設定 ")
    expect(translate("Describe the task for {0}", { "0": "Billing {1}" }, "zh-TW")).toContain("Billing {1}")
    expect(translate("Unknown {count}", { count: 0 }, "zh-TW")).toBe("Unknown 0")
    expect(translate("Missing {count}", {}, "zh-TW")).toBe("Missing {count}")
    expect(translate("Settings", undefined, "en")).toBe("Settings")
    expect(translate("/work/my-project", undefined, "zh-TW")).toBe("/work/my-project")
    expect(translate("constructor", undefined, "zh-TW")).toBe("constructor")
    expect(translate("Light", undefined, "zh-TW")).toBe("輕量")
    expect(translate("Light", undefined, "zh-TW", "theme")).toBe("淺色")
    expect(translate("Light", undefined, "en", "theme")).toBe("Light")
  })
})
