import { useTranslation } from "@/hooks/useTranslation"
import { memo } from "react"
import { LiveSessions } from "@/components/LiveSessions"
import { cn } from "@/lib/utils"
import type { SessionBrowserProps } from "./types"

export const SessionBrowser = memo(function SessionBrowser({
  activeSessionKey,
  activeProject,
  onSelectSession,
  onNewSession,
  creatingSession,
  isMobile,
  onDuplicateSession,
  onDeleteSession,
  pendingSession,
  liveSessionsRefreshRef,
  onPrefetchSession,
  header,
}: SessionBrowserProps): React.ReactElement {
  const { t } = useTranslation()
  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-sidebar",
        isMobile ? "w-full" : "w-80",
      )}
      aria-label={t("Session browser")}
    >
      {header}
      <LiveSessions
        activeSessionKey={activeSessionKey}
        activeProject={activeProject}
        onSelectSession={onSelectSession}
        onDuplicateSession={onDuplicateSession}
        onDeleteSession={onDeleteSession}
        onNewSession={onNewSession}
        creatingSession={creatingSession}
        pendingSession={pendingSession}
        refreshRef={liveSessionsRefreshRef}
        onPrefetchSession={onPrefetchSession}
      />
    </aside>
  )
})
