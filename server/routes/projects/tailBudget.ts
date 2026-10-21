/**
 * Byte budget for the initial `?tail=` session payload. `tail=30` reads a
 * ~2MB byte window, and a single giant tool-result line can push the response
 * past a megabyte — fine on localhost, multi-second over a tunnel. The budget
 * caps what ships on first paint; older turns arrive via `?before=` paging.
 */
export const DEFAULT_TAIL_BYTE_BUDGET = 256 * 1024
const MIN_TAIL_BYTE_BUDGET = 16 * 1024
const MAX_TAIL_BYTE_BUDGET = 16 * 1024 * 1024

/** Clamp a `?maxBytes=` override, falling back to the default budget. */
export function parseTailByteBudget(raw: string | null): number {
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_TAIL_BYTE_BUDGET
  return Math.max(MIN_TAIL_BYTE_BUDGET, Math.min(parsed, MAX_TAIL_BYTE_BUDGET))
}

export interface TrimmedTail {
  lines: string[]
  byteOffset: number
}

/**
 * Drop oldest lines until the tail fits `budget` bytes (newline included per
 * line). Always keeps the newest line even when it alone exceeds the budget,
 * and never trims below `minLines` kept lines — the floor wins over the byte
 * budget so one fat line cannot reduce a page to a dribble. Lines `isNoise`
 * names are dropped wherever they sit and count toward neither. Advances
 * `byteOffset` by the exact bytes dropped from the front so `?before=` paging
 * continues seamlessly from the trimmed boundary.
 */
export function trimTailToByteBudget(
  lines: string[],
  byteOffset: number,
  budget: number,
  minLines = 1,
  isNoise: (line: string) => boolean = () => false,
): TrimmedTail {
  const floor = Math.max(1, minLines)
  const kept: string[] = []
  let firstKept = lines.length
  let keptBytes = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isNoise(lines[i])) continue
    const lineBytes = Buffer.byteLength(lines[i], "utf8") + 1
    if (keptBytes + lineBytes > budget && kept.length >= floor) break
    firstKept = i
    keptBytes += lineBytes
    kept.push(lines[i])
  }
  kept.reverse()

  let droppedBytes = 0
  for (let i = 0; i < firstKept; i++) {
    droppedBytes += Buffer.byteLength(lines[i], "utf8") + 1
  }
  return { lines: kept, byteOffset: byteOffset + droppedBytes }
}
