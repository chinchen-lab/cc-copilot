import { describe, expect, it } from "vitest"
import { isMarpMarkdown } from "../projectMarkdown"

describe("Marp document detection", () => {
  it.each([
    "---\nmarp: true\n---\n# Slides",
    "\uFEFF---\r\n# Presentation\r\nmarp: true\r\ntheme: gaia\r\n---\r\n# Slides",
    '---\n"marp": true # Enabled\n---\n',
  ])("recognizes enabled YAML front matter: %s", (content) => {
    expect(isMarpMarkdown(content)).toBe(true)
  })

  it.each([
    "# Ordinary Markdown\n\n---\n\nMore text",
    "---\nmarp: false\n---\n# Disabled",
    '---\nmarp: "true"\n---\n# String',
    "---\ntitle: Slides\n---\n# Without opt-in",
    "---\nmarp: [broken\n---\n",
    "```markdown\n---\nmarp: true\n---\n```",
  ])("keeps ordinary or malformed Markdown in document mode: %s", (content) => {
    expect(isMarpMarkdown(content)).toBe(false)
  })
})
