// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const mockShowNotification = vi.fn()
const mockSendPush = vi.fn()

vi.mock("../../lib/desktopNotify", () => ({
  showNotification: (...args: unknown[]) => mockShowNotification(...args),
}))
vi.mock("../../lib/pushNotify", () => ({
  sendPushNotification: (...args: unknown[]) => mockSendPush(...args),
}))
vi.mock("../../lib/notificationHistory", () => ({
  recordNotification: vi.fn(() => ({ id: "history-1" })),
}))
vi.mock("../../config", () => ({ getConfig: vi.fn() }))

import { deliverNotification } from "../../lib/notificationDelivery"
import { getConfig } from "../../config"
import { recordNotification } from "../../lib/notificationHistory"
import { setDesktopAttention } from "../../lib/desktopAttention"
import { computeDesktopAttention } from "../../../shared/notifications"

const NOTIFICATION = { title: "Claude Code — proj", body: "Done", nav: { sessionId: "s1", dirName: "-d" } }

const PRESENT = { hasWindow: true, locked: false, idleSeconds: 0 }

beforeEach(() => {
  vi.mocked(getConfig).mockReturnValue(null)
  vi.mocked(recordNotification).mockClear()
  mockShowNotification.mockReset()
  mockSendPush.mockReset().mockResolvedValue(true)
  setDesktopAttention(false)
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  setDesktopAttention(false)
  vi.restoreAllMocks()
})

describe("deliverNotification", () => {
  it("keeps history but suppresses desktop and push when all alerts are disabled", () => {
    vi.mocked(getConfig).mockReturnValue({ claudeDir: "/home/me/.agent", notificationsEnabled: false })
    deliverNotification(NOTIFICATION, "permission")
    expect(recordNotification).toHaveBeenCalledWith(NOTIFICATION, "permission")
    expect(mockShowNotification).not.toHaveBeenCalled()
    expect(mockSendPush).not.toHaveBeenCalled()
  })

  it("keeps history and unattended push when only desktop notifications are disabled", () => {
    vi.mocked(getConfig).mockReturnValue({ claudeDir: "/home/me/.agent", desktopNotificationsEnabled: false })
    deliverNotification(NOTIFICATION)
    expect(recordNotification).toHaveBeenCalledOnce()
    expect(mockShowNotification).not.toHaveBeenCalled()
    expect(mockSendPush).toHaveBeenCalledWith(NOTIFICATION)
  })

  it("still suppresses push while attended when desktop alerts are disabled", () => {
    vi.mocked(getConfig).mockReturnValue({ claudeDir: "/home/me/.agent", desktopNotificationsEnabled: false })
    setDesktopAttention(true)
    deliverNotification(NOTIFICATION)
    expect(mockShowNotification).not.toHaveBeenCalled()
    expect(mockSendPush).not.toHaveBeenCalled()
  })

  it("applies changed preferences to the next notification without a restart", () => {
    vi.mocked(getConfig).mockReturnValue({ claudeDir: "/home/me/.agent", notificationsEnabled: false })
    deliverNotification(NOTIFICATION)
    vi.mocked(getConfig).mockReturnValue({ claudeDir: "/home/me/.agent", notificationsEnabled: true, desktopNotificationsEnabled: true })
    deliverNotification(NOTIFICATION)
    expect(mockShowNotification).toHaveBeenCalledOnce()
    expect(mockSendPush).toHaveBeenCalledOnce()
  })

  it("pushes to the phone when nobody is at the desktop", () => {
    deliverNotification(NOTIFICATION)
    expect(mockShowNotification).toHaveBeenCalledOnce()
    expect(mockSendPush).toHaveBeenCalledWith(NOTIFICATION)
  })

  it("does not buzz the phone while the user is at the desktop", () => {
    setDesktopAttention(true)
    deliverNotification(NOTIFICATION)
    expect(mockShowNotification).toHaveBeenCalledOnce()
    expect(mockSendPush).not.toHaveBeenCalled()
  })

  it("still pushes if the desktop notification throws", () => {
    mockShowNotification.mockImplementation(() => { throw new Error("no parentPort") })
    expect(() => deliverNotification(NOTIFICATION)).not.toThrow()
    expect(mockSendPush).toHaveBeenCalledOnce()
  })

  it("never throws when push rejects, so the agent turn is unaffected", async () => {
    mockSendPush.mockRejectedValue(new Error("offline"))
    expect(() => deliverNotification(NOTIFICATION)).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })

  it("does not block on a push that never settles", () => {
    // A hung push server must not stall the hook's HTTP response.
    mockSendPush.mockReturnValue(new Promise<boolean>(() => {}))
    expect(() => deliverNotification(NOTIFICATION)).not.toThrow()
    expect(mockShowNotification).toHaveBeenCalledOnce()
  })
})

describe("computeDesktopAttention", () => {
  it("counts recent input as the user being present", () => {
    expect(computeDesktopAttention(PRESENT)).toBe(true)
  })

  it.each([
    ["no window exists", { ...PRESENT, hasWindow: false }],
    ["the screen is locked", { ...PRESENT, locked: true }],
    ["input stopped long ago", { ...PRESENT, idleSeconds: 600 }],
  ])("is unattended when %s", (_label, state) => {
    expect(computeDesktopAttention(state)).toBe(false)
  })

  it("pushes once the user walks away, even with Cogpit still focused", () => {
    // The case focus-based presence got wrong: no event fires when you leave.
    expect(computeDesktopAttention({ ...PRESENT, idleSeconds: 121 })).toBe(false)
  })

  it("stays attended while working in another app, so the phone stays quiet", () => {
    // Cogpit blurred but the user is typing: focus-based presence buzzed here.
    expect(computeDesktopAttention({ ...PRESENT, idleSeconds: 2 })).toBe(true)
  })

  it("treats a locked screen as unattended regardless of idle time", () => {
    expect(computeDesktopAttention({ ...PRESENT, idleSeconds: 0, locked: true })).toBe(false)
  })

  it("honours an explicit threshold", () => {
    expect(computeDesktopAttention({ ...PRESENT, idleSeconds: 30 }, 10)).toBe(false)
    expect(computeDesktopAttention({ ...PRESENT, idleSeconds: 30 }, 60)).toBe(true)
  })
})
