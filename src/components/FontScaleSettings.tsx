import { Minus, Plus, RotateCcw } from "lucide-react"
import { useId } from "react"
import { Button } from "@/components/ui/button"
import { useFontScale } from "@/hooks/useFontScale"
import { DEFAULT_FONT_SCALE, FONT_SCALE_STEP, MAX_FONT_SCALE, MIN_FONT_SCALE } from "@/lib/fontScale"

export function FontScaleSettings() {
  const [percent, setPercent] = useFontScale()
  const id = useId()
  return (
    <section aria-label="Text size preferences" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">Text size</label>
        <output htmlFor={id} aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{percent}%</output>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon-xs" aria-label="Decrease text size" disabled={percent <= MIN_FONT_SCALE} onClick={() => setPercent(percent - FONT_SCALE_STEP)}><Minus /></Button>
        <input id={id} type="range" min={MIN_FONT_SCALE} max={MAX_FONT_SCALE} step={FONT_SCALE_STEP} value={percent} onChange={(event) => setPercent(Number(event.target.value))} aria-label="Text size" aria-valuetext={`${percent}%`} className="min-w-0 flex-1 accent-primary" />
        <Button type="button" variant="outline" size="icon-xs" aria-label="Increase text size" disabled={percent >= MAX_FONT_SCALE} onClick={() => setPercent(percent + FONT_SCALE_STEP)}><Plus /></Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Reset text size to 100%" title="Reset to 100%" disabled={percent === DEFAULT_FONT_SCALE} onClick={() => setPercent(DEFAULT_FONT_SCALE)}><RotateCcw /></Button>
      </div>
      <p className="text-xs text-muted-foreground">Scale interface text, code and terminals together. Saved automatically in this browser.</p>
    </section>
  )
}
