import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProjectFileTree } from "../ProjectFileTree"

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authFetch: mocks.authFetch }))
const props = { cwd: "/project", selectedPath: null, onSelect: vi.fn(), fileStatus: () => null, reloadToken: 0 }
const response = (entries: { name: string; type: string }[]) => ({ ok: true, json: async () => ({ entries }) })
const folder = (name: string) => ({ name, type: "directory" })
const file = (name: string) => ({ name, type: "file" })
const directoryOf = (url: string) => new URL(url, "http://localhost").searchParams.get("dir")

beforeEach(() => { mocks.authFetch.mockReset() })

describe("ProjectFileTree lazy loading", () => {
  it("requests children only on expansion and reuses them when reopened", async () => {
    mocks.authFetch.mockImplementation(async (url: string) => response(directoryOf(url) === "" ? [folder("src"), folder("other")] : [folder("lib"), file("main.ts")]))
    render(<ProjectFileTree {...props} />)
    const src = await screen.findByRole("button", { name: "src" })
    expect(mocks.authFetch.mock.calls.map(([url]) => directoryOf(url))).toEqual([""])
    fireEvent.click(src)
    expect(await screen.findByRole("button", { name: "main.ts" })).toBeInTheDocument()
    expect(mocks.authFetch.mock.calls.map(([url]) => directoryOf(url))).toEqual(["", "src"])
    fireEvent.click(src)
    expect(screen.queryByRole("button", { name: "main.ts" })).not.toBeInTheDocument()
    fireEvent.click(src)
    expect(screen.getByRole("button", { name: "main.ts" })).toBeInTheDocument()
    expect(mocks.authFetch).toHaveBeenCalledTimes(2)
  })

  it("reloads expanded directories when ignored files are toggled and leaves other branches lazy", async () => {
    mocks.authFetch.mockImplementation(async (url: string) => response(directoryOf(url) === "" ? [folder("src"), folder("other")]
      : [file("main.ts"), ...(url.includes("includeIgnored=1") ? [file("generated.log")] : [])]))
    const view = render(<ProjectFileTree {...props} />)
    fireEvent.click(await screen.findByRole("button", { name: "src" }))
    await screen.findByRole("button", { name: "main.ts" })
    expect(screen.queryByRole("button", { name: "generated.log" })).not.toBeInTheDocument()
    view.rerender(<ProjectFileTree {...props} includeIgnored />)
    expect(await screen.findByRole("button", { name: "generated.log" })).toBeInTheDocument()
    expect(mocks.authFetch.mock.calls.map(([url]) => directoryOf(url))).toEqual(["", "src", "", "src"])
    expect(mocks.authFetch.mock.calls.slice(-2).every(([url]) => String(url).includes("includeIgnored=1"))).toBe(true)
    view.rerender(<ProjectFileTree {...props} />)
    await waitFor(() => expect(screen.queryByRole("button", { name: "generated.log" })).not.toBeInTheDocument())
    await screen.findByRole("button", { name: "main.ts" })
  })

  it("refreshes expanded directories and leaves unopened branches unloaded", async () => {
    let refreshed = false
    mocks.authFetch.mockImplementation(async (url: string) => response(directoryOf(url) === "" ? [folder("src"), folder("other")] : [file(refreshed ? "new.ts" : "old.ts")]))
    const view = render(<ProjectFileTree {...props} />)
    fireEvent.click(await screen.findByRole("button", { name: "src" }))
    await screen.findByRole("button", { name: "old.ts" })
    refreshed = true
    view.rerender(<ProjectFileTree {...props} reloadToken={1} />)
    expect(await screen.findByRole("button", { name: "new.ts" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "old.ts" })).not.toBeInTheDocument()
    expect(mocks.authFetch.mock.calls.map(([url]) => directoryOf(url))).toEqual(["", "src", "", "src"])
  })

  it.each(["refresh", "ignored-file toggle"])("aborts obsolete requests and ignores late responses after a %s", async (change) => {
    let resolveOld!: (value: ReturnType<typeof response>) => void
    let oldSignal!: AbortSignal
    let childCalls = 0
    mocks.authFetch.mockImplementation((url: string, init: RequestInit) => {
      if (directoryOf(url) === "") return Promise.resolve(response([folder("src")]))
      if (childCalls++ > 0) return Promise.resolve(response([file("new.ts")]))
      oldSignal = init.signal as AbortSignal
      return new Promise(resolve => { resolveOld = resolve })
    })
    const view = render(<ProjectFileTree {...props} />)
    fireEvent.click(await screen.findByRole("button", { name: "src" }))
    await waitFor(() => expect(childCalls).toBe(1))
    view.rerender(<ProjectFileTree {...props} reloadToken={change === "refresh" ? 1 : 0} includeIgnored={change !== "refresh"} />)
    expect(await screen.findByRole("button", { name: "new.ts" })).toBeInTheDocument()
    expect(oldSignal.aborted).toBe(true)
    resolveOld(response([file("stale.ts")]))
    await waitFor(() => expect(screen.queryByRole("button", { name: "stale.ts" })).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: "new.ts" })).toBeInTheDocument()
  })

  it("cancels pending reads when switching projects and on unmount", async () => {
    const signals: AbortSignal[] = []
    mocks.authFetch.mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      return new Promise(() => {})
    })
    const view = render(<ProjectFileTree {...props} />)
    view.rerender(<ProjectFileTree {...props} cwd="/other" />)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    view.unmount()
    expect(signals[1].aborted).toBe(true)
  })

  it("allows retrying failed folder reads", async () => {
    let failed = false
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (directoryOf(url) === "") return response([folder("src")])
      if (failed) return response([file("main.ts")])
      failed = true
      throw new Error("Temporarily unavailable")
    })
    render(<ProjectFileTree {...props} />)
    fireEvent.click(await screen.findByRole("button", { name: "src" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporarily unavailable")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(await screen.findByRole("button", { name: "main.ts" })).toBeInTheDocument()
  })

  it("reveals a selected file through ancestors outside the virtual viewport", async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      const directory = directoryOf(url)
      return response(directory === "" ? Array.from({ length: 200 }, (_, i) => folder(`dir-${i}`))
        : directory === "dir-199" ? [folder("nested")] : [file("selected.ts")])
    })
    render(<ProjectFileTree {...props} selectedPath="dir-199/nested/selected.ts" />)
    await waitFor(() => expect(mocks.authFetch.mock.calls.map(([url]) => directoryOf(url))).toEqual(["", "dir-199", "dir-199/nested"]))
  })

  it("keeps the DOM bounded with twenty thousand files", async () => {
    mocks.authFetch.mockResolvedValue(response(Array.from({ length: 20_000 }, (_, i) => file(`file-${i}.ts`))))
    const { container } = render(<ProjectFileTree {...props} />)
    await waitFor(() => expect(container.querySelector('[style*="480000px"]')).not.toBeNull())
    expect(screen.queryAllByRole("button").length).toBeLessThan(100)
  })
})
