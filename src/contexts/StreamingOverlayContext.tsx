import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react"
import { EMPTY_OVERLAY, type StreamingOverlay } from "@/lib/streamingOverlay"
import type { StreamingOverlayStore } from "@/lib/streamingOverlayStore"

const EMPTY_AGENT_PROGRESS: Record<string, string> = {}

/**
 * Dedicated context for the token-streaming overlay.
 *
 * Deliberately separate from SessionContext: the overlay updates at up to
 * ~13 Hz while a turn streams, and putting it on the session context would
 * re-render every session consumer on each flush. Only the running-turn
 * overlay and live subagent transcripts subscribe here.
 */
const StreamingOverlayContext = createContext<StreamingOverlay | StreamingOverlayStore>(EMPTY_OVERLAY)

/**
 * Latest AI-generated progress line per running subagent, keyed by the
 * Task/Agent tool_use id. Provided here rather than on SessionContext because
 * it has exactly the same audience as the overlay — the live subagent panes —
 * and updates on the same lifecycle (it is dropped whenever the overlay is).
 * Its own context so a ~30s summary does not re-render overlay consumers.
 */
const AgentProgressContext = createContext<Record<string, string>>(EMPTY_AGENT_PROGRESS)

interface StreamingOverlayProviderProps {
  value?: StreamingOverlay
  store?: StreamingOverlayStore
  agentProgress?: Record<string, string>
  children: ReactNode
}

export function StreamingOverlayProvider({
  value = EMPTY_OVERLAY,
  store,
  agentProgress = EMPTY_AGENT_PROGRESS,
  children,
}: StreamingOverlayProviderProps): ReactNode {
  return (
    <StreamingOverlayContext.Provider value={store ?? value}>
      <AgentProgressContext.Provider value={agentProgress}>
        {children}
      </AgentProgressContext.Provider>
    </StreamingOverlayContext.Provider>
  )
}

const noSubscribe = () => () => {}

export function useStreamingOverlay(): StreamingOverlay {
  const source = useContext(StreamingOverlayContext)
  const store = "snapshot" in source ? source : null
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.snapshot ?? (() => source as StreamingOverlay))
}

/** The running subagent's current progress line, or null before the first fork lands. */
export function useAgentProgress(toolUseId: string | undefined): string | null {
  const progress = useContext(AgentProgressContext)
  return toolUseId ? progress[toolUseId] ?? null : null
}
