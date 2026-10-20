import brand from "../../shared/brand.json"
import { cn } from "@/lib/utils"

/** The wordmark shares its vector mark with the generated platform icons. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <div
      className={cn("brand-logo inline-flex items-center gap-2.5 text-foreground", className)}
      role="img"
      aria-label={`${brand.prefix} ${brand.name} ${brand.badge}`}
    >
      <svg className="brand-icon size-9 shrink-0" viewBox="0 0 512 512" aria-hidden="true">
        <use href="/cogpit.svg#mark" />
      </svg>
      <span className="brand-text inline-flex items-center gap-1.5 whitespace-nowrap text-xl font-semibold tracking-tight" aria-hidden="true">
        {brand.prefix}
        <span className="brand-highlight text-[#4285F4]">{brand.name}</span>
        <span className="brand-badge ml-0.5 rounded-md bg-[#FBBC05] px-1.5 py-0.5 text-[10px] font-bold leading-tight tracking-wide text-[#202124]">{brand.badge}</span>
      </span>
    </div>
  )
}
