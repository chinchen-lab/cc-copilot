import { useEffect, useState, useCallback, useRef } from "react"
import { authFetch } from "@/lib/auth"
import { DEFAULT_AGENT_KIND, type AgentKind } from "@/lib/agents"
import { quotaSourceFor, type UsageData } from "@/lib/agents/quota"
import { useCapability } from "@/hooks/useCapability"
import { getActiveDeviceScope } from "@/lib/device"
import { USAGE_REFRESH_EVENT, type UsageRefreshDetail } from "@/lib/usageRefreshEvents"

export type { UsageData } from "@/lib/agents/quota"

interface UseTokenUsageResult {
  usage: UsageData | null
  loading: boolean
  available: boolean
  refresh: () => void
}

const POLL_INTERVAL = 5 * 60 * 1000

export function useTokenUsage(agentKind: AgentKind = DEFAULT_AGENT_KIND): UseTokenUsageResult {
  const canViewUsage = useCapability("viewUsage")
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(false)
  const [available, setAvailable] = useState(false)
  const requestIdRef = useRef(0)
  const activeRequestRef = useRef<AbortController | null>(null)

  const fetchUsage = useCallback(async (force = false) => {
    if (!canViewUsage) return
    // A monotonic id plus an abort controller, so a slow response in one
    // agent's shape can never reach another agent's reader after a switch.
    const requestId = ++requestIdRef.current
    activeRequestRef.current?.abort()
    const controller = new AbortController()
    activeRequestRef.current = controller
    const isCurrentRequest = () => (
      requestIdRef.current === requestId && !controller.signal.aborted
    )

    setLoading(true)
    try {
      const source = quotaSourceFor(agentKind)
      const endpoint = force ? `${source.endpoint}?refresh=1` : source.endpoint
      let res = await authFetch(endpoint, { signal: controller.signal, cache: "no-store" })
      let read = source.read
      if (source.legacy && !res.ok && !controller.signal.aborted) {
        res = await authFetch(source.legacy.endpoint, { signal: controller.signal })
        read = source.legacy.read
      }
      if (!isCurrentRequest()) return

      if (res.status === 501 || res.status === 404) {
        setAvailable(false)
        return
      }

      if (!res.ok) {
        // Credentials found (available) but API failed — keep showing stale data
        setAvailable(true)
        return
      }

      const data = await res.json() as Record<string, unknown>
      if (!isCurrentRequest()) return
      const mapped = read(data)
      setAvailable(mapped !== null)
      setUsage(mapped ? { ...mapped, agentKind, fetchedAt: Date.now() } : null)
    } catch {
      // Network error — don't change available state or clear existing data
    } finally {
      if (isCurrentRequest()) {
        activeRequestRef.current = null
        setLoading(false)
      }
    }
  }, [agentKind, canViewUsage])

  useEffect(() => {
    setUsage(null)
    setAvailable(false)
    if (!canViewUsage) {
      setLoading(false)
      requestIdRef.current += 1
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
      return
    }
    const source = quotaSourceFor(agentKind)
    const scope = getActiveDeviceScope()
    const poll = () => { if (document.visibilityState !== "hidden") void fetchUsage() }
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const completed = (event: Event) => {
      const detail = (event as CustomEvent<UsageRefreshDetail>).detail
      if (detail?.agentKind !== agentKind || detail.scope !== scope) return
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      for (const delay of source.completionRefreshDelaysMs ?? [0]) {
        if (delay === 0) { void fetchUsage(true); continue }
        const timer = setTimeout(() => { timers.delete(timer); if (document.visibilityState !== "hidden") void fetchUsage(true) }, delay)
        timers.add(timer)
      }
    }
    poll()
    const id = setInterval(poll, source.pollIntervalMs ?? POLL_INTERVAL)
    window.addEventListener("focus", poll)
    document.addEventListener("visibilitychange", poll)
    window.addEventListener(USAGE_REFRESH_EVENT, completed)
    return () => {
      clearInterval(id)
      for (const timer of timers) clearTimeout(timer)
      window.removeEventListener("focus", poll)
      document.removeEventListener("visibilitychange", poll)
      window.removeEventListener(USAGE_REFRESH_EVENT, completed)
      requestIdRef.current += 1
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
    }
  }, [agentKind, canViewUsage, fetchUsage])

  const refresh = useCallback(() => { void fetchUsage(true) }, [fetchUsage])

  return {
    usage: canViewUsage ? usage : null,
    loading: canViewUsage && loading,
    available: canViewUsage && available,
    refresh,
  }
}
