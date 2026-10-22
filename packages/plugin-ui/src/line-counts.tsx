import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "./utils.js"

export interface LineCountsRow {
  label: string
  additions: number
  deletions: number
}

interface LineCountsProps {
  add: number
  del: number
  dimmed?: boolean
  className?: string
  /**
   * Lines per kind of file, shown on hover or focus under the total. `null`
   * while the split is still loading; leave it out where there is no split.
   */
  breakdown?: readonly LineCountsRow[] | null
  /** Called when the tooltip opens, so a list can read the split only for rows someone looks at. */
  onBreakdownRequest?: () => void
}

/** Compact "+12 -3" line counts. Renders nothing for a zero-change entry. */
export function LineCounts({
  add,
  del,
  dimmed,
  className,
  breakdown,
  onBreakdownRequest,
}: LineCountsProps) {
  const statClassName = cn(
    "flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums",
    dimmed && "opacity-40",
    className,
  )
  const counts = (
    <>
      {add > 0 && <span className="text-success">+{add}</span>}
      {del > 0 && <span className="text-destructive">-{del}</span>}
    </>
  )
  if (breakdown === undefined || add + del === 0) return <span className={statClassName}>{counts}</span>

  return (
    <TooltipPrimitive.Provider delay={0}>
      <TooltipPrimitive.Root onOpenChange={(open) => { if (open) onBreakdownRequest?.() }}>
        <TooltipPrimitive.Trigger
          render={<span />}
          tabIndex={0}
          className={cn(
            statClassName,
            "cursor-default rounded-xs underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          )}
        >
          {counts}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner side="bottom" sideOffset={6} className="isolate z-50">
            <TooltipPrimitive.Popup className="z-50 w-fit origin-(--transform-origin) rounded-md bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 ease-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-98 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-98 data-closed:duration-75 motion-reduce:animate-none">
              {breakdown === null ? (
                <span className="text-muted-foreground">Loading breakdown…</span>
              ) : (
                <div className="grid grid-cols-[auto_auto_auto] items-baseline gap-x-4 gap-y-1 font-mono tabular-nums">
                  {breakdown.map((row) => <BreakdownRow key={row.label} {...row} />)}
                  <div className="col-span-3 my-0.5 border-t border-border" />
                  <BreakdownRow label="Total" additions={add} deletions={del} />
                </div>
              )}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

function BreakdownRow({ label, additions, deletions }: LineCountsRow) {
  return (
    <>
      <span className="font-sans">{label}</span>
      <span className="text-right text-success">+{additions}</span>
      <span className="text-right text-destructive">-{deletions}</span>
    </>
  )
}
