import { useCallback, useRef, useState } from "react"
import { authFetch, jsonFetch } from "@/lib/auth"
import { useVisiblePolling } from "./useVisiblePolling"
import type { CrewChatMessage, CrewChatPage } from "../../shared/contracts/crewChat"

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response
  const body = await response.json().catch(() => null) as { error?: string } | null
  throw new Error(body?.error || "Couldn't update crew chat.")
}

function mergeMessages(current: readonly CrewChatMessage[], incoming: readonly CrewChatMessage[]): CrewChatMessage[] {
  return [...new Map([...current, ...incoming].map((message) => [message.sequence, message])).values()].sort((a, b) => a.sequence - b.sequence)
}

/** Mounted by crew root so moving between members preserves chat and drafts. */
export function useCrewChat(rootId: string) {
  const [page, setPage] = useState<CrewChatPage | null>(null)
  const [messages, setMessages] = useState<CrewChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [busyMembers, setBusyMembers] = useState<ReadonlySet<string>>(new Set())
  const requestCounter = useRef(0)
  const postAttempt = useRef<{ text: string; id: string } | null>(null)
  const postInFlight = useRef(false)
  const olderInFlight = useRef(false)
  const memberInFlight = useRef(new Set<string>())
  const initialized = useRef(false)
  const latestCursor = useRef<number | null>(null)

  const poll = useCallback(async (isActive: () => boolean) => {
    const request = ++requestCounter.current
    try {
      const cursor = latestCursor.current
      const response = await checked(await authFetch(`/api/crew-chat/${encodeURIComponent(rootId)}${cursor === null ? "" : `?after=${cursor}&limit=100`}`))
      const next = await response.json() as CrewChatPage
      if (!isActive() || request !== requestCounter.current) return
      setPage(next)
      setMessages((current) => mergeMessages(current, next.messages))
      latestCursor.current = next.nextCursor
      if (!initialized.current) { initialized.current = true; setHasOlder(next.hasMore) }
      setError(null)
    } catch (cause) { if (isActive() && request === requestCounter.current) setError(cause instanceof Error ? cause.message : "Couldn't load crew chat.") }
  }, [rootId])
  useVisiblePolling(poll, 2_000)

  const post = useCallback(async (text: string): Promise<boolean> => {
    if (postInFlight.current) return false
    postInFlight.current = true
    setPosting(true)
    if (postAttempt.current?.text !== text) postAttempt.current = { text, id: crypto.randomUUID() }
    try {
      const response = await checked(await jsonFetch(`/api/crew-chat/${encodeURIComponent(rootId)}`, { text, commandId: postAttempt.current.id }))
      const result = await response.json() as { message: CrewChatMessage; pending: { sessionId: string }[] }
      requestCounter.current++
      setMessages((current) => mergeMessages(current, [result.message]))
      postAttempt.current = null
      setError(result.pending.length ? "Message saved. Some members are unavailable; delivery will retry." : null)
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't send the message."); return false }
    finally { postInFlight.current = false; setPosting(false) }
  }, [rootId])

  const setListening = useCallback(async (sessionId: string, listening: boolean) => {
    if (memberInFlight.current.has(sessionId)) return
    memberInFlight.current.add(sessionId)
    setBusyMembers((current) => new Set(current).add(sessionId))
    try {
      await checked(await jsonFetch(`/api/crew-chat/${encodeURIComponent(rootId)}`, { sessionId, listening }, { method: "PATCH" }))
      requestCounter.current++
      setPage((current) => current && ({ ...current, members: current.members.map((member) => member.sessionId === sessionId ? { ...member, listening } : member) }))
      setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't change listening.") }
    finally {
      memberInFlight.current.delete(sessionId)
      setBusyMembers((current) => { const next = new Set(current); next.delete(sessionId); return next })
    }
  }, [rootId])

  const older = useCallback(async () => {
    if (!messages.length || olderInFlight.current) return
    olderInFlight.current = true
    setLoadingOlder(true)
    try {
      const response = await checked(await authFetch(`/api/crew-chat/${encodeURIComponent(rootId)}?before=${messages[0]!.sequence}`))
      const next = await response.json() as CrewChatPage
      setMessages((current) => mergeMessages(current, next.messages))
      setHasOlder(next.hasMore)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't load older messages.") }
    finally { olderInFlight.current = false; setLoadingOlder(false) }
  }, [messages, rootId])

  return { page, messages, error, posting, busyMembers, hasOlder, loadingOlder, post, setListening, older }
}
