import { useEffect, useRef, useState } from "react"
import { evaluateCompatibility } from "@cogpit/plugin-contracts"
import { useSessionChatContextOptional, useSessionContextOptional } from "@/contexts/SessionContext"
import { Button } from "@/components/ui/button"
import { clientRuntimeDescriptor } from "./runtimeClient"
import { useRuntimeContributions } from "./RuntimePluginContributions"

export function RuntimePluginActions() {
  const runtime = useRuntimeContributions()
  return runtime ? <PluginActions runtime={runtime} /> : null
}

function PluginActions({ runtime }: { runtime: NonNullable<ReturnType<typeof useRuntimeContributions>> }) {
  const session = useSessionContextOptional()
  const chat = useSessionChatContextOptional()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef({ epoch: 0, locked: false })
  const sessionId = session?.session?.sessionId
  useEffect(() => { const state = request.current; state.epoch++; state.locked = false; setBusy(null); setError(null); return () => { state.epoch++; state.locked = false } }, [sessionId, runtime.activation])
  if (!runtime?.activation || !runtime.status?.store.available || runtime.status.safeMode || !chat || !sessionId || session?.permissions.send === false) return null
  const actions = runtime.status.store.plugins.filter(plugin => plugin.enabled
    && (plugin.scope.type === "all" || !!runtime.project && plugin.scope.projectIds.includes(runtime.project.id))
    && evaluateCompatibility(plugin.manifest, clientRuntimeDescriptor(), runtime.status!.runtime, { allowPrerelease: plugin.manifest.publisher.startsWith("dev-") }).compatible)
    .flatMap(plugin => (plugin.manifest.contributes.sessionActions ?? []).map(action => ({ ...action, key: `${plugin.id}:${action.id}` })))
  if (!actions.length) return null
  const disabled = !!busy
  async function invoke(action: typeof actions[number]) {
    const state = request.current
    if (!chat || disabled || state.locked) return
    state.locked = true
    const id = ++state.epoch
    setBusy(action.key); setError(null)
    try { if (!await chat.chat.sendMessage(action.prompt) && state.epoch === id) setError("The request could not be sent. Try again when the session is ready.") }
    catch { if (state.epoch === id) setError("The request could not be sent.") }
    finally { if (state.epoch === id) { state.locked = false; setBusy(null) } }
  }
  return <div className="flex flex-wrap items-center gap-1">
    {actions.map(action => <Button key={action.key} type="button" size="xs" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={disabled} aria-busy={busy === action.key} onClick={() => { void invoke(action) }}>{busy === action.key ? "Sending…" : action.title}</Button>)}
    {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
  </div>
}
