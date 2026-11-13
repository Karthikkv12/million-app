"use client";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip, useChartStyle } from "@/components/chart/kit";
import { Panel, Segmented, SkeletonCard } from "@/components/ui";
import { compactUsd, Metric, NoData, shortDate, signedUsd, TD, TH, tone, useIncome, usd } from "./broker";
import { TickerLink } from "@/components/TickerLink";

export function IncomeTab() {
  const { data: inc, isLoading } = useIncome();
  const [view, setView] = useState<"weekly" | "monthly">("weekly");
  const [series, setSeries] = useState<"collected" | "premium" | "realized">("collected");
  const s = useChartStyle();
  if (isLoading) return <SkeletonCard rows={6} />;
  if (!inc || (!inc.weekly.length && !inc.monthly.length)) return <NoData what="trade history" />;
  const rows = inc[view];
  const label = (p: string) => (view === "weekly" ? `wk ${shortDate(p)}` : new Date(p + "-15").toLocaleDateString(undefined, { month: "short", year: "2-digit" }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Premium collected" value={<span className="text-gain">{signedUsd(inc.collected_total, 0)}</span>} sub={`net ${signedUsd(inc.premium_total, 0)} after ${usd(inc.bought_back_total, 0)} buy-backs`} />
        <Metric label="Realized P&L" value={<span className={tone(inc.realized_total)}>{signedUsd(inc.realized_total, 0)}</span>} sub={`${inc.trades} closing trades · stocks + options`} />
        <Metric sensitive={false} label="Win rate" value={inc.win_rate == null ? "—" : `${(inc.win_rate * 100).toFixed(0)}%`} sub="closing trades in profit" />
        <Metric sensitive={false} label="History since" value={inc.since ? shortDate(inc.since) : "—"} sub="from Robinhood" />
      </div>
      <Panel title={series === "collected" ? "Premium collected" : series === "premium" ? "Net premium (after buy-backs)" : "Realized P&L"}>
        <div className="mb-3 flex flex-wrap gap-2">
          <Segmented value={series} onChange={setSeries} options={[{ value: "collected", label: "Collected" }, { value: "premium", label: "Net" }, { value: "realized", label: "Realized" }]} />
          <Segmented value={view} onChange={setView} options={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} />
        </div>
        <div className="sensitive-blur h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 4 }}>
              <CartesianGrid {...s.grid} />
              <XAxis dataKey="period" {...s.xAxis} tickFormatter={label} minTickGap={20} />
              <YAxis {...s.yAxis} width={52} tickFormatter={(v: number) => compactUsd(v)} />
              <Tooltip cursor={s.barCursor} content={<ChartTooltip title={(l) => label(String(l))} format={(pl) => [
                { label: "Collected", value: signedUsd(pl[0].payload.collected) }, { label: "Bought back", value: usd(pl[0].payload.bought_back) },
                { label: "Net premium", value: signedUsd(pl[0].payload.premium) }, { label: "Realized", value: signedUsd(pl[0].payload.realized) },
                { label: "Closing trades", value: String(pl[0].payload.trades) }]} />} />
              <Bar dataKey={series} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {rows.map((r, i) => <Cell key={i} fill={(r[series] ?? 0) >= 0 ? s.c.gain : s.c.loss} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title="By symbol" sub="Realized P&L already includes closed options' premium; don't add the two." padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px]">
            <thead><tr className="border-b border-[var(--border)]"><th className={TH}>Symbol</th><th className={`${TH} text-right`}>Collected</th><th className={`${TH} text-right`}>Bought back</th><th className={`${TH} text-right`}>Net premium</th><th className={`${TH} text-right`}>Realized P&L</th><th className={`${TH} text-right`}>Closes</th></tr></thead>
            <tbody>
              {inc.by_symbol.map((r) => (
                <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0">
                  <td className={`${TD} font-medium text-foreground`}><TickerLink symbol={r.symbol} /></td>
                  <td className={`sensitive ${TD} text-right ${r.collected ? "text-gain" : "text-foreground/40"}`}>{signedUsd(r.collected, 0)}</td>
                  <td className={`sensitive ${TD} text-right text-foreground/60`}>{r.bought_back ? usd(r.bought_back, 0) : "—"}</td>
                  <td className={`sensitive ${TD} text-right ${tone(r.premium)}`}>{signedUsd(r.premium, 0)}</td>
                  <td className={`sensitive ${TD} text-right ${tone(r.realized)}`}>{signedUsd(r.realized, 0)}</td>
                  <td className={`${TD} text-right text-foreground/60`}>{r.trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
