import { execFile } from "node:child_process"
import { readdir, realpath } from "node:fs/promises"
import { resolve } from "node:path"
import type { ProjectTreeEntry } from "../../shared/contracts/projectTools"
import { isWithinDir } from "../helpers"

export const IGNORED_PROJECT_DIRECTORIES = new Set([
  ".git", ".next", ".nuxt", ".output", ".turbo", ".vercel",
  "build", "coverage", "dist", "node_modules", "target",
])

export class ProjectDirectoryError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** check-ignore honours tracked files, nested ignore files and repository excludes. */
function ignoredPaths(root: string, paths: string[]): Promise<Set<string> | null> {
  if (paths.length === 0) return Promise.resolve(new Set())
  return new Promise((done) => {
    const child = execFile("git", ["check-ignore", "--stdin", "-z"], {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 10_000,
      windowsHide: true,
    }, (error, stdout) => {
      // Exit 1 means none of the supplied paths are ignored. Other failures
      // (including a non-git project) use the filesystem ignore defaults.
      if (error && error.code !== 1) return done(null)
      done(new Set(stdout.split("\0").filter(Boolean)))
    })
    child.stdin?.on("error", () => { /* Git may exit before consuming stdin. */ })
    child.stdin?.end(`${paths.join("\0")}\0`)
  })
}

const pending = new Map<string, Promise<ProjectTreeEntry[]>>()

/** Read only this directory. Never inspect children to compact folder chains. */
async function readDirectory(root: string, directory: string, includeIgnored: boolean): Promise<ProjectTreeEntry[]> {
  const candidate = resolve(root, directory)
  if (!isWithinDir(root, candidate)) throw new ProjectDirectoryError(400, "dir must stay inside the project")
  let absolutePath: string
  try {
    absolutePath = await realpath(candidate)
  } catch {
    throw new ProjectDirectoryError(404, "Directory not found")
  }
  if (!isWithinDir(root, absolutePath)) throw new ProjectDirectoryError(403, "Directory is outside the project")

  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(() => {
    throw new ProjectDirectoryError(400, "Unable to read directory")
  })
  const children = entries.filter((entry) => entry.name !== ".git" && (entry.isFile() || entry.isDirectory()))
  const paths = children.map((entry) => `${directory ? `${directory}/` : ""}${entry.name}${entry.isDirectory() ? "/" : ""}`)
  const ignored = includeIgnored ? new Set<string>() : await ignoredPaths(root, paths)
  return children.flatMap((entry, index): ProjectTreeEntry[] => {
    if (ignored?.has(paths[index])) return []
    if (ignored === null && entry.isDirectory() && IGNORED_PROJECT_DIRECTORIES.has(entry.name)) return []
    return [{ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }]
  }).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1))
}

/** Deduplicate concurrent reads, without retaining stale directory snapshots. */
export function listProjectDirectory(root: string, directory: string, { includeIgnored = false }: { includeIgnored?: boolean } = {}): Promise<ProjectTreeEntry[]> {
  const key = JSON.stringify([root, directory, includeIgnored])
  const existing = pending.get(key)
  if (existing) return existing
  const request = readDirectory(root, directory, includeIgnored).finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}
