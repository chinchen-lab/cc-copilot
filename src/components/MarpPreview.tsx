import { useEffect, useMemo, useRef } from "react"
import browser from "@marp-team/marp-core/browser"
import { useTranslation } from "@/hooks/useTranslation"
import { createMarpDocument } from "@/lib/marpDocument"

export default function MarpPreview({ content, cwd, filePath }: { content: string; cwd: string; filePath: string }) {
  const { t } = useTranslation()
  const cleanup = useRef<(() => void) | null>(null)
  const result = useMemo(() => {
    try { return { document: createMarpDocument(content, cwd, filePath) } }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  }, [content, cwd, filePath])
  useEffect(() => () => { cleanup.current?.() }, [])

  if (result.error !== undefined) {
    return <div role="alert" className="p-4 text-sm text-destructive">{t("Unable to render slides")}: {result.error}</div>
  }
  return (
    <iframe
      title={t("Slides of {0}", { "0": filePath })}
      className="h-full min-h-0 w-full flex-1 border-0"
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={result.document}
      onLoad={(event) => {
        cleanup.current?.()
        const body = event.currentTarget.contentDocument?.body
        cleanup.current = body ? browser(body) : null
      }}
    />
  )
}
