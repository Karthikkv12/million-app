"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { fetchBrokerPortfolio, BrokerPortfolio } from "@/lib/api";
import { AccountFilter, AccountProvider, ago } from "@/components/portfolio/broker";
import { PORTFOLIO_TABS } from "./registry";

/** Robinhood sync status, from the unfiltered portfolio. */
function SyncStatus() {
  const { data } = useQuery<BrokerPortfolio>({ queryKey: ["broker", "portfolio", null], queryFn: () => fetchBrokerPortfolio(null), refetchInterval: 60_000 });
  return (
    <p className="font-mono text-[11px] text-foreground/50">
      <span className={clsx("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", data?.synced_at ? "bg-gain" : "bg-amber-500")} />
      Robinhood · synced {ago(data?.synced_at) ?? "never"} · hourly in market hours
    </p>
  );
}

/** Portfolio shell: title, sync status, account filter and a tab strip that scrolls sideways on phones. */
export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  return <AccountProvider><Shell>{children}</Shell></AccountProvider>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = PORTFOLIO_TABS.find((t) => pathname.startsWith(`/portfolio/${t.id}`));
  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 pb-16 pt-8 sm:px-6">
      <div className="mb-6">
        <p className="eyebrow mb-2 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />Portfolio</p>
        <h1 className="text-3xl font-semibold leading-[1.05] tracking-[-0.035em] text-foreground sm:text-[40px]">{active?.label ?? "Portfolio"}</h1>
        {active && <p className="mt-2 text-[15px] leading-relaxed text-foreground/60">{active.desc}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {active?.id !== "watchlist" ? <AccountFilter /> : <span />}
          <SyncStatus />
        </div>
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
