import { useTranslation } from "@/hooks/useTranslation"
import { useEffect, useState } from "react"
import { Flame } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useLeakMonitor } from "@/hooks/useLeakMonitor"
import { formatAge } from "@/lib/format"
import { cn } from "@/lib/utils"

/** How long a cleared indicator stays on screen before it hides itself. */
const CLEARED_VISIBLE_MS = 60_000

export function LeakIndicator({ onReview }: { onReview: () => void }) {
  const { t } = useTranslation()
  const { leaks } = useLeakMonitor()
  const [pinned, setPinned] = useState(false)

  const hasLeaks = leaks.length > 0
  const totalCpu = leaks.reduce((sum, leak) => sum + leak.cpuPercent, 0)

  useEffect(() => {
    if (hasLeaks) {
      setPinned(true)
      return
    }
    const timer = window.setTimeout(() => setPinned(false), CLEARED_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [hasLeaks])

  if (!hasLeaks && !pinned) return null

  return (
    <Tooltip>
      <TooltipTrigger render={
        <Button
          variant={hasLeaks ? "destructive" : "ghost"}
          size="xs"
          aria-label={hasLeaks
            ? t(leaks.length === 1 ? "Review {0} flagged process" : "Review {0} flagged processes", { "0": leaks.length })
            : t("Leak monitor. No flagged processes")}
          onClick={onReview}
          className={cn("mr-1 font-mono", !hasLeaks && "text-muted-foreground")}
        />
      }>
        <Flame data-icon="inline-start" />
        <span className="tabular-nums">{leaks.length}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="p-3">
        {hasLeaks ? (
          <div className="flex min-w-56 flex-col gap-2">
            <div className="text-xs font-medium">
              {t("Flagged processes · ")}{totalCpu.toFixed(0)}% CPU
            </div>
            {leaks.slice(0, 6).map((leak) => (
              <div key={leak.pid} className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-muted-foreground">{leak.label} · {formatAge(leak.ageSeconds)}</span>
                <span className="shrink-0 font-semibold text-destructive">{leak.cpuPercent.toFixed(0)}%</span>
              </div>
            ))}
            {leaks.length > 6 && (
              <div className="text-xs text-muted-foreground">+{leaks.length - 6} {t(" more")}</div>
            )}
            <Separator />
            <div className="text-xs text-muted-foreground">
              {t("Review ownership and stop individual processes")}
            </div>
          </div>
        ) : (
          <div className="flex min-w-48 flex-col gap-1">
            <div className="text-xs font-medium">{t("Leak monitor")}</div>
            <div className="text-xs text-muted-foreground">
              {t("No flagged processes. Click to open the power monitor.")}
            </div>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
