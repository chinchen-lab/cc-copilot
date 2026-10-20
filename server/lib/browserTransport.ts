import { deploymentValue } from "./deploymentEnvironment"

/** HTTP access follows the configured deployment transport policy. */
export function allowsHttpBrowserAccess(env: NodeJS.ProcessEnv = process.env): boolean {
  return deploymentValue("COGPIT_ALLOW_HTTP", env) === "1"
}
