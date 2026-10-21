/** Bound synchronous tokenization, including large single-line/minified files. */
const MAX_CHARACTERS = 200_000
const MAX_LINES = 20_000
const MAX_LINE_LENGTH = 10_000

export function canHighlightDiff(before: string, after: string): boolean {
  if (before.length + after.length > MAX_CHARACTERS) return false
  let lines = 0
  for (const text of [before, after]) {
    let lineLength = 0
    lines++
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        if (++lines > MAX_LINES) return false
        lineLength = 0
      } else if (++lineLength > MAX_LINE_LENGTH) return false
    }
  }
  return lines <= MAX_LINES
}
