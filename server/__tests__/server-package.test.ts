// @vitest-environment node
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it, vi } from "vitest"
import { packageServer } from "../../scripts/lib/serverPackage"

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "server package "))
  directories.push(root)
  const write = (path: string, value: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), value)
  }
  write("package.json", JSON.stringify({ workspaces: ["packages/example"], patchedDependencies: { "example@1": "patches/example.patch" } }))
  for (const path of ["bun.lock", "dist/index.html", "server/standalone.ts", "server/agents/instanceWorker.ts", "shared/brand.json", "generated/runtime-plugin-seeds/index.json", "packages/example/dist/index.js", "packages/example/package.json", "patches/example.patch", "docs/self-hosting.md", "LICENSE"]) write(path, "fixture")
  for (const path of [".env", "config.local.json", "server/.env.local", "server/config.local.json", "server/__tests__/secret.ts", "shared/node_modules/local/credentials", "server/something.test.ts"]) write(path, "must not ship")
  const bun = join(root, "fake-bun")
  write("fake-bun", '#!/bin/sh\nif [ "$1" = --version ]; then echo 1.4.3; else printf "%s\\n" "$@"; printf "cwd=%s\\n" "$PWD"; fi\n')
  chmodSync(bun, 0o755)
  return { root, bun, write }
}

describe("portable server package", () => {
  it("ships runtime assets and workers, excludes private files, and installs locked production dependencies", () => {
    const { root, bun } = fixture()
    const run = vi.fn()
    const output = packageServer({ root, bun, platform: "linux", arch: "x64", run })
    expect(run).toHaveBeenCalledWith(bun, ["install", "--production", "--frozen-lockfile", "--ignore-scripts"], expect.stringContaining("/app"))
    for (const path of ["server/agents/instanceWorker.ts", "dist/index.html", "generated/runtime-plugin-seeds/index.json", "packages/example/dist/index.js", "patches/example.patch"]) expect(existsSync(join(output, "app", path))).toBe(true)
    for (const path of [".env", "config.local.json", "server/.env.local", "server/config.local.json", "server/__tests__", "shared/node_modules", "server/something.test.ts"]) expect(existsSync(join(output, "app", path))).toBe(false)
    expect(JSON.parse(readFileSync(join(output, "build-info.json"), "utf8"))).toMatchObject({ platform: "linux", arch: "x64" })
    if (process.platform !== "win32") {
      const start = spawnSync(join(output, "CC-Copilot"), ["--https"], { cwd: tmpdir(), encoding: "utf8" })
      expect(start.status).toBe(0)
      expect(start.stdout.split("\n")).toContain(join(output, "app/server/standalone.ts"))
      expect(start.stdout.split("\n")).toContain("--https")
      expect(start.stdout).toContain(`cwd=${realpathSync(tmpdir())}`)
    }
  })

  it("keeps the previous package if dependency installation fails", () => {
    const { root, bun, write } = fixture()
    write("release/cc-copilot-linux-x64/previous", "usable")
    expect(() => packageServer({ root, bun, platform: "linux", arch: "x64", run: () => { throw new Error("install failed") } })).toThrow("install failed")
    expect(readFileSync(join(root, "release/cc-copilot-linux-x64/previous"), "utf8")).toBe("usable")
  })
})
