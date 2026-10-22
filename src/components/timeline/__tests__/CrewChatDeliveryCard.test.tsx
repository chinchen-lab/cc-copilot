import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { formatCrewChatDelivery, type CrewChatMessage, type CrewChatPage } from "../../../../shared/contracts/crewChat"
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authFetch: mocks.fetch }))
import { UserMessage } from "../UserMessage"
import { crewChatDeliverySummary } from "@/lib/userMessageContent"

const message: CrewChatMessage = {
  sequence: 7, id: "m-7", rootId: "root-a", mentions: ["root-a"], createdAt: 0,
  author: { kind: "agent", sessionId: "s-ds", name: "studio-ds" },
  text: "@lead M1 ds promoted at d38028166; tests PASS",
}
const page = (messages: CrewChatMessage[], rootId = "root-a"): CrewChatPage => ({
  rootId, canPost: true, nextCursor: 7, hasMore: false, messages,
  members: [{ sessionId: rootId, name: "Lead", handle: "lead", listening: true, canInteract: true }, { sessionId: "s-ds", name: "studio-ds", handle: "studio-ds", listening: true, canInteract: true }],
})
const delivery = (mentioned: boolean, rootId = "root-a") => formatCrewChatDelivery({ ...message, rootId }, mentioned, `cogpit-session chat fetch '${rootId}' --after 6`, `cogpit-session chat post "YOUR_MESSAGE" --crew '${rootId}'`)

beforeEach(() => { mocks.fetch.mockReset().mockImplementation(async (url: string) => ({ ok: true, json: async () => page(url.includes("after=") ? [message] : [], decodeURIComponent(url.split("/api/crew-chat/")[1]!.split("?")[0]!)) })) })
afterEach(cleanup)

describe("crew chat deliveries in the timeline", () => {
  it("shows a tagged delivery as its author's chat message instead of the prompt text", async () => {
    render(<UserMessage content={delivery(true)} timestamp="" compact />)
    const card = screen.getByRole("article", { name: "Crew chat message from studio-ds" })
    expect(card).toHaveTextContent("M1 ds promoted at d38028166; tests PASS")
    expect(card).not.toHaveTextContent("You were tagged")
    await waitFor(() => expect(card).toHaveTextContent("studio-dsToLead"))
    expect(card).not.toHaveTextContent("@lead")
  })

  it("keeps a notice to one line and fetches the message only when asked", async () => {
    render(<UserMessage content={delivery(false, "root-b")} timestamp="" compact />)
    const card = screen.getByRole("article", { name: "Crew chat message from studio-ds" })
    expect(card).toHaveTextContent("studio-dsposted in crew chat")
    expect(card).not.toHaveTextContent("tests PASS")
    fireEvent.click(screen.getByRole("button", { name: "Show message" }))
    await waitFor(() => expect(card).toHaveTextContent("tests PASS"))
    expect(mocks.fetch).toHaveBeenCalledWith("/api/crew-chat/root-b?after=6&limit=1")
  })

  it("still offers the raw prompt", () => {
    render(<UserMessage content={delivery(true, "root-c")} timestamp="" compact />)
    fireEvent.click(screen.getByRole("button", { name: "Show raw" }))
    expect(screen.queryByRole("article")).toBeNull()
    expect(document.body).toHaveTextContent("You were tagged in this message")
  })

  it("summarizes deliveries in one line", () => {
    expect(crewChatDeliverySummary(delivery(true))).toBe("studio-ds in crew chat: M1 ds promoted at d38028166; tests PASS")
    expect(crewChatDeliverySummary(delivery(false))).toBe("studio-ds posted in crew chat")
    expect(crewChatDeliverySummary("Fix the tests")).toBeNull()
  })
})
