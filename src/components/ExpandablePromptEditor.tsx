import { useTranslation } from "@/hooks/useTranslation"
import { useRef, useState, type ClipboardEventHandler, type RefObject } from "react"
import { Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

interface ExpandablePromptEditorProps {
  value: string
  onChange: (value: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>
}

/** A larger view of the same draft; closing never submits or discards it. */
export function ExpandablePromptEditor({ value, onChange, inputRef, onPaste }: ExpandablePromptEditorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const selection = useRef({ start: 0, end: 0 })
  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (next && inputRef.current) selection.current = { start: inputRef.current.selectionStart, end: inputRef.current.selectionEnd }
      setOpen(next)
    }}>
      {value.includes("\n") && (
        <DialogTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={t("Expand prompt editor")} title={t("Expand prompt editor")} className="absolute right-2 top-2 z-10 bg-popover text-muted-foreground" />}>
          <Maximize2 />
        </DialogTrigger>
      )}
      <DialogContent
        className="flex h-[min(80dvh,48rem)] min-h-0 flex-col sm:max-w-4xl"
        initialFocus={() => {
          const editor = editorRef.current
          editor?.setSelectionRange(selection.current.start, selection.current.end)
          return editor
        }}
        finalFocus={() => {
          const input = inputRef.current
          input?.setSelectionRange(selection.current.start, selection.current.end)
          return input
        }}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t("Edit prompt")}</DialogTitle>
          <DialogDescription>{t("Enter starts a new line. Done returns to the chat without sending.")}</DialogDescription>
        </DialogHeader>
        <Textarea
          ref={editorRef}
          aria-label={t("Expanded prompt")}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onSelect={(event) => { selection.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd } }}
          onPaste={onPaste}
          className="min-h-0 flex-1 resize-none overflow-y-auto text-sm"
        />
        <DialogFooter className="shrink-0">
          <Button type="button" onClick={() => setOpen(false)}>{t("Done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
