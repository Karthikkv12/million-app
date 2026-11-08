"use client";
import Link from "next/link";
import { Panel, SkeletonCard } from "@/components/ui";
import { NoData, pct, signedUsd, TD, TH, tone, usePortfolio, usd } from "./broker";

export function HoldingsTab() {
  const { data: p, isLoading } = usePortfolio();
  if (isLoading) return <SkeletonCard rows={6} />;
  if (!p?.holdings.length) return <NoData what="stocks" />;
  const rows = [...p.holdings].sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0));
  return (
    <Panel padded={false} title="Stocks" sub={`${rows.length} positions · live prices`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>Symbol</th><th className={`${TH} text-right`}>Shares</th><th className={`${TH} text-right`}>Avg cost</th>
              <th className={`${TH} text-right`}>Price</th><th className={`${TH} text-right`}>Today</th><th className={`${TH} text-right`}>Value</th>
              <th className={`${TH} text-right`}>Unrealized</th><th className={`${TH} text-right`}>Weight</th><th className={`${TH} text-right`}>Covered</th>
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
                <td className={`${TD} text-right text-foreground`}>{usd(h.price)}</td>
                <td className={`${TD} text-right ${tone(h.day_change_pct)}`}>{pct(h.day_change_pct)}</td>
                <td className={`sensitive ${TD} text-right text-foreground`}>{usd(h.market_value, 0)}</td>
                <td className={`sensitive ${TD} text-right ${tone(h.unrealized)}`}>{signedUsd(h.unrealized, 0)}<p className="text-[11px]">{pct(h.unrealized_pct, 1)}</p></td>
                <td className={`${TD} text-right text-foreground/60`}>{h.weight != null ? `${(h.weight * 100).toFixed(1)}%` : "—"}</td>
                <td className={`${TD} text-right`}>
                  {h.short_calls ? <Link href="/hedge" className="text-accent hover:underline">{(h.covered_pct * 100).toFixed(0)}%</Link> : <span className="text-foreground/40">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border-strong)]">
              <td className={`${TD} font-sans text-foreground/60`} colSpan={5}>Total</td>
              <td className={`sensitive ${TD} text-right text-foreground`}>{usd(p.stock_value, 0)}</td>
              <td className={`sensitive ${TD} text-right ${tone(p.unrealized)}`}>{signedUsd(p.unrealized, 0)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}
