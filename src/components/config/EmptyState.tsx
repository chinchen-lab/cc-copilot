import { useTranslation } from "@/hooks/useTranslation"
import { FileText } from "lucide-react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export function EmptyState() {
  const { t } = useTranslation()
  return (
    <Empty className="border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileText />
        </EmptyMedia>
        <EmptyTitle>{t("Select a configuration file")}</EmptyTitle>
        <EmptyDescription>
          {t("Browse instructions, agents, skills, commands, and settings from the sidebar.")}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
