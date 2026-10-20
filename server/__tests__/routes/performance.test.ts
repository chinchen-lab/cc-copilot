// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../../lib/systemProcesses", () => ({
  captureSystemProcesses: vi.fn(),
  stopSystemProcesses: vi.fn(),
}))

vi.mock("../../lib/leakReaper", () => ({
  startLeakReaper: vi.fn(),
  getRecentlyReaped: vi.fn(() => []),
  killPids: vi.fn(() => []),
}))

import type { SystemProcessesSnapshot } from "../../../shared/contracts/performance"
import { captureSystemProcesses, stopSystemProcesses } from "../../lib/systemProcesses"
import { registerPerformanceRoutes } from "../../routes/performance"
import { __resetEditionForTest } from "../../edition"
import { useAccountSignIn } from "../edition/fakeEdition"
import { setRequestPrincipal } from "../../requestPrincipal"
import type { SessionPrincipal } from "../../sessionConstants"
import type { Middleware, UseFn } from "../../http"
import { asIncomingMessage, asServerResponse, getRouteHandler, createMockReqRes as createHttpReqRes } from "../http-fixtures"

const ADMIN: SessionPrincipal = { userId: "u-admin", username: "alice", role: "admin" }
const MEMBER: SessionPrincipal = { userId: "u-member", username: "bob", role: "member" }

const systemFixture: SystemProcessesSnapshot = {
  capturedAt: 123,
  processes: [{
    pid: 4242,
    kind: "claude",
    label: "claude",
    command: "claude --resume abc",
    cpuPercent: 12,
    memoryMb: 80,
    ageSeconds: 60,
    orphaned: false,
    suspectedLeak: false,
  }],
  suspectedLeakCount: 0,
}

const mockedCapture = vi.mocked(captureSystemProcesses)

const originalEditionEnv = process.env.COGPIT_EDITION

function createMockReqRes(principal?: SessionPrincipal) {
  let body = ""
  let resolveEnded = () => {}
  const ended = new Promise<void>((resolve) => { resolveEnded = resolve })
  const req = asIncomingMessage({ method: "GET", url: "/", headers: {} })
  if (principal) setRequestPrincipal(req, principal)
  const res = asServerResponse({
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((data?: string) => {
      body = data ?? ""
      resolveEnded()
    }),
  })
  const next = vi.fn()
  return { req, res, next, ended, getBody: () => body }
}

describe("GET /api/performance system snapshot gating", () => {
  let handlers: Map<string, Middleware>

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.COGPIT_EDITION
    mockedCapture.mockResolvedValue(systemFixture)
    handlers = new Map()
    const use: UseFn = (path, handler) => { handlers.set(path, handler) }
    registerPerformanceRoutes(use)
  })

  afterEach(() => {
    __resetEditionForTest()
    if (originalEditionEnv === undefined) delete process.env.COGPIT_EDITION
    else process.env.COGPIT_EDITION = originalEditionEnv
  })

  async function fetchSnapshot(principal?: SessionPrincipal) {
    const handler = getRouteHandler(handlers, "/api/performance")
    const mock = createMockReqRes(principal)
    handler(mock.req, mock.res, mock.next)
    await mock.ended
    expect(mock.next).not.toHaveBeenCalled()
    return JSON.parse(mock.getBody()) as Record<string, unknown>
  }

  it("includes the system snapshot in personal edition (regression pin)", async () => {
    const snapshot = await fetchSnapshot()
    expect(snapshot.system).toEqual(systemFixture)
  })

  it("includes the system snapshot for an account the edition lets act host-wide", async () => {
    useAccountSignIn()
    const snapshot = await fetchSnapshot(ADMIN)
    expect(snapshot.system).toEqual(systemFixture)
  })

  it("omits the system snapshot for an account the edition does not let act host-wide", async () => {
    useAccountSignIn()
    const snapshot = await fetchSnapshot(MEMBER)
    expect("system" in snapshot).toBe(false)
    expect(mockedCapture).not.toHaveBeenCalled()
  })

  it("omits the system snapshot for principal-less requests where accounts sign in", async () => {
    useAccountSignIn()
    const snapshot = await fetchSnapshot()
    expect("system" in snapshot).toBe(false)
    expect(mockedCapture).not.toHaveBeenCalled()
  })

  it("still ships the core snapshot fields a member's perf panel reads", async () => {
    useAccountSignIn()
    const snapshot = await fetchSnapshot(MEMBER)
    for (const key of ["cpuPercent", "eventLoopPercent", "memory", "activities", "requests", "sampleWindowSeconds"]) {
      expect(snapshot).toHaveProperty(key)
    }
  })

  it("requires host-wide authorization for process discovery and stopping", async () => {
    useAccountSignIn()
    const handler = getRouteHandler(handlers, "/api/system-processes")
    for (const method of ["GET", "POST"]) {
      const mock = createHttpReqRes(method, method === "POST" ? "/kill" : "/")
      setRequestPrincipal(mock.req, MEMBER)
      handler(mock.req, mock.res, mock.next)
      expect(mock.res._getStatus()).toBe(403)
    }
    expect(mockedCapture).not.toHaveBeenCalled()
    expect(stopSystemProcesses).not.toHaveBeenCalled()
  })

  it("accepts only bounded process targets with start identities", async () => {
    const handler = getRouteHandler(handlers, "/api/system-processes")
    const target = { pid: 53013, identity: "a".repeat(64) }
    vi.mocked(stopSystemProcesses).mockResolvedValue([53013])
    const allowed = createHttpReqRes("POST", "/kill", { body: JSON.stringify({ processes: [target] }) })
    handler(allowed.req, allowed.res, allowed.next)
    allowed.sendBody()
    await vi.waitFor(() => expect(allowed.res.end).toHaveBeenCalled())
    expect(stopSystemProcesses).toHaveBeenCalledWith([target])
    expect(JSON.parse(allowed.res._getData())).toEqual({ killed: [53013], skipped: [] })
    vi.mocked(stopSystemProcesses).mockClear()
    for (const body of [{ pids: [53013] }, { processes: [{ ...target, pid: -1 }] }, { processes: Array(21).fill(target) }]) {
      const denied = createHttpReqRes("POST", "/kill", { body: JSON.stringify(body) })
      handler(denied.req, denied.res, denied.next)
      denied.sendBody()
      expect(denied.res._getStatus()).toBe(400)
    }
    expect(stopSystemProcesses).not.toHaveBeenCalled()
  })
})
