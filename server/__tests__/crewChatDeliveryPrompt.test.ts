// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getSessionMeta } from "../sessionMetadata"
import { formatCrewChatDelivery, isCrewChatDelivery, parseCrewChatDelivery, type CrewChatMessage } from "../../shared/contracts/crewChat"

const message: CrewChatMessage = {
  sequence: 435, id: "m-435", rootId: "root-1", mentions: ["root-1"], createdAt: 0,
  author: { kind: "agent", sessionId: "s-ds", name: "Admin v2 · F1 studio foundation" },
  text: "@lead M1 ds promoted at d38028166.\n\nThis is a crew message. Quoted by the author.\n\nStories: studio.tsx",
}
const fetch = "cogpit-session chat fetch 'root-1' --device 'Mac' --after 434"
const reply = `cogpit-session chat post "YOUR_MESSAGE" --crew 'root-1'`

describe("crew chat delivery prompts", () => {
  it("reads a tagged delivery back into its author, number, crew and whole message", () => {
    expect(parseCrewChatDelivery(formatCrewChatDelivery(message, true, fetch, reply))).toEqual({ author: "Admin v2 · F1 studio foundation", sequence: 435, rootId: "root-1", text: message.text })
  })

  it("reads a notice, which carries no message", () => {
    const notice = formatCrewChatDelivery(message, false, fetch, reply)
    expect(isCrewChatDelivery(notice)).toBe(true)
    expect(parseCrewChatDelivery(notice)).toEqual({ author: "Admin v2 · F1 studio foundation", sequence: 435, rootId: "root-1", text: null })
  })

  it("leaves other prompts alone", () => {
    expect(isCrewChatDelivery("Crew chat is great")).toBe(false)
    expect(parseCrewChatDelivery("Crew chat · Lead · message 3\nSomething else entirely")).toBeNull()
  })
})

describe("session previews", () => {
  const dirs: string[] = []
  afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

  it("never shows a crew chat delivery as the session's latest prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cogpit-crew-meta-"))
    dirs.push(dir)
    const line = (text: string, timestamp: string) => ({ type: "user", sessionId: "s1", cwd: "/tmp/proj", timestamp, message: { role: "user", content: [{ type: "text", text }] } })
    const filePath = join(dir, "session.jsonl")
    await writeFile(filePath, [
      line("ship the admin studio foundation", "2026-10-14T10:00:00Z"),
      line(formatCrewChatDelivery(message, true, fetch, reply), "2026-10-14T10:00:05Z"),
      line(formatCrewChatDelivery(message, false, fetch, reply), "2026-10-14T10:00:06Z"),
    ].map((value) => JSON.stringify(value)).join("\n") + "\n")
    expect((await getSessionMeta(filePath)).lastUserMessage).toBe("ship the admin studio foundation")
  })
})
