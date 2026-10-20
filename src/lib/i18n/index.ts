import { agentZhTW } from "@/lib/agents/uiMessages"
import { zhTW } from "./zh-TW"
import type { UiLanguage } from "./language"

export function translate(source: string, params: Record<string, unknown> | undefined, language: UiLanguage, context?: string): string {
  let message = source
  if (language === "zh-TW") {
    const key = source.trim()
    const contextualKey = context ? `${context}:${key}` : key
    const translated = Object.prototype.hasOwnProperty.call(zhTW, contextualKey) ? zhTW[contextualKey]
      : Object.prototype.hasOwnProperty.call(zhTW, key) ? zhTW[key]
        : Object.prototype.hasOwnProperty.call(agentZhTW, key) ? agentZhTW[key] : undefined
    if (translated !== undefined) message = source.replace(key, () => translated)
  }
  return message.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    params && Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : placeholder)
}
