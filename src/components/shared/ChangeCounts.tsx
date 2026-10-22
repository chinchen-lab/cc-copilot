/**
 * The +N / −M diffstat renderers, shared so every surface that reports line
 * changes looks identical. `LineCounts` lives in the plugin UI package so the
 * GitHub plugin renders the same stat and breakdown tooltip.
 */

export { LineCounts } from "@cogpit/plugin-ui/line-counts"

const CHANGE_BAR_BLOCKS = 5

/** GitHub-style five-block meter showing the add/delete ratio. */
export function ChangeBar({ add, del }: { add: number; del: number }) {
  const total = add + del
  if (total === 0) return null
  const addBlocks = Math.round((add / total) * CHANGE_BAR_BLOCKS)
  const delBlocks = CHANGE_BAR_BLOCKS - addBlocks
  return (
    <span className="flex items-center gap-[1px] shrink-0 ml-1">
      {Array.from({ length: addBlocks }, (_, i) => (
        <span key={`a${i}`} className="inline-block size-1.5 rounded-xs bg-success/70" />
      ))}
      {Array.from({ length: delBlocks }, (_, i) => (
        <span key={`d${i}`} className="inline-block size-1.5 rounded-xs bg-destructive/70" />
      ))}
    </span>
  )
}
