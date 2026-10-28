import { useEffect } from "react"
import { useTokenUsage } from "@/hooks/useTokenUsage"
import { useTranslation } from "@/hooks/useTranslation"
import type { AgentKind } from "@/lib/agents"
import { TokenUsageDetails } from "@/components/TokenUsageWidget"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function UsageDialog({ agentKind, onClose }: { agentKind: AgentKind; onClose: () => void }) {
  const { t } = useTranslation()
  const { usage, loading, available, refresh } = useTokenUsage(agentKind)
  useEffect(() => { refresh() }, [refresh])
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t("Usage")}</DialogTitle>
        <DialogDescription>{t("Account quota and reset times.")}</DialogDescription>
      </DialogHeader>
      {loading && <p role="status" className="text-sm text-muted-foreground">{t("Loading…")}</p>}
      {available && usage && <TokenUsageDetails usage={usage} />}
      {!loading && (!available || !usage) && <p role="status" className="text-sm text-muted-foreground">{t("Usage unavailable. Refresh to try again.")}</p>}
      <Button variant="outline" onClick={refresh} disabled={loading}>{t("Refresh")}</Button>
    </DialogContent>
  </Dialog>
}
