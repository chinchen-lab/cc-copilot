import { useEffect, useState } from "react"
import { authFetch } from "@/lib/auth"
import type { CrewChatMember, CrewChatMessage, CrewChatPage } from "../../shared/contracts/crewChat"

const MEMBERS_TTL_MS = 60_000
const membersByRoot = new Map<string, { at: number; members: Promise<CrewChatMember[] | null> }>()

async function chatPage(rootId: string, query: string): Promise<CrewChatPage | null> {
  const response = await authFetch(`/api/crew-chat/${encodeURIComponent(rootId)}?${query}`).catch(() => null)
  return response?.ok ? await response.json() as CrewChatPage : null
}

function crewMembers(rootId: string): Promise<CrewChatMember[] | null> {
  const cached = membersByRoot.get(rootId)
  if (cached && Date.now() - cached.at < MEMBERS_TTL_MS) return cached.members
  const members = chatPage(rootId, "limit=1").then((page) => page?.members ?? null)
  membersByRoot.set(rootId, { at: Date.now(), members })
  return members
}

/** A crew's chat members, shared by every prompt from that crew in the timeline; null until known or when the crew cannot be read. */
export function useCrewChatMembers(rootId: string | null): CrewChatMember[] | null {
  const [members, setMembers] = useState<{ rootId: string; members: CrewChatMember[] } | null>(null)
  useEffect(() => {
    if (!rootId) return
    let active = true
    void crewMembers(rootId).then((value) => { if (active && value) setMembers({ rootId, members: value }) })
    return () => { active = false }
  }, [rootId])
  return members && members.rootId === rootId ? members.members : null
}

/** One crew chat message by its sequence number; null when it cannot be read. */
export async function fetchCrewChatMessage(rootId: string, sequence: number): Promise<CrewChatMessage | null> {
  const page = await chatPage(rootId, `after=${sequence - 1}&limit=1`)
  return page?.messages.find((message) => message.sequence === sequence) ?? null
}
