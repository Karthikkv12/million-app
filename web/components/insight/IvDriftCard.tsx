"use client";
/**
 * IvDriftCard — ATM implied vol through the day against the price: is volatility expanding or compressing?
 * Two IV lines (nearest expiry ≥ 1 day out, and a constant 30-day) on the left axis, price on the right. Points
 * come from the flow snapshots, which are stored while a board or this page has the ticker open; rows before
 * 2026-11-14 have no IV.
 * The read: IV up with price down is the usual fear bid; IV up with price up means calls are being chased (a squeeze
 * or event); IV down while price holds is premium bleeding out (good for sellers).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchNetFlowHistory, FlowSnapshot } from "@/lib/api";
import { ChartTooltip, Legend, useChartStyle } from "@/components/chart/kit";
import { H, P, Formula, Terms, Theory } from "@/components/hedge/Theory";

const ET = "America/New_York";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: ET });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const pct = (v?: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const pts = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)} pts`;
const DAYS = [1, 3, 5] as const;

type Pt = { ts: string; near: number | null; d30: number | null; price: number | null };

/** One reading of the day: how IV and price moved together, in plain words. */
function read(dIv: number, dPx: number): string {
  const ivUp = dIv > 0.005, ivDown = dIv < -0.005, pxUp = dPx > 0.002, pxDown = dPx < -0.002;
  if (ivUp && pxDown) return "Vol is expanding as price falls: buyers are paying up for protection.";
  if (ivUp && pxUp) return "Vol is expanding with price up: calls are being chased, often ahead of news or in a squeeze.";
  if (ivUp) return "Vol is expanding while price holds: the market is pricing a move that hasn't come yet.";
  if (ivDown && pxUp) return "Vol is compressing on the way up: the usual calm rally, and premium is bleeding out.";
  if (ivDown && pxDown) return "Vol is compressing even as price slips: an orderly drift, not fear.";
  if (ivDown) return "Vol is compressing with price flat: premium is getting cheaper.";
  return "Vol is flat today.";
}

export function IvDriftCard({ symbol }: { symbol: string }) {
  const { c, grid, xAxis, yAxis, cursor } = useChartStyle();
  const [days, setDays] = useState<(typeof DAYS)[number]>(1);
  const q = useQuery<FlowSnapshot[]>({
    queryKey: ["flow", "history", symbol, days], queryFn: () => fetchNetFlowHistory(symbol, days), refetchInterval: 60_000,
  });

  const rows = useMemo<Pt[]>(() => {
    const all = (q.data ?? []).filter((r) => r.atm_iv_near != null || r.atm_iv_30d != null);
    // one point a minute keeps the chart light (snapshots land every ~10 s)
    const out: Pt[] = [];
    let last = "";
    for (const r of all) {
      const m = r.ts.slice(0, 16);
      const p = { ts: r.ts, near: r.atm_iv_near ?? null, d30: r.atm_iv_30d ?? null, price: r.price ?? null };
      if (m === last) out[out.length - 1] = p; else out.push(p);
      last = m;
    }
    return out;
  }, [q.data]);

  const today = rows.length ? rows.filter((r) => dayOf(r.ts) === dayOf(rows[rows.length - 1].ts)) : [];
  const first = today[0], now = today[today.length - 1];
  const key = now?.d30 != null && first?.d30 != null ? "d30" : "near";
  const dIv = now && first && now[key] != null && first[key] != null ? (now[key] as number) - (first[key] as number) : null;
  const dPx = now?.price && first?.price ? now.price / first.price - 1 : null;
  const ivs = rows.flatMap((r) => [r.near, r.d30]).filter((v): v is number => v != null);
  const lo = ivs.length ? Math.min(...ivs) : 0, hi = ivs.length ? Math.max(...ivs) : 1;
  const pad = (hi - lo) * 0.15 || 0.01;
  const multiDay = days > 1;

  if (q.isLoading) return <div className="h-56 animate-pulse rounded-lg bg-foreground/[0.03]" />;

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid grid-cols-2 gap-x-6 font-mono tabular-nums">
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">ATM IV 30-day</p>
            <p className="mt-1 text-[24px] font-semibold text-foreground">{pct(now?.d30)}</p>
          </div>
          <div>
            <p className="text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Nearest expiry</p>
            <p className="mt-1 text-[24px] font-semibold text-foreground/80">{pct(now?.near)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Theory title={`How to use ${symbol}'s volatility drift`}>
            <IvTheory symbol={symbol} first={first} now={now} dIv={dIv} dPx={dPx} />
          </Theory>
          {DAYS.map((d) => (
            <button key={d} onClick={() => setDays(d)} aria-pressed={days === d}
              className={clsx("h-7 px-2.5 font-mono text-[11.5px]", days === d ? "bg-[var(--surface-2)] text-foreground" : "text-foreground/50 hover:text-foreground")}>
              {d === 1 ? "Today" : `${d}D`}
            </button>
          ))}
        </div>
      </div>

      {!rows.length ? (
        <p className="py-6 text-[13px] text-foreground/55">
          No IV readings for {symbol} yet. They are saved while this page or the Flow board has the ticker open in market
          hours, so the line fills in from here.
        </p>
      ) : (
        <>
          {dIv != null && (
            <p className="mb-2 text-[13px] leading-snug text-foreground/75">
              <span className={clsx("font-mono tabular-nums", dIv > 0.005 ? "text-warn" : dIv < -0.005 ? "text-gain" : "text-foreground/60")}>{pts(dIv)}</span>
              {dPx != null && <span className="font-mono tabular-nums text-foreground/50"> · price {dPx >= 0 ? "+" : "−"}{Math.abs(dPx * 100).toFixed(2)}%</span>}
              <span className="text-foreground/45"> since {first ? clock(first.ts) : "the open"}. </span>
              {dPx != null && read(dIv, dPx)}
            </p>
          )}
          <Legend items={[
            { label: "30-day IV", color: c.accent },
            { label: "Nearest expiry IV", color: c.accent, dashed: true },
            { label: "Price", color: c.muted },
          ]} />
          <div className="mt-2 h-[220px] select-none [&_*:focus]:outline-none">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="ts" {...xAxis} minTickGap={48}
                  tickFormatter={(v: string) => multiDay ? new Date(v).toLocaleDateString("en-US", { timeZone: ET, weekday: "short" }) : clock(v)} />
                <YAxis yAxisId="iv" {...yAxis} width={44} domain={[lo - pad, hi + pad]} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                <YAxis yAxisId="px" orientation="right" {...yAxis} width={52} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(v >= 100 ? 0 : 2)} />
                <Tooltip cursor={cursor} content={
                  <ChartTooltip title={(l) => `${multiDay ? new Date(String(l)).toLocaleDateString("en-US", { timeZone: ET, month: "short", day: "numeric" }) + " " : ""}${clock(String(l))} ET`}
                    format={(items) => items.map((it) => ({
                      label: it.dataKey === "d30" ? "30-day IV" : it.dataKey === "near" ? "Nearest IV" : "Price",
                      value: it.dataKey === "price" ? Number(it.value).toFixed(2) : pct(Number(it.value)),
                      color: it.dataKey === "price" ? c.muted : c.accent,
                    }))} />
                } />
                <Line yAxisId="px" type="monotone" dataKey="price" stroke={c.muted} strokeOpacity={0.7} strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />
                <Line yAxisId="iv" type="monotone" dataKey="near" stroke={c.accent} strokeOpacity={0.6} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                <Line yAxisId="iv" type="monotone" dataKey="d30" stroke={c.accent} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-foreground/50">
        At-the-money implied vol from the live chain. 30-day blends the expiries either side of 30 days, so it doesn&apos;t
        jump when an expiry rolls off; the nearest expiry reacts faster and is noisier.
      </p>
    </div>
  );
}

/** Theory pop-up: what ATM IV is, how to turn it into a move, and what today's drift means, with today's numbers. */
function IvTheory({ symbol, first, now, dIv, dPx }: { symbol: string; first?: Pt; now?: Pt; dIv: number | null; dPx: number | null }) {
  const iv = now?.d30 ?? now?.near ?? null;
  const spot = now?.price ?? null;
  const day = iv != null && spot != null ? spot * iv / Math.sqrt(252) : null;
  const term = now?.near != null && now?.d30 != null ? now.near - now.d30 : null;
  return (
    <>
      {now ? (
        <P>
          Examples are {symbol}&apos;s readings today: from {first ? clock(first.ts) : "the first reading"} to {clock(now.ts)} ET.
          They refresh every minute while this page is open.
        </P>
      ) : <P>{symbol} has no IV readings yet today, so the examples below are empty. They fill in while this page is open in market hours.</P>}

      <H>What ATM IV is</H>
      <P>
        Implied volatility is the yearly move option prices assume. At the money (strike at spot) is the cleanest read
        of it. 30-day IV blends the expiries around 30 days, so it is steady; the nearest expiry reacts first.
      </P>
      <Terms rows={[
        ["30-day IV", now?.d30 != null ? <><b className="text-foreground">{pct(now.d30)}</b> now{first?.d30 != null ? `, ${pct(first.d30)} at ${clock(first.ts)}` : ""}.</> : "No reading yet."],
        ["Nearest expiry IV", now?.near != null ? <><b className="text-foreground">{pct(now.near)}</b> now{first?.near != null ? `, ${pct(first.near)} at ${clock(first.ts)}` : ""}.</> : "No reading yet."],
      ]} />

      <H>From IV to a price move</H>
      {iv != null && spot != null && day != null ? (
        <>
          <Formula>1-day move ≈ price × IV ÷ √252 = {spot.toFixed(2)} × {pct(iv)} ÷ 15.9 ≈ ${day.toFixed(2)}</Formula>
          <P>So options price a typical {symbol} day at about ±${day.toFixed(2)} (±{(day / spot * 100).toFixed(2)}%). Each 1 point of IV is worth about ±${(spot * 0.01 / Math.sqrt(252)).toFixed(2)} of daily move.</P>
        </>
      ) : <P>Needs a reading with both IV and price.</P>}

      <H>Reading the drift</H>
      <Terms rows={[
        ["IV ↑, price ↓", "Fear: protection is being bought. Normal for most stocks; selling puts gets richer."],
        ["IV ↑, price ↑", "Calls being chased: event, squeeze or news. Moves can extend."],
        ["IV ↓, price ↑", "Calm rally. Premium bleeds; long options lose value even when right on direction."],
        ["IV ↓, price flat/↓", "Orderly drift. Cheap time to buy options if you expect a move."],
      ]} />
      {dIv != null && dPx != null ? (
        <P>
          Today {symbol}&apos;s IV is <b className="text-foreground">{pts(dIv)}</b> with price {dPx >= 0 ? "+" : "−"}{Math.abs(dPx * 100).toFixed(2)}%:{" "}
          {read(dIv, dPx)}
        </P>
      ) : null}

      {term != null && (
        <>
          <H>Near vs 30-day</H>
          <P>
            Nearest expiry is {pct(now!.near)} vs {pct(now!.d30)} for 30-day ({term >= 0 ? "+" : "−"}{Math.abs(term * 100).toFixed(1)} pts).{" "}
            {term > 0.02 ? "Short-dated vol is higher than longer-dated: the market expects something soon (earnings, a release). It usually drops after the event."
              : term < -0.02 ? "Short-dated vol is below 30-day: the next few days are priced calm."
              : "About the same: no near-term event priced in."}
          </P>
        </>
      )}

      <H>How to use it</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Sell premium after IV has risen (you get paid more), buy options after it has fallen.</li>
        <li>Before earnings, the nearest expiry&apos;s IV climbs; it collapses the morning after. Long options bought into that lose even on a correct guess.</li>
        <li>Compare the expected 1-day move with the distance to the dealer walls to judge whether a wall is in reach today.</li>
      </ul>
      <P>Readings are saved only while this page or the Flow board has {symbol} open. Not advice.</P>
    </>
  );
}
