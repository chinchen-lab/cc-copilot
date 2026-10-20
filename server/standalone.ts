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
import brand from "../shared/brand.json"
import { applyDeploymentEnvironment, deploymentName, setDeploymentValue } from "./lib/deploymentEnvironment"

applyDeploymentEnvironment()
try {
  const options = parseStandaloneOptions(process.argv.slice(2))
  if (options.help) {
    console.log(`Usage: ./${brand.prefix}-${brand.name} [--https | --http-only]\n       bun server/standalone.ts [--https | --http-only]\n\nHTTP browser login is enabled by default. Remote access requires a password of at least 6 characters.\n  --https      Require HTTPS browser sessions behind a TLS reverse proxy (also ${deploymentName("COGPIT_ALLOW_HTTP")}=0). Does not serve TLS directly.\n  --http-only  Explicitly allow HTTP browser login, overriding ${deploymentName("COGPIT_ALLOW_HTTP")}=0.\n  -h, --help   Show this help.\n\nEnvironment: ${deploymentName("COGPIT_HOST")} (0.0.0.0), ${deploymentName("COGPIT_PORT")} (19384), ${deploymentName("COGPIT_DATA_DIR")}, ${deploymentName("COGPIT_NETWORK_PASSWORD")} or ${deploymentName("COGPIT_NETWORK_PASSWORD_FILE")}.`)
    process.exit(0)
  }
  setDeploymentValue("COGPIT_ALLOW_HTTP", options.httpOnly ? "1" : "0")
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
else console.log("HTTPS browser sessions required: place a TLS reverse proxy in front of this HTTP listener.")
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
