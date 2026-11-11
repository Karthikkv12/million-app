"use client";
/** Hedge shell: Desk · Scanner, with the strategy dropdown that drives both. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Radar, Scale } from "lucide-react";
import { StrategyPicker } from "@/components/strategy/StrategyPicker";

const TABS = [
  { href: "/hedge", label: "Delta desk", icon: Scale, match: (p: string) => !p.startsWith("/hedge/scanner") },
  { href: "/hedge/scanner", label: "Scanner", icon: Radar, match: (p: string) => p.startsWith("/hedge/scanner") },
];

export default function HedgeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <nav aria-label="Hedge" className="border-b border-[var(--border)]">
        <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center gap-x-3 px-4 sm:flex-nowrap sm:px-8">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
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
          <div className="w-full pb-2.5 sm:w-auto sm:pb-0"><StrategyPicker /></div>
        </div>
      </nav>
      {children}
    </>
  );
}
