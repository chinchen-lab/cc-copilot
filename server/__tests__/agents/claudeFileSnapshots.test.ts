// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readClaudeFileSnapshot } from "../../agents/claudeFileSnapshots"

const cwd = "/repo"
const record = (value: unknown) => JSON.stringify(value)
function snapshot(path: string, backupFileName: string | null) {
  return record({ type: "file-history-snapshot", snapshot: { trackedFileBackups: { [path]: { backupFileName, version: 1 } } } })
}
function call(id: string, name: string, input: object, isError = false) {
  return [
    record({ type: "assistant", uuid: `a-${id}`, cwd, timestamp: "2026-01-01T00:00:00Z", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } }),
    record({ type: "user", uuid: `r-${id}`, cwd, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "done", is_error: isError }] } }),
  ].join("\n")
}
const prompt = record({ type: "user", uuid: "u", cwd, message: { role: "user", content: "edit the file" } })

describe("historical file snapshots", () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "file-snapshots-"))
    await mkdir(join(root, "file-history", "session"), { recursive: true })
    await mkdir(join(root, "projects"))
    await writeFile(join(root, "file-history", "session", "hash@v1"), "header\nold\nfooter\n")
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })
  const load = (root: string, text: string, path = "/repo/src/a.ts") => readClaudeFileSnapshot(join(root, "projects"), "session", text, path)

  it("normalizes absolute/relative paths and replays every successful edit on the earliest backup", async () => {
    await writeFile(join(root, "file-history", "session", "hash@v2"), "header\nintermediate\nfooter\n")
    const text = [prompt, snapshot("src/a.ts", "hash@v1"),
      call("one", "Edit", { file_path: "/repo/src/a.ts", old_string: "old", new_string: "intermediate" }),
      snapshot("src/a.ts", "hash@v2"),
      call("two", "Edit", { file_path: "src/a.ts", old_string: "intermediate", new_string: "final" }),
      call("failed", "Edit", { file_path: "src/a.ts", old_string: "final", new_string: "wrong" }, true),
    ].join("\n")
    expect(await load(root, text)).toEqual({ before: "header\nold\nfooter\n", after: "header\nfinal\nfooter\n" })
    expect(await load(root, text, "src/a.ts")).toEqual(await load(root, text))
  })

  it("handles new and empty files without mistaking an empty snapshot for missing data", async () => {
    const text = [prompt, snapshot("src/a.ts", null), call("new", "Write", { file_path: "src/a.ts", content: "" })].join("\n")
    expect(await load(root, text)).toEqual({ before: "", after: "" })
  })

  it("supports replace_all and literal dollar patterns", async () => {
    await writeFile(join(root, "file-history", "session", "hash@v1"), "old old")
    const text = [prompt, snapshot("/repo/src/a.ts", "hash@v1"), call("all", "Edit", { file_path: "src/a.ts", old_string: "old", new_string: "$&", replace_all: true })].join("\n")
    expect(await load(root, text)).toEqual({ before: "old old", after: "$& $&" })
  })

  it("falls back when replay cannot be proven or backups have expired", async () => {
    const text = [prompt, snapshot("src/a.ts", "hash@v1"), call("bad", "Edit", { file_path: "src/a.ts", old_string: "missing", new_string: "x" })].join("\n")
    expect(await load(root, text)).toBeNull()
    expect(await load(root, [prompt, snapshot("src/a.ts", "expired"), call("write", "Write", { file_path: "src/a.ts", content: "x" })].join("\n"))).toBeNull()
  })

  it("rejects traversal, symlink escapes, oversized and binary backups", async () => {
    const text = (backup: string) => [prompt, snapshot("src/a.ts", backup), call("write", "Write", { file_path: "src/a.ts", content: "x" })].join("\n")
    expect(await load(root, text("../../secret"))).toBeNull()
    await writeFile(join(root, "secret"), "private")
    await symlink(join(root, "secret"), join(root, "file-history", "session", "escape"))
    expect(await load(root, text("escape"))).toBeNull()
    await writeFile(join(root, "file-history", "session", "large"), "x".repeat(2 * 1024 * 1024 + 1))
    expect(await load(root, text("large"))).toBeNull()
    await writeFile(join(root, "file-history", "session", "binary"), "a\0b")
    expect(await load(root, text("binary"))).toBeNull()
  })

  it("ignores malformed records and does not invent snapshots for untracked files", async () => {
    expect(await load(root, ["broken json", prompt, snapshot("other.ts", "hash@v1")].join("\n"))).toBeNull()
  })
})
