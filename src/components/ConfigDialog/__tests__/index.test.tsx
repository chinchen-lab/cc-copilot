import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { __resetCapabilitiesForTest, setMe } from "@/lib/capabilities"
import { NO_CAPABILITIES } from "../../../../shared/contracts/identity"
import { LANGUAGE_KEY, setLanguage } from "@/lib/i18n/language"

afterEach(() => { act(() => setLanguage("en")); localStorage.removeItem(LANGUAGE_KEY); __resetCapabilitiesForTest(); window.history.replaceState(null, "", "/") })

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authFetch: mocks.authFetch }))

import { ConfigDialog } from "@/components/ConfigDialog"
import { PASSWORD_MIN_LENGTH } from "../../../../shared/contracts/password"

const SAVED_CONFIG = {
  claudeDir: "/Users/me/.claude",
  agentExecutable: { source: "auto" } as Record<string, unknown>,
  networkAccess: false,
  networkPassword: null,
  terminalApp: "",
  editorApp: "cursor",
  useBuiltInEditor: false,
}

const ACCOUNTS_REPORT = {
  status: "ok",
  tool: "claude-swap",
  version: "0.26.0",
  activeSlot: 2,
  accounts: [
    { slot: 1, alias: "work", email: "work@example.com", organization: null, active: false, disabled: false, usageStatus: "ok", usage: null },
    { slot: 2, alias: null, email: "me@example.com", organization: null, active: true, disabled: false, usageStatus: "ok", usage: null },
  ],
}

function mockConfig(overrides: Partial<typeof SAVED_CONFIG> = {}, accounts: unknown = { status: "missing" }) {
  mocks.authFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/agent-accounts/claude") return Promise.resolve({ ok: true, json: async () => accounts })
    if (url === "/api/config" && init?.method === "POST") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, claudeDir: SAVED_CONFIG.claudeDir }) })
    }
    if (url === "/api/config") {
      return Promise.resolve({ ok: true, json: async () => ({ ...SAVED_CONFIG, ...overrides }) })
    }
    if (url === "/api/shares") return Promise.resolve({ ok: true, json: async () => [] })
    if (url === "/api/agent-executable/claude") {
      return Promise.resolve({ ok: true, json: async () => EXECUTABLE_REPORT })
    }
    throw new Error(`Unexpected request: ${url}`)
  })
}

const EXECUTABLE_REPORT = {
  choice: { source: "auto" },
  candidates: [
    { source: "path", path: "/Users/me/.local/bin/claude", version: "2.1.258" },
    { source: "bundled", path: "/Users/me/app/node_modules/sdk/claude", version: "2.1.245" },
  ],
  active: { source: "path", path: "/Users/me/.local/bin/claude", version: "2.1.258" },
}

function renderDialog() {
  const onSaved = vi.fn()
  render(
    <ConfigDialog
      open
      currentPath={SAVED_CONFIG.claudeDir}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  return { onSaved }
}

function editorInput() {
  return screen.getByLabelText("Editor application")
}

describe("ConfigDialog editor routing", () => {
  beforeEach(() => {
    mocks.authFetch.mockReset()
  })

  it("leaves the editor field editable while files open externally", async () => {
    mockConfig()
    renderDialog()

    await waitFor(() => expect(editorInput()).toHaveValue("cursor"))
    expect(editorInput()).toBeEnabled()
    expect(screen.getByText(/Leave blank to use \$VISUAL/)).toBeInTheDocument()
  })

  it("disables the editor field as soon as files are routed into Cogpit", async () => {
    const user = userEvent.setup()
    mockConfig()
    const { onSaved } = renderDialog()

    await waitFor(() => expect(editorInput()).toHaveValue("cursor"))
    await user.click(screen.getByRole("checkbox", { name: /Open files in Cogpit/ }))

    expect(editorInput()).toBeDisabled()
    expect(screen.getByText("Not used while files open in Cogpit.")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SAVED_CONFIG.claudeDir))
    const save = mocks.authFetch.mock.calls.find((call) => call[1]?.method === "POST")
    expect(JSON.parse(save?.[1]?.body as string)).toMatchObject({
      editorApp: "cursor",
      useBuiltInEditor: true,
    })
  })

  it("restores the persisted preference when reopened", async () => {
    mockConfig({ useBuiltInEditor: true })
    renderDialog()

    await waitFor(() => expect(editorInput()).toBeDisabled())
    expect(screen.getByRole("checkbox", { name: /Open files in Cogpit/ })).toBeChecked()
    // Nothing changed yet, so there is nothing to save.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })
})

describe("ConfigDialog network password", () => {
  beforeEach(() => {
    mocks.authFetch.mockReset()
  })

  it("holds the network password to the server's password rule", async () => {
    const user = userEvent.setup()
    mockConfig()
    renderDialog()

    await waitFor(() => expect(editorInput()).toHaveValue("cursor"))
    await user.click(screen.getByRole("tab", { name: "Network & sharing" }))
    await user.click(screen.getByRole("switch", { name: "Network Access" }))
    const password = screen.getByLabelText("Password")
    await user.type(password, "a".repeat(PASSWORD_MIN_LENGTH - 1))
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()

    await user.type(password, "a")
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
  })
})

describe("ConfigDialog executable picker", () => {
  beforeEach(() => {
    mocks.authFetch.mockReset()
  })

  async function expandPicker(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("tab", { name: "Agents" }))
    await user.click(await screen.findByRole("button", { name: /Claude Code executable/ }))
  }

  it("starts collapsed, summarising the choice and the running version", async () => {
    mockConfig()
    renderDialog()

    fireEvent.click(screen.getByRole("tab", { name: "Agents" }))
    const trigger = await screen.findByRole("button", { name: /Claude Code executable/ })
    await waitFor(() => expect(trigger).toHaveTextContent("Automatic · v2.1.258"))
    expect(screen.queryByRole("radio", { name: "Automatic" })).not.toBeInTheDocument()
  })

  it("lists each detected binary with its version and what is running now", async () => {
    const user = userEvent.setup()
    mockConfig()
    renderDialog()
    await expandPicker(user)

    await waitFor(() => expect(screen.getByText(/Now running: v2\.1\.258/)).toBeInTheDocument())
    expect(screen.getByRole("radio", { name: "Automatic" })).toBeChecked()
    expect(screen.getByText("v2.1.245 · /Users/me/app/node_modules/sdk/claude")).toBeInTheDocument()
    // Nothing behind the npm option on this machine, so it cannot be picked.
    expect(screen.getByRole("radio", { name: "Global npm install" })).toBeDisabled()
    expect(screen.getByText("Not found on this machine.")).toBeInTheDocument()
  })

  it("saves the picked source", async () => {
    const user = userEvent.setup()
    mockConfig()
    const { onSaved } = renderDialog()
    await expandPicker(user)

    await waitFor(() => expect(screen.getByRole("radio", { name: "Automatic" })).toBeChecked())
    await user.click(screen.getByRole("radio", { name: "Bundled with Cogpit" }))
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const save = mocks.authFetch.mock.calls.find((call) => call[1]?.method === "POST")
    expect(JSON.parse(save?.[1]?.body as string)).toMatchObject({
      agentExecutable: { source: "bundled" },
    })
  })

  it("will not save a custom source without a path", async () => {
    const user = userEvent.setup()
    mockConfig()
    renderDialog()
    await expandPicker(user)

    await waitFor(() => expect(screen.getByRole("radio", { name: "Automatic" })).toBeChecked())
    await user.click(screen.getByRole("radio", { name: "Custom path" }))
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()

    await user.type(screen.getByLabelText("Claude Code executable path"), "/opt/claude")
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
  })

  it("keeps a saved npm choice selectable even when the shim has gone", async () => {
    const user = userEvent.setup()
    mockConfig({ agentExecutable: { source: "npm" } })
    renderDialog()
    await expandPicker(user)

    await waitFor(() => expect(screen.getByRole("radio", { name: "Global npm install" })).toBeChecked())
    expect(screen.getByRole("radio", { name: "Global npm install" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })
})

describe("ConfigDialog account switcher", () => {
  beforeEach(() => {
    mocks.authFetch.mockReset()
  })

  it("shows no accounts section when the switcher is not installed", async () => {
    mockConfig()
    renderDialog()

    fireEvent.click(screen.getByRole("tab", { name: "Agents" }))
    await screen.findByRole("button", { name: /Claude Code executable/ })
    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalledWith("/api/agent-accounts/claude"))
    expect(screen.queryByRole("button", { name: /Claude Code accounts/ })).not.toBeInTheDocument()
  })

  it("shows the managed accounts when the switcher is installed", async () => {
    mockConfig({}, ACCOUNTS_REPORT)
    renderDialog()

    fireEvent.click(screen.getByRole("tab", { name: "Agents" }))
    const trigger = await screen.findByRole("button", { name: /Claude Code accounts/ })
    expect(trigger).toHaveTextContent("me@example.com · 2 accounts")
  })
})

describe("ConfigDialog language preference", () => {
  it("switches interface language without saving or changing the server configuration draft", async () => {
    mockConfig()
    const { onSaved } = renderDialog()
    const input = await screen.findByLabelText("Editor application")
    fireEvent.change(input, { target: { value: "my-editor --wait" } })
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "zh-TW" } })
    expect(screen.getByRole("combobox", { name: "語言" })).toHaveValue("zh-TW")
    expect(screen.getByRole("button", { name: "儲存" })).toBeInTheDocument()
    expect(input).toHaveValue("my-editor --wait")
    expect(onSaved).not.toHaveBeenCalled()
    expect(mocks.authFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false)
    fireEvent.change(screen.getByRole("combobox", { name: "語言" }), { target: { value: "en" } })
    expect(input).toHaveValue("my-editor --wait")
  })
})


describe("ConfigDialog categories", () => {
  it("shows one category at a time and preserves edits across all three tabs when saving", async () => {
    const user = userEvent.setup()
    mockConfig()
    const { onSaved } = renderDialog()
    await waitFor(() => expect(editorInput()).toHaveValue("cursor"))
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true")
    expect(screen.queryByRole("switch", { name: "Network Access" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Claude Code executable/ })).not.toBeInTheDocument()
    await user.clear(editorInput())
    await user.type(editorInput(), "my-editor")

    await user.click(screen.getByRole("tab", { name: "Agents" }))
    await user.click(await screen.findByRole("button", { name: /Claude Code executable/ }))
    await user.click(await screen.findByRole("radio", { name: "Bundled with Cogpit" }))
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Language" })).not.toBeInTheDocument())

    await user.click(screen.getByRole("tab", { name: "Network & sharing" }))
    await user.click(await screen.findByRole("switch", { name: "Network Access" }))
    await user.type(screen.getByLabelText("Password"), "secret")
    await user.click(screen.getByRole("tab", { name: "General" }))
    expect(editorInput()).toHaveValue("my-editor")
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const saved = mocks.authFetch.mock.calls.find((call) => call[1]?.method === "POST")
    expect(JSON.parse(saved?.[1]?.body as string)).toMatchObject({
      editorApp: "my-editor", agentExecutable: { source: "bundled" }, networkAccess: true, networkPassword: "secret",
    })
  })

  it("translates category tabs and retains the selected category during language changes", async () => {
    mockConfig()
    renderDialog()
    await waitFor(() => expect(editorInput()).toHaveValue("cursor"))
    fireEvent.click(screen.getByRole("tab", { name: "Agents" }))
    act(() => setLanguage("zh-TW"))
    expect(screen.getByRole("tab", { name: "代理" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "網路與分享" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "一般" }))
    expect(screen.getByRole("combobox", { name: "語言" })).toHaveValue("zh-TW")
  })

  it("omits network settings on remote devices and reopens on General", async () => {
    window.history.replaceState(null, "", "/d/remote")
    mockConfig()
    const props = { open: true, currentPath: SAVED_CONFIG.claudeDir, onClose: vi.fn(), onSaved: vi.fn() }
    const { rerender } = render(<ConfigDialog {...props} />)
    expect(screen.queryByRole("tab", { name: "Network & sharing" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "Network Access", hidden: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "Agents" }))
    rerender(<ConfigDialog {...props} open={false} />)
    rerender(<ConfigDialog {...props} />)
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true")
  })

  it("keeps local preferences available without permission to write server configuration", () => {
    setMe({ authenticated: true, edition: "personal", user: null, capabilities: NO_CAPABILITIES })
    mockConfig()
    renderDialog()
    expect(screen.queryByRole("tab", { name: "Network & sharing" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "zh-TW" } })
    expect(screen.getByRole("combobox", { name: "語言" })).toHaveValue("zh-TW")
    expect(screen.getByRole("slider", { name: "文字大小" })).toBeEnabled()
  })
})
