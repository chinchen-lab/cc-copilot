import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import MarpPreview from "../MarpPreview"

describe("MarpPreview code blocks", () => {
  it.each(["", "javascript"])("keeps a multiline %s code block together after browser initialization", (language) => {
    const code = "codeline1 ...\n  codeline2 ...\n\ncodeline3 ...\n"
    const content = `---\nmarp: true\n---\n# Example\n\n\`\`\`${language}\n${code}\`\`\``
    render(<MarpPreview content={content} cwd="/workspace" filePath="slides.md" />)
    const frame = screen.getByTitle<HTMLIFrameElement>("Slides of slides.md")
    // jsdom does not load srcdoc; populate the separate iframe document and
    // run the real browser helper through the component's load handler.
    const document = frame.contentDocument!
    document.open()
    document.write(frame.srcdoc)
    document.close()
    // jsdom cannot compute specificity for the packed theme's modern selectors.
    // Retain the preview base styles to exercise the iframe layout fallback.
    for (const style of [...document.head.querySelectorAll("style")].slice(1)) style.remove()
    fireEvent.load(frame)

    const blocks = document.querySelectorAll("pre, marp-pre")
    expect(blocks).toHaveLength(1)
    expect(blocks[0].querySelector("code")?.textContent).toBe(code)
    const style = frame.contentWindow!.getComputedStyle(blocks[0])
    expect(style.display).toBe("block")
    expect(style.whiteSpace).toBe("pre")
  })
})
