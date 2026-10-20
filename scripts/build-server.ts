#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { basename, dirname } from "node:path"
import { packageServer } from "./lib/serverPackage"

const root = fileURLToPath(new URL("..", import.meta.url))
const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: ./build-server.sh\nBuild a native server package with its own Bun runtime in release/cc-copilot-<os>-<arch>/ and a .tar.gz archive. Build on RHEL 9 for RHEL 9 deployments; no cross-compilation. Requires Bun >= 1.3.5, git and tar. Installs locked dependencies and builds the web app without Electron lifecycle scripts.")
  process.exit(0)
}
if (args.length) throw new Error(`Unknown build option: ${args[0]}`)
if (process.platform !== "linux" && process.platform !== "darwin") throw new Error("Build on Linux or macOS")
if (!("Bun" in globalThis) || !("Terminal" in (globalThis as unknown as { Bun: object }).Bun)) {
  throw new Error("Bun >= 1.3.5 with Bun.Terminal is required")
}
// Bun run scripts and package tools must use this same installed runtime.
process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? ""}`
function run(args: string[]) {
  const child = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, COGPIT_WITHOUT_TEAM: "1" } })
  if (child.error) throw child.error
  if (child.status !== 0) process.exit(child.status ?? 1)
}
run(["install", "--frozen-lockfile", "--ignore-scripts"])
run(["run", "build:web"])
const output = packageServer({ root, bun: process.execPath })
const archive = `${output}.tar.gz`
const packed = spawnSync("tar", ["-czf", archive, "-C", dirname(output), basename(output)], { stdio: "inherit" })
if (packed.error) throw packed.error
if (packed.status !== 0) process.exit(packed.status ?? 1)
console.log(`\nBuilt: ${output}\nArchive: ${archive}\nStart: cd "${output}" && CC_COPILOT_UI_PASSWORD='your-own-long-password' ./CC-Copilot`)
