// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { expect, it } from "vitest"
import { OrchestrationStore } from "../../orchestration/store"

it("migrates a version 3 database and persists history, subscriptions, cursors and pending deliveries", () => {
  const root = mkdtempSync(join(tmpdir(), "cogpit-chat-store-"))
  const path = join(root, "state.sqlite")
  const legacy = new DatabaseSync(path)
  legacy.exec("PRAGMA user_version=3")
  legacy.close()
  let store = new OrchestrationStore(path)
  try {
    const message = store.postChat("owner", "persistent-chat-001", { rootId: "lead", author: { kind: "agent", name: "Parser", sessionId: "parser" }, text: "Finding", mentions: ["review"] }, [{ sessionId: "review", kind: "mention" }])
    store.setChatListening("lead", "review", false)
    store.setChatCursor("lead", "review", message.sequence)
    store.close()
    store = new OrchestrationStore(path)
    expect(store.chatMessages("lead", { limit: 100 })).toEqual([message])
    expect(store.chatListener("lead", "review")).toEqual({ listening: false, cursor: message.sequence })
    expect(store.chatDeliveries("lead", "owner")).toEqual([expect.objectContaining({ sessionId: "review", kind: "mention", state: "pending" })])
    expect(store.chatDeliveries("lead", "other-owner")).toEqual([])
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})
