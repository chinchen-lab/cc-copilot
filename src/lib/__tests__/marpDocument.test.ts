import { describe, expect, it, vi } from "vitest"
import { createMarpDocument } from "../marpDocument"

vi.mock("@/lib/auth", () => ({ authUrl: (path: string) => `/hub/device${path}` }))

function render(content: string, cwd = "/workspace/project", filePath = "slides/deck.md") {
  return new DOMParser().parseFromString(createMarpDocument(content, cwd, filePath), "text/html")
}

function styles(document: Document) {
  return [...document.querySelectorAll("style")].map(style => style.textContent).join("\n")
}

describe("Marp slide document", () => {
  it("uses Marp themes, slide size, pagination and actual Markdown slide boundaries", () => {
    const document = render("---\nmarp: true\ntheme: gaia\nsize: 4:3\npaginate: true\n---\n# First\n\n```md\n---\n```\n\n---\n# Second")
    expect(document.querySelectorAll("svg[data-marpit-svg]")).toHaveLength(2)
    expect(document.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 960 720")
    expect(document.querySelector("section")?.getAttribute("data-theme")).toBe("gaia")
    expect(document.querySelector('section[data-marpit-pagination="2"]')?.textContent).toContain("Second")
    expect(styles(document)).toContain("960px")
    expect(document.querySelector("h1")?.textContent).toBe("First")
  })

  it("routes regular and background images to the active device relative to the Markdown file", () => {
    const document = render("![photo](./images/a%20b.png)\n![bg](../background.png)")
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/hub/device/api/local-file?path=%2Fworkspace%2Fproject%2Fslides%2Fimages%2Fa%20b.png")
    const figure = document.querySelector("figure")!
    expect(figure.getAttribute("style")).toContain("/hub/device/api/local-file?path=%2Fworkspace%2Fproject%2Fbackground.png")
  })

  it("resolves CSS image URLs and keeps external and data images unchanged", () => {
    const document = render('<style>section { background-image: url("./paper.png") }</style>\n![web](https://example.com/photo.png)\n![data](data:image/png;base64,YQ==)')
    expect(styles(document)).toContain("/hub/device/api/local-file?path=%2Fworkspace%2Fproject%2Fslides%2Fpaper.png")
    const images = document.querySelectorAll("img")
    expect(images[0].getAttribute("src")).toBe("https://example.com/photo.png")
    expect(images[1].getAttribute("src")).toBe("data:image/png;base64,YQ==")
  })

  it("does not emit executable HTML or helper scripts and restricts document resources", () => {
    const document = render('# Safe\n<script>window.parent.alert(1)</script>\n<img src=x onerror="alert(1)">')
    expect(document.querySelector("script")).toBeNull()
    expect(document.querySelector("[onerror]")).toBeNull()
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("default-src 'none'")
  })

  it("supports Windows project roots and does not retain directives between renders", () => {
    const document = render("![photo](./photo.png)", "C:\\project", "slides/deck.md")
    expect(document.querySelector("img")?.getAttribute("src")).toContain("C%3A%5Cproject%5Cslides%5Cphoto.png")
    render("---\ntheme: gaia\n---\n# Gaia")
    expect(render("# Default").querySelector("section")?.getAttribute("data-theme")).not.toBe("gaia")
  })

  it("preserves styled HTML and merges global and per-slide CSS", () => {
    const document = render('<style>h1 { color: red } .card { display: grid }</style>\n\n# First\n\n<div class="card" style="--tone: blue; color: var(--tone)">Card</div>\n\n<style scoped>h1 { color: blue }</style>\n\n---\n# Second')
    expect(document.querySelector(".card")?.getAttribute("style")).toContain("--tone: blue")
    expect(styles(document)).toContain("color:red")
    expect(styles(document)).toContain("color:blue")
    const sections = document.querySelectorAll("section")
    expect(sections[0].getAttributeNames().some(name => name.startsWith("data-marpit-scope-"))).toBe(true)
    expect(sections[1].getAttributeNames().some(name => name.startsWith("data-marpit-scope-"))).toBe(false)
  })

  it("registers embedded Marp themes before resolving slide dimensions and imported themes", () => {
    const document = render('---\nmarp: true\ntheme: custom\n---\n<style>\n/* @theme custom */\n@import "default";\nsection { width: 800px; height: 600px; background: #123456; }\nh1 { color: #abcdef; }\n</style>\n\n# Custom theme')
    expect(document.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 800 600")
    expect(styles(document)).toContain("#123456")
    expect(styles(document)).toContain("#abcdef")
  })

  it("keeps theme CSS in fenced examples inactive", () => {
    const document = render('---\ntheme: sample\n---\n```css\n/* @theme sample */\nsection { width: 800px; height: 600px; }\n```')
    expect(document.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 1280 720")
  })
})
