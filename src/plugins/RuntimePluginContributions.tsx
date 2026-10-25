import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { evaluateCompatibility, parsePluginBlockLanguage, utf8Length, type PluginContext } from "@cogpit/plugin-contracts"
import type { InstalledPlugin } from "../../shared/contracts/plugins"
import type { PluginProjectSummary } from "../../shared/contracts/pluginManagement"
import { PluginFrame } from "./PluginFrame"
import { clientRuntimeDescriptor, type RuntimePluginClient, type RuntimePluginState } from "./runtimeClient"
import { createRuntimePanelActivation, type RuntimePanelActivation } from "./runtimePanelActivation"
import { pluginPanelContext, usePluginPresentation } from "./runtimeContext"
import { useRuntimeProject } from "./useRuntimeProject"
import { useBrowserSafeMode } from "./browserSafeMode"

interface ContributionsContext extends RuntimePluginState { client: RuntimePluginClient; project: PluginProjectSummary | null; workspacePath: string | null }
const Contributions = createContext<ContributionsContext | null>(null)
export const useRuntimeContributions = () => useContext(Contributions)

export function RuntimePluginContributions({ runtime, workspacePath, children }: {
  runtime: RuntimePluginState & { client: RuntimePluginClient }; workspacePath: string | null; children: ReactNode
}) {
  const safeMode = useBrowserSafeMode()
  const { project, resolving } = useRuntimeProject({ ...runtime, projectPath: workspacePath })
  const { client, status, error, activation } = runtime
  const value = useMemo(() => ({ client, status, error, activation: safeMode || resolving ? "" : activation, project, workspacePath }), [client, status, error, activation, safeMode, resolving, project, workspacePath])
  return <Contributions.Provider value={value}>{children}</Contributions.Provider>
}

export function RuntimePluginBlock({ language, source, instanceKey, fallback }: { language: string; source: string; instanceKey: string; fallback: ReactNode }) {
  const runtime = useContext(Contributions)
  const target = parsePluginBlockLanguage(language)
  const plugin = runtime?.status?.store.plugins.find(plugin => plugin.id === target?.pluginId)
  const block = plugin?.manifest.contributes.chatBlocks?.find(block => block.id === target?.blockId)
  if (!runtime?.activation || !runtime.status?.store.available || runtime.status.safeMode || !plugin?.enabled || !block || utf8Length(source) > 16384
    || plugin.scope.type === "projects" && (!runtime.project || !plugin.scope.projectIds.includes(runtime.project.id))
    || !evaluateCompatibility(plugin.manifest, clientRuntimeDescriptor(), runtime.status.runtime, { allowPrerelease: plugin.manifest.publisher.startsWith("dev-") }).compatible) return <>{fallback}</>
  const key = JSON.stringify([runtime.activation, runtime.status.store.revision, plugin.selectedDigest, runtime.project?.id, runtime.workspacePath, block.id, instanceKey, source])
  return <ViewportBlock key={key} runtime={runtime} plugin={plugin} block={block} source={source} fallback={fallback} />
}

function ViewportBlock({ runtime, plugin, block, source, fallback }: {
  runtime: ContributionsContext; plugin: InstalledPlugin; block: { id: string; title: string; height: number }; source: string; fallback: ReactNode
}) {
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [height, setHeight] = useState(block.height)
  useEffect(() => {
    if (!element.current) return
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: "200px" })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  return <div ref={element} style={{ minHeight: height }} className="my-3" data-plugin-block={`${plugin.id}:${block.id}`}>
    {visible ? <ActiveBlock runtime={runtime} plugin={plugin} block={block} source={source} height={height} resize={setHeight} fallback={fallback} />
      : <div className="rounded-lg border bg-card p-3 text-sm"><p className="mb-2 font-medium">{block.title}</p><p className="whitespace-pre-wrap">{source}</p></div>}
  </div>
}

function ActiveBlock({ runtime, plugin, block, source, height, resize, fallback }: {
  runtime: ContributionsContext; plugin: InstalledPlugin; block: { id: string; title: string }; source: string; height: number; resize: (height: number) => void; fallback: ReactNode
}) {
  const presentation = usePluginPresentation()
  const [loaded, setLoaded] = useState<{ payload: ArrayBuffer; leaseId: string; activation: RuntimePanelActivation } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [epoch] = useState(() => crypto.randomUUID())
  useEffect(() => {
    const activation = createRuntimePanelActivation({
      client: runtime.client, pluginId: plugin.id, digest: plugin.selectedDigest, projectId: runtime.project?.id ?? null,
      workspacePath: runtime.project ? runtime.workspacePath : null, contextEpoch: epoch, active: true, resize,
      onLoaded: (payload, leaseId) => setLoaded({ payload, leaseId, activation }), onError: failure => setError(failure.message),
    })
    return () => activation.dispose()
  }, [runtime.client, runtime.project, runtime.workspacePath, plugin.id, plugin.selectedDigest, epoch, resize])
  const context: PluginContext = { ...pluginPanelContext(plugin.manifest, runtime.project, true, presentation), surface: { type: "chat-block", id: block.id, source } }
  if (error) return <>{fallback}<p role="alert" className="text-sm text-destructive">{block.title} could not load. {error}</p></>
  if (!loaded) return <div role="status" className="rounded-lg border bg-card p-3 text-sm">Loading {block.title}…</div>
  return <div style={{ height }}><PluginFrame payload={loaded.payload} digest={plugin.selectedDigest} activationKey={`${epoch}:${loaded.leaseId}`}
    context={context} active title={block.title} execute={loaded.activation.execute} onError={loaded.activation.fail} /></div>
}
