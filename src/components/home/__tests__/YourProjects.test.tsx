import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectInfo } from "@/components/Dashboard/types"

import { LanguageSettings } from "@/components/LanguageSettings"
import { LANGUAGE_KEY, setLanguage } from "@/lib/i18n/language"

afterEach(() => { act(() => setLanguage("en")); localStorage.removeItem(LANGUAGE_KEY) })

const state = vi.hoisted(() => ({ projects: [] as ProjectInfo[], names: {} as Record<string, string> }))
vi.mock("@/components/ProjectSwitcherList", () => ({ useProjectList: () => state.projects }))
vi.mock("@/hooks/useProjectNames", () => ({ useProjectNames: () => ({ names: state.names }) }))
import { YourProjects } from "../YourProjects"

beforeEach(() => {
  state.projects = [
    { dirName: "-old", path: "/work/old", shortName: "old", sessionCount: 1, lastModified: "2025-01-01T00:00:00Z" },
    { dirName: "-recent", path: "/work/recent", shortName: "recent", sessionCount: 4, lastModified: "2026-01-01T00:00:00Z" },
    { dirName: "-empty", path: "/work/empty", shortName: "empty", sessionCount: 0, lastModified: null },
  ]
  state.names = { "-recent": "Billing dashboard" }
})

describe("YourProjects", () => {
  it("lists all projects newest first, including old and empty projects, and opens their session history", () => {
    const select = vi.fn()
    render(<YourProjects onSelectProject={select} />)
    const region = screen.getByRole("region", { name: "Your projects" })
    const buttons = within(region).getAllByRole("button")
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).toHaveTextContent("Billing dashboard")
    expect(buttons[0]).toHaveTextContent("4 sessions")
    expect(buttons[1]).toHaveTextContent("1 session")
    expect(buttons[2]).toHaveTextContent("0 sessions")
    fireEvent.click(buttons[1])
    expect(select).toHaveBeenCalledExactlyOnceWith("-old")
  })

  it("searches custom names and paths without hiding the other project inventory permanently", () => {
    render(<YourProjects onSelectProject={vi.fn()} />)
    const search = screen.getByRole("searchbox", { name: "Search projects" })
    fireEvent.change(search, { target: { value: "BILLING recent" } })
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.getByRole("button")).toHaveTextContent("Billing dashboard")
    fireEvent.change(search, { target: { value: "missing" } })
    expect(screen.getByText("No project matches “missing”.")).toBeInTheDocument()
    fireEvent.change(search, { target: { value: "" } })
    expect(screen.getAllByRole("button")).toHaveLength(3)
  })

  it("explains an empty inventory", () => {
    state.projects = []
    render(<YourProjects onSelectProject={vi.fn()} />)
    expect(screen.getByText("Projects appear here after you start a session in them.")).toBeInTheDocument()
  })
})


it("translates project navigation without changing custom names, paths, search or selection", () => {
  state.names = { "-recent": "Settings" }
  const select = vi.fn()
  render(<><LanguageSettings /><YourProjects onSelectProject={select} /></>)
  const search = screen.getByRole("searchbox", { name: "Search projects" })
  fireEvent.change(search, { target: { value: "Settings" } })
  fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "zh-TW" } })
  expect(screen.getByRole("region", { name: "你的專案" })).toBeInTheDocument()
  expect(screen.getByRole("searchbox", { name: "搜尋專案" })).toBe(search)
  expect(search).toHaveValue("Settings")
  expect(screen.getByRole("button")).toHaveTextContent("Settings")
  expect(screen.getByRole("button")).toHaveTextContent("/work/recent")
  fireEvent.click(screen.getByRole("button"))
  expect(select).toHaveBeenCalledExactlyOnceWith("-recent")
})
