"use client";
/** Catalyst shell: Stocks · Unusual activity · Economic calendar · Reports. Stock pages count as "Stocks". */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { CalendarDays, FileText, Flame, Search } from "lucide-react";

const TABS = [
  { href: "/catalyst", label: "Stocks", icon: Search, match: (p: string) => !["/catalyst/unusual", "/catalyst/calendar", "/catalyst/reports"].some((x) => p.startsWith(x)) },
  { href: "/catalyst/unusual", label: "Unusual activity", icon: Flame, match: (p: string) => p.startsWith("/catalyst/unusual") },
  { href: "/catalyst/calendar", label: "Economic calendar", icon: CalendarDays, match: (p: string) => p.startsWith("/catalyst/calendar") },
  { href: "/catalyst/reports", label: "Reports", icon: FileText, match: (p: string) => p.startsWith("/catalyst/reports") },
];

export default function CatalystLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <nav aria-label="Catalyst" className="border-b border-[var(--border)]">
        <div className="mx-auto flex w-full max-w-screen-2xl gap-1 overflow-x-auto px-4 sm:px-6">
          {TABS.map((t) => {
            const on = t.match(pathname);
            return (
              <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
                className={clsx("-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-[13.5px] transition",
                  on ? "border-foreground font-medium text-foreground" : "border-transparent text-foreground/55 hover:text-foreground")}>
                <t.icon size={15} />{t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </>
  );
}
