"use client";
/**
 * FlowMomentumChart — premium flow through the day, interactive.
 *  - Mode: "Traded" (premium traded in calls / puts: Δvolume × mid per contract at each refresh, counted from the
 *    09:30 ET open by the server and reset each ET day; longer views add the days up) or "Totals" (money sitting in
 *    open contracts, OI × mid). Snapshots from before 2026-11-13 have no traded figures: a window with none falls
 *    back to Totals and says "not measured yet".
 *  - Series chips toggle calls / puts / net / price (price on its own right axis).
 *  - A readout bar follows the cursor; click the chart to pin a moment and the readout shows
 *    the change from the pin to the cursor. Drag the brush under the chart to zoom.
 *  - variant "page" (the full-size Flow → Premium page): a taller chart, calls and puts as two lines
 *    (the drawer's thin bars blend together at that width) and a one-sentence read above it.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  Area, Bar, Brush, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Clock, Pin, X } from "lucide-react";
import { fetchNetFlowHistory, FlowSnapshot } from "@/lib/api";
import { useChartStyle } from "@/components/chart/kit";

interface Props {
  symbol: string; accentColor?: string; variant?: "drawer" | "page";
  /** Price levels drawn dashed on the price axis (e.g. Anchor and Flip), shown while Price is on. */
  levels?: { label: string; price: number | null | undefined; color: string }[];
}

const DAYS = [1, 3, 7, 14] as const;
type Day = (typeof DAYS)[number];
type Mode = "since" | "total";
type Key = "call" | "put" | "net" | "price";

const m = (v: number | null | undefined, d = 1) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : v > 0 ? "+" : "";
  return a >= 1000 ? `${s}$${(a / 1000).toFixed(2)}B` : `${s}$${a.toFixed(d)}M`;
};
const utc = (ts: string) => new Date(/Z|[+-]\d\d:\d\d$/.test(ts) ? ts : ts + "Z");
const etParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** US-Eastern day and minutes after midnight of a snapshot. */
const et = (ts: string) => {
  const p = Object.fromEntries(etParts.formatToParts(utc(ts)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
};
const OPEN = 9 * 60 + 30;
/** Index of the first snapshot at or after the latest session's 09:30 ET open; 0 when the open hasn't happened yet. */
export function openIndex(snaps: { ts: string }[]): number {
  if (!snaps.length) return 0;
  const day = et(snaps[snaps.length - 1].ts).day;
  const i = snaps.findIndex((s) => { const t = et(s.ts); return t.day === day && t.min >= OPEN; });
  return Math.max(i, 0);
}
const when = (ts: string, days: number) => {
  const d = utc(ts);
  return days === 1 ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export function FlowMomentumChart({ symbol, variant = "drawer", levels = [] }: Props) {
  const page = variant === "page";
  const [days, setDays] = useState<Day>(1);
  const [picked, setPicked] = useState(false);          // the user chose a range: don't auto-widen
  const [mode, setMode] = useState<Mode>("since");
  const [on, setOn] = useState<Record<Key, boolean>>({ call: true, put: true, net: true, price: true });
  const [hover, setHover] = useState<number | null>(null);
  const [pin, setPin] = useState<number | null>(null);
  const { c, grid, xAxis, yAxis } = useChartStyle();

  const { data: all = [], isLoading } = useQuery<FlowSnapshot[]>({
    queryKey: ["netFlowHistory", symbol, days],
    queryFn: () => fetchNetFlowHistory(symbol, days),
    // a snapshot is written on each GEX refresh (30 s on real-time chains): poll at 10 s to show it promptly
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  // No snapshots in the window (weekend, before the open)? Widen to the last session automatically.
  useEffect(() => {
    if (picked || isLoading || all.length >= 2) return;
    const next = DAYS.find((d) => d > days);
    if (next) setDays(next);
  }, [picked, isLoading, all.length, days]);
  // 1-day "since" view: count from the open, not from the overnight snapshots (they repeat the previous close).
  const measured = all.some((s) => s.call_traded != null || s.put_traded != null);
  const eff: Mode = measured ? mode : "total";
  const fromOpen = eff === "since" && days === 1;
  const snaps = useMemo(() => {
    if (!fromOpen) return all;
    const cut = all.slice(openIndex(all));
    return cut.length >= 2 ? cut : all;
  }, [all, fromOpen]);
  const widened = !picked && days > 1 && snaps.length >= 2;

  const rows = useMemo(() => {
    if (!snaps.length) return [];
    // "Traded": the server's figures are already cumulative since that ET day's open, so they're plotted as is.
    // Across days, earlier days' closing totals are carried in; a null (outside the session) holds the last value.
    let day = "", doneC = 0, doneP = 0, tc = 0, tp = 0;
    return snaps.map((s, i) => {
      const call = s.call_prem / 1e6, put = s.put_prem / 1e6, net = s.net_flow / 1e6;
      const d = et(s.ts).day;
      if (d !== day) { doneC += tc; doneP += tp; tc = 0; tp = 0; day = d; }
      if (s.call_traded != null) tc = s.call_traded / 1e6;
      if (s.put_traded != null) tp = s.put_traded / 1e6;
      const dc = doneC + tc, dp = doneP + tp;
      return {
        i, ts: s.ts, price: s.price,
        call: eff === "since" ? dc : call,
        putVal: eff === "since" ? dp : put,          // real value (readout)
        put: eff === "since" ? dp : -put,           // plotted: totals mirror puts below zero
        net: eff === "since" ? dc - dp : net,
        raw: { call, put, net, volume: s.volume },
      };
    });
  }, [snaps, eff]);

  const last = rows.length - 1;
  const cur = rows[hover ?? last];
  const base = pin != null ? rows[pin] : null;
  const chip = (k: Key, label: string, color: string) => (
    <button key={k} onClick={() => setOn((o) => ({ ...o, [k]: !o[k] }))} aria-pressed={on[k]}
      className={clsx("inline-flex items-center gap-1.5 rounded-[3px] px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] ring-1 ring-inset transition",
        on[k] ? "text-foreground ring-[var(--border-strong)]" : "text-foreground/35 ring-transparent line-through")}>
      <span className="h-2 w-2 rounded-full" style={{ background: color, opacity: on[k] ? 1 : 0.35 }} />{label}
    </button>
  );
  const seg = <T extends string | number>(v: T, cur: T, set: (x: T) => void, label: string) => (
    <button key={String(v)} onClick={() => set(v)} className={clsx("px-1.5 py-0.5 font-mono text-[11px]", cur === v ? "text-foreground underline decoration-2 underline-offset-[5px]" : "text-foreground/45 hover:text-foreground")}>{label}</button>
  );

  return (
    <div className={page ? "" : "border-b border-[var(--border)] px-5 py-5"}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-foreground">{page ? "" : "Through the day"}</h3>
        <div className="flex items-center gap-4">
          <div className="flex">{seg<Mode>("since", mode, (x) => { setMode(x); setPin(null); setHover(null); }, days === 1 ? "Traded today" : "Traded")}{seg<Mode>("total", mode, (x) => { setMode(x); setPin(null); setHover(null); }, "Totals")}</div>
          <div className="flex">{DAYS.map((d) => seg<Day>(d, days, (x) => { setPicked(true); setDays(x); setPin(null); setHover(null); }, `${d}D`))}</div>
        </div>
      </div>

      {!measured && mode === "since" && !isLoading && all.length > 0 && (
        <p className="mb-2 font-mono text-[11px] text-foreground/55">Premium traded is not measured yet in this window (it starts 2026-11-13); showing totals.</p>
      )}
      {widened && (
        <p className="mb-2 font-mono text-[11px] text-warn">No flow yet today (market closed); showing the last {days} days.</p>
      )}
      {isLoading || (!picked && snaps.length < 2 && days < 14) ? (
        <div className="skeleton h-48" />
      ) : rows.length < 2 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-foreground/50">
          <Clock size={20} className="opacity-40" />
          <p className="text-[13px]">No flow history for this ticker in the last {days} days. It builds up while the market is open.</p>
        </div>
      ) : (
        <>
          {page && eff === "since" && (() => {
            const e = rows[last], lead = Math.abs(e.net) < 0.02 * Math.max(Math.abs(e.call), Math.abs(e.putVal), 1) ? null : e.net > 0;
            const amt = (v: number) => m(Math.abs(v)).replace("+", "");
            return (
              <p className="mb-3 max-w-3xl text-[15px] leading-relaxed text-foreground/80">
                {days === 1 ? "Since the 9:30 ET open" : `Over the last ${days} days`}, <b className="font-medium text-foreground">{amt(e.call)}</b> of premium traded
                in <span className="text-gain">calls</span> and <b className="font-medium text-foreground">{amt(e.putVal)}</b> in <span className="text-loss">puts</span>.{" "}
                {lead == null ? "The two moved about the same, so there is no clear tilt."
                  : <>The gap between them (<span className="text-accent">net</span>) is <b className="font-medium text-foreground">{m(e.net)}</b>: the tilt is toward <b className="font-medium text-foreground">{lead ? "calls (bullish)" : "puts (bearish)"}</b>.</>}
              </p>
            );
          })()}
          {/* Readout: follows the cursor; relative to the pin when one is set */}
          <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 border-y border-[var(--border)] py-2 font-mono text-[12px] tabular-nums sm:grid-cols-[auto_repeat(4,minmax(0,1fr))]">
            <div className="col-span-2 flex items-center gap-2 text-foreground/60 sm:col-span-1">
              {base ? <><Pin size={12} className="text-accent" />{when(base.ts, days)} → {when(cur.ts, days)}</> : <>{when(cur.ts, days)}{hover == null && <span className="text-foreground/35">latest</span>}</>}
            </div>
            {(() => {
              const d = (a: number, b?: number) => (base ? a - (b ?? 0) : a);
              const px = base ? (cur.price / base.price - 1) * 100 : null;
              return [
                ["Calls", m(d(cur.call, base?.call)), "text-gain"],
                ["Puts", m(d(cur.putVal, base?.putVal)), "text-loss"],
                ["Net", m(d(cur.net, base?.net)), d(cur.net, base?.net) >= 0 ? "text-gain" : "text-loss"],
                ["Price", base ? `${cur.price.toFixed(2)} (${px! >= 0 ? "+" : ""}${px!.toFixed(2)}%)` : cur.price.toFixed(2), "text-foreground"],
              ].map(([l, v, t]) => (
                <div key={l} className="min-w-0"><span className="mr-1.5 text-[10px] uppercase tracking-[0.12em] text-foreground/40">{l}</span><span className={t}>{v}</span></div>
              ));
            })()}
          </div>

          <div className={clsx(page ? "h-[320px] sm:h-[460px]" : "h-[230px]", "select-none [&_*:focus]:outline-none [&_.recharts-wrapper]:outline-none")}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 6, right: 0, left: 0, bottom: 0 }}
                barGap={0}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onMouseMove={(e: any) => { if (e?.activeTooltipIndex != null) setHover(Number(e.activeTooltipIndex)); }}
                onMouseLeave={() => setHover(null)}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onClick={(e: any) => { if (e?.activeTooltipIndex != null) { const i = Number(e.activeTooltipIndex); setPin((p) => (p === i ? null : i)); } }}
              >
                <defs>
                  <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={c.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...grid} />
                <XAxis dataKey="ts" {...xAxis} minTickGap={48} tickFormatter={(v: string) => when(v, days)} />
                <YAxis yAxisId="m" {...yAxis} width={56} tickFormatter={(v: number) => m(v, 0)} />
                <YAxis yAxisId="px" orientation="right" {...yAxis} width={48} domain={["auto", "auto"]} hide={!on.price} tickFormatter={(v: number) => v.toFixed(0)} />
                <Tooltip cursor={{ stroke: c.muted, strokeDasharray: "3 3" }} content={() => null} />
                <ReferenceLine yAxisId="m" y={0} stroke={c.border} />
                {pin != null && <ReferenceLine yAxisId="m" x={rows[pin].ts} stroke={c.accent} strokeDasharray="4 3" label={{ value: "pin", position: "insideTopLeft", fill: c.accent, fontSize: 10 }} />}
                {on.call && (page
                  ? <Line yAxisId="m" type="monotone" dataKey="call" stroke={c.gain} strokeWidth={1.75} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                  : <Bar yAxisId="m" dataKey="call" fill={c.gainSoft} maxBarSize={5} isAnimationActive={false} />)}
                {on.put && (page
                  ? <Line yAxisId="m" type="monotone" dataKey="put" stroke={c.loss} strokeWidth={1.75} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                  : <Bar yAxisId="m" dataKey="put" fill={c.lossSoft} maxBarSize={5} isAnimationActive={false} />)}
                {on.net && <Area yAxisId="m" type="monotone" dataKey="net" stroke={c.accent} strokeWidth={2.25} fill="url(#netFill)" dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false} />}
                {on.price && levels.filter((l) => l.price != null).map((l) => (
                  <ReferenceLine key={l.label} yAxisId="px" y={l.price!} stroke={l.color} strokeDasharray="5 4" strokeWidth={1.25} ifOverflow="extendDomain"
                    label={{ value: `${l.label} ${l.price!.toFixed(2)}`, position: "insideBottomRight", fill: l.color, fontSize: 10.5 }} />
                ))}
                {on.price && <Line yAxisId="px" type="monotone" dataKey="price" stroke={c.ink} strokeOpacity={0.55} strokeWidth={1.25} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />}
                {rows.length > 20 && (
                  <Brush dataKey="ts" height={20} travellerWidth={8} stroke={c.border} fill="transparent" tickFormatter={(v: string) => when(v, days)} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {chip("call", "Calls", c.gain)}{chip("put", "Puts", c.loss)}{chip("net", "Net", c.accent)}{chip("price", "Price", c.ink)}
            {pin != null
              ? <button onClick={() => setPin(null)} className="ml-auto inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent"><X size={12} /> clear pin</button>
              : <span className="ml-auto text-[11.5px] text-foreground/40">Click to pin a moment · drag the bar below to zoom</span>}
          </div>
        </>
      )}
    </div>
  );
}
