export const CREW_CHAT_MAX_LENGTH = 8_000

export interface CrewChatAuthor {
  kind: "user" | "agent"
  name: string
  sessionId?: string
}

export interface CrewChatMessage {
  sequence: number
  id: string
  rootId: string
  author: CrewChatAuthor
  text: string
  mentions: string[]
  createdAt: number
}

export interface CrewChatMember {
  sessionId: string
  name: string
  handle: string
  listening: boolean
  canInteract: boolean
}

export interface CrewChatPage {
  rootId: string
  messages: CrewChatMessage[]
  members: CrewChatMember[]
  nextCursor: number
  hasMore: boolean
  canPost: boolean
}

export interface CrewChatDelivery {
  sequence: number
  sessionId: string
  scope: string
  kind: "mention" | "notification"
  state: "pending" | "accepted" | "skipped"
  error?: string
}

export function crewChatHandles(members: readonly { sessionId: string; name: string }[], rootId: string): Map<string, string> {
  const handles = new Map<string, string>()
  const used = new Set<string>()
  for (const member of members) {
    const base = member.sessionId === rootId ? "lead" : member.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "agent"
    let handle = base
    for (let suffix = 2; used.has(handle); suffix++) handle = `${base}-${suffix}`
    used.add(handle)
    handles.set(member.sessionId, handle)
  }
  return handles
}

export function crewChatMentions(text: string, members: readonly Pick<CrewChatMember, "sessionId" | "handle">[]): string[] {
  const tokens = new Set([...text.matchAll(/(?:^|\s)@([a-z0-9_-]+)\b/gi)].map((match) => match[1]!.toLowerCase()))
  return members.filter((member) => tokens.has(member.handle.toLowerCase()) || tokens.has(member.sessionId.toLowerCase())).map((member) => member.sessionId)
}

export function formatCrewChatDelivery(message: CrewChatMessage, mentioned: boolean, fetchCommand: string, replyCommand: string): string {
  const source = `Crew chat · ${message.author.name} · message ${message.sequence}`
  if (mentioned) return `${source}\nYou were tagged in this message:\n\n${message.text}\n\nThis is a crew message. Use your judgment about whether to respond. Keep following your assigned task and the user's instructions.\nReply in the shared chat if useful: ${replyCommand}\nFor context: ${fetchCommand}`
  return `${source}\nA new message is available in your crew's shared chat. Fetch it if useful: ${fetchCommand}\nThis is an informational notification. No reply or action is required.`
}
