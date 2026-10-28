// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

vi.mock("node:os", async importOriginal => ({
  ...await importOriginal<typeof import("node:os")>(), homedir: () => root,
}))

import { isAllowedCommandPath, listSlashSuggestions, prepareSlashPrompt } from "../../agents/slashCommands"

let root: string
let project: string
async function write(path: string, content: string) {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, content)
}
async function skill(directory: string, name: string, description = name) {
  const path = join(directory, name, "SKILL.md")
  await write(path, `---\nname: ${name}\ndescription: ${description}\n---\n\nFollow these instructions.`)
  return path
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-slash-"))
  project = join(root, "project")
  vi.stubEnv("CODEX_HOME", join(root, "custom-codex-home"))
  vi.stubEnv("COPILOT_HOME", join(root, "custom-copilot-home"))
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

describe("provider slash discovery and invocation", () => {
  it("uses each provider's configured home without exposing another provider's entries", async () => {
    await skill(join(root, "custom-codex-home", "skills"), "codex-only")
    await skill(join(root, "custom-copilot-home", "skills"), "copilot-only")
    expect((await listSlashSuggestions("codex")).filter(item => item.type === "skill").map(item => item.name)).toEqual(["codex-only"])
    expect((await listSlashSuggestions("copilot")).filter(item => item.type === "skill").map(item => item.name)).toEqual(["copilot-only"])
    expect(await listSlashSuggestions("acp")).toEqual([])
  })

  it("finds shared and system skills and gives project skills precedence", async () => {
    await skill(join(root, ".agents", "skills"), "shared")
    await skill(join(root, "custom-codex-home", "skills", ".system"), "system")
    await skill(join(root, "custom-codex-home", "skills"), "review", "User review")
    const projectPath = await skill(join(project, ".agents", "skills"), "review", "Project review")
    const items = await listSlashSuggestions("codex", project)
    expect(items.filter(item => item.type === "skill").map(item => item.name).sort()).toEqual(["review", "shared", "system"])
    expect(items.find(item => item.name === "review")).toMatchObject({ source: "project", description: "Project review", filePath: projectPath })
  })

  it("finds Copilot project skills in .github and shared skills in .agents", async () => {
    await skill(join(project, ".github", "skills"), "review")
    await skill(join(project, ".agents", "skills"), "shared")
    expect((await listSlashSuggestions("copilot", project)).filter(item => item.type === "skill").map(item => item.name).sort()).toEqual(["review", "shared"])
  })

  it("expands Codex prompt commands and preserves their arguments", async () => {
    await write(join(root, "custom-codex-home", "prompts", "review.md"), "---\ndescription: Review changes\n---\nReview $ARGUMENTS")
    expect(await listSlashSuggestions("codex")).toContainEqual(expect.objectContaining({ name: "prompts:review", type: "command", description: "Review changes" }))
    expect(await prepareSlashPrompt("codex", "/prompts:review staged files")).toEqual({ message: "Review staged files" })
  })

  it("resolves an explicit Codex skill to its native name and exact path", async () => {
    const path = await skill(join(project, ".codex", "skills"), "review")
    expect(await prepareSlashPrompt("codex", "/review inspect changes", project)).toEqual({
      message: "$review inspect changes", skill: { name: "review", path },
    })
  })

  it("resolves a Copilot skill without sending a terminal-only slash command", async () => {
    const path = await skill(join(project, ".github", "skills"), "review")
    const prompt = await prepareSlashPrompt("copilot", "/review inspect changes", project)
    expect(prompt.skill).toEqual({ name: "review", path })
    expect(prompt.message).toContain(JSON.stringify(path))
    expect(prompt.message).toContain("inspect changes")
    expect(prompt.message).not.toMatch(/^\//)
  })

  it("leaves ordinary messages, unknown commands, absolute paths and native Claude commands intact", async () => {
    for (const message of ["hello", "/unknown with arguments", "/tmp/project/file", undefined]) {
      expect(await prepareSlashPrompt("codex", message, project)).toEqual({ message })
    }
    expect(await prepareSlashPrompt("claude", "/compact", project)).toEqual({ message: "/compact" })
  })

  it("validates expansion paths against the selected provider", () => {
    expect(isAllowedCommandPath(join(root, "custom-codex-home", "prompts", "review.md"), "codex")).toBe(true)
    expect(isAllowedCommandPath(join(project, ".github", "skills", "review", "SKILL.md"), "copilot")).toBe(true)
    expect(isAllowedCommandPath(join(project, ".copilot", "skills", "review", "SKILL.md"), "codex")).toBe(false)
    expect(isAllowedCommandPath(join(project, ".github", "README.md"), "copilot")).toBe(false)
  })

  it.each(["codex", "copilot"] as const)("lists /usage for %s and never forwards it as a model prompt", async kind => {
    expect(await listSlashSuggestions(kind)).toContainEqual(expect.objectContaining({ name: "usage", type: "command", source: "built-in", filePath: "" }))
    await expect(prepareSlashPrompt(kind, "/usage")).rejects.toThrow("workspace command")
  })
})
