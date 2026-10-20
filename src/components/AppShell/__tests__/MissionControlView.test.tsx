import type { ComponentProps } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ dashboardProject: null as string | null }))
vi.mock("@/contexts/AppContext", () => ({ useAppContext: () => ({ state, config: { defaultAgentKind: "claude" } }) }))
vi.mock("@/components/Dashboard", () => ({
  Dashboard: ({ selectedProjectDirName, onSelectSession }: { selectedProjectDirName: string | null; onSelectSession: (dir: string, file: string) => void }) => (
    <div data-testid="project-history">
      {selectedProjectDirName ?? "All projects"}
      <button onClick={() => onSelectSession(selectedProjectDirName!, "chosen.jsonl")}>Open chosen session</button>
    </div>
  ),
}))
vi.mock("@/components/home/MissionHome", () => ({
  MissionHome: ({ onSelectProject, onBrowseProjects }: { onSelectProject: (dir: string) => void; onBrowseProjects: () => void }) => (
    <>
      <button onClick={() => onSelectProject("-existing-project")}>Existing project</button>
      <button onClick={onBrowseProjects}>Browse projects</button>
    </>
  ),
}))
import { MissionControlView } from "../SharedAppViews"

function navigation(): ComponentProps<typeof MissionControlView>["navigation"] {
  return {
    actions: { handleDashboardSelect: vi.fn() },
    handlers: { handleDuplicateSessionByPath: vi.fn(), handleDeleteSession: vi.fn() },
    creatingSession: false,
    pendingSession: null,
    onStartNewSession: vi.fn(),
    onStartNewSessionWith: vi.fn(),
    newSessionModel: { selectedModel: "", onModelChange: vi.fn(), selectedEffort: "", onEffortChange: vi.fn() },
    onStartNewFolder: vi.fn(),
    onSelectProject: vi.fn((dirName: string | null) => { state.dashboardProject = dirName }),
    liveSessionsRefreshRef: { current: null },
    onPrefetchSession: vi.fn(),
  }
}

beforeEach(() => { state.dashboardProject = null })

describe("MissionControlView project navigation", () => {
  it("opens the selected project's history, then a session, and returns to the home", async () => {
    const nav = navigation()
    render(<MissionControlView navigation={nav} />)
    fireEvent.click(await screen.findByRole("button", { name: "Existing project" }))
    expect(nav.onSelectProject).toHaveBeenCalledWith("-existing-project")
    expect(screen.getByTestId("project-history")).toHaveTextContent("-existing-project")
    fireEvent.click(screen.getByRole("button", { name: "Open chosen session" }))
    expect(nav.actions.handleDashboardSelect).toHaveBeenCalledWith("-existing-project", "chosen.jsonl")
    fireEvent.click(screen.getByRole("button", { name: "Mission Control" }))
    expect(nav.onSelectProject).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole("button", { name: "Existing project" })).toBeInTheDocument()
  })

  it("keeps the full project browser available", async () => {
    render(<MissionControlView navigation={navigation()} />)
    fireEvent.click(await screen.findByRole("button", { name: "Browse projects" }))
    expect(screen.getByTestId("project-history")).toHaveTextContent("All projects")
  })
})
