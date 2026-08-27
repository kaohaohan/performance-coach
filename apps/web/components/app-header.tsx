import type { ReactNode } from "react";
import { BRAND_NAME } from "@/lib/brand";

// Shared shell for the signed-in "hero" header family (clients,
// clients/[athleteId], workouts, exercises, today). Owns only the markup
// those pages had byte-identical: the dark wrapper, safe-area padding, and
// the eyebrow+actions row. Page-specific content (title, subtitle, nav,
// date carousel) stays with each page as children.
export function AppHeader({
  maxWidth = "max-w-lg",
  padding = "pb-8",
  actions,
  children,
}: {
  maxWidth?: string;
  padding?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <header className={`bg-slate-950 px-5 ${padding} pt-[max(1.5rem,env(safe-area-inset-top))] text-white`}>
      <div className={`mx-auto ${maxWidth}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">{BRAND_NAME}</p>
          {actions}
        </div>
        {children}
      </div>
    </header>
  );
}
