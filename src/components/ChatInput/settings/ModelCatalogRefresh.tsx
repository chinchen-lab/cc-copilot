import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { loadModelCatalog } from "@/hooks/useModelOptions"

/** Ask the installed providers again, bypassing both browser and server caches. */
export function ModelCatalogRefresh() {
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    setFailed(false)
    try { await loadModelCatalog(true) }
    catch { setFailed(true) }
    finally { setRefreshing(false) }
  }
  return (
    <span className="inline-flex items-center gap-1">
      {failed && <span role="alert" className="text-xs text-destructive">Refresh failed. Try again.</span>}
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Refresh models" title="Refresh models from installed providers" disabled={refreshing} onClick={() => void refresh()}>
        <RefreshCw className={refreshing ? "motion-safe:animate-spin" : undefined} />
      </Button>
    </span>
  )
}
