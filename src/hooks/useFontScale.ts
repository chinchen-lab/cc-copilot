import { useSyncExternalStore } from "react"
import { DEFAULT_FONT_SCALE, getFontScale, setFontScale, subscribeFontScale } from "@/lib/fontScale"

/** A local display preference, independent of host/server configuration. */
export function useFontScale(): [number, (percent: number) => void] {
  const scale = useSyncExternalStore(subscribeFontScale, getFontScale, () => DEFAULT_FONT_SCALE)
  return [scale, setFontScale]
}
