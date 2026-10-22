import { Dialog, DialogContent } from "@/components/ui/dialog"
import { SessionFileDiffContent } from "@/components/timeline/EditDiffView"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  filePath: string
  oldString: string
  newString: string
  startLine: number
}

export function SessionFileDiffDialog({ open, onOpenChange, filePath, oldString, newString, startLine }: Props) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[calc(100dvh-5rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-[calc(100vw-2rem)]">
      <SessionFileDiffContent oldString={oldString} newString={newString} filePath={filePath} startLine={startLine} />
    </DialogContent>
  </Dialog>
}
