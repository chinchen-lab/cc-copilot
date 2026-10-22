import brand from "../../shared/brand.json"
import { cn } from "@/lib/utils"

/** The wordmark shares its vector mark with the generated platform icons. */
export function BrandLogo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div
      className={cn("brand-logo inline-flex items-center text-foreground", compact ? "gap-1.5" : "gap-2.5", className)}
      role="img"
      aria-label={`${brand.prefix}-${brand.name}${compact ? "" : ` ${brand.badge}`}`}
    >
      <svg className={cn("brand-icon shrink-0", compact ? "size-5.5" : "size-9")} viewBox="0 0 512 512" aria-hidden="true">
        <use href="/cogpit.svg#mark" />
      </svg>
      <span className={cn("brand-text inline-flex items-center whitespace-nowrap font-semibold tracking-tight", compact ? "text-sm" : "text-xl")} aria-hidden="true">
        {brand.prefix}-
        <span className="brand-highlight text-[#4285F4]">{brand.name}</span>
        {!compact && <span className="brand-badge ml-0.5 rounded-md bg-[#FBBC05] px-1.5 py-0.5 text-[0.625rem] font-bold leading-tight tracking-wide text-[#202124]">{brand.badge}</span>}
      </span>
    </div>
  )
}
