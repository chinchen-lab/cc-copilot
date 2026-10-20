import { useId } from "react"
import { useTranslation } from "@/hooks/useTranslation"
import type { UiLanguage } from "@/lib/i18n/language"

export function LanguageSettings() {
  const { language, setLanguage, t } = useTranslation()
  const id = useId()
  return (
    <section className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">{t("Language")}</label>
      <select id={id} value={language} onChange={(event) => setLanguage(event.target.value as UiLanguage)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
        <option value="en">English</option>
        <option value="zh-TW">繁體中文</option>
      </select>
      <p className="text-xs text-muted-foreground">{t("Choose the interface language. Saved automatically in this browser.")}</p>
    </section>
  )
}
