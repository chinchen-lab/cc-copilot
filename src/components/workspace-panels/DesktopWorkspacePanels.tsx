import { useLayoutEffect, useRef, type ReactNode } from "react"
import type { GroupImperativeHandle } from "react-resizable-panels"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import type {
  RegisteredWorkspacePanel,
  WorkspacePanelContext,
} from "@/plugin-api"
import {
  BuiltInPanelServicesProvider,
  type BuiltInPanelServices,
} from "./BuiltInPanelServices"
import {
  WorkspaceActivityBar,
  WorkspacePanelHost,
  type WorkspaceActivityAction,
} from "./WorkspaceActivityBar"

interface DesktopWorkspacePanelsProps {
  children: ReactNode
  panels: readonly RegisteredWorkspacePanel[]
  context: WorkspacePanelContext
  activePanel: RegisteredWorkspacePanel | null
  services: BuiltInPanelServices
  onClosePanel: () => void
  onTogglePanel: (panelId: string) => void
  actions?: readonly WorkspaceActivityAction[]
  expanded?: boolean
  onToggleExpanded?: () => void
}

function mainPanelDefaultSize(panelSize?: string): string {
  const match = panelSize?.match(/^(\d+(?:\.\d+)?)%$/)
  if (!match) return "64%"
  const percentage = Number(match[1])
  return percentage > 0 && percentage < 100 ? `${100 - percentage}%` : "64%"
}

export function DesktopWorkspacePanels({
  children,
  panels,
  context,
  activePanel,
  services,
  onClosePanel,
  onTogglePanel,
  actions,
  expanded = false,
  onToggleExpanded,
}: DesktopWorkspacePanelsProps) {
  const group = useRef<GroupImperativeHandle | null>(null)
  const previousLayout = useRef<Record<string, number> | null>(null)
  useLayoutEffect(() => {
    if (expanded || !previousLayout.current) return
    if (activePanel) group.current?.setLayout(previousLayout.current)
    previousLayout.current = null
  }, [expanded, activePanel])

  function toggleExpanded() {
    if (!expanded) previousLayout.current = group.current?.getLayout() ?? null
    onToggleExpanded?.()
  }

  return (
    <>
      <ResizablePanelGroup groupRef={group} disabled={expanded} orientation="horizontal" className="min-h-0 min-w-0 w-auto flex-1">
        <ResizablePanel
          id="workspace-main"
          defaultSize={activePanel
            ? mainPanelDefaultSize(activePanel.defaultSize)
            : "100%"}
          minSize={expanded ? "0%" : "320px"}
          maxSize={expanded ? "0%" : "100%"}
        >
          <div className="h-full min-h-0" hidden={expanded} inert={expanded}>{children}</div>
        </ResizablePanel>

        {activePanel && (
          <>
            <ResizableHandle withHandle className={expanded ? "hidden" : undefined} />
            <ResizablePanel
              id="workspace-panel"
              defaultSize={activePanel.defaultSize ?? "36%"}
              minSize={expanded ? "100%" : activePanel.minSize ?? "300px"}
              maxSize={expanded ? "100%" : activePanel.maxSize ?? "70%"}
            >
              <BuiltInPanelServicesProvider value={services}>
                <WorkspacePanelHost
                  panels={panels}
                  context={context}
                  activePanelId={activePanel.id}
                  onClosePanel={onClosePanel}
                />
              </BuiltInPanelServicesProvider>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <WorkspaceActivityBar
        panels={panels}
        context={context}
        activePanelId={activePanel?.id ?? null}
        onTogglePanel={onTogglePanel}
        actions={actions}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded ? toggleExpanded : undefined}
      />
    </>
  )
}
