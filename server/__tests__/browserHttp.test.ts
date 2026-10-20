// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import type { IncomingMessage } from "node:http"
import { allowsHttpBrowserAccess } from "../lib/browserTransport"
import { parseStandaloneOptions } from "../lib/standalone-bootstrap"
import {
  canIssueBrowserSession, setBrowserSessionCookie, clearBrowserSessionCookie,
  setShareCookie, getRequestShareToken, createSessionToken, getRequestSessionToken,
  validSessionToken, websocketUpgradeRejection, revokeAllSessions,
} from "../security"
import { createMockReqRes } from "./http-fixtures"
import { startStandaloneServer } from "../standalone-runtime"
import { fixture, runningServers, useStandaloneRuntimeFixture } from "./standaloneRuntimeFixture"

useStandaloneRuntimeFixture()
afterEach(() => { vi.unstubAllEnvs(); revokeAllSessions() })

const password = "vpn-network-password-2026"
const ua = "HTTP-mode-test/1"

function remoteRequest(headers: Record<string, string> = {}): IncomingMessage {
  return createMockReqRes("POST", "/api/auth/verify", {
    remoteAddress: "10.10.0.5",
    headers: { host: "cogpit.internal:19384", origin: "http://cogpit.internal:19384", "user-agent": ua, ...headers },
  }).req
}

describe("HTTP mode configuration", () => {
  it("requires an explicit flag or environment opt-in", () => {
    expect(parseStandaloneOptions([])).toEqual({ httpOnly: false, help: false })
    expect(parseStandaloneOptions(["--http-only"])).toEqual({ httpOnly: true, help: false })
    expect(parseStandaloneOptions(["--help"]).help).toBe(true)
    expect(() => parseStandaloneOptions(["--http-onyl"])).toThrow()
    for (const value of [undefined, "", "0", "false", "yes"]) {
      expect(allowsHttpBrowserAccess({ COGPIT_ALLOW_HTTP: value })).toBe(false)
    }
    expect(allowsHttpBrowserAccess({ COGPIT_ALLOW_HTTP: "1" })).toBe(true)
  })

  it("keeps HTTPS-only sessions as the default and ignores the HTTP cookie", () => {
    vi.stubEnv("COGPIT_ALLOW_HTTP", "0")
    expect(canIssueBrowserSession(remoteRequest())).toBe(false)
    expect(canIssueBrowserSession(remoteRequest({ origin: "https://cogpit.internal:19384", "x-forwarded-proto": "https" }))).toBe(true)
    const { res } = createMockReqRes("POST")
    setBrowserSessionCookie(res, "token")
    expect(res._getHeaders()["Set-Cookie"]).toContain("__Host-cogpit_session=token; Path=/; HttpOnly; Secure;")
    const token = createSessionToken("10.10.0.5", ua)
    expect(validSessionToken(remoteRequest({ cookie: `cogpit_session_http=${token}` }))).toBeNull()
  })

  it("uses separate HttpOnly cookies in HTTP mode without weakening source checks", () => {
    vi.stubEnv("COGPIT_ALLOW_HTTP", "1")
    expect(canIssueBrowserSession(remoteRequest())).toBe(true)
    expect(canIssueBrowserSession(remoteRequest({ origin: "http://attacker.test" }))).toBe(false)
    expect(canIssueBrowserSession(remoteRequest({ "sec-fetch-site": "cross-site" }))).toBe(false)
    const { res } = createMockReqRes("POST")
    const token = createSessionToken("10.10.0.5", ua)
    setBrowserSessionCookie(res, token)
    expect(res._getHeaders()["Set-Cookie"]).toBe(`cogpit_session_http=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`)
    const req = remoteRequest({ cookie: `cogpit_session_http=${token}` })
    expect(getRequestSessionToken(req)).toBe(token)
    expect(validSessionToken(req)).toBe(token)
    expect(validSessionToken(remoteRequest({ cookie: `cogpit_session_http=${token}`, "user-agent": "another browser" }))).toBeNull()
    clearBrowserSessionCookie(res)
    expect(res._getHeaders()["Set-Cookie"]).toBe("cogpit_session_http=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
    setShareCookie(res, "guest-token")
    expect(res._getHeaders()["Set-Cookie"]).toContain("cogpit_share_http=guest-token; Path=/; HttpOnly; SameSite=Strict;")
    expect(getRequestShareToken(remoteRequest({ cookie: "cogpit_share_http=guest-token" }))).toBe("guest-token")
  })
})

describe("HTTP browser login lifecycle", () => {
  it("authenticates API and WebSocket requests, rejects cross-origin access, and logs out", async () => {
    vi.stubEnv("COGPIT_ALLOW_HTTP", "1")
    const { staticDir, dataDir } = await fixture()
    const runtime = await startStandaloneServer({ staticDir, dataDir, port: 0, env: { COGPIT_NETWORK_PASSWORD: password } })
    runningServers.push(runtime)
    const origin = runtime.url
    const host = new URL(origin).host
    const headers = { origin, "x-forwarded-for": "10.10.0.5", "x-cogpit-client": "1", "user-agent": ua }
    const hello = await fetch(`${runtime.url}/api/hello`)
    expect(await hello.json()).toMatchObject({ httpOnly: true })
    const login = (attempt: string) => fetch(`${runtime.url}/api/auth/verify`, { method: "POST", headers: { ...headers, authorization: `Bearer ${attempt}` } })
    const wrong = await login("wrong-password")
    expect(wrong.status, await wrong.text()).toBe(401)
    const response = await login(password)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ valid: true })
    const setCookie = response.headers.get("set-cookie")!
    expect(setCookie).toMatch(/^cogpit_session_http=/)
    expect(setCookie).not.toContain("Secure")
    const cookie = setCookie.split(";")[0]
    const request = (path: string, options: RequestInit = {}) => fetch(`${runtime.url}${path}`, { ...options, headers: { ...headers, cookie, ...options.headers } })
    expect((await request("/api/auth/session")).status).toBe(200)
    expect((await request("/api/projects")).status).toBe(200)
    const socketReq = remoteRequest({ host, origin, cookie })
    expect(websocketUpgradeRejection(socketReq, new URL(`${origin}/__pty`))).toBeNull()
    expect(websocketUpgradeRejection(remoteRequest({ cookie, origin: "http://attacker.test" }), new URL(`${origin}/__pty`))).toBe(403)
    expect((await request("/api/auth/logout", { method: "POST", headers: { origin: "http://attacker.test" } })).status).toBe(403)
    const logout = await request("/api/auth/logout", { method: "POST" })
    expect(logout.status).toBe(200)
    expect(logout.headers.get("set-cookie")).toContain("cogpit_session_http=;")
    expect((await request("/api/auth/session")).status).toBe(401)
    expect(websocketUpgradeRejection(socketReq, new URL(`${origin}/__pty`))).toBe(401)
  })

  it("keeps rejecting HTTP login and passwordless remote binds without opting in", async () => {
    vi.stubEnv("COGPIT_ALLOW_HTTP", "0")
    const { staticDir, dataDir } = await fixture()
    const runtime = await startStandaloneServer({ staticDir, dataDir, port: 0, env: { COGPIT_NETWORK_PASSWORD: password } })
    runningServers.push(runtime)
    const response = await fetch(`${runtime.url}/api/auth/verify`, { method: "POST", headers: {
      origin: runtime.url,
      "x-forwarded-for": "10.10.0.5", "x-cogpit-client": "1", authorization: `Bearer ${password}`,
    } })
    expect(response.status, await response.text()).toBe(426)
    await runtime.dispose()
    runningServers.pop()
    vi.stubEnv("COGPIT_ALLOW_HTTP", "1")
    const unconfigured = await fixture()
    await expect(startStandaloneServer({ ...unconfigured, host: "0.0.0.0", port: 0, env: {} })).rejects.toThrow("Refusing to bind")
  })
})
