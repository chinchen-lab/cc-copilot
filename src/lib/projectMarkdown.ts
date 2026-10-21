import { JSON_SCHEMA, load } from "js-yaml"
import MarkdownIt from "markdown-it"

const markdown = new MarkdownIt({ html: true })

/** HTML and styles need the isolated renderer; code examples remain plain text. */
export function needsHtmlMarkdownPreview(content: string): boolean {
  const hasHtml = (tokens: ReturnType<MarkdownIt["parse"]>): boolean => tokens.some((token) =>
    ((token.type === "html_block" || token.type === "html_inline")
      && /<\/?[a-z][^>]*>/i.test(token.content.replace(/<!--[\s\S]*?-->/g, "")))
    || (token.children !== null && hasHtml(token.children)),
  )
  return hasHtml(markdown.parse(content, {}))
}

/** Marp's opt-in lives in the document's YAML front matter. */
export function isMarpMarkdown(content: string): boolean {
  const frontMatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!frontMatter) return false
  try {
    const data: unknown = load(frontMatter[1], { schema: JSON_SCHEMA })
    return data !== null && typeof data === "object" && "marp" in data && data.marp === true
  } catch {
    return false
  }
}

/** Resolve an image relative to the Markdown file's directory. */
export function resolveMarkdownImage(src: string | undefined, cwd: string, filePath: string): string | undefined {
  if (!src || /^(?:[a-z]+:|\/|#)/i.test(src)) return src
  const directory = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : ""
  const resolved: string[] = []
  for (const segment of [...directory.split("/"), ...src.split("/")]) {
    if (segment === "..") resolved.pop()
    else if (segment && segment !== ".") resolved.push(segment)
  }
  const separator = cwd.includes("\\") ? "\\" : "/"
  return [cwd.replace(/[\\/]+$/, ""), ...resolved].join(separator)
}
