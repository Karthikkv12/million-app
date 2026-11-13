"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip, useChartStyle } from "@/components/chart/kit";
import { Panel, SkeletonCard } from "@/components/ui";
import { dayPnl, liveAccount, okBooks, Tick, useLiveBooks } from "@/lib/live";
import { SectorDonut } from "./SectorDonut";
import { compactUsd, Metric, NoData, pct, shortDate, signedUsd, TD, TH, tone, useHistory, useIncome, usePortfolio, usd } from "./broker";

export function OverviewTab() {
  const { data: p, isLoading } = usePortfolio();
  const { data: allHist } = useHistory(1825);
  const [range, setRange] = useState<Range>("3M");
  const hist = useMemo(() => withChange(clip(allHist ?? [], range)), [allHist, range]);
  const { data: inc } = useIncome();
  const s = useChartStyle();
  const live = useLiveBooks();
  const books = okBooks(live.data);
  const today = p && !p.account_filter ? dayPnl(books) : null;
  const acct = liveAccount(p, books);
  if (isLoading) return <SkeletonCard rows={6} />;
  if (!p || (!p.accounts.length && !p.holdings.length)) return <NoData />;
  const thisMonth = inc?.monthly.at(-1);
  // Only the current ET week counts: weekly.at(-1) is the last week with any fills, which may be weeks ago.
  const week = inc?.weekly.find((w) => w.period === inc.this_week);
  const unreal = p.unrealized != null ? p.unrealized + (acct?.optionsUnrealized ?? 0) : null;
  const dayPct = p.day_change != null && p.total_value ? p.day_change / (p.total_value - p.day_change) : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {today && (
          <Metric label="Today · live" value={<Tick value={Math.round(today.total)}><span className={tone(today.total)}>{signedUsd(today.total)}</span></Tick>}
            sub={<span>stocks <span className={tone(today.stocks)}>{signedUsd(today.stocks, 0)}</span> · options <span className={tone(today.options)}>{signedUsd(today.options, 0)}</span> est.</span>} />
        )}
        <Metric label={acct ? "Account value · live" : "Account value"} value={<Tick value={acct ? Math.round(acct.value) : null}>{usd(acct?.value ?? p.total_value)}</Tick>}
          sub={<span>{acct && <>at sync {usd(p.total_value, 0)} · </>}<span className={tone(p.day_change)}>{signedUsd(p.day_change)} {dayPct != null && `(${pct(dayPct)})`}</span> since last sync</span>} />
        <Metric label="Unrealized P&L" value={<Tick value={unreal != null ? Math.round(unreal) : null}><span className={tone(unreal)}>{signedUsd(unreal)}</span></Tick>}
          sub={<span>stocks <span className={tone(p.unrealized)}>{signedUsd(p.unrealized, 0)}</span>{acct && <> · options <span className={tone(acct.optionsUnrealized)}>{signedUsd(acct.optionsUnrealized, 0)}</span></>}</span>} />
        <Metric label="Net premium · this week" value={<span className={tone(week?.premium ?? 0)}>{signedUsd(week?.premium ?? 0, 0)}</span>}
          sub={<span>sold {usd(week?.collected ?? 0, 0)} · bought back {usd(week?.bought_back ?? 0, 0)}{week?.long_paid ? <> · long options bought {usd(week.long_paid, 0)} (not counted)</> : null}</span>} />
        <Metric label="Premium collected · month" value={<span className="text-gain">{signedUsd(thisMonth?.collected ?? 0)}</span>} sub={<span>realized P&L <span className={tone(thisMonth?.realized)}>{signedUsd(thisMonth?.realized ?? 0)}</span></span>} />
        <Metric label="Cash · buying power" value={usd(p.cash)} sub={`BP ${usd(p.buying_power)}`} />
      </div>

      <Panel title="Account value" sub={hist.length ? `${hist.length} daily syncs` : undefined}
        actions={<RangeChips value={range} onChange={setRange} />}>
        {hist.length > 1 ? (
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
                <Tooltip cursor={s.cursor} content={<ChartTooltip title={(l) => shortDate(String(l))} format={(pl) => [
                  { label: "Value", value: usd(pl[0].value) },
                  { label: "Day", value: pl[0].payload.change == null ? "—" : signedUsd(pl[0].payload.change) },
                  { label: "Cash", value: usd(pl[0].payload.cash) },
                ]} />} />
                {/* Straight segments between daily syncs: every up and down day shows, nothing is smoothed away. */}
                <Area type="linear" dataKey="total_value" stroke={s.c.accent} strokeWidth={1.75} fill="url(#pv)" isAnimationActive={false}
                  dot={hist.length <= 45 ? { r: 2.5, fill: s.c.accent, stroke: s.c.surface, strokeWidth: 1 } : false}
                  activeDot={{ r: 4, fill: s.c.accent, stroke: s.c.surface, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="py-10 text-center text-[13px] text-foreground/55">The chart fills in as daily syncs come in.</p>}
      </Panel>

      <SectorDonut holdings={p.holdings} options={p.options} />

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

type Range = "1M" | "3M" | "YTD" | "1Y" | "All";
const RANGES: Range[] = ["1M", "3M", "YTD", "1Y", "All"];
type Point = { day: string; total_value?: number | null; cash?: number | null };

function clip<T extends Point>(rows: T[], r: Range): T[] {
  if (r === "All" || !rows.length) return rows;
  const d = new Date();
  if (r === "YTD") d.setMonth(0, 1);
  else d.setDate(d.getDate() - (r === "1M" ? 31 : r === "3M" ? 92 : 366));
  const from = d.toISOString().slice(0, 10);
  return rows.filter((x) => x.day >= from);
}

const withChange = <T extends Point>(rows: T[]) =>
  rows.map((x, i) => ({ ...x, change: i && x.total_value != null && rows[i - 1].total_value != null ? x.total_value - rows[i - 1].total_value! : null }));

function RangeChips({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="flex gap-0.5">
      {RANGES.map((r) => (
        <button key={r} onClick={() => onChange(r)} aria-pressed={value === r}
          className={clsx("h-7 rounded-md px-2 font-mono text-[11px] transition",
            value === r ? "bg-[var(--surface-2)] text-foreground" : "text-foreground/50 hover:text-foreground")}>
          {r}
        </button>
      ))}
    </div>
  );
}
