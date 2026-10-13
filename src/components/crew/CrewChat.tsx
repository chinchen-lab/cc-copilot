import { useEffect, useRef, useState } from "react"
import { AtSign, Ear, MessageSquare, Send } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useCrewChat } from "@/hooks/useCrewChat"
import { formatRelativeTime } from "@/lib/format"
import { CREW_CHAT_MAX_LENGTH, type CrewChatMessage } from "../../../shared/contracts/crewChat"

export function CrewChat({ rootId, active = true }: { rootId: string; active?: boolean }) {
  const chat = useCrewChat(rootId)
  const [draft, setDraft] = useState("")
  const end = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const latest = chat.messages.at(-1)?.sequence

  useEffect(() => { if (active && follow.current) end.current?.scrollIntoView?.({ block: "end" }) }, [active, latest])

  const send = async () => {
    const text = draft.trim()
    if (!text || chat.posting) return
    if (await chat.post(text)) { setDraft((current) => current.trim() === text ? "" : current); follow.current = true }
  }

  return (
    <section aria-label="Crew chat" className="flex h-full min-h-0 flex-col">
      <details className="shrink-0 border-b px-3 py-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          {chat.page ? `${chat.page.members.filter((member) => member.listening).length} listening · Members & mentions` : "Loading chat…"}
        </summary>
        <FieldGroup className="max-h-48 gap-2 overflow-y-auto py-2">
          {chat.page?.members.map((member) => (
            <Field key={member.sessionId} orientation="horizontal">
              <Button variant="ghost" size="xs" disabled={!chat.page?.canPost || !member.canInteract} onClick={() => setDraft((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}@${member.handle} `)} aria-label={`Mention ${member.name}`}>
                <AtSign data-icon="inline-start" />{member.handle}
              </Button>
              <FieldLabel className="min-w-0 flex-1 truncate" htmlFor={`listen-${member.sessionId}`} aria-label={`Listen for ${member.name}`}>{member.name}</FieldLabel>
              <Switch id={`listen-${member.sessionId}`} size="sm" checked={member.listening} disabled={!member.canInteract || chat.busyMembers.has(member.sessionId)} onCheckedChange={(value) => void chat.setListening(member.sessionId, value)} />
            </Field>
          ))}
        </FieldGroup>
        <p className="pb-1 text-xs text-muted-foreground">Listening sends short notices while an agent works. @mentions send the full message, even when listening is off.</p>
      </details>
      <ScrollArea className="min-h-0 flex-1" onScrollCapture={(event) => {
        const viewport = event.target as HTMLElement
        follow.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
      }}>
        {chat.hasOlder && <div className="flex justify-center py-2"><Button variant="ghost" size="xs" disabled={chat.loadingOlder} onClick={() => void chat.older()}>{chat.loadingOlder ? "Loading…" : "Load earlier messages"}</Button></div>}
        {chat.page && chat.messages.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><MessageSquare /></EmptyMedia>
              <EmptyTitle>Talk to the crew</EmptyTitle>
              <EmptyDescription>Share a discovery, ask a question, or tag someone for their input.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <div role="log" aria-label="Shared messages" aria-live="polite" aria-relevant="additions" className="flex flex-col gap-4 px-3 py-3">
          {chat.messages.map((message) => <ChatMessage key={message.sequence} message={message} members={chat.page?.members ?? []} />)}
          <div ref={end} />
        </div>
      </ScrollArea>
      <form className="shrink-0 border-t p-3" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <FieldGroup className="gap-2">
          <Field data-invalid={Boolean(chat.error)}>
            <FieldLabel htmlFor={`crew-chat-${rootId}`} className="sr-only">Message the crew</FieldLabel>
            <Textarea id={`crew-chat-${rootId}`} value={draft} rows={3} maxLength={CREW_CHAT_MAX_LENGTH} placeholder="Message the crew… use @ to tag an agent" disabled={!chat.page?.canPost} aria-invalid={Boolean(chat.error)} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
            }} />
            {chat.error && <p role="alert" className="text-xs text-destructive">{chat.error}</p>}
          </Field>
          <div className="flex items-center gap-2">
            <FieldDescription className="flex-1">{chat.page?.canPost === false ? "You have read access to this crew." : "⌘ / Ctrl + Enter to send"}</FieldDescription>
            <Button type="submit" size="sm" disabled={!chat.page?.canPost || !draft.trim() || chat.posting}><Send data-icon="inline-start" />{chat.posting ? "Sending…" : "Send"}</Button>
          </div>
        </FieldGroup>
      </form>
    </section>
  )
}

function ChatMessage({ message, members }: { message: CrewChatMessage; members: { sessionId: string; handle: string }[] }) {
  const createdAt = new Date(message.createdAt)
  return (
    <article className="flex flex-col gap-1.5" aria-label={`Message from ${message.author.name}`}>
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">{message.author.name}</span>
        {message.author.kind === "user" && <Badge variant="outline">User</Badge>}
        <time className="ml-auto shrink-0 text-muted-foreground" dateTime={createdAt.toISOString()} title={createdAt.toLocaleString()}>{formatRelativeTime(createdAt.toISOString())}</time>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
      {message.mentions.length > 0 && <div className="flex flex-wrap gap-1">{message.mentions.map((id) => <Badge key={id} variant="secondary"><Ear data-icon="inline-start" />@{members.find((member) => member.sessionId === id)?.handle ?? "member"}</Badge>)}</div>}
    </article>
  )
}
