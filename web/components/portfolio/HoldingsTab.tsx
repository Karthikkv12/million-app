"use client";
import Link from "next/link";
import { useState } from "react";
import { clsx } from "clsx";
import { LeapsCell, useLeapsScores } from "@/components/insight/LeapsScore";
import { Panel, SkeletonCard } from "@/components/ui";
import type { BrokerHolding, BrokerOption } from "@/lib/api";
import { Tick, useLiveBooks, okBooks } from "@/lib/live";
import { SectorDonut } from "./SectorDonut";
import { NoData, pct, signedUsd, TD, TH, tone, usePortfolio, usd } from "./broker";

type SortKey = "value" | "leaps";

/** A stock you own shares of, or one you only hold options on (counted as a holding, with no shares). */
type Row = { symbol: string; stock?: BrokerHolding; options: BrokerOption[]; accounts: string[] };

/** "+2C −1P": net long / short calls and puts on one underlying. */
function optionMix(opts: BrokerOption[]): string {
  const sum = (t: string) => opts.filter((o) => o.option_type.toLowerCase().startsWith(t)).reduce((a, o) => a + o.contracts, 0);
  const part = (n: number, l: string) => (n ? `${n > 0 ? "+" : "−"}${Math.abs(n)}${l}` : null);
  return [part(sum("c"), "C"), part(sum("p"), "P")].filter(Boolean).join(" ") || `${opts.length} opt`;
}

export function HoldingsTab() {
  const { data: p, isLoading } = usePortfolio();
  const beta = new Map(okBooks(useLiveBooks().data).map((b) => [b.symbol, b.beta]));

  // Every underlying you have exposure to: shares, options, or both.
  const bySym = new Map<string, Row>();
  for (const h of p?.holdings ?? []) bySym.set(h.symbol, { symbol: h.symbol, stock: h, options: [], accounts: [...h.accounts] });
  for (const o of p?.options ?? []) {
    const r = bySym.get(o.symbol) ?? { symbol: o.symbol, options: [], accounts: [] };
    r.options.push(o);
    if (o.account && !r.accounts.includes(o.account)) r.accounts.push(o.account);
    bySym.set(o.symbol, r);
  }
  const all = [...bySym.values()];

  const { data: leaps } = useLeapsScores(all.map((r) => r.symbol));
  const [sortBy, setSortBy] = useState<SortKey>("value");
  if (isLoading) return <SkeletonCard rows={6} />;
  if (!p || !all.length) return <NoData what="stocks or options" />;
  const score = (sym: string) => leaps?.get(sym)?.score ?? -1;
  const rows = all.sort((a, b) =>
    sortBy === "leaps" ? score(b.symbol) - score(a.symbol)
      : (b.stock?.market_value ?? -1) - (a.stock?.market_value ?? -1) || a.symbol.localeCompare(b.symbol));
  const nStocks = p.holdings.length, nOpt = rows.filter((r) => !r.stock).length;
  const sortTh = (key: SortKey, label: string, title: string) => (
    <th className={`${TH} text-right`} aria-sort={sortBy === key ? "descending" : "none"}>
      <button onClick={() => setSortBy(key)} title={title}
        className={clsx("uppercase hover:text-foreground", sortBy === key && "text-foreground underline underline-offset-4")}>{label}</button>
    </th>
  );
  const dash = <span className="text-foreground/30">—</span>;
  return (
    <div className="space-y-4">
    {(nStocks > 0 || (p?.options.length ?? 0) > 0) && <SectorDonut holdings={p.holdings} options={p.options} />}
    <Panel padded={false} title="Stocks"
      sub={[nStocks ? `${nStocks} with shares` : null, nOpt ? `${nOpt} through options only` : null, "live prices"].filter(Boolean).join(" · ")}>
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
            {rows.map(({ symbol, stock: h, options, accounts }) => {
              const price = h?.price ?? options.find((o) => o.spot != null)?.spot ?? leaps?.get(symbol)?.price ?? null;
              return (
                <tr key={symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                  <td className={TD}>
                    <Link href={`/stocks/${symbol}`} className="font-medium text-foreground hover:text-accent">{symbol}</Link>
                    <p className="font-sans text-[11px] text-foreground/45">{accounts.join(" · ")}</p>
                  </td>
                  <td className={`sensitive ${TD} text-right text-foreground/80`}>
                    {h ? h.shares : dash}
                    {options.length > 0 && (
                      <Link href="/portfolio/options" title="Option contracts on this stock (open the Options tab)"
                        className="block text-[11px] text-accent hover:underline">{optionMix(options)}</Link>
                    )}
                  </td>
                  <td className={`${TD} text-right text-foreground/80`}>{h ? usd(h.avg_cost) : dash}</td>
                  <td className={`${TD} text-right text-foreground`}><Tick value={price} className="px-1">{usd(price)}</Tick></td>
                  <td className={`${TD} text-right ${tone(h?.day_change_pct)}`}>{h ? pct(h.day_change_pct) : dash}</td>
                  <td className={`sensitive ${TD} text-right text-foreground`}>{h ? <Tick value={h.market_value} className="px-1">{usd(h.market_value, 0)}</Tick> : dash}</td>
                  <td className={`sensitive ${TD} text-right ${tone(h?.unrealized)}`}>{h ? <>{signedUsd(h.unrealized, 0)}<p className="text-[11px]">{pct(h.unrealized_pct, 1)}</p></> : dash}</td>
                  <td className={`${TD} text-right text-foreground/60`}>{h?.weight != null ? `${(h.weight * 100).toFixed(1)}%` : "—"}</td>
                  <td className={`${TD} text-right text-foreground/70`}>{beta.get(symbol) != null ? beta.get(symbol)!.toFixed(2) : "—"}</td>
                  <td className={`${TD} text-right`}>
                    {h?.short_calls ? <Link href="/hedge" className="text-accent hover:underline">{(h.covered_pct * 100).toFixed(0)}%</Link> : <span className="text-foreground/40">—</span>}
                  </td>
                  <td className={`${TD} text-right`}><LeapsCell s={leaps?.get(symbol)} symbol={symbol} /></td>
                </tr>
              );
            })}
          </tbody>
          {nStocks > 0 && (
            <tfoot>
              <tr className="border-t border-[var(--border-strong)]">
                <td className={`${TD} font-sans text-foreground/60`} colSpan={5}>Total</td>
                <td className={`sensitive ${TD} text-right text-foreground`}>{usd(p.stock_value, 0)}</td>
                <td className={`sensitive ${TD} text-right ${tone(p.unrealized)}`}>{signedUsd(p.unrealized, 0)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Panel>
    </div>
  );
}
