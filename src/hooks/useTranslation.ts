import { useCallback, useSyncExternalStore } from "react"
import { translate } from "@/lib/i18n"
import { DEFAULT_LANGUAGE, getLanguage, setLanguage, subscribeLanguage } from "@/lib/i18n/language"

export function useTranslation() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => DEFAULT_LANGUAGE)
  const t = useCallback((source: string, params?: Record<string, unknown>, context?: string) => translate(source, params, language, context), [language])
  return { language, setLanguage, t }
}
