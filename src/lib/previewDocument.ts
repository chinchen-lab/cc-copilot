import valueParser from "postcss-value-parser"
import { authUrl } from "@/lib/auth"
import { resolveMarkdownImage } from "./projectMarkdown"

/** Isolate author styles and resolve assets relative to the previewed file. */
export function createPreviewDocument(html: string, cwd: string, filePath: string, baseCss: string, css = ""): string {
  const resolveAsset = (source: string): string => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) return source
    let decoded = source
    try { decoded = decodeURI(source) } catch { /* Keep malformed escapes literal. */ }
    const path = resolveMarkdownImage(decoded, cwd, filePath) ?? decoded
    return authUrl(`/api/local-file?path=${encodeURIComponent(path)}`)
  }
  const resolveCss = (value: string): string => {
    const parsed = valueParser(value)
    parsed.walk((node) => {
      if (node.type !== "function" || node.value.toLowerCase() !== "url") return
      const source = valueParser.stringify(node.nodes).replace(/^(["'])([\s\S]*)\1$/, "$2")
      node.nodes = [{ type: "string", quote: '"', value: resolveAsset(source), sourceIndex: 0, sourceEndIndex: 0 }]
      return false
    })
    return parsed.toString()
  }
  const document = new DOMParser().parseFromString(html, "text/html")
  for (const image of document.querySelectorAll("img[src]")) {
    image.setAttribute("src", resolveAsset(image.getAttribute("src")!))
  }
  for (const element of document.querySelectorAll("[style]")) {
    element.setAttribute("style", resolveCss(element.getAttribute("style")!))
  }
  for (const style of document.querySelectorAll("style")) {
    style.textContent = resolveCss(style.textContent ?? "")
  }
  const base = document.createElement("style")
  base.textContent = baseCss
  document.head.prepend(base)
  if (css) {
    const style = document.createElement("style")
    style.textContent = resolveCss(css)
    document.head.append(style)
  }
  const policy = document.createElement("meta")
  policy.httpEquiv = "Content-Security-Policy"
  policy.content = "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src 'self' data:; base-uri 'none'; form-action 'none'"
  document.head.prepend(policy)
  return `<!doctype html>${document.documentElement.outerHTML}`
}
