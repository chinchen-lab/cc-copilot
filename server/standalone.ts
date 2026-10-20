#!/usr/bin/env bun
/**
 * Standalone server entry point for headless environments.
 * Applies standalone bootstrap policy, then delegates to the shared server
 * composition through a server-owned adapter.
 */
import { CLICKUP_CONFIG_FILE } from "./lib/clickupConfig"
import { join } from "node:path"
import { hostname, networkInterfaces } from "node:os"
import { removePortFile } from "./lib/portFile"
import {
  buildBootBanner,
  resolveDataDir,
  resolveDeviceName,
  parseStandaloneOptions,
} from "./lib/standalone-bootstrap"
import { allowsHttpBrowserAccess } from "./lib/browserTransport"
import { editionModule, editionOwnsSignIn } from "./edition"
import { startStandaloneServer } from "./standalone-runtime"

try {
  const options = parseStandaloneOptions(process.argv.slice(2))
  if (options.help) {
    console.log("Usage: bun server/standalone.ts [--http-only]\n\n  --http-only  Allow browser login over HTTP (also COGPIT_ALLOW_HTTP=1). Password authentication remains required for remote access.")
    process.exit(0)
  }
  if (options.httpOnly) process.env.COGPIT_ALLOW_HTTP = "1"
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const host = process.env.COGPIT_HOST || "0.0.0.0"
const port = parseInt(process.env.COGPIT_PORT || "19384", 10)
const dataDir = resolveDataDir()

// Resolve static dir: built Vite output
const staticDir = join(import.meta.dirname, "../dist")

let runtime: Awaited<ReturnType<typeof startStandaloneServer>>
try {
  runtime = await startStandaloneServer({
    staticDir,
    legacyClickUpPath: CLICKUP_CONFIG_FILE,
    dataDir,
    host,
    port,
    publishPort: true,
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

if (runtime.createdConfig) {
  console.log(`First run: created ${runtime.createdConfig}`)
}
const deviceName = resolveDeviceName(process.env, hostname())
const banner = buildBootBanner({
  deviceName,
  host,
  port: runtime.port,
  interfaces: networkInterfaces(),
})
for (const line of banner) console.log(line)
console.log(`Data directory: ${dataDir}`)
if (allowsHttpBrowserAccess()) console.log("HTTP mode enabled: browser sessions are allowed over unencrypted HTTP. Use a trusted network or VPN.")
if (runtime.envPassword && !editionOwnsSignIn()) {
  console.log("Network access: enabled via environment (password kept in memory only)")
}
const editionNotices = editionModule().bootNotices({
  envPasswordSet: runtime.envPassword,
  host,
  port: runtime.port,
  interfaces: networkInterfaces(),
  publicUrl: process.env.COGPIT_PUBLIC_URL,
})
for (const line of editionNotices) console.log(line)

// Graceful shutdown
let shuttingDown = false
// Windows never delivers SIGTERM to a listener, so the port file would go stale
// on taskkill. SIGBREAK covers Ctrl+Break and "exit" is the last-resort net.
const shutdownSignals = process.platform === "win32"
  ? (["SIGINT", "SIGBREAK"] as const)
  : (["SIGINT", "SIGTERM"] as const)
process.on("exit", () => removePortFile())
for (const signal of shutdownSignals) {
  process.on(signal, async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\nReceived ${signal}, shutting down...`)
    removePortFile()
    try {
      await runtime.dispose()
      process.exit(0)
    } catch (error) {
      console.error("Failed to shut down cleanly:", error)
      process.exit(1)
    }
  })
}
