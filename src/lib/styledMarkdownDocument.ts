import DOMPurify from "dompurify"
import MarkdownIt from "markdown-it"
import { createPreviewDocument } from "./previewDocument"

const markdown = new MarkdownIt({ html: true })

export function createStyledMarkdownDocument(content: string, cwd: string, filePath: string): string {
  const html = DOMPurify.sanitize(markdown.render(content), {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["base", "meta", "link", "form"],
  })
  return createPreviewDocument(html, cwd, filePath, `
    :where(html) { color-scheme: light; background: white; color: #24292f; }
    :where(body) { box-sizing: border-box; min-height: 100vh; margin: 0; padding: 24px; font: 14px/1.6 system-ui, sans-serif; overflow-wrap: anywhere; }
    :where(h1, h2, h3) { line-height: 1.25; margin: 1.5em 0 .75em; }
    :where(h1) { font-size: 2em; } :where(h2) { font-size: 1.5em; }
    :where(img, video, svg) { max-width: 100%; }
    :where(pre) { overflow: auto; padding: 16px; background: #f6f8fa; border-radius: 6px; }
    :where(code) { font-family: ui-monospace, monospace; }
    :where(table) { border-collapse: collapse; }
    :where(td, th) { border: 1px solid #d0d7de; padding: 6px 12px; }
    :where(blockquote) { margin-left: 0; padding-left: 16px; border-left: 3px solid #d0d7de; }
  `)
}
