import { isReaderPrompt } from "./automatedPrompts"
import type { ToolCall, Turn } from "./types"

function promptText(content: Turn["userMessage"]): string {
  if (content === null) return ""
  if (typeof content === "string") return content
  return content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n")
}

/**
 * Records on each async question the reader's first prompt after it.
 *
 * Nothing links a reply to its question, so that prompt answers every question
 * still open when it arrives. A pure recompute over the list handed in, so the
 * page stitcher re-runs it across a join and gets what a single parse would
 * have produced. Turns whose answers did not change come back by reference.
 */
export function linkAsyncAnswers(turns: readonly Turn[]): Turn[] {
  const answers = new Map<string, string>()
  let open: string[] = []
  const answer = (text: string) => {
    if (open.length === 0 || !isReaderPrompt(text)) return
    for (const id of open) answers.set(id, text.trim())
    open = []
  }

  for (const turn of turns) {
    answer(promptText(turn.userMessage))
    for (const block of turn.contentBlocks) {
      if (block.kind === "queued_prompt") answer(block.content)
      else if (block.kind === "tool_calls") {
        for (const call of block.toolCalls) if (call.asyncQuestion) open.push(call.id)
      }
    }
  }

  const stale = (call: ToolCall) => call.asyncQuestion === true && call.asyncAnswer !== answers.get(call.id)
  const relinked = new Map<ToolCall, ToolCall>()
  const relink = (call: ToolCall): ToolCall => {
    if (!stale(call)) return call
    let next = relinked.get(call)
    if (!next) {
      const { asyncAnswer: _previous, ...rest } = call
      const reply = answers.get(call.id)
      next = reply === undefined ? rest : { ...rest, asyncAnswer: reply }
      relinked.set(call, next)
    }
    return next
  }

  return turns.map((turn) => {
    if (!turn.toolCalls.some(stale)) return turn
    return {
      ...turn,
      toolCalls: turn.toolCalls.map(relink),
      contentBlocks: turn.contentBlocks.map((block) => (
        block.kind === "tool_calls" ? { ...block, toolCalls: block.toolCalls.map(relink) } : block
      )),
    }
  })
}
