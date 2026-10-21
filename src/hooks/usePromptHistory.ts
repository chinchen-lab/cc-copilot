import { useCallback, useEffect, useRef, type KeyboardEvent } from "react"
import type { ParsedSession } from "../../shared/session/types"
import { getUserMessageText } from "../../shared/session/parser"
import { extractCommandArgs, extractCommandName, stripSystemTags } from "@/lib/userMessageContent"

type HistorySession = Pick<ParsedSession, "sessionId" | "turns">

function promptText(text: string): string {
  const command = extractCommandName(text)
  const args = command ? extractCommandArgs(text) : null
  return command ? `/${command}${args ? ` ${args}` : ""}` : stripSystemTags(text)
}

function promptsFor(session: HistorySession | null, pending: readonly string[]): string[] {
  const prompts: string[] = []
  for (const turn of session?.turns ?? []) {
    const text = promptText(getUserMessageText(turn.userMessage))
    if (text) prompts.push(text)
    for (const block of turn.contentBlocks) {
      if (block.kind !== "queued_prompt") continue
      const queued = promptText(block.content)
      if (queued) prompts.push(queued)
    }
  }
  // Delivery and transcript updates can overlap before the pending queue is consumed.
  const queued = pending.map(promptText).filter(Boolean)
  let overlap = Math.min(prompts.length, queued.length)
  while (overlap > 0 && !queued.slice(0, overlap).every((text, index) => text === prompts[prompts.length - overlap + index])) overlap--
  return [...prompts, ...queued.slice(overlap)]
}

/** Browse a snapshot so incoming turns cannot move the reader's history cursor. */
export function usePromptHistory(session: HistorySession | null, pending: readonly string[], onRecall: (text: string) => void) {
  const navigation = useRef<{
    sessionId: string | null
    prompts: string[]
    index: number
    draft: string
    value: string
  } | null>(null)

  const resetHistory = useCallback(() => { navigation.current = null }, [])
  const sessionId = session?.sessionId ?? null
  useEffect(resetHistory, [sessionId, resetHistory])
  const handleHistoryKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false
    const input = event.currentTarget
    const { value, selectionStart: start, selectionEnd: end } = input
    if (start !== end) return false
    const older = event.key === "ArrowUp"
    if (older ? value.slice(0, start).includes("\n") : value.slice(end).includes("\n")) return false

    const sessionId = session?.sessionId ?? null
    let current = navigation.current
    if (current && (current.sessionId !== sessionId || current.value !== value)) current = null
    if (!current) {
      if (!older) return false
      const prompts = promptsFor(session, pending)
      if (prompts.length === 0) return false
      current = { sessionId, prompts, index: prompts.length, draft: value, value }
    }
    current.index = Math.max(0, Math.min(current.prompts.length, current.index + (older ? -1 : 1)))
    const recalled = current.prompts[current.index] ?? current.draft
    current.value = recalled
    navigation.current = current.index === current.prompts.length ? null : current
    event.preventDefault()
    onRecall(recalled)
    requestAnimationFrame(() => {
      if (input.isConnected && input.value === recalled) input.setSelectionRange(recalled.length, recalled.length)
    })
    return true
  }, [session, pending, onRecall])

  return { handleHistoryKeyDown, resetHistory }
}
