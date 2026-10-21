import { describe, expect, it } from "vitest"
import { needsHtmlMarkdownPreview, isMarpMarkdown } from "../projectMarkdown"

describe("Markdown HTML and style detection", () => {
  it.each([
    "<style>h1 { color: red }</style>\n\n# Title",
    '<div class="card" style="display: grid">Hello</div>',
    'Text <span style="color: blue">highlight</span>.',
    '<h1 align="center">Cogpit</h1>',
    '<p align="center"><strong>HTML without CSS</strong></p>',
    'Press <kbd>Enter</kbd> to continue.',
  ])("recognizes embedded styles: %s", (content) => {
    expect(needsHtmlMarkdownPreview(content)).toBe(true)
  })

  it.each([
    "```html\n<style>h1 { color: red }</style>\n```",
    '    <div style="color: red">Example</div>',
    '`<span style="color: red">Example</span>`',
    "<!-- <style>h1 { color: red }</style> -->",
    "```html\n<h1 align=\"center\">Example</h1>\n```",
    "Just ordinary **Markdown**.",
    "<https://example.com>",
  ])("does not enable styles from examples or comments: %s", (content) => {
    expect(needsHtmlMarkdownPreview(content)).toBe(false)
  })
})

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
