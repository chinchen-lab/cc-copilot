import { BUILTIN_SKILLS } from "./claudeCommands"
import { AGENT_KINDS, descriptorFor, descriptorForDirName, type AgentKind } from "../../shared/session/agent-descriptors"
import { agentHomeDir } from "../config"
import { AgentRuntimeError } from "./runtimeTypes"
import { readdir, readFile } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { homedir } from "node:os"
import type { SlashSuggestion } from "../../shared/contracts/projectTools"

/** Parse YAML frontmatter from a markdown file's content */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":")
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "")
      if (key && val) result[key] = val
    }
  }
  return result
}

/** Scan a skills directory (contains subdirs each with a SKILL.md) */
async function scanSkillsDir(
  dir: string,
  source: "project" | "user",
  depth = 0,
): Promise<SlashSuggestion[]> {
  const results: SlashSuggestion[] = []
  try {
    const entries = await readdir(dir)
    for (const entry of entries) {
      const skillMdPath = join(dir, entry, "SKILL.md")
      try {
        const content = await readFile(skillMdPath, "utf-8")
        const fm = parseFrontmatter(content)
        results.push({
          name: fm.name || entry,
          description: fm.description || "",
          type: "skill",
          source,
          filePath: skillMdPath,
        })
      } catch {
        if (entry === ".system" && depth === 0) results.push(...await scanSkillsDir(join(dir, entry), source, depth + 1))
      }
    }
  } catch {
    // directory doesn't exist
  }
  return results
}

/** Publishers whose plugins are considered built-in to Claude Code */
const BUILTIN_PUBLISHERS = new Set([
  "claude-plugins-official",
])

/**
 * Scan a directory for .md files and return a suggestion for each.
 * `nameFn` derives the suggestion name from the frontmatter and filename.
 */
async function scanMdFiles(
  dir: string,
  type: "command" | "skill",
  source: string,
  nameFn: (fm: Record<string, string>, file: string) => string,
): Promise<SlashSuggestion[]> {
  const results: SlashSuggestion[] = []
  try {
    const files = await readdir(dir)
    for (const file of files) {
      if (!file.endsWith(".md")) continue
      const filePath = join(dir, file)
      try {
        const content = await readFile(filePath, "utf-8")
        const fm = parseFrontmatter(content)
        results.push({
          name: nameFn(fm, file),
          description: fm.description || "",
          type,
          source,
          filePath,
        })
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // directory doesn't exist
  }
  return results
}

export const DEFAULT_SLASH_AGENT = descriptorForDirName(null).kind

export function slashAgentKind(value: unknown): AgentKind | null {
  return value == null ? DEFAULT_SLASH_AGENT : AGENT_KINDS.find(kind => kind === value) ?? null
}

/** Scan installed plugins for skills, commands, and agents */
async function scanPluginSkills(kind: AgentKind): Promise<SlashSuggestion[]> {
  const { pluginsDir: directory } = descriptorFor(kind).config
  if (!directory) return []
  const pluginsDir = join(agentHomeDir(kind), directory)
  const installedPath = join(pluginsDir, "installed_plugins.json")

  let data: Record<string, unknown>
  try {
    const raw = await readFile(installedPath, "utf-8")
    data = JSON.parse(raw)
  } catch {
    return [] // installed_plugins.json doesn't exist
  }

  const plugins = (data.plugins || {}) as Record<string, Array<{ installPath: string }>>
  const results: SlashSuggestion[] = []

  for (const [pluginKey, installList] of Object.entries(plugins)) {
    if (!installList.length) continue
    const installPath = installList[0].installPath

    // Derive display name and publisher from key (e.g. "superpowers@superpowers-dev")
    const [pluginDisplayName, publisher = ""] = pluginKey.split("@")
    const source = BUILTIN_PUBLISHERS.has(publisher) ? "built-in" : pluginDisplayName
    const nameFromFm = (fm: Record<string, string>, file: string) =>
      fm.name || file.replace(/\.md$/, "")
    // Both skills and commands are invoked as "plugin:name", so two plugins
    // shipping the same name stay distinguishable.
    const qualify = (name: string) => `${pluginDisplayName}:${name}`

    // Skills: each subdirectory contains a SKILL.md
    const skillsDir = join(installPath, "skills")
    try {
      const skillDirs = await readdir(skillsDir)
      for (const skillDir of skillDirs) {
        const skillMdPath = join(skillsDir, skillDir, "SKILL.md")
        try {
          const content = await readFile(skillMdPath, "utf-8")
          const fm = parseFrontmatter(content)
          results.push({
            name: qualify(fm.name || skillDir),
            description: fm.description || "",
            type: "skill",
            source,
            filePath: skillMdPath,
          })
        } catch {
          // no SKILL.md in this directory
        }
      }
    } catch {
      // no skills directory
    }

    // Agents: skip built-in publishers (their agents back the hardcoded BUILTIN_SKILLS)
    if (!BUILTIN_PUBLISHERS.has(publisher)) {
      const agentSuggestions = await scanMdFiles(
        join(installPath, "agents"), "skill", source, nameFromFm,
      )
      results.push(...agentSuggestions)
    }

    const cmdSuggestions = await scanMdFiles(
      join(installPath, "commands"), "command", source,
      (fm, file) => qualify(nameFromFm(fm, file)),
    )
    results.push(...cmdSuggestions)
  }

  return results
}

/** Check if a file path is safe to read (inside the agent's config directory, .md extension) */
export function isAllowedCommandPath(filePath: string, kind: AgentKind = DEFAULT_SLASH_AGENT): boolean {
  const resolved = resolve(filePath)
  if (!resolved.endsWith(".md")) return false
  const layout = descriptorFor(kind).config
  const root = agentHomeDir(kind)
  if (resolved.startsWith(`${root}${sep}`)) return true
  if (resolved.includes(`${sep}${layout.rootDirName}${sep}`)) return true
  return resolved.includes(`${sep}.agents${sep}skills${sep}`)
    || (kind === "copilot" && resolved.includes(`${sep}.github${sep}skills${sep}`))
}

/** Expand a command file: strip frontmatter, replace $ARGUMENTS */
export async function expandCommand(
  filePath: string,
  args: string,
): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8")
    // Strip frontmatter
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
    // Replace $ARGUMENTS placeholder
    return body.replace(/\$ARGUMENTS/g, args)
  } catch {
    return null
  }
}

/** Per-provider discovery, shared by the palette and explicit invocation. */
export async function listSlashSuggestions(kind: AgentKind, cwd = ""): Promise<SlashSuggestion[]> {
  const descriptor = descriptorFor(kind)
  if (!descriptor.capabilities.slashCommands) return []
  const layout = descriptor.config
  const globalRoot = agentHomeDir(kind)
  const skillRoots: Array<{ dir: string; source: "user" | "project" }> = [
    ...(kind !== "claude" ? [{ dir: join(homedir(), ".agents", "skills"), source: "user" as const }] : []),
    ...(layout.skillsDir ? [{ dir: join(globalRoot, layout.skillsDir), source: "user" as const }] : []),
    ...(cwd ? [
      ...(kind !== "claude" ? [{ dir: join(cwd, ".agents", "skills"), source: "project" as const }] : []),
      ...(kind === "copilot" ? [{ dir: join(cwd, ".github", "skills"), source: "project" as const }] : []),
      ...(layout.skillsDir ? [{ dir: join(cwd, layout.rootDirName, layout.skillsDir), source: "project" as const }] : []),
    ] : []),
  ]
  const commandName = (_fm: Record<string, string>, file: string) =>
    `${kind === "codex" ? "prompts:" : ""}${file.replace(/\.md$/, "")}`
  const [userCommands, projectCommands, skills, plugins] = await Promise.all([
    layout.commandsDir ? scanMdFiles(join(globalRoot, layout.commandsDir), "command", "user", commandName) : [],
    layout.commandsDir && cwd ? scanMdFiles(join(cwd, layout.rootDirName, layout.commandsDir), "command", "project", commandName) : [],
    Promise.all(skillRoots.map(({ dir, source }) => scanSkillsDir(dir, source))),
    scanPluginSkills(kind),
  ])
  const commands = new Map<string, SlashSuggestion>()
  const skillMap = new Map<string, SlashSuggestion>()
  for (const item of kind === "claude" ? BUILTIN_SKILLS : []) skillMap.set(item.name, item)
  for (const item of [...userCommands, ...projectCommands]) commands.set(item.name, item)
  for (const items of skills) for (const item of items) skillMap.set(item.name, item)
  for (const command of descriptor.composerCommands ?? []) {
    commands.set(command.name, { name: command.name, description: command.description, type: "command", source: "built-in", filePath: "" })
    skillMap.delete(command.name)
  }
  return [...commands.values(), ...skillMap.values(), ...plugins]
}

export interface SlashPrompt {
  message: string | undefined
  skill?: { name: string; path: string }
}

/** Terminal menus are not parsed by the RPC transports: resolve file-backed
 * commands and explicitly selected skills before sending a turn. */
export async function prepareSlashPrompt(kind: AgentKind, message: string | undefined, cwd?: string): Promise<SlashPrompt> {
  if (kind === "claude" || !message?.startsWith("/")) return { message }
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(message)
  if (!match) return { message }
  if (descriptorFor(kind).composerCommands?.some(command => command.name === match[1])) {
    throw new AgentRuntimeError(400, "INVALID_REQUEST", `/${match[1]} is a workspace command. Run it from the conversation composer.`)
  }
  const suggestion = (await listSlashSuggestions(kind, cwd)).find(item => item.name === match[1])
  if (!suggestion?.filePath) return { message }
  const args = match[2] ?? ""
  if (suggestion.type === "command") {
    const expanded = await expandCommand(suggestion.filePath, args)
    if (expanded === null) throw new Error(`Command file not found: ${suggestion.name}`)
    return { message: expanded }
  }
  const skill = { name: suggestion.name, path: suggestion.filePath }
  return {
    skill,
    message: kind === "codex" ? `$${skill.name}${args ? ` ${args}` : ""}`
      : `Use the "${skill.name}" skill. Read and follow the instructions in ${JSON.stringify(skill.path)}.${args ? `\n\n${args}` : ""}`,
  }
}
