/**
 * How a crew chat message is read: its markdown tree with the line breaks
 * agents mean as paragraphs, inline "(a) … (b) …" runs as lists, and the
 * mentions, status words, commit hashes and file paths marked so the message
 * view can style them.
 */

import type { CSSProperties } from "react"
import type { CrewChatMember, CrewChatMessage } from "../../../shared/contracts/crewChat"

interface Node {
  type: string
  value?: string
  children?: Node[]
  data?: { hName?: string; hProperties?: Record<string, string> }
  [key: string]: unknown
}

type CrewChatToken = "mention" | "status" | "sha"
export type StatusTone = "success" | "warning" | "destructive"

const STATUS: Record<string, StatusTone> = {
  PASS: "success", PASSED: "success", APPROVE: "success", APPROVED: "success", MERGED: "success", READY: "success", GREEN: "success", DONE: "success",
  FAIL: "destructive", FAILS: "destructive", FAILED: "destructive", ERROR: "destructive", RED: "destructive", CHANGES_REQUESTED: "destructive",
  BLOCKED: "warning", BLOCKER: "warning", URGENT: "warning", WAITING: "warning", "DECISION NEEDED": "warning",
}

const TOKEN = new RegExp([
  String.raw`(?<mention>(?<=^|[\s(])@[a-z0-9_-]+\b)`,
  String.raw`(?<status>\b(?:${Object.keys(STATUS).sort((a, b) => b.length - a.length).join("|")})\b)`,
  String.raw`(?<sha>\b(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40})\b)`,
  String.raw`(?<path>(?<=^|[\s(“"'=])(?:(?:~|\.{1,2})?\/[\w.@%+=-]+(?:\/[\w.@%+=-]*)*|[\w.-]+\/[\w.@/-]*\.[a-z][a-z0-9]{0,5}\b))`,
].join("|"), "gi")

const MARKER = /(?<=^|[\s:;,.])\((\d{1,2}|[a-z])\)(?=\s)/g
const LEADING_MARKER = /^\((\d{1,2}|[a-z])\)\s+/

type Handles = ReadonlyMap<string, string>

/** Handles and session ids, lowercased, to the member they name. */
export function crewChatHandleMap(members: readonly Pick<CrewChatMember, "sessionId" | "handle">[]): Map<string, string> {
  return new Map(members.flatMap((member) => [[member.handle.toLowerCase(), member.sessionId], [member.sessionId.toLowerCase(), member.sessionId]]))
}

/** The remark plugin. */
export function remarkCrewChat({ handles }: { handles: Handles }) {
  return (tree: Node) => { transform(tree, handles) }
}

function transform(parent: Node, handles: Handles): void {
  if (!parent.children || parent.type === "link" || parent.type === "linkReference") return
  const paragraphs = (child: Node) => parent.type === "listItem" ? splitEnumeration(breakLines(child)) : splitLines(child).flatMap(splitEnumeration)
  parent.children = mergeMarkedParagraphs(parent.children.flatMap((child) => child.type === "paragraph" ? paragraphs(child) : [child]))
  parent.children = parent.children.flatMap((child) => child.type === "text" ? tokenize(child.value ?? "", handles) : [child])
  for (const child of parent.children) transform(child, handles)
}

/** A single newline from an agent starts a new thought, so it starts a new paragraph. */
function splitLines(paragraph: Node): Node[] {
  const lines: Node[][] = [[]]
  for (const child of paragraph.children ?? []) {
    if (child.type !== "text" || !child.value?.includes("\n")) { lines.at(-1)!.push(child); continue }
    child.value.split("\n").forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part) lines.at(-1)!.push({ type: "text", value: part })
    })
  }
  return lines.filter((line) => line.some((node) => node.type !== "text" || node.value!.trim())).map((children) => ({ type: "paragraph", children: trim(children) }))
}

/** Inside a list item, where extra paragraphs would loosen the list, a single newline is a line break. */
function breakLines(paragraph: Node): Node {
  return {
    ...paragraph,
    children: (paragraph.children ?? []).flatMap((child) => child.type === "text" && child.value?.includes("\n")
      ? child.value.split("\n").flatMap((part, index) => [...(index > 0 ? [{ type: "break" }] : []), ...(part ? [{ type: "text", value: part }] : [])])
      : [child]),
  }
}

/** Whether a marker label is the one a run expects next, or opens a run when none is expected. */
function continues(label: string, expected: string | null): boolean {
  return expected ? label === expected : label === "1" || label === "a"
}

function nextLabel(label: string): string {
  return /\d/.test(label) ? String(Number(label) + 1) : String.fromCharCode(label.charCodeAt(0) + 1)
}

/** "Intro: (a) one (b) two" becomes the intro and a two-item list. */
function splitEnumeration(paragraph: Node): Node[] {
  const children = paragraph.children ?? []
  const markers: Array<{ child: number; start: number; end: number; label: string }> = []
  let expected: string | null = null
  children.forEach((child, index) => {
    if (child.type !== "text") return
    for (const match of child.value!.matchAll(MARKER)) {
      const label = match[1]!
      if (!continues(label, expected)) continue
      markers.push({ child: index, start: match.index!, end: match.index! + match[0].length, label })
      expected = nextLabel(label)
    }
  })
  if (markers.length < 2) return [paragraph]
  const segments: Node[][] = [[]]
  children.forEach((child, index) => {
    if (child.type !== "text") { segments.at(-1)!.push(child); return }
    let cursor = 0
    for (const marker of markers.filter((value) => value.child === index)) {
      if (marker.start > cursor) segments.at(-1)!.push({ type: "text", value: child.value!.slice(cursor, marker.start) })
      segments.push([])
      cursor = marker.end
    }
    if (cursor < child.value!.length) segments.at(-1)!.push({ type: "text", value: child.value!.slice(cursor) })
  })
  const [intro, ...items] = segments.map(trim)
  return [...(intro!.length ? [{ type: "paragraph", children: intro }] : []), list(items, markers[0]!.label)]
}

/** Paragraphs that each open with the next marker, "(1) …" then "(2) …", become one list. */
function mergeMarkedParagraphs(children: Node[]): Node[] {
  const result: Node[] = []
  for (let index = 0; index < children.length;) {
    const run: Node[][] = []
    let expected: string | null = null
    for (let at = index; at < children.length; at++) {
      const label = leadingMarker(children[at]!)
      if (!label || !continues(label, expected)) break
      run.push(stripLeadingMarker(children[at]!))
      expected = nextLabel(label)
    }
    if (run.length >= 2) {
      result.push(list(run, leadingMarker(children[index]!)!))
      index += run.length
    } else result.push(children[index++]!)
  }
  return result
}

function leadingMarker(node: Node): string | null {
  const head = node.type === "paragraph" ? node.children?.[0] : undefined
  return head?.type === "text" ? head.value!.match(LEADING_MARKER)?.[1] ?? null : null
}

function stripLeadingMarker(paragraph: Node): Node[] {
  const [head, ...rest] = paragraph.children!
  return trim([{ type: "text", value: head!.value!.replace(LEADING_MARKER, "") }, ...rest])
}

function list(items: Node[][], label: string): Node {
  return {
    type: "list",
    ordered: true,
    start: 1,
    spread: false,
    ...(/[a-z]/.test(label) && { data: { hProperties: { type: "a" } } }),
    children: items.map((children) => ({ type: "listItem", spread: false, checked: null, children: [{ type: "paragraph", children }] })),
  }
}

function trim(nodes: Node[]): Node[] {
  const result = nodes.map((node) => ({ ...node }))
  const head = result[0]
  const tail = result.at(-1)
  if (head?.type === "text") head.value = head.value!.trimStart()
  if (tail?.type === "text") tail.value = tail.value!.trimEnd()
  return result.filter((node) => node.type !== "text" || node.value)
}

function tokenize(text: string, handles: Handles): Node[] {
  const nodes: Node[] = []
  let cursor = 0
  for (const match of text.matchAll(TOKEN)) {
    const value = match.groups!.path ? match[0].replace(/[.,;:)]+$/, "") : match[0]
    const node = tokenNode(match.groups!, value, handles)
    if (!node) continue
    if (match.index! > cursor) nodes.push({ type: "text", value: text.slice(cursor, match.index) })
    nodes.push(node)
    cursor = match.index! + value.length
  }
  if (cursor < text.length) nodes.push({ type: "text", value: text.slice(cursor) })
  return nodes
}

/** A match as its node, or null when its case makes it ordinary prose. */
function tokenNode(groups: Record<string, string | undefined>, value: string, handles: Handles): Node | null {
  if (groups.mention) {
    const sessionId = handles.get(value.slice(1).toLowerCase())
    return token(value, "mention", sessionId ? { dataSessionId: sessionId } : {})
  }
  if (groups.status) return value === value.toUpperCase() ? token(value, "status", { dataTone: STATUS[value]! }) : null
  if (groups.sha) return value === value.toLowerCase() ? token(value, "sha") : null
  return value.length > 1 ? { type: "inlineCode", value } : null
}

function token(value: string, kind: CrewChatToken, properties: Record<string, string> = {}): Node {
  return { type: "text", value, data: { hName: "span", hProperties: { dataCrewToken: kind, ...properties } } }
}

/**
 * The text without the mentions it opens with, when every one names a member
 * the message tagged: the header already says who it is for.
 */
export function stripLeadingMentions(text: string, mentions: readonly string[], handles: Handles): string {
  const lead = text.match(/^(?:[ \t]*@[a-z0-9_-]+[,:]?)+(?:[ \t]+|[ \t]*\n)/i)
  if (!lead) return text
  const named = [...lead[0].matchAll(/@([a-z0-9_-]+)/gi)].map((match) => handles.get(match[1]!.toLowerCase()))
  if (named.some((id) => !id || !mentions.includes(id))) return text
  const rest = text.slice(lead[0].length)
  return rest.trim() ? rest : text
}

export type CrewChatRole = "lead" | "user" | "agent"

/** Low-chroma hues, clear of the status greens, ambers and reds, ordered so neighbours differ most. */
const HUES = [255, 330, 185, 290, 210, 350, 232, 310]

function tint(hue: number): CSSProperties {
  const color = `oklch(0.64 0.14 ${hue})`
  return { color: `color-mix(in oklch, ${color} 78%, var(--foreground))`, backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)` }
}

/**
 * Each member's colour, the same on its avatar, its mentions and its row:
 * members take the hues in the order they joined, so a crew's first eight
 * never share one.
 */
export function crewChatTints(members: readonly Pick<CrewChatMember, "sessionId">[], rootId: string): Map<string, CSSProperties> {
  return new Map(members.filter((member) => member.sessionId !== rootId).map((member, index) => [member.sessionId, tint(HUES[index % HUES.length]!)]))
}

/** A member's colour, or for an author no longer in the crew one picked from its id. */
export function crewMemberTint(sessionId: string, tints: ReadonlyMap<string, CSSProperties>): CSSProperties {
  const known = tints.get(sessionId)
  if (known) return known
  let hash = 2166136261
  for (let index = 0; index < sessionId.length; index++) hash = Math.imul(hash ^ sessionId.charCodeAt(index), 16777619)
  return tint(HUES[(hash >>> 0) % HUES.length]!)
}

export interface CrewChatRun {
  role: CrewChatRole
  /** Members the run's messages tagged. */
  recipients: string[]
  /** Set on the first run of a day. */
  day?: number
  messages: CrewChatMessage[]
}

/** Authors who post again within this long keep one header. */
const CREW_CHAT_RUN_MS = 5 * 60_000

/** Messages in a row from one author to the same people, close together and on one day, share a header. */
export function crewChatRuns(messages: readonly CrewChatMessage[], rootId: string): CrewChatRun[] {
  const runs: CrewChatRun[] = []
  let previous: { author: string; recipients: string; day: number; at: number } | null = null
  for (const message of messages) {
    const author = message.author.kind === "user" ? `user:${message.author.name}` : `agent:${message.author.sessionId ?? message.author.name}`
    const recipients = [...message.mentions].sort().join(",")
    const day = new Date(message.createdAt).setHours(0, 0, 0, 0)
    if (previous && previous.author === author && previous.recipients === recipients && previous.day === day && message.createdAt - previous.at < CREW_CHAT_RUN_MS) {
      runs.at(-1)!.messages.push(message)
    } else {
      runs.push({
        role: message.author.kind === "user" ? "user" : message.author.sessionId === rootId ? "lead" : "agent",
        recipients: message.mentions,
        ...(previous?.day !== day && { day }),
        messages: [message],
      })
    }
    previous = { author, recipients, day, at: message.createdAt }
  }
  return runs
}

export interface GitHubReference { kind: "pull" | "issue" | "commit"; label: string }

/** A GitHub pull request, issue or commit URL, as `repo#123` or `repo@abc1234`. */
export function gitHubReference(href: string): GitHubReference | null {
  const match = href.match(/^https?:\/\/github\.com\/[^/\s]+\/([^/\s]+)\/(pull|issues|commit)\/([0-9a-f]+)(?:[/?#].*)?$/i)
  if (!match) return null
  const [, repo, kind, id] = match
  if (kind === "commit") return { kind: "commit", label: `${repo}@${id!.slice(0, 7)}` }
  return /^\d+$/.test(id!) ? { kind: kind === "pull" ? "pull" : "issue", label: `${repo}#${id}` } : null
}

/** A bare URL without its scheme, `www.` or trailing slash. */
export function displayUrl(href: string): string {
  return href.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")
}
