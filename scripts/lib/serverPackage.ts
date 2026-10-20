import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, relative } from "node:path"
import { spawnSync } from "node:child_process"

export const SERVER_LAUNCHER = `#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="$root/runtime:$PATH"
export SHELL="\${SHELL:-/bin/bash}"
exec "$root/runtime/bun" "$root/app/server/standalone.ts" "$@"
`

type Run = (command: string, args: string[], cwd: string) => void
const runCommand: Run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${basename(command)} ${args.join(" ")} failed (${result.status ?? result.signal})`)
}

/** Keep the source layout: workers, SDK executables and runtime assets use real paths. */
export function packageServer({
  root,
  bun,
  platform = process.platform,
  arch = process.arch,
  run = runCommand,
}: {
  root: string
  bun: string
  platform?: NodeJS.Platform
  arch?: string
  run?: Run
}): string {
  if (platform !== "linux" && platform !== "darwin") throw new Error("Build on Linux or macOS; cross-compilation is not supported")
  const release = join(root, "release")
  mkdirSync(release, { recursive: true })
  const name = `cc-copilot-${platform}-${arch}`
  const output = join(release, name)
  // A failed build leaves the previous usable package intact.
  const staging = mkdtempSync(join(release, ".server-package-"))
  try {
    const app = join(staging, "app")
    mkdirSync(app)
    const sourceFilter = (path: string) => !relative(root, path).split(/[\\/]/).some((part) =>
      part === "__tests__" || part === "node_modules" || part.startsWith(".env") || part.endsWith(".local.json") || part.endsWith(".test.ts") || part.endsWith(".test.tsx"),
    )
    for (const directory of ["server", "shared", "dist", "generated/runtime-plugin-seeds"]) {
      cpSync(join(root, directory), join(app, directory), { recursive: true, filter: sourceFilter })
    }
    for (const file of ["package.json", "bun.lock"]) copyFileSync(join(root, file), join(app, file))
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      workspaces: string[]
      patchedDependencies?: Record<string, string>
    }
    for (const workspace of manifest.workspaces) {
      const destination = join(app, workspace)
      mkdirSync(destination, { recursive: true })
      copyFileSync(join(root, workspace, "package.json"), join(destination, "package.json"))
      cpSync(join(root, workspace, "dist"), join(destination, "dist"), { recursive: true })
    }
    for (const patch of Object.values(manifest.patchedDependencies ?? {})) {
      const destination = join(app, patch)
      mkdirSync(join(destination, ".."), { recursive: true })
      copyFileSync(join(root, patch), destination)
    }
    // Frozen versions, production dependencies only; no Electron postinstall.
    run(bun, ["install", "--production", "--frozen-lockfile", "--ignore-scripts"], app)
    mkdirSync(join(staging, "runtime"))
    copyFileSync(bun, join(staging, "runtime/bun"))
    chmodSync(join(staging, "runtime/bun"), 0o755)
    writeFileSync(join(staging, "CC-Copilot"), SERVER_LAUNCHER, { mode: 0o755 })
    for (const file of ["LICENSE", "NOTICE"]) {
      if (existsSync(join(root, file))) copyFileSync(join(root, file), join(staging, file))
    }
    copyFileSync(join(root, "docs/self-hosting.md"), join(staging, "README.md"))
    writeFileSync(join(staging, "build-info.json"), JSON.stringify({ platform, arch, bun: spawnSync(bun, ["--version"], { encoding: "utf8" }).stdout?.trim() }, null, 2) + "\n")
    rmSync(output, { recursive: true, force: true })
    renameSync(staging, output)
    return output
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
