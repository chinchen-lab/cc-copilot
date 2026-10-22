import { describe, expect, it } from "vitest"
import { formatTaskAttention, formatTaskWakeup, isTaskWakeup, parseTaskAttention, parseTaskWakeup } from "../../../shared/contracts/taskWakeup"

const task = { id: "task-1", parentSessionId: "parent", childSessionId: "child", state: "completed" as const }

describe("task wakeup", () => {
  it("reads back the result it was written with", () => {
    const result = { turn: { reply: "Done.\nAll green." }, filesChanged: [{ path: "a.ts" }] }
    expect(parseTaskWakeup(formatTaskWakeup({ ...task, result }))).toEqual({ taskId: "task-1", state: "completed", childSessionId: "child", result })
  })

  it("keeps a result cut to fit as text", () => {
    const parsed = parseTaskWakeup(formatTaskWakeup({ ...task, state: "error", result: { reply: "x".repeat(30000) } }))
    expect(parsed?.state).toBe("error")
    expect(typeof parsed?.result).toBe("string")
  })

  it("leaves out the prompt the parent wrote itself", () => {
    const result = { sessionId: "child", turn: { index: 0, userMessage: "Your task: ".repeat(500), reply: "Done." }, filesChanged: [] }
    expect(parseTaskWakeup(formatTaskWakeup({ ...task, result }))?.result).toEqual({ sessionId: "child", turn: { index: 0, reply: "Done." }, filesChanged: [] })
  })

  it("shortens a long reply so the result still reads as a whole, and says where the rest is", () => {
    const result = { turn: { reply: "line\n".repeat(10000) }, filesChanged: [{ path: "a.ts" }] }
    const wakeup = formatTaskWakeup({ ...task, result })
    expect(wakeup.length).toBeLessThan(25000)
    const parsed = parseTaskWakeup(wakeup)?.result as { turn: { reply: string }; filesChanged: unknown[] }
    expect(parsed.filesChanged).toEqual([{ path: "a.ts" }])
    expect(parsed.turn.reply.startsWith("line\nline\n")).toBe(true)
    expect(parsed.turn.reply.endsWith("[cut to fit; read it all with cogpit-session result child]")).toBe(true)
  })

  it("keeps a short reply whole when the changed-file list alone is too long, listing the paths that fit", () => {
    const filesChanged = Array.from({ length: 600 }, (_, i) => ({ path: `src/features/module-${i}/components/really/deep/path/Component${i}.tsx`, type: "edit", additions: 12, deletions: 3 }))
    const result = { turn: { reply: "Done, but the migration still needs a manual run." }, filesChanged }
    const wakeup = formatTaskWakeup({ ...task, result })
    expect(wakeup.length).toBeLessThan(25000)
    const parsed = parseTaskWakeup(wakeup)?.result as { turn: { reply: string }; filesChanged: { path: string }[]; filesChangedOmitted: number }
    expect(parsed.turn.reply).toBe("Done, but the migration still needs a manual run.")
    expect(parsed.filesChanged[0]).toEqual({ path: filesChanged[0]!.path })
    expect(parsed.filesChanged.length + parsed.filesChangedOmitted).toBe(600)
    expect(parsed.filesChangedOmitted).toBeGreaterThan(0)
  })

  it("keeps a short reply whole when the file list alone almost fills the result", () => {
    const entry = (path: string) => ({ path, type: "edit", additions: 12, deletions: 3 })
    const size = (files: unknown[]) => JSON.stringify({ turn: { reply: "" }, filesChanged: files }).length
    const filesChanged = []
    while (size([...filesChanged, entry("src/features/module/Component.tsx")]) < 23_800) filesChanged.push(entry(`src/features/module-${filesChanged.length}/Component.tsx`))
    filesChanged.push(entry("x".repeat(23_980 - size([...filesChanged, entry("")]))))
    expect(size(filesChanged)).toBe(23_980)
    const reply = "Done, but the migration still needs a manual run."
    const parsed = parseTaskWakeup(formatTaskWakeup({ ...task, result: { turn: { reply }, filesChanged } }))?.result as { turn: { reply: string }; filesChanged: unknown[]; filesChangedOmitted?: number }
    expect(parsed.turn.reply).toBe(reply)
    expect(parsed.filesChanged.length + (parsed.filesChangedOmitted ?? 0)).toBe(filesChanged.length)
  })

  it("ignores ordinary prompts", () => {
    expect(parseTaskWakeup("Delegated task looks fine, carry on")).toBeNull()
    expect(isTaskWakeup("Delegated task looks fine, carry on")).toBe(false)
  })

  it("recognizes a wakeup from its opening alone", () => {
    expect(isTaskWakeup(formatTaskWakeup({ ...task, result: null }).slice(0, 120))).toBe(true)
  })

  it("writes an attention prompt that names the child and is not mistaken for a result", () => {
    const text = formatTaskAttention(task, "It is waiting on you.", ["cogpit-session answer child --request q-1 \"<answer>\""])
    expect(text).toBe("Delegated task task-1 needs attention. Child session: child. It is waiting on you.\ncogpit-session answer child --request q-1 \"<answer>\"")
    expect(isTaskWakeup(text)).toBe(true)
    expect(parseTaskAttention(text)).toEqual({ childSessionId: "child" })
    expect(parseTaskWakeup(text)).toBeNull()
    expect(parseTaskAttention(formatTaskWakeup({ ...task, result: null }))).toBeNull()
  })
})
