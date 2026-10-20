// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createClaudeStore } from "../../agents/claudeStore"
import { resolveProcessOwner, taskOutputOwner } from "../../agents/processOwnership"

const SESSION = "58479731-3c68-489f-8327-bbad21533d66"
const PROJECT = "-Users-gentritbiba-Insync-gentritbiba1-gmail-com-Google-Drive-Code-Git-honest-cms"
const OUTPUT = `/private/tmp/claude-501/${PROJECT}/${SESSION}/tasks/bt3fj0wjf.output`
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe("process session evidence", () => {
  it("resolves an old originating session from a deleted open task output, independently of recent sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "cogpit-process-owner-"))
    roots.push(root)
    await mkdir(join(root, PROJECT))
    await writeFile(join(root, PROJECT, `${SESSION}.jsonl`), [
      { type: "custom-title", customTitle: "HonestCMS code bloat cleanup", sessionId: SESSION },
      { type: "user", sessionId: SESSION, cwd: "/project", message: { content: "Extract makeChain into queryChain" } },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n")
    expect(await resolveProcessOwner([`${OUTPUT} (deleted)`, OUTPUT], [createClaudeStore(root)])).toEqual({
      sessionId: SESSION, taskId: "bt3fj0wjf", title: "HonestCMS code bloat cleanup", dirName: PROJECT, fileName: `${SESSION}.jsonl`,
    })
  })

  it("keeps proven session IDs when transcripts are unavailable and refuses ambiguous or guessed ownership", async () => {
    expect(await resolveProcessOwner([OUTPUT], [])).toEqual({ sessionId: SESSION, taskId: "bt3fj0wjf" })
    expect(taskOutputOwner([OUTPUT, OUTPUT.replace(SESSION, "11111111-1111-4111-8111-111111111111")])).toBeUndefined()
    expect(taskOutputOwner(["/Users/me/project", "/tmp/unrelated.output"])).toBeUndefined()
    expect(taskOutputOwner([OUTPUT.replace(PROJECT, "..")])).toBeUndefined()
  })
})
