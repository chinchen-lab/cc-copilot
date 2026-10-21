// @vitest-environment node
import { execFile as execFileCallback } from "node:child_process"
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { listProjectDirectory } from "../../routes/project-directory"

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})

const execFile = promisify(execFileCallback)
const roots: string[] = []
async function project() {
  const root = await mkdtemp(join(tmpdir(), "cogpit-lazy-tree-"))
  roots.push(root)
  return realpath(root)
}

beforeEach(() => { vi.mocked(readdir).mockClear() })
afterEach(async () => {
  vi.mocked(readdir).mockRestore()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe("listProjectDirectory", () => {
  it("reads only the requested level, including empty folders, without compacting chains", async () => {
    const root = await project()
    await mkdir(join(root, "packages/app/src"), { recursive: true })
    await mkdir(join(root, "empty"))
    await writeFile(join(root, "README.md"), "")
    await writeFile(join(root, "packages/app/src/index.ts"), "")

    expect(await listProjectDirectory(root, "")).toEqual([
      { name: "empty", type: "directory" },
      { name: "packages", type: "directory" },
      { name: "README.md", type: "file" },
    ])
    expect(vi.mocked(readdir).mock.calls.map(call => call[0])).toEqual([root])
    expect(await listProjectDirectory(root, "packages")).toEqual([{ name: "app", type: "directory" }])
    expect(vi.mocked(readdir).mock.calls.map(call => call[0])).toEqual([root, join(root, "packages")])
  })

  it("honours git ignores, nested rules, repository excludes, and tracked files", async () => {
    const root = await project()
    await execFile("git", ["init", "-q"], { cwd: root })
    await mkdir(join(root, "src"))
    await mkdir(join(root, "ignored"))
    await writeFile(join(root, "ignored/tracked.ts"), "")
    await execFile("git", ["add", "ignored/tracked.ts"], { cwd: root })
    await writeFile(join(root, ".gitignore"), "ignored/\n*.log\n!keep.log\n")
    await writeFile(join(root, ".git/info/exclude"), "local.txt\n")
    for (const file of ["ignored/noise.ts", "noise.log", "keep.log", "local.txt", "src/hidden.ts", "src/visible.ts"]) {
      await writeFile(join(root, file), "")
    }
    await writeFile(join(root, "src/.gitignore"), "hidden.ts\n")

    expect(await listProjectDirectory(root, "")).toEqual([
      { name: "ignored", type: "directory" },
      { name: "src", type: "directory" },
      { name: ".gitignore", type: "file" },
      { name: "keep.log", type: "file" },
    ])
    expect(await listProjectDirectory(root, "ignored")).toEqual([{ name: "tracked.ts", type: "file" }])
    expect(await listProjectDirectory(root, "src")).toEqual([
      { name: ".gitignore", type: "file" }, { name: "visible.ts", type: "file" },
    ])
  })

  it("uses filesystem ignore defaults outside git and omits symlinks", async () => {
    const root = await project()
    await mkdir(join(root, "node_modules"))
    await mkdir(join(root, "src"))
    await writeFile(join(root, "src/main.ts"), "")
    await symlink(join(root, "src"), join(root, "alias"), "dir")
    expect(await listProjectDirectory(root, "")).toEqual([{ name: "src", type: "directory" }])
  })

  it("does not apply the whole-project search limit to a directory", async () => {
    const root = await project()
    vi.mocked(readdir).mockResolvedValueOnce(Array.from({ length: 20_010 }, (_, i) => ({
      name: `file-${String(i).padStart(5, "0")}.ts`, isFile: () => true, isDirectory: () => false,
    })) as never)
    const entries = await listProjectDirectory(root, "")
    expect(entries).toHaveLength(20_010)
    expect(entries.at(-1)?.name).toBe("file-20009.ts")
    expect(readdir).toHaveBeenCalledTimes(1)
  })

  it("deduplicates concurrent reads and reads fresh data on subsequent requests", async () => {
    const root = await project()
    const first = listProjectDirectory(root, "")
    expect(listProjectDirectory(root, "")).toBe(first)
    expect(await first).toEqual([])
    expect(readdir).toHaveBeenCalledTimes(1)
    await writeFile(join(root, "new.ts"), "")
    expect(await listProjectDirectory(root, "")).toEqual([{ name: "new.ts", type: "file" }])
  })

  it("rejects paths and symlinks outside the project", async () => {
    const root = await project()
    const outside = await project()
    await symlink(outside, join(root, "outside"), "dir")
    await expect(listProjectDirectory(root, "..")).rejects.toMatchObject({ status: 400 })
    await expect(listProjectDirectory(root, "outside")).rejects.toMatchObject({ status: 403 })
    await expect(listProjectDirectory(root, "missing")).rejects.toMatchObject({ status: 404 })
  })
})
