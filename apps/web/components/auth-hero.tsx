import type { ReactNode } from "react";
import { BRAND_NAME } from "@/lib/brand";

// Shared shell for the pre-auth hero (login, coach/signup, join). Owns the
// dark section, safe-area padding, and brand eyebrow; each page passes its
// own title and subtitle as children.
export function AuthHero({
  padding = "pb-20",
  children,
}: {
  padding?: string;
  children: ReactNode;
}) {
  return (
    <section className={`bg-slate-950 px-6 ${padding} pt-[max(2.5rem,env(safe-area-inset-top))] text-white`}>
      <div className="mx-auto max-w-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">{BRAND_NAME}</p>
        {children}
      </div>
    </section>
  );
}
