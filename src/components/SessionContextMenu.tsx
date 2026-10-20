import { useTranslation } from "@/hooks/useTranslation"
import { useState, useRef } from "react"
import { Archive, ArchiveRestore, Copy, Trash2, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

interface SessionContextMenuProps {
  children: React.ReactNode
  sessionLabel: string
  customName?: string
  onDuplicate?: () => void
  onDelete?: () => void
  onRename?: (name: string) => void
  onArchive?: () => void
  onUnarchive?: () => void
  /** A running session cannot be archived — it would only come straight back. */
  archiveDisabled?: boolean
}

export function SessionContextMenu({
  children,
  sessionLabel,
  customName,
  onDuplicate,
  onDelete,
  onRename,
  onArchive,
  onUnarchive,
  archiveDisabled = false,
}: SessionContextMenuProps) {
  const { t } = useTranslation()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)

  function openRename(): void {
    setRenameValue(customName || "")
    setShowRename(true)
    requestAnimationFrame(() => renameInputRef.current?.select())
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={<div className="w-full" />}>{children}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-44">
          {(onRename || onDuplicate || onArchive || onUnarchive) && (
            <ContextMenuGroup>
              {onRename && (
                <ContextMenuItem onClick={openRename}>
                  <Pencil data-icon="inline-start" />
                  {t("Rename session")}
                </ContextMenuItem>
              )}
              {onDuplicate && (
                <ContextMenuItem onClick={onDuplicate}>
                  <Copy data-icon="inline-start" />
                  {t("Duplicate session")}
                </ContextMenuItem>
              )}
              {onUnarchive ? (
                <ContextMenuItem onClick={onUnarchive}>
                  <ArchiveRestore data-icon="inline-start" />
                  {t("Restore from archive")}
                </ContextMenuItem>
              ) : onArchive && (
                <ContextMenuItem onClick={onArchive} disabled={archiveDisabled}>
                  <Archive data-icon="inline-start" />
                  {archiveDisabled ? t("Archive (stop the session first)") : t("Archive session")}
                </ContextMenuItem>
              )}
            </ContextMenuGroup>
          )}
          {onDelete && (
            <>
              {(onDuplicate || onRename || onArchive || onUnarchive) && <ContextMenuSeparator />}
              <ContextMenuGroup>
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 data-icon="inline-start" />
                  {t("Delete session")}
                </ContextMenuItem>
              </ContextMenuGroup>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete session?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This will permanently delete")}{" "}
              <span className="font-medium text-foreground">{sessionLabel}</span>{t(". This action cannot be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              onClick={() => {
                onDelete?.()
                setShowDeleteConfirm(false)
              }}
            >
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showRename} onOpenChange={setShowRename}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">{t("Rename session")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("Give this session a custom name. Clear to reset to default.")}
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              onRename?.(renameValue)
              setShowRename(false)
            }}
          >
            <Field>
              <FieldLabel htmlFor="session-rename">{t("Session name")}</FieldLabel>
              <Input
                id="session-rename"
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder={sessionLabel}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowRename(false)}
              >
                {t("Cancel")}
              </Button>
              <Button type="submit" size="sm">
                {t("Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
