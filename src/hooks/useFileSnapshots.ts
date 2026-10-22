import { useEffect, useState } from "react"
import { authFetch } from "@/lib/auth"
import { deviceScopedKey } from "@/lib/device"
import type { FileSnapshot } from "../../shared/contracts/fileSnapshots"

/** Fetch only for an open preview; live sessions never reuse an immutable cache. */
export function useFileSnapshots(sessionId: string | undefined, filePath: string, enabled: boolean, revision: string) {
  const key = deviceScopedKey(JSON.stringify([sessionId, filePath, revision]))
  const [result, setResult] = useState<{ key: string; snapshot: FileSnapshot | null } | null>(null)
  useEffect(() => {
    if (!enabled || !sessionId) {
      setResult(null)
      return
    }
    const controller = new AbortController()
    void (async () => {
      let snapshot: FileSnapshot | null = null
      try {
        const response = await authFetch(`/api/file-snapshots/${encodeURIComponent(sessionId)}?path=${encodeURIComponent(filePath)}`, { signal: controller.signal })
        if (response.ok) {
          const data: unknown = await response.json()
          if (data && typeof data === "object" && "before" in data && "after" in data && typeof data.before === "string" && typeof data.after === "string") snapshot = data as FileSnapshot
        }
      } catch { /* Keep the recorded edits when backups are unavailable. */ }
      if (!controller.signal.aborted) setResult({ key, snapshot })
    })()
    return () => controller.abort()
  }, [enabled, sessionId, filePath, revision, key])
  return {
    snapshot: enabled && result?.key === key ? result.snapshot : null,
    loading: Boolean(enabled && sessionId && result?.key !== key),
  }
}
