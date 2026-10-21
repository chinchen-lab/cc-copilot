import { useMemo } from "react"
import { useTranslation } from "@/hooks/useTranslation"
import { createStyledMarkdownDocument } from "@/lib/styledMarkdownDocument"

export default function StyledMarkdownPreview({ content, cwd, filePath }: { content: string; cwd: string; filePath: string }) {
  const { t } = useTranslation()
  const document = useMemo(() => createStyledMarkdownDocument(content, cwd, filePath), [content, cwd, filePath])
  return (
    <iframe
      title={t("Styled preview of {0}", { "0": filePath })}
      className="h-full min-h-0 w-full flex-1 border-0"
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={document}
    />
  )
}
