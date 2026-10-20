// @vitest-environment node
import { webcrypto } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { randomUUID } from "../uuid"

afterEach(() => vi.unstubAllGlobals())
describe("browser UUIDs", () => {
  it("uses the browser's native implementation when available", () => {
    const native = vi.fn(() => "native-uuid")
    vi.stubGlobal("crypto", { randomUUID: native })
    expect(randomUUID()).toBe("native-uuid")
    expect(native).toHaveBeenCalledOnce()
  })

  it("sets the v4 version and variant bits without randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) })
    expect(randomUUID()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff")
  })

  it("generates distinct UUIDs from cryptographic randomness in HTTP browsers", () => {
    vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
    const ids = Array.from({ length: 100 }, () => randomUUID())
    expect(new Set(ids).size).toBe(100)
    expect(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true)
  })
})
