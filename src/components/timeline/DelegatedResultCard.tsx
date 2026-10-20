import { useTranslation } from "@/hooks/useTranslation"
import { ChevronRight } from "lucide-react"
import type { TaskWakeup } from "../../../shared/contracts/taskWakeup"
import { useSessionInventoryOptional } from "@/contexts/SessionInventoryContext"
import { inventorySession } from "@/components/LiveSessions/inventorySession"
import { revealSessionById } from "@/lib/revealSession"
import { Button } from "@/components/ui/button"
import { TaskNotificationCard } from "./TaskNotificationCard"

interface ChildResult {
  turn?: { reply?: unknown } | null
  filesChanged?: unknown
  /** Changed files a long result left out of `filesChanged`. */
  filesChangedOmitted?: unknown
}

function describeResult(result: unknown): { reply: string; raw: string } {
  if (typeof result === "string") return { reply: "", raw: result }
  const { turn, filesChanged, filesChangedOmitted } = (result ?? {}) as ChildResult
  const reply = typeof turn?.reply === "string" ? turn.reply : ""
  const files = (Array.isArray(filesChanged) ? filesChanged.length : 0) + (typeof filesChangedOmitted === "number" ? filesChangedOmitted : 0)
  const changed = files ? `\n\n_${files === 1 ? "1 file" : `${files} files`} changed_` : ""
  return { reply: reply + changed, raw: "" }
}

/** The prompt that wakes this session when a delegated session finishes, shown as that session's result. */
export function DelegatedResultCard({ wakeup }: { wakeup: TaskWakeup }) {
  const { t } = useTranslation()
  const child = inventorySession(useSessionInventoryOptional(), wakeup.childSessionId)
  const { reply, raw } = describeResult(wakeup.result)
  return (
    <TaskNotificationCard
      notification={{
        taskId: wakeup.taskId,
        toolUseId: "",
        outputFile: "",
        status: wakeup.state,
        summary: child?.title ?? "Delegated session",
        result: reply,
        event: raw,
      }}
      action={(
        <Button variant="ghost" size="xs" onClick={() => child ? child.open() : void revealSessionById(wakeup.childSessionId)}>
          {t("Open")}<ChevronRight data-icon="inline-end" />
        </Button>
      )}
    />
  )
}
