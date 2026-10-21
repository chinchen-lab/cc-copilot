import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Turn } from "../../../../shared/session/types"
import type { SlashSuggestion } from "../../../../shared/contracts/projectTools"
import { makeTurn } from "@/__tests__/fixtures"

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  restoreImages: vi.fn(),
  clearImages: vi.fn(),
  images: [] as Array<{ id: string; data: string; mediaType: string }>,
  session: null as { sessionId: string; turns?: Turn[] } | null,
  pendingMessages: [] as string[],
  slashSuggestions: [] as SlashSuggestion[],
}))

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    session: mocks.session,
    isLive: false,
    actions: { handleEditConfig: vi.fn() },
    pendingInteraction: null,
    permissionRequests: [],
    permissionResponding: new Set(),
    respondPermission: vi.fn(),
    respondAllPermissions: vi.fn(),
    slashSuggestions: mocks.slashSuggestions,
    slashSuggestionsLoading: false,
    turnError: null,
    promptSuggestion: null,
  }),
  useSessionChatContext: () => ({
    chat: { status: "idle", error: null, isConnected: false, pendingMessages: mocks.pendingMessages, sendMessage: mocks.sendMessage, interrupt: vi.fn() },
  }),
}))
vi.mock("@/hooks/useCapability", () => ({ useCapability: () => true }))
vi.mock("@/hooks/useElapsedTimer", () => ({ useElapsedTimer: () => 0 }))
vi.mock("@/hooks/useProjectFileSuggestions", () => ({
  useProjectFileSuggestions: () => ({ files: [], loading: false }),
}))
vi.mock("../useImageUpload", () => ({
  useImageUpload: () => ({
    images: mocks.images,
    isDragOver: false,
    imageError: null,
    hasUnsupportedAttachments: false,
    dismissImageError: vi.fn(),
    removeImage: vi.fn(),
    clearImages: mocks.clearImages,
    restoreImages: mocks.restoreImages,
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    handlePaste: vi.fn(),
  }),
}))
vi.mock("@/components/SlashSuggestions", () => ({ SlashSuggestions: () => null }))
vi.mock("@/components/FileSuggestions", () => ({ FileSuggestions: () => null }))

import { ChatInput } from "../index"

describe("ChatInput footer", () => {
  it("stacks the message above a control row that ends with Send", () => {
    render(<ChatInput footer={<span>session controls</span>} />)

    const controls = screen.getByText("session controls")
    const send = screen.getByRole("button", { name: "Send message" })
    const message = screen.getByRole("combobox", { name: "Message" })

    // The control row holds the footer and, via the action group, Send.
    const row = controls.parentElement
    expect(row).toContainElement(send)
    expect(row).not.toContainElement(message)
    expect(message.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row?.parentElement).toHaveClass("flex-col")
  })

  it("keeps the inline single-row layout without a footer", () => {
    render(<ChatInput />)

    const message = screen.getByRole("combobox", { name: "Message" })

    expect(message.parentElement).toHaveClass("grid")
    expect(message.parentElement).not.toHaveClass("flex-col")
  })
})

describe("ChatInput sending", () => {
  it("edits a multiline prompt in the expanded view without sending until the composer submits", async () => {
    mocks.sendMessage.mockResolvedValue(true)
    render(<ChatInput />)
    const message = screen.getByRole("combobox", { name: "Message" })
    expect(screen.queryByRole("button", { name: "Expand prompt editor" })).not.toBeInTheDocument()
    fireEvent.change(message, { target: { value: "first\nsecond" } })
    fireEvent.click(screen.getByRole("button", { name: "Expand prompt editor" }))
    const editor = await screen.findByRole("textbox", { name: "Expanded prompt" })
    fireEvent.change(editor, { target: { value: "first\nrevised\n中文" } })
    fireEvent.keyDown(editor, { key: "Enter" })
    fireEvent.keyDown(editor, { key: "Enter", isComposing: true })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() => expect(message).toHaveFocus())
    expect(message).toHaveValue("first\nrevised\n中文")
    await act(async () => fireEvent.keyDown(message, { key: "Enter" }))
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith("first\nrevised\n中文", undefined)
  })

  it("lets Enter confirm Chinese input and only sends on the next ordinary Enter", async () => {
    mocks.sendMessage.mockResolvedValue(true)
    render(<ChatInput />)
    const message = screen.getByRole("combobox", { name: "Message" })
    fireEvent.compositionStart(message)
    fireEvent.change(message, { target: { value: "中文訊息" } })
    // Some IMEs omit isComposing, so the composition lifecycle also guards Enter.
    fireEvent.keyDown(message, { key: "Enter", isComposing: false })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    fireEvent.compositionEnd(message)
    // WebKit can end composition before its confirming keydown.
    fireEvent.keyDown(message, { key: "Enter", keyCode: 229, isComposing: false })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(message).toHaveValue("中文訊息")
    await act(async () => { fireEvent.keyDown(message, { key: "Enter" }) })
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith("中文訊息", undefined)
  })

  it("ignores native composing Enter and preserves Shift+Enter", () => {
    render(<ChatInput />)
    const message = screen.getByRole("combobox", { name: "Message" })
    fireEvent.change(message, { target: { value: "中文" } })
    fireEvent.keyDown(message, { key: "Enter", isComposing: true })
    fireEvent.keyDown(message, { key: "Enter", shiftKey: true })
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(message).toHaveValue("中文")
  })
  beforeEach(() => {
    mocks.sendMessage.mockReset()
    mocks.restoreImages.mockReset()
    mocks.images = []
    mocks.session = null
    mocks.pendingMessages = []
    mocks.slashSuggestions = []
  })

  it("recalls existing and newly sent prompts without sending until Enter is pressed", async () => {
    mocks.session = { sessionId: "history", turns: [makeTurn({ userMessage: "earlier prompt" })] }
    mocks.pendingMessages = ["just sent"]
    mocks.sendMessage.mockResolvedValue(true)
    render(<ChatInput />)
    const message = screen.getByRole("combobox", { name: "Message" })
    fireEvent.keyDown(message, { key: "ArrowUp" })
    expect(message).toHaveValue("just sent")
    fireEvent.keyDown(message, { key: "ArrowUp" })
    expect(message).toHaveValue("earlier prompt")
    expect(mocks.sendMessage).not.toHaveBeenCalled()
    await act(async () => fireEvent.keyDown(message, { key: "Enter" }))
    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith("earlier prompt", undefined)
    expect(message).toHaveValue("")
  })

  it("leaves arrows to Chinese input and active command suggestions", () => {
    mocks.session = { sessionId: "ime-history", turns: [makeTurn({ userMessage: "older prompt" })] }
    mocks.slashSuggestions = [{ name: "review", description: "Review changes", type: "command", source: "project", filePath: "/work/review.md" }]
    render(<ChatInput />)
    const message = screen.getByRole("combobox", { name: "Message" })
    fireEvent.compositionStart(message)
    fireEvent.keyDown(message, { key: "ArrowUp" })
    expect(message).toHaveValue("")
    fireEvent.compositionEnd(message)
    fireEvent.keyDown(message, { key: "ArrowUp", isComposing: true })
    fireEvent.keyDown(message, { key: "ArrowUp", keyCode: 229 })
    expect(message).toHaveValue("")
    fireEvent.change(message, { target: { value: "/rev" } })
    fireEvent.keyDown(message, { key: "ArrowUp" })
    expect(message).toHaveValue("/rev")
    fireEvent.keyDown(message, { key: "Tab" })
    expect(message).toHaveValue("/review ")
  })

  function submit(text: string): HTMLElement {
    const message = screen.getByRole("combobox", { name: "Message" })
    fireEvent.change(message, { target: { value: text } })
    fireEvent.keyDown(message, { key: "Enter" })
    return message
  }

  it("clears a sent message and puts back one the session refused", async () => {
    let answer!: (sent: boolean) => void
    mocks.sendMessage.mockReturnValue(new Promise<boolean>((resolve) => { answer = resolve }))
    render(<ChatInput />)

    const message = submit("  ship it  ")
    expect(mocks.sendMessage).toHaveBeenCalledWith("ship it", undefined)
    expect(message).toHaveValue("")

    await act(async () => answer(false))
    expect(message).toHaveValue("  ship it  ")
  })

  it("puts back the images of a refused message, and only of a refused one", async () => {
    const answers: Array<(sent: boolean) => void> = []
    mocks.sendMessage.mockImplementation(() => new Promise<boolean>((resolve) => { answers.push(resolve) }))
    mocks.images = [{ id: "img-1", data: "eA==", mediaType: "image/png" }]
    const draft = mocks.images
    render(<ChatInput />)

    submit("look at this")
    expect(mocks.sendMessage).toHaveBeenCalledWith("look at this", [{ data: "eA==", mediaType: "image/png" }])
    await act(async () => answers[0](true))
    expect(mocks.restoreImages).not.toHaveBeenCalled()

    submit("and this")
    await act(async () => answers[1](false))
    expect(mocks.restoreImages).toHaveBeenCalledWith(draft)
  })

  it("never overwrites what was typed after a refused message", async () => {
    let answer!: (sent: boolean) => void
    mocks.sendMessage.mockReturnValue(new Promise<boolean>((resolve) => { answer = resolve }))
    render(<ChatInput />)

    const message = submit("first")
    fireEvent.change(message, { target: { value: "second" } })
    await act(async () => answer(false))
    expect(message).toHaveValue("second")
  })

  describe("a message the session refused as the composer went away", () => {
    function refuseLater(): () => Promise<void> {
      let answer!: (sent: boolean) => void
      mocks.sendMessage.mockReturnValueOnce(new Promise<boolean>((resolve) => { answer = resolve }))
      return () => act(async () => answer(false))
    }

    /** The composer as App renders it for a session: the session's own project comes with it. */
    function composerFor(sessionId: string) {
      mocks.session = { sessionId }
      return <ChatInput projectCwd={`/work/${sessionId}`} />
    }

    function showSession(sessionId: string) {
      return render(composerFor(sessionId))
    }

    it("comes back when a composer shows its session again", async () => {
      const refuse = refuseLater()
      mocks.images = [{ id: "img-1", data: "eA==", mediaType: "image/png" }]
      const draft = mocks.images
      const composer = showSession("refused-while-gone")
      submit("ship it")
      composer.unmount()
      await refuse()
      mocks.images = []

      showSession("refused-while-gone")

      expect(screen.getByRole("combobox", { name: "Message" })).toHaveValue("ship it")
      expect(mocks.restoreImages).toHaveBeenCalledWith(draft)
    })

    it("outlives the composer it was put back into", async () => {
      const refuse = refuseLater()
      const composer = showSession("refused-then-gone")
      submit("ship it")
      await refuse()
      expect(screen.getByRole("combobox", { name: "Message" })).toHaveValue("ship it")

      // The refusal lowered the caller's access, so a read-only notice replaces the composer.
      composer.unmount()
      showSession("refused-then-gone")

      expect(screen.getByRole("combobox", { name: "Message" })).toHaveValue("ship it")
    })

    it("stays with the session it was sent to, not the one on screen when the answer arrives", async () => {
      const refuse = refuseLater()
      const composer = showSession("sent-to")
      submit("ship it")
      composer.rerender(composerFor("moved-to"))
      await refuse()

      expect(screen.getByRole("combobox", { name: "Message" })).toHaveValue("")
      composer.rerender(composerFor("sent-to"))
      expect(screen.getByRole("combobox", { name: "Message" })).toHaveValue("ship it")
    })

    it("waits while the composer holds other text, and comes back once it is empty", async () => {
      const refuse = refuseLater()
      const gone = showSession("refused-behind-text")
      submit("ship it")
      gone.unmount()
      await refuse()

      // The one composer App renders carries what was typed from session to session.
      const composer = showSession("typed-elsewhere")
      const message = screen.getByRole("combobox", { name: "Message" })
      fireEvent.change(message, { target: { value: "for another session" } })
      composer.rerender(composerFor("refused-behind-text"))
      expect(message).toHaveValue("for another session")

      fireEvent.change(message, { target: { value: "" } })
      composer.rerender(composerFor("typed-elsewhere"))
      composer.rerender(composerFor("refused-behind-text"))
      expect(message).toHaveValue("ship it")
    })

    it.each([
      ["put back as the answer arrived", false],
      ["brought back by a composer showing its session again", true],
    ])("leaves the composer with its session when it was %s", async (_case, broughtBack) => {
      const sessionId = `left-with-its-session-${broughtBack}`
      const refuse = refuseLater()
      let composer = showSession(sessionId)
      submit("ship it")
      if (broughtBack) {
        composer.unmount()
        await refuse()
        composer = showSession(sessionId)
      } else {
        await refuse()
      }
      const message = screen.getByRole("combobox", { name: "Message" })
      expect(message).toHaveValue("ship it")

      composer.rerender(composerFor(`elsewhere-${broughtBack}`))
      expect(message).toHaveValue("")
      composer.rerender(composerFor(sessionId))
      expect(message).toHaveValue("ship it")
    })

    it("is gone once it was sent after all", async () => {
      const refuse = refuseLater()
      const composer = showSession("sent-after-all")
      submit("ship it")
      await refuse()
      mocks.sendMessage.mockResolvedValueOnce(true)
      submit("ship it")
      await act(async () => {})

      composer.unmount()
      showSession("sent-after-all")

      expect(screen.getByRole("combobox", { name: "Message" })).toHaveValue("")
    })
  })
})
