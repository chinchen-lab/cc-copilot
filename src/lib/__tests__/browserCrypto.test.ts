// @vitest-environment node
import { createHash, webcrypto } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { canHashInBrowser, setHttpBrowserMode, sha256Hex } from "../browserCrypto"

afterEach(() => setHttpBrowserMode(false))
const noSubtle = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } as Crypto

describe("browser SHA-256", () => {
  it("requires explicit HTTP mode when native hashing is unavailable", async () => {
    expect(canHashInBrowser(noSubtle)).toBe(false)
    await expect(sha256Hex(new ArrayBuffer(0), noSubtle)).rejects.toThrow("explicit HTTP mode")
  })

  it.each(["", "abc", "VPN 工作環境", "a".repeat(10000)])("matches native SHA-256 in HTTP mode", async text => {
    const data = Uint8Array.from(Buffer.from(text)).buffer
    const expected = createHash("sha256").update(text).digest("hex")
    expect(await sha256Hex(data, webcrypto as Crypto)).toBe(expected)
    setHttpBrowserMode(true)
    expect(canHashInBrowser(noSubtle)).toBe(true)
    expect(await sha256Hex(data, noSubtle)).toBe(expected)
  })
})
