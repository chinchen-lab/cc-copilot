import { useCallback, useState } from "react"

import { authFetch } from "@/lib/auth"
import type { SystemProcessMetric, SystemProcessesResponse } from "../../shared/contracts/performance"
import { useVisiblePolling } from "./useVisiblePolling"

const POLL_INTERVAL_MS = 60_000

/**
 * Polls the system-wide agent process scan so the top bar can warn about
 * leaked processes even while the power monitor is closed.
 */
export function useLeakMonitor() {
  const [leaks, setLeaks] = useState<SystemProcessMetric[]>([])
  const refresh = useCallback(async (isActive: () => boolean) => {
    try {
      const response = await authFetch("/api/system-processes")
      if (response.ok) {
        const data = await response.json() as SystemProcessesResponse
        if (isActive()) {
          const next = (data.processes ?? []).filter((metric) => metric.suspectedLeak)
          setLeaks((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
        }
      }
    } catch {
      // Offline or server restarting — keep the last known state.
    }
  }, [])
  useVisiblePolling(refresh, POLL_INTERVAL_MS)
  return { leaks }
}
