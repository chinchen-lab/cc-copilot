import { useTranslation } from "@/hooks/useTranslation"
import { useState } from "react"
import { ChevronRight, FolderOpen, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useProjectList } from "@/components/ProjectSwitcherList"
import { useProjectNames } from "@/hooks/useProjectNames"
import { projectName, shortPath } from "@/lib/format"

/** The full project inventory, including projects outside the recent sessions. */
export function YourProjects({ onSelectProject }: { onSelectProject: (dirName: string) => void }) {
  const { t } = useTranslation()
  const projects = useProjectList(true)
  const { names } = useProjectNames()
  const [query, setQuery] = useState("")
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const label = (project: typeof projects[number]) => names[project.dirName] || projectName(project.path)
  const visible = projects
    .filter((project) => {
      const text = `${label(project)} ${project.path} ${project.shortName}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
    .sort((a, b) => (Date.parse(b.lastModified ?? "") || 0) - (Date.parse(a.lastModified ?? "") || 0) || label(a).localeCompare(label(b)))

  return (
    <section aria-label={t("Your projects")} className="min-w-0 shrink-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">{t("Your projects")}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{words.length ? visible.length : projects.length}</span>
        <span className="flex-1" />
        <div className="relative w-full max-w-64">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label={t("Search projects")} placeholder={t("Search projects")} value={query} onChange={(event) => setQuery(event.target.value)} className="h-7 pl-8 text-xs" />
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="py-4 text-xs text-muted-foreground">{words.length ? t("No project matches “{0}”.", { "0": query.trim() }) : t("Projects appear here after you start a session in them.")}</p>
      ) : (
        <ul className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {visible.map((project) => (
            <li key={project.dirName} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelectProject(project.dirName)}
                title={project.path}
                className="group flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{label(project)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{shortPath(project.path)}</span>
                  <span className="block text-xs text-muted-foreground">{project.sessionCount} {project.sessionCount === 1 ? t("session") : t("sessions")}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
