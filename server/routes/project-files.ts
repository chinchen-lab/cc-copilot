import { execFile as execFileCallback } from "node:child_process"
import { readdir, realpath, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import { sendJson, type UseFn } from "../http"
import { rankProjectFiles } from "./project-files-ranking"
import { IGNORED_PROJECT_DIRECTORIES, listProjectDirectory, ProjectDirectoryError } from "./project-directory"

const MAX_FILES = 20_000
const CACHE_TTL_MS = 30_000

const fileCache = new Map<string, { expiresAt: number; files: string[] }>()
const execFile = promisify(execFileCallback)

async function listGitProjectFiles(root: string): Promise<string[] | null> {
  try {
    const result = await execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
      {
        cwd: root,
        encoding: "utf-8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 10_000,
        windowsHide: true,
      },
    )
    return result.stdout
      .split("\0")
      .filter(Boolean)
      .slice(0, MAX_FILES)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return null
  }
}

export async function listProjectFiles(
  root: string,
  { skipCache = false }: { skipCache?: boolean } = {},
): Promise<string[]> {
  const cached = fileCache.get(root)
  if (!skipCache && cached && cached.expiresAt > Date.now()) return cached.files

  const gitFiles = await listGitProjectFiles(root)
  if (gitFiles) {
    fileCache.set(root, { expiresAt: Date.now() + CACHE_TTL_MS, files: gitFiles })
    return gitFiles
  }

  const files: string[] = []
  const pending = [root]
  while (pending.length > 0 && files.length < MAX_FILES) {
    const directory = pending.pop()!
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const absolutePath = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_PROJECT_DIRECTORIES.has(entry.name)) pending.push(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      files.push(relative(root, absolutePath).split(sep).join("/"))
      if (files.length >= MAX_FILES) break
    }
  }
  files.sort((a, b) => a.localeCompare(b))
  fileCache.set(root, { expiresAt: Date.now() + CACHE_TTL_MS, files })
  return files
}

async function resolveProjectRoot(cwd: string): Promise<{ root: string } | { error: string; status: number }> {
  if (!isAbsolute(cwd)) return { error: "cwd must be an absolute path", status: 400 }
  try {
    const root = resolve(cwd)
    const info = await stat(root)
    if (!info.isDirectory()) return { error: "cwd must be a directory", status: 400 }
    // Canonicalize so a symlinked project root keys the cache — and relativizes
    // paths — the same way /api/git-status and /api/project-file do.
    return { root: await realpath(root) }
  } catch {
    return { error: "Project directory not found", status: 404 }
  }
}

export function registerProjectFileRoutes(use: UseFn) {
  use("/api/project-files/tree", async (req, res, next) => {
    if (req.method !== "GET") return next()
    const url = new URL(req.url || "", "http://localhost")
    const directory = (url.searchParams.get("dir") ?? "").replace(/\/+$/g, "")
    if (isAbsolute(directory) || directory.includes("\0") || directory.split(/[/\\]/).some((segment) => segment === "..")) {
      return sendJson(res, 400, { error: "dir must stay inside the project" })
    }
    const resolved = await resolveProjectRoot(url.searchParams.get("cwd") ?? "")
    if ("error" in resolved) return sendJson(res, resolved.status, { error: resolved.error })
    try {
      const entries = await listProjectDirectory(resolved.root, directory)
      return sendJson(res, 200, { entries, scanLimited: false })
    } catch (error) {
      return sendJson(res, error instanceof ProjectDirectoryError ? error.status : 500, {
        error: error instanceof ProjectDirectoryError ? error.message : "Unable to list directory",
      })
    }
  })

  use("/api/project-files", async (req, res, next) => {
    if (req.method !== "GET") return next()
    const url = new URL(req.url || "", "http://localhost")
    const query = url.searchParams.get("q") ?? ""
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100)
    const skipCache = url.searchParams.get("refresh") === "1"

    const resolved = await resolveProjectRoot(url.searchParams.get("cwd") ?? "")
    if ("error" in resolved) return sendJson(res, resolved.status, { error: resolved.error })
    const files = await listProjectFiles(resolved.root, { skipCache })
    const ranked = rankProjectFiles(files, query, limit)
    return sendJson(res, 200, {
      files: ranked.files,
      totalMatches: ranked.totalMatches,
      scanLimited: files.length >= MAX_FILES,
    })
  })
}
