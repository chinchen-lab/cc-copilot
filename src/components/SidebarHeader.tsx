import { useTranslation } from "@/hooks/useTranslation"
import { memo } from "react"
import { PanelLeftClose, Search } from "lucide-react"
import { HeaderIconButton } from "@/components/header-shared"
import { BrandLogo } from "@/components/BrandLogo"

interface SidebarHeaderProps {
  onToggleSidebar: () => void
  onGoHome: () => void
  onOpenCommandPalette: () => void
  sidebarShortcut: string
  commandPaletteShortcut: string
}

/**
 * With no title bar, the sidebar's top row owns the window's top-left corner:
 * the traffic lights keep their inset, the compact home link sits on the
 * left and utility actions stay on the right.
 */
export const SidebarHeader = memo(function SidebarHeader({
  onToggleSidebar,
  onGoHome,
  onOpenCommandPalette,
  sidebarShortcut,
  commandPaletteShortcut,
}: SidebarHeaderProps) {
  const { t } = useTranslation()
  return (
    <div className="electron-drag window-inset-start flex h-12 shrink-0 items-center gap-1 px-2">
      <button
        type="button"
        aria-label={t("Home")}
        title={t("Mission Control")}
        onClick={onGoHome}
        className="mr-auto min-w-0 rounded-md px-1 py-1.5 outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BrandLogo compact />
      </button>
      <HeaderIconButton
        icon={Search}
        label={t("Search ({0})", { "0": commandPaletteShortcut })}
        onClick={onOpenCommandPalette}
        size="default"
      />
      <HeaderIconButton
        icon={PanelLeftClose}
        label={t("Hide sidebar ({0})", { "0": sidebarShortcut })}
        onClick={onToggleSidebar}
        size="default"
      />
    </div>
  )
})
