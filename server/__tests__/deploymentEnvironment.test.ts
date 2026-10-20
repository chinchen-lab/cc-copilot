// @vitest-environment node
import { describe, expect, it } from "vitest"
import { applyDeploymentEnvironment, deploymentValue, setDeploymentValue } from "../lib/deploymentEnvironment"
import { parseStandaloneOptions, resolveDataDir, resolveDeviceName, resolveEnvPassword } from "../lib/standalone-bootstrap"
import { allowsHttpBrowserAccess } from "../lib/browserTransport"

describe("deployment environment", () => {
  it("uses the new password, password file, data and device names", () => {
    expect(resolveEnvPassword({ CC_COPILOT_UI_PASSWORD: "123456" })).toBe("123456")
    expect(resolveEnvPassword({ CC_COPILOT_UI_PASSWORD: "123456", COGPIT_NETWORK_PASSWORD: "legacy" })).toBe("123456")
    expect(resolveEnvPassword({ CC_COPILOT_UI_PASSWORD_FILE: "/new", COGPIT_NETWORK_PASSWORD_FILE: "/old" }, (path) => `${path}\n`)).toBe("/new")
    expect(resolveEnvPassword({ CC_COPILOT_UI_PASSWORD: "", COGPIT_NETWORK_PASSWORD: "legacy" })).toBeNull()
    expect(resolveDataDir({ CC_COPILOT_UI_DATA_DIR: "/data" })).toBe("/data")
    expect(resolveDeviceName({ CC_COPILOT_UI_DEVICE_NAME: " build-box " }, "host")).toBe("build-box")
  })

  it("normalizes deployment names for existing internal consumers without changing unrelated settings", () => {
    const env = {
      CC_COPILOT_UI_PORT: "8080", COGPIT_PORT: "19384", CC_COPILOT_UI_HOST: "0.0.0.0",
      CC_COPILOT_UI_PROJECTS_ROOT: "/projects", CC_COPILOT_UI_PUBLIC_URL: "http://vpn:8080",
      COGPIT_SESSION_ID: "session", PATH: "/bin",
    }
    applyDeploymentEnvironment(env)
    expect(env).toMatchObject({ COGPIT_PORT: "8080", COGPIT_HOST: "0.0.0.0", COGPIT_PROJECTS_ROOT: "/projects", COGPIT_PUBLIC_URL: "http://vpn:8080", COGPIT_SESSION_ID: "session", PATH: "/bin" })
    expect(deploymentValue("COGPIT_PORT", { COGPIT_PORT: "19400" })).toBe("19400")
  })

  it("lets transport flags override either environment name", () => {
    const env = { CC_COPILOT_UI_ALLOW_HTTP: "0", COGPIT_ALLOW_HTTP: "1" }
    expect(parseStandaloneOptions([], env).httpOnly).toBe(false)
    expect(parseStandaloneOptions(["--http-only"], env).httpOnly).toBe(true)
    expect(parseStandaloneOptions(["--https"], { CC_COPILOT_UI_ALLOW_HTTP: "1" }).httpOnly).toBe(false)
    expect(allowsHttpBrowserAccess(env)).toBe(false)
    setDeploymentValue("COGPIT_ALLOW_HTTP", "1", env)
    expect(allowsHttpBrowserAccess(env)).toBe(true)
    expect(env).toEqual({ CC_COPILOT_UI_ALLOW_HTTP: "1", COGPIT_ALLOW_HTTP: "1" })
  })
})
