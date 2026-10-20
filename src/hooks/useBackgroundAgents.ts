import { useCallback, useState } from "react"
import { authFetch } from "@/lib/auth"
import { useVisiblePolling } from "@/hooks/useVisiblePolling"

export interface BgAgent {
  agentId: string
  dirName: string
  fileName: string
  parentSessionId: string
  modifiedAt: number
  isActive: boolean
  preview: string
}

const NO_AGENTS: BgAgent[] = []

export function useBackgroundAgents(cwd: string | null): BgAgent[] {
  const [result, setResult] = useState<{ cwd: string; agents: BgAgent[] } | null>(null)
  const poll = useCallback(async (isActive: () => boolean) => {
    if (!cwd) return
    try {
      const res = await authFetch(`/api/background-agents?cwd=${encodeURIComponent(cwd)}`)
      if (!res.ok) return
      const agents = await res.json() as BgAgent[]
      if (!isActive()) return
      setResult((current) => current?.cwd === cwd && JSON.stringify(current.agents) === JSON.stringify(agents)
        ? current
        : { cwd, agents })
    } catch {
      // The next visible poll retries.
    }
  }, [cwd])
  useVisiblePolling(cwd ? poll : null, 5_000)
  return result && result.cwd === cwd ? result.agents : NO_AGENTS
}
