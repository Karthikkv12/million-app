"use client";
import Link from "next/link";
import { clsx } from "clsx";
import { Panel, Pill, SkeletonCard } from "@/components/ui";
import { NoData, pct, signedUsd, TD, TH, usePortfolio, usd } from "./broker";

export function OptionsTab() {
  const { data: p, isLoading } = usePortfolio();
  if (isLoading) return <SkeletonCard rows={6} />;
  if (!p?.options.length) return <NoData what="open options" />;
  const premium = p.options.reduce((a, o) => a + (o.premium ?? 0), 0);
  const soonest = p.options.reduce<number | null>((m, o) => (o.dte != null && (m == null || o.dte < m) ? o.dte : m), null);
  return (
    <Panel padded={false} title="Open options" sub={<>{p.options.length} contracts · <span className="sensitive">{signedUsd(premium, 0)}</span> premium held · next expiry in {soonest ?? "—"}d</>}
      actions={<Link href="/hedge" className="text-[12px] text-accent">Delta & suggestions →</Link>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>Contract</th><th className={`${TH} text-right`}>Qty</th><th className={`${TH} text-right`}>Expiry</th>
              <th className={`${TH} text-right`}>Avg</th><th className={`${TH} text-right`}>Premium</th><th className={`${TH} text-right`}>Spot</th>
              <th className={`${TH} text-right`}>Strike vs spot</th><th className={TH}>Account</th>
            </tr>
          </thead>
          <tbody>
            {p.options.map((o, i) => (
              <tr key={i} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className={TD}>
                  <span className="font-medium text-foreground">{o.symbol} {o.strike}{o.option_type === "call" ? "C" : "P"}</span>
                  <span className={clsx("ml-2 text-[11px]", o.contracts < 0 ? "text-foreground/50" : "text-accent")}>{o.contracts < 0 ? "short" : "long"}</span>
                </td>
                <td className={`sensitive ${TD} text-right text-foreground/80`}>{Math.abs(o.contracts)}</td>
                <td className={`${TD} text-right`}>
                  <span className="text-foreground/80">{o.expiry}</span>
                  <span className={clsx("ml-1.5 text-[11px]", (o.dte ?? 99) <= 1 ? "text-loss" : (o.dte ?? 99) <= 5 ? "text-warn" : "text-foreground/45")}>{o.dte}d</span>
                </td>
                <td className={`${TD} text-right text-foreground/70`}>{usd(o.avg_price)}</td>
                <td className={`sensitive ${TD} text-right ${(o.premium ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>{signedUsd(o.premium, 0)}</td>
                <td className={`${TD} text-right text-foreground`}>{usd(o.spot)}</td>
                <td className={`${TD} text-right`}>
                  {o.moneyness && <Pill tone={o.moneyness === "ITM" ? (o.contracts < 0 ? "warn" : "good") : "neutral"} className="mr-1.5">{o.moneyness}</Pill>}
                  <span className="text-foreground/55">{pct(o.distance_pct, 1)}</span>
                </td>
                <td className={`${TD} font-sans text-[12px] text-foreground/55`}>{o.account}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
