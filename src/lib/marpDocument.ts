import { Marp } from "@marp-team/marp-core"
import type Token from "markdown-it/lib/token.mjs"
import { createPreviewDocument } from "./previewDocument"

/** Render into an isolated document; no Markdown-provided script can execute. */
export function createMarpDocument(content: string, cwd: string, filePath: string): string {
  const marp = new Marp({
    html: Object.fromEntries(Object.entries(Marp.html).map(([tag, attributes]) => [
      tag, Array.isArray(attributes) ? [...attributes, "style"] : { ...attributes, style: true },
    ])),
    script: false,
    emoji: { unicode: false, shortcode: true },
  })
  // Register actual style tokens, including themes declared after the front matter.
  // Parsing tokens avoids treating a fenced CSS example as a theme definition.
  marp.markdown.core.ruler.after("block", "embedded_themes", (state: { tokens: Token[] }) => {
    for (const token of state.tokens) {
      if (token.type === "marpit_style" && !token.meta?.marpitStyleScoped && /@theme\s+\S+/.test(token.content)) {
        marp.themeSet.add(token.content)
      }
    }
  })
  const { html, css } = marp.render(content)
  return createPreviewDocument(html, cwd, filePath, `
    html { color-scheme: light; background: #202124; }
    body { margin: 0; padding: 16px; }
    .marpit { display: flex; flex-direction: column; gap: 16px; }
    .marpit > svg[data-marpit-svg] { display: block; width: 100%; height: auto; flex: none; }
    /* The parent's Marp helper rewrites pre to marp-pre, but its custom element
       registry does not extend into the sandboxed iframe. Supply pre defaults
       here so the unregistered element stays one block; theme styles override. */
    .marpit marp-pre { display: block; white-space: pre; font-family: monospace; margin: 1em 0; }
  `, css)
}
