"use client";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip, useChartStyle } from "@/components/chart/kit";
import { Panel, SkeletonCard } from "@/components/ui";
import { compactUsd, Metric, NoData, pct, shortDate, signedUsd, TD, TH, tone, useHistory, useIncome, usePortfolio, usd } from "./broker";

export function OverviewTab() {
  const { data: p, isLoading } = usePortfolio();
  const { data: hist } = useHistory(365);
  const { data: inc } = useIncome();
  const s = useChartStyle();
  if (isLoading) return <SkeletonCard rows={6} />;
  if (!p || (!p.accounts.length && !p.holdings.length)) return <NoData />;
  const thisMonth = inc?.monthly.at(-1);
  const dayPct = p.day_change != null && p.total_value ? p.day_change / (p.total_value - p.day_change) : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Account value" value={usd(p.total_value)} sub={<span className={tone(p.day_change)}>{signedUsd(p.day_change)} {dayPct != null && `(${pct(dayPct)})`} since last sync</span>} />
        <Metric label="Unrealized P&L" value={<span className={tone(p.unrealized)}>{signedUsd(p.unrealized)}</span>} sub={`stocks ${usd(p.stock_value, 0)}`} />
        <Metric label="Premium collected · month" value={<span className="text-gain">{signedUsd(thisMonth?.collected ?? 0)}</span>} sub={<span>realized P&L <span className={tone(thisMonth?.realized)}>{signedUsd(thisMonth?.realized ?? 0)}</span></span>} />
        <Metric label="Cash · buying power" value={usd(p.cash)} sub={`BP ${usd(p.buying_power)}`} />
      </div>

      <Panel title="Account value" sub={hist?.length ? `${hist.length} daily syncs` : undefined}>
        {hist && hist.length > 1 ? (
          <div className="sensitive-blur h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hist} margin={{ top: 6, right: 6, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="pv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.c.accent} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.c.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...s.grid} />
                <XAxis dataKey="day" {...s.xAxis} tickFormatter={shortDate} minTickGap={40} />
                <YAxis {...s.yAxis} width={56} domain={["auto", "auto"]} tickFormatter={(v: number) => compactUsd(v)} />
                <Tooltip cursor={s.cursor} content={<ChartTooltip title={(l) => shortDate(String(l))} format={(pl) => [{ label: "Value", value: usd(pl[0].value) }, { label: "Cash", value: usd(pl[0].payload.cash) }]} />} />
                <Area type="monotone" dataKey="total_value" stroke={s.c.accent} strokeWidth={1.75} fill="url(#pv)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="py-10 text-center text-[13px] text-foreground/55">The chart fills in as daily syncs come in.</p>}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Accounts" padded={false}>
          <table className="w-full">
            <thead><tr className="border-b border-[var(--border)]"><th className={TH}>Account</th><th className={`${TH} text-right`}>Value</th><th className={`${TH} text-right`}>Change</th><th className={`${TH} hidden text-right sm:table-cell`}>Cash</th></tr></thead>
            <tbody>
              {p.accounts.map((a) => (
                <tr key={a.account} className="border-b border-[var(--border)] last:border-0">
                  <td className={`${TD} font-sans text-foreground`}>{a.account}<span className="ml-2 font-mono text-[11px] text-foreground/40">{a.day}</span></td>
                  <td className={`sensitive ${TD} text-right text-foreground`}>{usd(a.total_value)}</td>
                  <td className={`sensitive ${TD} text-right ${tone(a.change)}`}>{signedUsd(a.change)}</td>
                  <td className={`sensitive ${TD} hidden text-right text-foreground/70 sm:table-cell`}>{usd(a.cash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Top holdings" padded={false} actions={<Link href="/portfolio/holdings" className="text-[12px] text-accent">All →</Link>}>
          <table className="w-full">
            <tbody>
              {[...p.holdings].sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0)).slice(0, 6).map((h) => (
                <tr key={h.symbol} className="border-b border-[var(--border)] last:border-0">
                  <td className={TD}><Link href={`/stocks/${h.symbol}`} className="font-medium text-foreground hover:text-accent">{h.symbol}</Link><span className="sensitive ml-2 text-[11px] text-foreground/45">{h.shares} sh</span></td>
                  <td className={`sensitive ${TD} text-right text-foreground`}>{usd(h.market_value, 0)}</td>
                  <td className={`${TD} text-right ${tone(h.unrealized)}`}>{pct(h.unrealized_pct, 1)}</td>
                  <td className={`${TD} hidden text-right text-foreground/55 sm:table-cell`}>{h.weight != null ? `${(h.weight * 100).toFixed(0)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
