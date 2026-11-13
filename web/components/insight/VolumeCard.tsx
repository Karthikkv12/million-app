"use client";
/**
 * VolumeCard — is today's volume unusual for this stock?
 *  - Relative volume for the time of day: today's volume so far ÷ this stock's average volume by the same minute on
 *    the previous sessions (5-minute bars, last 5 days). A plain today ÷ daily average reads low all day until the
 *    close; this one is comparable at 10:15 and at 3:45.
 *  - Projected close: today so far ÷ the share of a normal day's volume usually done by now.
 *  - 30 sessions of daily volume against the 20-day average, coloured by the day's direction, plus the 5-day vs
 *    20-day trend and the share of volume on up days (buying vs selling pressure).
 * Built only from /stocks/{sym}/history (no new data).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { fetchStockHistory, QuoteBar, StockHistory } from "@/lib/api";

const ET = "America/New_York";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: ET });
const minuteOf = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(iso));
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24, m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  return h * 60 + m;
};
const OPEN = 9 * 60 + 30, CLOSE = 16 * 60;
const fmt = (v?: number | null) => {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  return a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0);
};

type Pace = { rvol: number; frac: number; today: number; projected: number; asOf: number; n: number } | null;

/** Time-of-day relative volume from 5-minute bars: today's cumulative volume vs prior sessions' at the same minute. */
function pace(bars: QuoteBar[]): Pace {
  const byDay = new Map<string, { m: number; v: number }[]>();
  for (const b of bars) {
    const m = minuteOf(b.date);
    if (m < OPEN || m >= CLOSE || !b.volume) continue;
    const d = dayOf(b.date);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push({ m, v: b.volume });
  }
  const days = [...byDay.keys()].sort();
  if (days.length < 2) return null;
  const today = days[days.length - 1];
  const tb = byDay.get(today)!;
  const asOf = Math.max(...tb.map((x) => x.m)) + 5;              // end of the last 5-minute bar
  const cum = tb.reduce((a, x) => a + x.v, 0);
  const prior = days.slice(0, -1).map((d) => byDay.get(d)!).filter((rows) => rows.length > 40);  // full-ish sessions
  if (!prior.length || !cum) return null;
  const byNow = prior.map((rows) => rows.filter((x) => x.m < asOf).reduce((a, x) => a + x.v, 0));
  const totals = prior.map((rows) => rows.reduce((a, x) => a + x.v, 0));
  const avgByNow = byNow.reduce((a, x) => a + x, 0) / byNow.length;
  const frac = byNow.reduce((a, x) => a + x, 0) / totals.reduce((a, x) => a + x, 0);
  if (!avgByNow || !frac) return null;
  return { rvol: cum / avgByNow, frac, today: cum, projected: cum / frac, asOf, n: prior.length };
}

const clock = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

export function VolumeCard({ symbol, optionsVolume }: { symbol: string; optionsVolume?: number | null }) {
  const daily = useQuery<StockHistory>({ queryKey: ["history", symbol, "3mo", "1d"], queryFn: () => fetchStockHistory(symbol, "3mo", "1d"), staleTime: 10 * 60_000 });
  const intra = useQuery<StockHistory>({ queryKey: ["history", symbol, "5d", "5m"], queryFn: () => fetchStockHistory(symbol, "5d", "5m"), refetchInterval: 60_000 });

  const p = useMemo(() => pace(intra.data?.bars ?? []), [intra.data]);
  const d = useMemo(() => {
    const bars = (daily.data?.bars ?? []).filter((b) => b.volume);
    if (bars.length < 21) return null;
    const last30 = bars.slice(-30);
    const prev = bars.slice(-21, -1);                                   // 20 full sessions before the latest
    const avg20 = prev.reduce((a, b) => a + (b.volume ?? 0), 0) / prev.length;
    const avg5 = bars.slice(-6, -1).reduce((a, b) => a + (b.volume ?? 0), 0) / 5;
    let up = 0, all = 0;
    prev.forEach((b, i) => {
      const before = i ? prev[i - 1].close : bars[bars.length - 22]?.close ?? b.open ?? b.close;
      all += b.volume ?? 0;
      if (b.close >= before) up += b.volume ?? 0;
    });
    return { last30, avg20, trend: avg5 / avg20 - 1, upShare: all ? up / all : null };
  }, [daily.data]);

  if (daily.isLoading && intra.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-foreground/[0.03]" />;
  if (!d && !p) return <p className="text-[13px] text-foreground/55">No volume history for {symbol}.</p>;

  const live = p && p.frac < 0.999;
  const rv = p?.rvol ?? null;
  const rvTone = rv == null ? "text-foreground" : rv >= 2 ? "text-warn" : rv >= 1.3 ? "text-accent" : rv <= 0.6 ? "text-foreground/55" : "text-foreground";
  const label = rv == null ? "" : rv >= 2 ? "Heavy" : rv >= 1.3 ? "Above normal" : rv <= 0.6 ? "Light" : "Normal";
  const max = d ? Math.max(...d.last30.map((b) => b.volume ?? 0), live ? p!.projected : 0, d.avg20) : 1;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/45">Relative volume</p>
          <p className={clsx("mt-0.5 font-mono text-[26px] font-semibold tabular-nums", rvTone)}>{rv != null ? `${rv.toFixed(2)}×` : "—"}</p>
          <p className="font-mono text-[11px] text-foreground/50">{p ? `${label} for ${live ? clock(Math.min(p.asOf, CLOSE)) : "the full day"} · vs last ${p.n} sessions` : "needs intraday bars"}</p>
        </div>
        <Stat label={live ? "Today so far" : "Last session"} value={fmt(p?.today)} sub={live ? `${Math.round((p!.frac) * 100)}% of a normal day done` : "full session"} />
        <Stat label={live ? "Projected close" : "20-day avg"} value={fmt(live ? p!.projected : d?.avg20)} sub={live && d ? `${((p!.projected / d.avg20) * 100).toFixed(0)}% of 20-day avg ${fmt(d.avg20)}` : "shares / day"} />
        <Stat label="5d vs 20d" value={d ? `${d.trend >= 0 ? "+" : ""}${(d.trend * 100).toFixed(0)}%` : "—"}
          sub={d?.upShare != null ? `${Math.round(d.upShare * 100)}% of 20d volume on up days` : undefined}
          cls={d ? (d.trend > 0.15 ? "text-accent" : d.trend < -0.15 ? "text-foreground/55" : "") : ""} />
      </div>

      {d && (
        <div>
          <div className="relative flex h-[84px] items-end gap-[2px]" role="img" aria-label={`${symbol} daily volume, last 30 sessions, against the 20-day average`}>
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/35" style={{ bottom: `${(d.avg20 / max) * 100}%` }}>
              <span className="absolute -top-4 right-0 font-mono text-[9.5px] text-foreground/45">20d avg</span>
            </div>
            {d.last30.map((b, i) => {
              const prevClose = i ? d.last30[i - 1].close : b.open ?? b.close;
              const isLast = i === d.last30.length - 1;
              const v = isLast && live ? p!.projected : b.volume ?? 0;
              return (
                <div key={b.date} className="relative flex h-full flex-1 items-end" title={`${dayOf(b.date)} · ${fmt(b.volume)}${isLast && live ? ` (so far; projected ${fmt(p!.projected)})` : ""}`}>
                  {isLast && live && <div className="absolute inset-x-0 bottom-0 border border-dashed border-foreground/40" style={{ height: `${(v / max) * 100}%` }} />}
                  <div className={clsx("w-full", b.close >= prevClose ? "bg-gain/60" : "bg-loss/60")} style={{ height: `${((b.volume ?? 0) / max) * 100}%` }} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-foreground/40">
            <span>{dayOf(d.last30[0].date).slice(5)}</span><span>30 sessions · green up day, red down day{live ? " · dashed: today projected" : ""}</span><span>today</span>
          </div>
        </div>
      )}

      {optionsVolume != null && optionsVolume > 0 && (
        <p className="font-mono text-[11.5px] text-foreground/55">Options: {fmt(optionsVolume)} contracts traded today in the nearest expiries.</p>
      )}
      <p className="text-[12px] leading-relaxed text-foreground/50">
        Relative volume compares today with this stock&apos;s own volume by the same time on the previous sessions, so it means the same at 10 AM as at 3 PM. Above 1.5× usually comes with news, a level break or big option activity.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, cls }: { label: string; value: React.ReactNode; sub?: React.ReactNode; cls?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/45">{label}</p>
      <p className={clsx("mt-0.5 font-mono text-[17px] tabular-nums text-foreground", cls)}>{value}</p>
      {sub && <p className="font-mono text-[10.5px] leading-snug text-foreground/50">{sub}</p>}
    </div>
  );
}
