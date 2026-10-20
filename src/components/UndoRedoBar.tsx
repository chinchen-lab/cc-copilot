import { useTranslation } from "@/hooks/useTranslation"
import { RotateCcw, ChevronsRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

interface UndoRedoBarProps {
  redoTurnCount: number
  onRedoAll: () => void
}

export function UndoRedoBar({ redoTurnCount, onRedoAll }: UndoRedoBarProps) {
  const { t } = useTranslation()
  if (redoTurnCount <= 0) return null

  return (
    <div className="sticky bottom-0 flex items-center justify-center gap-3 border-t border-border bg-popover px-4 py-2" role="status">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <RotateCcw className="size-4" data-icon="inline-start" />
          <span className="font-mono">{redoTurnCount}</span>
          <span>{t("turn")}{redoTurnCount !== 1 ? "s" : ""} {t(" archived")}</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <Button
          variant="default"
          size="sm"
          onClick={onRedoAll}
        >
          <ChevronsRight data-icon="inline-start" />
          {t("Redo all")}
        </Button>
    </div>
  )
}
