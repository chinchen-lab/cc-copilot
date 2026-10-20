import { Moon, Sun } from "lucide-react"
import { HeaderIconButton } from "@/components/header-shared"
import { useAppContext } from "@/contexts/AppContext"
import { themeMode, type ThemeId } from "@/lib/themes"

export function ThemeToggleButton({ className }: { className?: string }) {
  const { theme: { activeTheme, setTheme } } = useAppContext()
  const isDark = themeMode(activeTheme) === "dark"
  const nextTheme: ThemeId = activeTheme === "layered" ? "layered-light"
    : activeTheme === "layered-light" ? "layered"
    : isDark ? "light" : "dark"

  return (
    <HeaderIconButton
      icon={isDark ? Sun : Moon}
      label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(nextTheme)}
      size="default"
      className={className}
    />
  )
}
