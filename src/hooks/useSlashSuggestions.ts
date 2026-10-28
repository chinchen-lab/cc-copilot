import { useState, useEffect } from "react"
import { authFetch } from "@/lib/auth"
import { DEFAULT_AGENT_KIND, type AgentKind } from "@/lib/agents"
import type { SlashSuggestion } from "../../shared/contracts/projectTools"

export function useSlashSuggestions(cwd: string | undefined, enabled = true, agentKind: AgentKind = DEFAULT_AGENT_KIND) {
  const [suggestions, setSuggestions] = useState<SlashSuggestion[]>([])
  const [loading, setLoading] = useState(false)

  // Fetch suggestions when cwd changes
  useEffect(() => {
    if (!enabled) {
      setSuggestions([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setSuggestions([])
    setLoading(true)
    const params = new URLSearchParams({ agentKind })
    if (cwd) params.set("cwd", cwd)
    authFetch(`/api/slash-suggestions?${params}`, { signal: controller.signal, cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error("Failed to load suggestions"); return r.json() })
      .then((data) => { if (!controller.signal.aborted) setSuggestions(data.suggestions || []) })
      .catch(() => { if (!controller.signal.aborted) setSuggestions([]) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [cwd, enabled, agentKind])

  return { suggestions, loading }
}
