"use client";
/** Flow shell: Board (dealer exposure by strike) · Trinity (SPX / SPY / QQQ, one expiry) · Premium (one ticker's option premium). */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Columns3, Grid3x3, LineChart } from "lucide-react";

const TABS = [
  { href: "/options-flow", label: "Board", icon: Grid3x3, match: (p: string) => p === "/options-flow" },
  { href: "/options-flow/trinity", label: "Trinity", icon: Columns3, match: (p: string) => p.startsWith("/options-flow/trinity") },
  { href: "/options-flow/premium", label: "Premium", icon: LineChart, match: (p: string) => p.startsWith("/options-flow/premium") },
];

export default function FlowLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <nav aria-label="Flow" className="border-b border-[var(--border)]">
        <div className="flex w-full gap-1 overflow-x-auto px-4 sm:px-8">
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
