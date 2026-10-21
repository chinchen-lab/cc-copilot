import { describe, expect, it, vi } from "vitest"
import { createStyledMarkdownDocument } from "../styledMarkdownDocument"

vi.mock("@/lib/auth", () => ({ authUrl: (path: string) => `/hub/device${path}` }))

function render(content: string) {
  return new DOMParser().parseFromString(createStyledMarkdownDocument(content, "/workspace/project", "docs/guide.md"), "text/html")
}

describe("styled Markdown documents", () => {
  it("preserves style blocks, HTML classes and inline styles alongside rendered Markdown", () => {
    const document = render('<style>h1 { color: red } .card { display: grid }</style>\n\n# Title\n\n<div class="card" style="--tone: blue; color: var(--tone)">Card</div>')
    expect(document.querySelector("h1")?.textContent).toBe("Title")
    expect(document.querySelector(".card")?.getAttribute("style")).toContain("--tone: blue")
    const styles = [...document.querySelectorAll("style")].map(style => style.textContent)
    expect(styles[1]).toContain("h1 { color: red }")
    expect(styles[0]).toContain(":where(h1)")
  })

  it("resolves images in Markdown, style blocks and inline CSS relative to the file", () => {
    const document = render('<style>.card { background: url("./paper.png") }</style>\n\n![photo](../photo.png)\n\n<div style="background-image: url(./card.png)">Card</div>')
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/hub/device/api/local-file?path=%2Fworkspace%2Fproject%2Fphoto.png")
    expect(document.head.textContent).toContain("/hub/device/api/local-file?path=%2Fworkspace%2Fproject%2Fdocs%2Fpaper.png")
    expect(document.querySelector("div")?.getAttribute("style")).toContain("/hub/device/api/local-file?path=%2Fworkspace%2Fproject%2Fdocs%2Fcard.png")
  })

  it("keeps CSS code fences as visible examples", () => {
    const document = render("```html\n<style>h1 { color: red }</style>\n```")
    expect(document.querySelectorAll("style")).toHaveLength(1)
    expect(document.querySelector("code")?.textContent).toContain("<style>")
  })

  it("removes scripts, event handlers, navigation metadata and embedded frames", () => {
    const document = render('<style>h1 { color: red }</style>\n<script>alert(1)</script>\n<img src="a.png" onerror="alert(1)">\n<meta http-equiv="refresh" content="0;url=https://example.com">\n<iframe src="https://example.com"></iframe>\n<a href="javascript:alert(1)">bad link</a>')
    expect(document.querySelector("script, iframe, [onerror], meta[http-equiv=refresh], a[href]")).toBeNull()
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("default-src 'none'")
    expect(document.head.textContent).toContain("h1 { color: red }")
  })
})
