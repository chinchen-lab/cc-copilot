import { useTranslation } from "@/hooks/useTranslation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ChevronRight, Folder, FolderOpen, FolderTree, type LucideIcon } from "lucide-react"
import { Virtualizer, type VirtualizerHandle } from "virtua"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/Spinner"
import { authFetch } from "@/lib/auth"
import { fileTypeIcon } from "@/lib/fileTypeColors"
import { cn } from "@/lib/utils"
import type { ProjectTreeEntry } from "../../shared/contracts/projectTools"

export interface FileStatusMark {
  code: string
  label: string
  className: string
}

interface ProjectFileTreeProps {
  cwd: string
  selectedPath: string | null
  onSelect: (path: string) => void
  /** Git status for a file, if it is changed. */
  fileStatus: (path: string) => FileStatusMark | null
  /** Bumped by the parent to re-read every open directory, bypassing the server cache. */
  reloadToken: number
  includeIgnored?: boolean
}

type DirectoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: ProjectTreeEntry[]; scanLimited: boolean }

const INDENT_PX = 12
const VIRTUALIZE_THRESHOLD = 100
const ROW_CLASS = "h-6 w-full justify-start gap-1 rounded-none px-2 text-left font-normal"

/** Rows without a chevron of their own line up past where one would be. */
function indentStyle(depth: number, hasChevron: boolean) {
  return { paddingLeft: 8 + depth * INDENT_PX + (hasChevron ? 0 : 16) }
}

function isTreeEntry(value: unknown): value is ProjectTreeEntry {
  const entry = value as ProjectTreeEntry | null
  return typeof entry === "object" && entry !== null
    && typeof entry.name === "string"
    && (entry.type === "file" || entry.type === "directory")
}

function parseEntries(data: unknown): ProjectTreeEntry[] {
  const entries = (data as { entries?: unknown })?.entries
  return Array.isArray(entries) ? entries.filter(isTreeEntry) : []
}

async function fetchDirectory(cwd: string, directory: string, refresh: boolean, includeIgnored: boolean, signal: AbortSignal): Promise<DirectoryState> {
  try {
    const response = await authFetch(
      `/api/project-files/tree?cwd=${encodeURIComponent(cwd)}&dir=${encodeURIComponent(directory)}${refresh ? "&refresh=1" : ""}${includeIgnored ? "&includeIgnored=1" : ""}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
    )
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      const message = (body as { error?: unknown } | null)?.error
      throw new Error(typeof message === "string" ? message : "Unable to list directory")
    }
    const data: unknown = await response.json()
    return {
      status: "ready",
      entries: parseEntries(data),
      scanLimited: (data as { scanLimited?: unknown }).scanLimited === true,
    }
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unable to list directory" }
  }
}

/** Every directory prefix of `path`, shallowest first. */
function ancestorsOf(path: string): string[] {
  const segments = path.split("/")
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"))
}

export function ProjectFileTree({ cwd, selectedPath, onSelect, fileStatus, reloadToken, includeIgnored = false }: ProjectFileTreeProps) {
  const { t } = useTranslation()
  const [directories, setDirectories] = useState<Map<string, DirectoryState>>(() => new Map())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const requestsRef = useRef(new Map<string, AbortController>())
  const generationRef = useRef(0)
  const virtualizerRef = useRef<VirtualizerHandle>(null)

  const loadDirectory = useCallback(async (directory: string, refresh = false) => {
    const requests = requestsRef.current
    if (requests.has(directory)) return
    const controller = new AbortController()
    const generation = generationRef.current
    requests.set(directory, controller)
    setDirectories((current) => new Map(current).set(directory, { status: "loading" }))
    const result = await fetchDirectory(cwd, directory, refresh, includeIgnored, controller.signal)
    if (requests.get(directory) === controller) requests.delete(directory)
    if (controller.signal.aborted || generation !== generationRef.current) return
    setDirectories((current) => new Map(current).set(directory, result))
  }, [cwd, includeIgnored])

  const loadedCwdRef = useRef<string | null>(null)
  useEffect(() => {
    const refresh = loadedCwdRef.current === cwd
    loadedCwdRef.current = cwd
    if (!refresh) setExpanded(new Set())
    setDirectories(new Map())
    void loadDirectory("", refresh)
    const requests = requestsRef.current
    return () => {
      generationRef.current += 1
      for (const controller of requests.values()) controller.abort()
      requests.clear()
    }
  }, [cwd, reloadToken, loadDirectory])

  // Keep the open file visible: expand every directory on its path.
  useEffect(() => {
    if (!selectedPath) return
    const ancestors = ancestorsOf(selectedPath)
    if (ancestors.length === 0) return
    setExpanded((current) => {
      if (ancestors.every((directory) => current.has(directory))) return current
      const next = new Set(current)
      for (const directory of ancestors) next.add(directory)
      return next
    })
  }, [selectedPath])

  const toggle = useCallback((directory: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(directory)) next.delete(directory)
      else next.add(directory)
      return next
    })
  }, [])

  // Flatten the expanded branches, then let the virtualizer mount only rows
  // near the viewport. Loading is independent of row mounting, so selected
  // files can reveal ancestors that are currently off screen.
  const rows = useMemo(() => visibleRows(directories, expanded), [directories, expanded])
  useEffect(() => {
    for (const row of rows) {
      if (row.kind === "status" && !directories.has(row.path)) void loadDirectory(row.path)
    }
  }, [rows, directories, loadDirectory])
  const selectedIndex = rows.findIndex((row) => row.kind === "entry" && row.path === selectedPath)
  useEffect(() => {
    if (selectedIndex >= 0) virtualizerRef.current?.scrollToIndex(selectedIndex, { align: "nearest" })
  }, [selectedIndex])

  const placeholder = rootPlaceholder(directories.get(""))
  const renderRow = (row: TreeRow) => {
    if (row.kind === "status") return <DirectoryStatus key={`status:${row.path}`} state={directories.get(row.path)} depth={row.depth} directory={row.path} onRetry={loadDirectory} />
    if (row.kind === "warning") return <p key={`warning:${row.path}`} className="h-6 truncate px-3 text-xs text-muted-foreground">{t("This project is too large to scan completely.")}</p>
    if (row.entry.type === "directory") return <DirectoryRow key={row.path} path={row.path} name={row.entry.name} depth={row.depth} open={expanded.has(row.path)} onToggle={toggle} />
    return <FileRow key={row.path} path={row.path} name={row.entry.name} depth={row.depth} selected={selectedPath === row.path} status={fileStatus(row.path)} onSelect={onSelect} />
  }
  return (
    <div aria-label={t("Project file tree")} className="min-h-0 flex-1 overflow-auto py-1">
      {placeholder ? (
        <Empty className="min-h-48 rounded-none p-4">
          <EmptyHeader>
            <EmptyMedia variant="icon"><placeholder.Icon /></EmptyMedia>
            <EmptyTitle>{t(placeholder.title)}</EmptyTitle>
            <EmptyDescription>{t(placeholder.description)}</EmptyDescription>
          </EmptyHeader>
          {directories.get("")?.status === "error" && (
            <Button variant="outline" size="sm" onClick={() => loadDirectory("")}>{t("Retry")}</Button>
          )}
        </Empty>
      ) : (
        rows.length > VIRTUALIZE_THRESHOLD
          ? <Virtualizer ref={virtualizerRef} data={rows} itemSize={24}>{renderRow}</Virtualizer>
          : rows.map(renderRow)
      )}
    </div>
  )
}

type TreeRow =
  | { kind: "entry"; path: string; depth: number; entry: ProjectTreeEntry }
  | { kind: "status"; path: string; depth: number }
  | { kind: "warning"; path: string; depth: number }

function visibleRows(directories: Map<string, DirectoryState>, expanded: Set<string>): TreeRow[] {
  const rows: TreeRow[] = []
  const append = (directory: string, depth: number) => {
    const state = directories.get(directory)
    if (!state || state.status !== "ready") {
      rows.push({ kind: "status", path: directory, depth })
      return
    }
    for (const entry of state.entries) {
      const path = directory ? `${directory}/${entry.name}` : entry.name
      rows.push({ kind: "entry", path, depth, entry })
      if (entry.type === "directory" && expanded.has(path)) append(path, depth + 1)
    }
    if (state.scanLimited) rows.push({ kind: "warning", path: directory, depth })
  }
  append("", 0)
  return rows
}

function rootPlaceholder(root: DirectoryState | undefined): { Icon: LucideIcon; title: string; description: string } | null {
  if (root?.status === "error") return { Icon: AlertTriangle, title: "Could not load files", description: root.message }
  if (root?.status === "ready" && root.entries.length === 0) {
    return { Icon: FolderTree, title: "No files", description: "This project has no files to show." }
  }
  return null
}

function DirectoryStatus({ state, depth, directory, onRetry }: {
  state: DirectoryState | undefined
  depth: number
  directory: string
  onRetry: (directory: string) => void
}) {
  const { t } = useTranslation()
  if (state?.status === "error") {
    return (
      <div role="alert" className="flex h-6 items-center gap-1.5 text-xs text-destructive" style={indentStyle(depth, false)} title={state.message}>
        <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">{state.message}</span>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onRetry(directory)}>{t("Retry")}</Button>
      </div>
    )
  }
  return (
    <div role="status" className="flex h-6 items-center gap-2 text-xs text-muted-foreground" style={indentStyle(depth, false)}>
      <Spinner className="size-3" />
      {directory === "" && t("Loading files…")}
    </div>
  )
}

function DirectoryRow({ path, name, depth, open, onToggle }: {
  path: string
  name: string
  depth: number
  open: boolean
  onToggle: (directory: string) => void
}) {
  const FolderIcon = open ? FolderOpen : Folder
  return (
    <Button variant="ghost" size="sm" aria-expanded={open} className={ROW_CLASS} style={indentStyle(depth, true)} onClick={() => onToggle(path)} title={path}>
      <ChevronRight aria-hidden="true" className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      <FolderIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
    </Button>
  )
}

interface FileRowProps {
  path: string
  name: string
  depth: number
  selected: boolean
  status: FileStatusMark | null
  onSelect: (path: string) => void
}

function FileRow({ path, name, depth, selected, status, onSelect }: FileRowProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const FileIcon = useMemo(() => fileTypeIcon(path), [path])

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest" })
  }, [selected])

  return (
    <Button
      ref={ref}
      aria-current={selected || undefined}
      variant={selected ? "secondary" : "ghost"}
      size="sm"
      className={ROW_CLASS}
      style={indentStyle(depth, false)}
      onClick={() => onSelect(path)}
      title={path}
    >
      <FileIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("min-w-0 flex-1 truncate text-xs", status && status.className)}>{name}</span>
      {status && (
        <span className={cn("shrink-0 font-mono text-[0.625rem]", status.className)} title={status.label}>
          {status.code}
        </span>
      )}
    </Button>
  )
}
