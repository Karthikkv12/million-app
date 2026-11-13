"use client";
import Link from "next/link";
import { useState } from "react";
import { clsx } from "clsx";
import { LeapsCell, useLeapsScores } from "@/components/insight/LeapsScore";
import { Panel, SkeletonCard } from "@/components/ui";
import { Tick, useLiveBooks, okBooks } from "@/lib/live";
import { SectorDonut } from "./SectorDonut";
import { NoData, pct, signedUsd, TD, TH, tone, usePortfolio, usd } from "./broker";

type SortKey = "value" | "leaps";

export function HoldingsTab() {
  const { data: p, isLoading } = usePortfolio();
  const beta = new Map(okBooks(useLiveBooks().data).map((b) => [b.symbol, b.beta]));
  const { data: leaps } = useLeapsScores(p?.holdings.map((h) => h.symbol) ?? []);
  const [sortBy, setSortBy] = useState<SortKey>("value");
  if (isLoading) return <SkeletonCard rows={6} />;
  if (!p?.holdings.length) return <NoData what="stocks" />;
  const score = (sym: string) => leaps?.get(sym)?.score ?? -1;
  const rows = [...p.holdings].sort((a, b) =>
    sortBy === "leaps" ? score(b.symbol) - score(a.symbol) : (b.market_value ?? 0) - (a.market_value ?? 0));
  const sortTh = (key: SortKey, label: string, title: string) => (
    <th className={`${TH} text-right`} aria-sort={sortBy === key ? "descending" : "none"}>
      <button onClick={() => setSortBy(key)} title={title}
        className={clsx("uppercase hover:text-foreground", sortBy === key && "text-foreground underline underline-offset-4")}>{label}</button>
    </th>
  );
  return (
    <div className="space-y-4">
    <SectorDonut holdings={p.holdings} />
    <Panel padded={false} title="Stocks" sub={`${rows.length} positions · live prices`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>Symbol</th><th className={`${TH} text-right`}>Shares</th><th className={`${TH} text-right`}>Avg cost</th>
              <th className={`${TH} text-right`}>Price</th><th className={`${TH} text-right`}>Today</th>{sortTh("value", "Value", "Sort by market value")}
              <th className={`${TH} text-right`}>Unrealized</th><th className={`${TH} text-right`}>Weight</th><th className={`${TH} text-right`}>Beta</th><th className={`${TH} text-right`}>Covered</th>
              {sortTh("leaps", "LEAPS", "LEAPS score, 0–100 for buying a long-dated call (put underneath). Click to sort best first.")}
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className={TD}>
                  <Link href={`/stocks/${h.symbol}`} className="font-medium text-foreground hover:text-accent">{h.symbol}</Link>
                  <p className="font-sans text-[11px] text-foreground/45">{h.accounts.join(" · ")}</p>
                </td>
                <td className={`sensitive ${TD} text-right text-foreground/80`}>{h.shares}</td>
                <td className={`${TD} text-right text-foreground/80`}>{usd(h.avg_cost)}</td>
                <td className={`${TD} text-right text-foreground`}><Tick value={h.price} className="px-1">{usd(h.price)}</Tick></td>
                <td className={`${TD} text-right ${tone(h.day_change_pct)}`}>{pct(h.day_change_pct)}</td>
                <td className={`sensitive ${TD} text-right text-foreground`}><Tick value={h.market_value} className="px-1">{usd(h.market_value, 0)}</Tick></td>
                <td className={`sensitive ${TD} text-right ${tone(h.unrealized)}`}>{signedUsd(h.unrealized, 0)}<p className="text-[11px]">{pct(h.unrealized_pct, 1)}</p></td>
                <td className={`${TD} text-right text-foreground/60`}>{h.weight != null ? `${(h.weight * 100).toFixed(1)}%` : "—"}</td>
                <td className={`${TD} text-right text-foreground/70`}>{beta.get(h.symbol) != null ? beta.get(h.symbol)!.toFixed(2) : "—"}</td>
                <td className={`${TD} text-right`}>
                  {h.short_calls ? <Link href="/hedge" className="text-accent hover:underline">{(h.covered_pct * 100).toFixed(0)}%</Link> : <span className="text-foreground/40">—</span>}
                </td>
                <td className={`${TD} text-right`}><LeapsCell s={leaps?.get(h.symbol)} symbol={h.symbol} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border-strong)]">
              <td className={`${TD} font-sans text-foreground/60`} colSpan={5}>Total</td>
              <td className={`sensitive ${TD} text-right text-foreground`}>{usd(p.stock_value, 0)}</td>
              <td className={`sensitive ${TD} text-right ${tone(p.unrealized)}`}>{signedUsd(p.unrealized, 0)}</td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
    </div>
  );
}
