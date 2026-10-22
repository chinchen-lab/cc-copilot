import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authFetch: mocks.authFetch }))

import { BackgroundServers } from "../BackgroundServers"
import { makeToolCall, makeTurn } from "@/__tests__/fixtures"

const DEV_SERVER = {
  id: "task-1",
  outputPath: "/tmp/task-1.log",
  ports: [5173],
  portStatus: { 5173: true },
  preview: "vite dev --port 5173",
}

async function renderServers(canStop?: boolean) {
  await act(async () => {
    render(<BackgroundServers cwd="/work/app" turns={[]} canStop={canStop} />)
  })
}

describe("BackgroundServers", () => {
  beforeEach(() => {
    mocks.authFetch.mockImplementation(async (url: string) => new Response(
      JSON.stringify(url.startsWith("/api/background-tasks") ? [DEV_SERVER] : {}),
    ))
  })

  afterEach(() => mocks.authFetch.mockReset())

  it("offers to stop a running server to a user who may stop this session's processes", async () => {
    await renderServers(true)

    await act(async () => screen.getByRole("button", { name: "Stop server" }).click())

    expect(mocks.authFetch).toHaveBeenCalledWith("/api/kill-port", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ port: 5173 }),
    }))
  })

  it("lists the server without Stop for anyone else", async () => {
    await renderServers()

    expect(screen.getByText("Background Tasks (1)")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Stop server" })).not.toBeInTheDocument()
  })

  it("opens portless command output without offering a server kill", async () => {
    const command = { ...DEV_SERVER, ports: [], portStatus: {}, preview: "bun run build", sessionId: "session-1" }
    mocks.authFetch.mockResolvedValue(new Response(JSON.stringify([command])))
    const open = vi.fn(), discovered = vi.fn()
    await act(async () => {
      render(<BackgroundServers cwd="/work/app" sessionId="session-1" turns={[]} canStop onToggleServer={open} onServersChanged={discovered} />)
    })
    expect(screen.getByText("Output available")).toBeVisible()
    expect(screen.queryByText("Running")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Stop server" })).not.toBeInTheDocument()
    await act(async () => screen.getByRole("button", { name: "View task output" }).click())
    expect(open).toHaveBeenCalledWith(command.id, command.outputPath, command.preview)
    expect(discovered).toHaveBeenLastCalledWith([expect.objectContaining({ status: "unknown" })])
  })

  it.each([
    ["completed", "Completed"], ["failed", "Failed"], ["killed", "Stopped"], ["running", "Running"],
  ])("reads explicit %s notifications for a portless task", async (status, label) => {
    const command = { ...DEV_SERVER, ports: [], portStatus: {}, sessionId: "session-1" }
    mocks.authFetch.mockResolvedValue(new Response(JSON.stringify([command])))
    const turns = [makeTurn({ contentBlocks: [{ kind: "task_notification", content: `<task-notification><task-id>${command.id}</task-id><status>${status}</status></task-notification>` }] })]
    await act(async () => {
      render(<BackgroundServers cwd="/work/app" sessionId="session-1" turns={turns} />)
    })
    expect(screen.getByText(label)).toBeVisible()
  })

  it("does not use another session's notification for a matching task id", async () => {
    const command = { ...DEV_SERVER, ports: [], portStatus: {}, sessionId: "other-session" }
    mocks.authFetch.mockResolvedValue(new Response(JSON.stringify([command])))
    const turns = [makeTurn({ contentBlocks: [{ kind: "task_notification", content: `<task-notification><task-id>${command.id}</task-id><status>completed</status></task-notification>` }] })]
    await act(async () => {
      render(<BackgroundServers cwd="/work/app" sessionId="session-1" turns={turns} />)
    })
    expect(screen.getByText("Output available")).toBeVisible()
    expect(screen.queryByText("Completed")).not.toBeInTheDocument()
  })

  it("keeps JSONL-discovered servers alongside portless command output", async () => {
    const command = { ...DEV_SERVER, ports: [], portStatus: {}, preview: "build output" }
    mocks.authFetch.mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.startsWith("/api/background-tasks") ? [command] : { 4321: true },
    )))
    const turns = [makeTurn({
      assistantText: [], contentBlocks: [],
      toolCalls: [makeToolCall({ name: "Bash", input: { run_in_background: true, command: "server --port 4321", description: "Fallback server" }, result: "" })],
    })]
    await act(async () => { render(<BackgroundServers cwd="/work/app" turns={turns} />) })
    expect(screen.getByText("build output")).toBeVisible()
    expect(screen.getByText("Fallback server")).toBeVisible()
    expect(screen.getByText("Background Tasks (2)")).toBeVisible()
    expect(mocks.authFetch).toHaveBeenCalledWith("/api/check-ports?ports=4321")
  })
  it("does not restart polling when transcript arrays change", async () => {
    vi.useFakeTimers()
    const changed = vi.fn()
    const { rerender, unmount } = render(<BackgroundServers cwd="/work/app" turns={[]} onServersChanged={changed} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const firstReports = changed.mock.calls.length
    rerender(<BackgroundServers cwd="/work/app" turns={[]} onServersChanged={changed} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(mocks.authFetch).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(mocks.authFetch).toHaveBeenCalledTimes(2)
    expect(changed).toHaveBeenCalledTimes(firstReports)
    unmount()
    vi.useRealTimers()
  })

  it("keeps portless output available when the fallback port check fails", async () => {
    const command = { ...DEV_SERVER, ports: [], portStatus: {}, preview: "build output" }
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/background-tasks")) return new Response(JSON.stringify([command]))
      throw new Error("port check unavailable")
    })
    const turns = [makeTurn({
      assistantText: [], contentBlocks: [],
      toolCalls: [makeToolCall({ name: "Bash", input: { run_in_background: true, command: "server --port 4321" }, result: "" })],
    })]
    await act(async () => { render(<BackgroundServers cwd="/work/app" turns={turns} />) })
    expect(screen.getByText("build output")).toBeVisible()
    expect(screen.getByText("Output available")).toBeVisible()
  })

})
