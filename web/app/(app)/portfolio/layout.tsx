"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { PORTFOLIO_TABS } from "./registry";

/** Portfolio shell: page title and a tab strip that scrolls sideways on phones. */
export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = PORTFOLIO_TABS.find((t) => pathname.startsWith(`/portfolio/${t.id}`));
  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 pb-16 pt-8 sm:px-6">
      <div className="mb-6">
        <p className="eyebrow mb-2 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />Portfolio</p>
        <h1 className="text-3xl font-semibold leading-[1.05] tracking-[-0.035em] text-foreground sm:text-[40px]">{active?.label ?? "Portfolio"}</h1>
        {active && <p className="mt-2 text-[15px] leading-relaxed text-foreground/60">{active.desc}</p>}
      </div>
      <nav aria-label="Portfolio" className="-mx-4 mb-6 overflow-x-auto border-b border-[var(--border)] px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1">
          {PORTFOLIO_TABS.map((t) => {
            const on = active?.id === t.id;
            return (
              <Link key={t.id} href={`/portfolio/${t.id}`} aria-current={on ? "page" : undefined}
                className={clsx("-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition",
                  on ? "border-foreground font-medium text-foreground" : "border-transparent text-foreground/55 hover:text-foreground")}>
                <t.icon size={15} className="shrink-0" />{t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </div>
  );
}
