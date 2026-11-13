"use client";
/**
 * Realized P&L calendar: one cell per day (P&L, closing trades, win rate), a total per week,
 * and the day's trades on click. Built from the Robinhood-synced "realized" activity rows,
 * the same rows the Income tab sums, so the two always agree.
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { fetchBrokerActivity, BrokerActivity } from "@/lib/api";
import { Panel, SkeletonCard } from "@/components/ui";
import { Metric, NoData, signedUsd, TD, TH, tone, useAccount, usd } from "./broker";
import { TickerLink } from "@/components/TickerLink";

/** The API returns at most this many rows (fills and closes together), newest first. */
const LIMIT = 2000;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const etDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

/** Trading day (US Eastern) of a row. A bare date, or a date stamped at UTC midnight, is already a day. */
export function dayOf(ts: string): string {
  if (ts.length === 10 || /T00:00:00(\.0+)?(Z|\+00:00)?$/.test(ts)) return ts.slice(0, 10);
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts.slice(0, 10) : etDay.format(d);
}

interface Day { pnl: number; trades: number; wins: number; rows: BrokerActivity[] }
const blank = (): Day => ({ pnl: 0, trades: 0, wins: 0, rows: [] });
const add = (a: Day, b: Day) => ({ pnl: a.pnl + b.pnl, trades: a.trades + b.trades, wins: a.wins + b.wins, rows: a.rows });

/** $1.08K / $996 / −$159: short enough for a calendar cell. */
const cellUsd = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(2)}K` : `${s}$${a.toFixed(a < 100 && a % 1 ? 1 : 0)}`;
};
const winPct = (d: Day) => (d.trades ? `${Math.round((d.wins / d.trades) * 100)}%` : "—");
const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const longDay = (k: string) => new Date(k + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

export function CalendarTab() {
  const { account } = useAccount();
  const { data, isLoading } = useQuery<BrokerActivity[]>({
    queryKey: ["broker", "activity", account, LIMIT], queryFn: () => fetchBrokerActivity(account, LIMIT), refetchInterval: 5 * 60_000,
  });
  const today = etDay.format(new Date());
  const [ym, setYm] = useState(() => ({ y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 }));
  const [picked, setPicked] = useState<string | null>(null);

  const { days, first } = useMemo(() => {
    const days = new Map<string, Day>();
    let first: string | null = null;
    for (const a of data ?? []) {
      if (a.kind !== "realized" || a.realized_gain == null) continue;
      const k = dayOf(a.ts);
      const d = days.get(k) ?? blank();
      d.pnl += a.realized_gain; d.trades += 1; d.wins += a.realized_gain > 0 ? 1 : 0; d.rows.push(a);
      days.set(k, d);
      if (!first || k < first) first = k;
    }
    return { days, first };
  }, [data]);

  const { y, m } = ym;
  const cal = useMemo(() => {
    const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const lead = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const weeks: (string | null)[][] = [];
    for (let i = -lead; i < count; i += 7) weeks.push(Array.from({ length: 7 }, (_, j) => (i + j >= 0 && i + j < count ? key(y, m, i + j + 1) : null)));
    const inMonth = weeks.flat().filter((k): k is string => !!k && days.has(k));
    // Weekends only take up room when something closed on one (expiries can post on a Saturday).
    const weekend = inMonth.some((k) => [0, 6].includes(new Date(k + "T12:00:00").getDay()));
    const total = inMonth.reduce((t, k) => add(t, days.get(k)!), blank());
    const ranked = [...inMonth].sort((a, b) => days.get(a)!.pnl - days.get(b)!.pnl);
    return { weeks, weekend, total, active: inMonth, worst: ranked[0], best: ranked[ranked.length - 1], green: inMonth.filter((k) => days.get(k)!.pnl > 0).length };
  }, [y, m, days]);

  if (isLoading) return <SkeletonCard rows={8} />;
  if (!data?.length || !first) return <NoData what="closed trades" />;

  const cols = cal.weekend ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  const thisMonth = y === +today.slice(0, 4) && m === +today.slice(5, 7) - 1;
  const atStart = key(y, m, 1) <= first.slice(0, 8) + "01";
  // When the row limit is hit, the oldest month is only partly loaded.
  const partial = data.length >= LIMIT && first.slice(0, 7) === key(y, m, 1).slice(0, 7);
  const step = (n: number) => { setPicked(null); setYm(({ y, m }) => { const d = new Date(Date.UTC(y, m + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; }); };
  const sel = picked && days.has(picked) ? picked : null;
  const selDay = sel ? days.get(sel)! : null;
  const navBtn = "flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-foreground/70 transition hover:bg-[var(--surface-2)] hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Realized P&L" value={<span className={tone(cal.total.pnl)}>{signedUsd(cal.total.pnl, 0)}</span>} sub={`${cal.total.trades} closing trade${cal.total.trades === 1 ? "" : "s"}`} />
        <Metric sensitive={false} label="Win rate" value={winPct(cal.total)} sub={`${cal.green} of ${cal.active.length} days green`} />
        <Metric label="Best day" value={cal.best ? <span className={tone(days.get(cal.best)!.pnl)}>{signedUsd(days.get(cal.best)!.pnl, 0)}</span> : "—"} sub={cal.best ? longDay(cal.best) : "no closes"} />
        <Metric label="Worst day" value={cal.worst ? <span className={tone(days.get(cal.worst)!.pnl)}>{signedUsd(days.get(cal.worst)!.pnl, 0)}</span> : "—"} sub={cal.worst ? longDay(cal.worst) : "no closes"} />
      </div>

      <Panel padded={false}
        title={new Date(Date.UTC(y, m, 15)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
        sub={partial ? "Earlier trades this month are not loaded" : undefined}
        actions={<>
          {!thisMonth && <button onClick={() => { setPicked(null); setYm({ y: +today.slice(0, 4), m: +today.slice(5, 7) - 1 }); }} className="h-8 rounded-lg border border-[var(--border)] px-2.5 font-mono text-[11px] text-foreground/70 transition hover:bg-[var(--surface-2)] hover:text-foreground">Today</button>}
          <button aria-label="Previous month" className={navBtn} disabled={atStart} onClick={() => step(-1)}><ChevronLeft size={16} /></button>
          <button aria-label="Next month" className={navBtn} disabled={thisMonth} onClick={() => step(1)}><ChevronRight size={16} /></button>
        </>}>
        <div style={{ "--cols": cols.length } as React.CSSProperties}
          className="grid grid-cols-[repeat(var(--cols),minmax(0,1fr))] gap-1 p-2 sm:grid-cols-[repeat(var(--cols),minmax(0,1fr))_minmax(104px,0.9fr)] sm:gap-1.5 sm:p-3">
          {cols.map((c) => <p key={c} className="pb-1 text-center font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground/45">{DOW[c]}</p>)}
          <p className="hidden pb-1 pl-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground/45 sm:block">Week</p>
          {cal.weeks.map((week, wi) => {
            if (!cols.some((c) => week[c])) return null;
            const wk = week.reduce((t, k) => (k && days.has(k) ? add(t, days.get(k)!) : t), blank());
            const wkDays = week.filter((k) => k && days.has(k)).length;
            return [
              ...cols.map((c) => {
                const k = week[c];
                if (!k) return <div key={`${wi}-${c}`} />;
                const d = days.get(k);
                const n = +k.slice(8);
                const base = "relative flex h-[70px] min-w-0 flex-col items-end rounded-lg border p-1.5 text-right sm:h-[104px] sm:rounded-xl sm:p-2.5";
                const num = <span className={clsx("font-mono text-[11px] leading-none", k === today ? "rounded-full bg-foreground px-1.5 py-0.5 text-background" : "text-foreground/50")}>{n}</span>;
                if (!d) return <div key={k} className={clsx(base, "border-transparent bg-foreground/[0.03]", k > today && "opacity-50")}>{num}</div>;
                const up = d.pnl >= 0;
                return (
                  <button key={k} onClick={() => setPicked(sel === k ? null : k)} aria-pressed={sel === k}
                    aria-label={`${longDay(k)}: ${signedUsd(d.pnl, 0)}, ${d.trades} closing trade${d.trades === 1 ? "" : "s"}, ${winPct(d)} in profit`}
                    className={clsx(base, "transition", up ? "border-gain/30 bg-gain/10 hover:bg-gain/[0.16]" : "border-loss/30 bg-loss/10 hover:bg-loss/[0.16]",
                      sel === k && "ring-2 ring-foreground/70 ring-offset-1 ring-offset-[var(--surface)]")}>
                    {num}
                    <span className="sensitive mt-auto w-full truncate font-mono text-[12px] font-semibold tabular-nums tracking-tight text-foreground sm:text-[16px]">{cellUsd(d.pnl)}</span>
                    <span className="w-full truncate font-mono text-[10px] leading-tight text-foreground/55 sm:text-[11.5px]">{d.trades}<span className="hidden sm:inline"> trade{d.trades === 1 ? "" : "s"}</span><span className="sm:hidden"> · {winPct(d)}</span></span>
                    <span className="hidden w-full truncate font-mono text-[11.5px] leading-tight text-foreground/55 sm:block">{winPct(d)}</span>
                  </button>
                );
              }),
              <div key={`w${wi}`} className="col-span-full mb-1 flex items-baseline justify-between gap-2 rounded-lg px-1.5 pb-1 sm:col-span-1 sm:mb-0 sm:h-[104px] sm:flex-col sm:items-start sm:justify-center sm:gap-1 sm:px-3 sm:pb-0">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground/45">Week {wi + 1}</span>
                <span className={clsx("sensitive font-mono text-[13px] font-semibold tabular-nums sm:text-[18px]", wkDays ? tone(wk.pnl) : "text-foreground/30")}>{wkDays ? cellUsd(wk.pnl) : "—"}</span>
                {wkDays > 0 && <span className="hidden rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10.5px] text-accent sm:inline">{wkDays} day{wkDays === 1 ? "" : "s"}</span>}
              </div>,
            ];
          })}
        </div>
      </Panel>

      {selDay && sel ? (
        <Panel padded={false} title={longDay(sel)}
          sub={`${selDay.trades} closing trade${selDay.trades === 1 ? "" : "s"} · ${winPct(selDay)} in profit`}
          actions={<span className={clsx("sensitive font-mono text-[15px] font-semibold tabular-nums", tone(selDay.pnl))}>{signedUsd(selDay.pnl)}</span>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead><tr className="border-b border-[var(--border)]"><th className={TH}>Closed</th><th className={`${TH} text-right`}>Qty</th><th className={`${TH} text-right`}>Price</th><th className={`${TH} text-right`}>Realized P&L</th><th className={TH}>Account</th></tr></thead>
              <tbody>
                {[...selDay.rows].sort((a, b) => (b.realized_gain ?? 0) - (a.realized_gain ?? 0)).map((a) => (
                  <tr key={a.id} className="border-b border-[var(--border)] last:border-0">
                    <td className={`${TD} whitespace-nowrap font-sans text-[13px] text-foreground`}>
                      <TickerLink symbol={a.symbol} className="font-medium" />
                      {a.strike != null && <span className="ml-1.5 text-foreground/60">{a.strike}{a.option_type === "call" ? "C" : a.option_type === "put" ? "P" : ""} {a.expiry ?? ""}</span>}
                      {a.side ? <span className="ml-1.5 text-[11px] text-foreground/45">{a.side}</span> : null}
                    </td>
                    <td className={`sensitive ${TD} text-right text-foreground/70`}>{a.quantity ?? "—"}</td>
                    <td className={`${TD} text-right text-foreground/70`}>{usd(a.price)}</td>
                    <td className={`sensitive ${TD} text-right ${tone(a.realized_gain)}`}>{signedUsd(a.realized_gain)}</td>
                    <td className={`${TD} font-sans text-[12px] text-foreground/55`}>{a.account}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <p className="px-1 text-[13px] text-foreground/50">Tap a day to see the trades that closed on it. Days are US Eastern; P&L is what Robinhood reports as realized on closing trades (stocks and options).</p>
      )}
    </div>
  );
}
