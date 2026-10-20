let httpBrowserMode = false

/** Learned only from this browser's own server handshake; never from storage or a URL. */
export function setHttpBrowserMode(enabled: boolean): void {
  httpBrowserMode = enabled
}

export function isHttpBrowserMode(): boolean {
  return httpBrowserMode
}

export function canHashInBrowser(cryptoApi: Pick<Crypto, "subtle"> | undefined = globalThis.crypto): boolean {
  return typeof cryptoApi?.subtle?.digest === "function" || httpBrowserMode
}

/** Keep package integrity checks in HTTP mode, where browsers hide SubtleCrypto. */
export async function sha256Hex(payload: ArrayBuffer, cryptoApi: Crypto = globalThis.crypto): Promise<string> {
  let bytes: Uint8Array
  if (typeof cryptoApi?.subtle?.digest === "function") {
    bytes = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", payload))
  } else if (httpBrowserMode) {
    const { sha256 } = await import("@noble/hashes/sha2.js")
    bytes = sha256(new Uint8Array(payload))
  } else {
    throw new Error("SHA-256 verification requires HTTPS or the server's explicit HTTP mode")
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
}
