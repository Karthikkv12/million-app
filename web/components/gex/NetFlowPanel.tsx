"use client";

import React, { useMemo, useEffect, useState, useRef, useCallback } from "react";
import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  Cell,
  BarChart,
} from "recharts";
import { GexResult, TopFlowStrike, api } from "@/lib/api";

interface Props {
  data: GexResult;
  accentColor?: string;
}

interface Snapshot {
  ts: string;
  t?: string;
  price: number;
  call_prem: number;
  put_prem: number;
  net_flow: number;
  total_prem: number;
  volume: number;
}

type DayRange = 1 | 2 | 3 | 7 | 14 | 30;
const DAY_RANGES: DayRange[] = [1, 2, 3, 7, 14, 30];

// Bucket size in minutes per range:
// 1D/2D/3D → 60-min candles, 7D/14D/30D → 1-day (1440-min) candles
const BUCKET_MINUTES: Record<DayRange, number> = {
  1: 60, 2: 60, 3: 60,
  7: 1440, 14: 1440, 30: 1440,
};

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseIso(isoUtc: string): Date {
  let s = isoUtc.replace(" ", "T");
  s = s.replace(/[+-]00:?00$/, "Z");
  if (!s.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  return new Date(s);
}

/** Format a label from an ISO UTC string based on the selected range */
function fmtSnapTime(isoUtc: string, days: DayRange): string {
  try {
    const d = parseIso(isoUtc);
    if (isNaN(d.getTime())) return "--";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    // 1-3D → hourly: show "09:00"
    if (days <= 3) return `${hh}:${mm}`;
    // 7-30D → daily: show "Feb 19"
    return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
  } catch { return "--"; }
}

/** Generate explicit tick ISO strings at clean hour or day boundaries */
function generateTicks(data: { ts: string }[], days: DayRange): string[] {
  if (!data.length) return [];
  const bucketMs = days <= 3 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const start = parseIso(data[0].ts).getTime();
  const end   = parseIso(data[data.length - 1].ts).getTime();
  // Align start to the next clean boundary
  const firstBoundary = Math.ceil(start / bucketMs) * bucketMs;
  const ticks: string[] = [];
  for (let t = firstBoundary; t <= end + bucketMs / 2; t += bucketMs) {
    // Find the data point whose ts is closest to this boundary
    const iso = new Date(t).toISOString();
    ticks.push(iso);
  }
  return ticks;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtVol(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
}
function fmtAxis(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
}

const CALL_COLOR  = "#3fb37f"; // muted gain
const PUT_COLOR   = "#e55d5d"; // muted loss
const PRICE_COLOR = "#5b8def"; // accent blue, readable on light and dark
const NET_CALL    = "#3fb37f";
const NET_PUT     = "#e55d5d";
const VOL_CALL    = "#3fb37f66";
const VOL_PUT     = "#e55d5d66";

// ── Custom tick components (Recharts 3.x requires React elements, not style objects) ──
function PriceTick({ x, y, payload }: any) {
  return (
    <text x={x} y={y} dy={4} textAnchor="start" fill="#fde68a" fontSize={10} fontWeight={800}>
      {`$${Number(payload.value).toFixed(2)}`}
    </text>
  );
}
function AxisTick({ x, y, payload, color = "#8b93a1", size = 11 }: any) {
  return (
    <text x={x} y={y} dy={4} textAnchor="middle" fill={color} fontSize={size} fontWeight={600}>
      {payload.value}
    </text>
  );
}
function AxisTickRight({ x, y, payload, color = "#d1d5db", size = 9 }: any) {
  return (
    <text x={x} y={y} dy={4} textAnchor="start" fill={color} fontSize={size} fontWeight={600}>
      {payload.value}
    </text>
  );
}
function StrikeTick({ x, y, payload }: any) {
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="#f9fafb" fontSize={9} fontWeight={700}>
      {payload.value}
    </text>
  );
}

// ── Tooltip ────────────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] shadow-2xl space-y-0.5 min-w-[180px]">
      <p className="text-foreground/70 font-semibold mb-1.5">{label}</p>
      {payload.map((p: any) => {
        const val = p.value;
        let display: string;
        if (p.name === "Price")   display = `$${Number(val).toFixed(2)}`;
        else if (p.name === "Vol") display = fmtVol(val);
        else                       display = fmt(val);
        return (
          <div key={p.name} className="flex justify-between gap-4">
            <span style={{ color: p.stroke ?? p.fill }}>{p.name}</span>
            <span className="text-foreground tabular-nums font-semibold">{display}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── SVG gradient defs (used in both sub-charts) ───────────────────────────────
function FlowGradients() {
  return (
    <defs>
      <linearGradient id="gCall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={NET_CALL} stopOpacity={0.45} />
        <stop offset="95%" stopColor={NET_CALL} stopOpacity={0.04} />
      </linearGradient>
      <linearGradient id="gPut" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={NET_PUT} stopOpacity={0.04} />
        <stop offset="95%" stopColor={NET_PUT} stopOpacity={0.45} />
      </linearGradient>
      <linearGradient id="gPrice" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={PRICE_COLOR} stopOpacity={0.22} />
        <stop offset="95%" stopColor={PRICE_COLOR} stopOpacity={0.02} />
      </linearGradient>
      {/* glow filter for price line */}
      <filter id="priceGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

export default function NetFlowPanel({ data }: Props) {
  const {
    symbol,
    spot             = 0,
    call_premium     = 0,
    put_premium      = 0,
    net_flow         = 0,
    total_volume     = 0,
    flow_by_expiry   = [],
    top_flow_strikes = [],
  } = data;

  const total      = call_premium + put_premium;
  const callPct    = total > 0 ? (call_premium / total) * 100 : 50;
  const putPct     = 100 - callPct;
  const isCallBias = net_flow >= 0;

  const [days, setDays] = useState<DayRange>(1);
  const [hovered, setHovered] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHistory = useCallback(async (d: DayRange) => {
    try {
      const snaps = await api.get<Snapshot[]>(`/options/net-flow-history/${symbol}?days=${d}&bucket=${BUCKET_MINUTES[d]}`);
      if (snaps?.length) setHistory(snaps);
    } catch { /* ignore */ }
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    setHistory([]);
    fetchHistory(days);
    timerRef.current = setInterval(() => fetchHistory(days), 15_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [symbol, days, fetchHistory]);

  const chartData = useMemo(() => {
    if (history.length > 0) {
      return history.map(s => ({ ...s, t: s.ts })); // keep raw ISO as key; format in tick component
    }
    if (!spot) return [];
    return [{ ts: new Date().toISOString(), t: new Date().toISOString(), price: spot, call_prem: call_premium,
              put_prem: put_premium, net_flow, total_prem: total, volume: total_volume }];
  }, [history, days, spot, call_premium, put_premium, net_flow, total, total_volume]);

  // ── Explicit tick values at clean interval boundaries ────────────────────
  // For 1D/2D/3D: every full hour. For 7D/14D/30D: every midnight (1 day).
  const xTicks = useMemo(() => {
    if (!chartData.length) return [];
    const bucketMs = BUCKET_MINUTES[days] * 60 * 1000;
    const first = parseIso(chartData[0].ts).getTime();
    const last  = parseIso(chartData[chartData.length - 1].ts).getTime();
    const ticks: string[] = [];
    // Start at the next clean boundary at or after `first`
    let t = Math.ceil(first / bucketMs) * bucketMs;
    while (t <= last) {
      const iso = new Date(t).toISOString();
      // Only include if a data point exists at (or close to) this boundary
      const match = chartData.find(d => Math.abs(parseIso(d.ts).getTime() - t) < bucketMs / 2);
      if (match) ticks.push(match.ts);
      t += bucketMs;
    }
    // Always include first and last
    if (!ticks.includes(chartData[0].ts)) ticks.unshift(chartData[0].ts);
    if (!ticks.includes(chartData[chartData.length - 1].ts)) ticks.push(chartData[chartData.length - 1].ts);
    return ticks;
  }, [chartData, days]);

  // Format a raw ISO ts for the X-axis label
  const fmtTick = (iso: string) => fmtSnapTime(iso, days);

  // ── Price domain — tight around actual range ──────────────────────────────
  const [priceMin, priceMax] = useMemo(() => {
    if (!chartData.length) return [0, 1];
    const p = chartData.map(d => d.price).filter(v => v > 0);
    if (!p.length) return [0, 1];
    const mn = Math.min(...p), mx = Math.max(...p);
    const range = mx - mn;
    // Pad by 2% of actual range each side — maximises visible movement.
    // Tiny absolute fallback (0.05% of price) for single-snapshot flat case.
    const pad = range > 0 ? range * 0.02 : mx * 0.0005;
    return [parseFloat((mn - pad).toFixed(2)), parseFloat((mx + pad).toFixed(2))];
  }, [chartData]);

  // ── Premium domain — symmetric so call/put areas are visually comparable ─
  const premMax = useMemo(() => {
    if (!chartData.length) return 1;
    const mx = Math.max(...chartData.flatMap(d => [d.call_prem, d.put_prem]));
    return mx * 1.15;
  }, [chartData]);

  const volMax = useMemo(() => {
    if (!chartData.length) return 1;
    return Math.max(...chartData.map(d => d.volume)) * 4;
  }, [chartData]);

  const stats = hovered ?? {
    price: spot, volume: total_volume,
    total_prem: total, net_flow, call_prem: call_premium,
  };

  // ── Expiry bar data ───────────────────────────────────────────────────────
  const expiryData = useMemo(() =>
    [...flow_by_expiry]
      .sort((a, b) => a.expiry.localeCompare(b.expiry))
      .slice(0, 8)
      .map(r => ({ expiry: r.expiry, Calls: r.call_prem, Puts: r.put_prem })),
  [flow_by_expiry]);

  const strikeData = useMemo(() =>
    [...top_flow_strikes]
      .sort((a, b) => a.strike - b.strike)
      .map(s => ({ strike: s.strike.toLocaleString(), Net: s.net, bias: s.bias })),
  [top_flow_strikes]);

  const tableStrikes: TopFlowStrike[] = useMemo(() =>
    [...top_flow_strikes].sort((a, b) => b.call_prem + b.put_prem - (a.call_prem + a.put_prem)),
  [top_flow_strikes]);

  const hasEnoughData = chartData.length >= 5;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">

      {/* ══ HEADER BAND ══════════════════════════════════════════════════════ */}
      <div className="relative flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        {/* Ambient glow behind bias badge */}
        <div className="flex items-center gap-3 z-10">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
            style={{ background: isCallBias ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)", border: `1px solid ${isCallBias ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}` }}>
            <span className="text-base leading-none">{isCallBias ? "▲" : "▼"}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-foreground uppercase tracking-widest font-semibold">Net Flow</span>
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-[var(--border)] text-foreground/70 uppercase tracking-wide">{symbol}</span>
            </div>
            {spot > 0 && (
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-mono text-2xl font-medium tracking-tight text-foreground tabular-nums leading-none">${spot.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 z-10">
          <span className={`text-[11px] font-black px-3 py-1.5 rounded-full tracking-wider shadow-sm ${
            isCallBias
              ? "bg-gain/15 text-gain border border-gain/30 shadow-emerald-500/10"
              : "bg-loss/15 text-loss border border-loss/30 shadow-red-500/10"
          }`}>
            {isCallBias ? "▲ CALLS" : "▼ PUTS"}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3.5">

        {/* ══ KPI ROW ══════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-3 gap-2">
          {/* Call Premium */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/55 mb-1.5">Call prem</p>
            <p className="font-mono text-[17px] font-medium text-gain tabular-nums leading-none">{fmt(call_premium)}</p>
            <p className="text-[12px] text-foreground/55 mt-1">{callPct.toFixed(1)}% of total</p>
          </div>
          {/* Net Flow */}
          <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/55 mb-1.5">Net flow</p>
            <p className={`font-mono text-[17px] font-medium tabular-nums leading-none ${isCallBias ? "text-gain" : "text-loss"}`}>{fmt(net_flow)}</p>
            <p className="text-[12px] text-foreground/55 mt-1">{isCallBias ? "Calls dominate" : "Puts dominate"}</p>
          </div>
          {/* Put Premium */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/55 mb-1.5">Put prem</p>
            <p className="font-mono text-[17px] font-medium text-loss tabular-nums leading-none">{fmt(put_premium)}</p>
            <p className="text-[12px] text-foreground/55 mt-1">{putPct.toFixed(1)}% of total</p>
          </div>
        </div>

        {/* ══ CALL / PUT SPLIT BAR ═════════════════════════════════════════ */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
          <div className="flex justify-between text-[11px] font-bold uppercase tracking-widest mb-2">
            <span className="flex items-center gap-1.5 text-gain">
              <span className="w-2 h-2 rounded-full bg-gain inline-block" />
              Calls {callPct.toFixed(1)}%
            </span>
            <span className="text-foreground text-[11px] font-semibold tabular-nums">Total {fmt(call_premium + put_premium)}</span>
            <span className="flex items-center gap-1.5 text-loss">
              Puts {putPct.toFixed(1)}%
              <span className="w-2 h-2 rounded-full bg-loss inline-block" />
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden flex bg-[var(--border)] gap-px">
            <div className="bg-gain rounded-l-full transition-all duration-700" style={{ width: `${callPct}%` }} />
            <div className="bg-loss rounded-r-full transition-all duration-700" style={{ width: `${putPct}%` }} />
          </div>
        </div>

        {/* ══ CHART SECTION ════════════════════════════════════════════════ */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden">

          {/* Chart controls row */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-[var(--border)]/50">
            <div className="flex items-center gap-3 text-[11px]">
              {spot > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" />
                  <span className="text-accent font-mono font-medium tabular-nums">${(stats.price ?? spot).toFixed(2)}</span>
                </span>
              )}
              <span className="text-foreground/70">
                Prem <span className="text-foreground font-mono font-medium tabular-nums">{fmt(stats.total_prem ?? 0)}</span>
              </span>
              <span className={`font-black tabular-nums ${(stats.net_flow ?? 0) >= 0 ? "text-gain" : "text-loss"}`}>
                {(stats.net_flow ?? 0) >= 0 ? "▲" : "▼"} {fmt(Math.abs(stats.net_flow ?? 0))}
              </span>
            </div>
            <div className="flex items-center bg-[var(--surface)] rounded-lg p-0.5 gap-0.5 border border-[var(--border)]">
              {DAY_RANGES.map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-all ${
                    days === d
                      ? "bg-foreground text-background"
                      : "text-foreground/60 hover:text-foreground"
                  }`}>{d}D</button>
              ))}
            </div>
          </div>

          {!hasEnoughData ? (
            <div className="flex flex-col items-center justify-center h-[340px] gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--border)] flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/50">
                  <path d="M3 17l4-8 4 5 3-4 4 6"/><path d="M21 21H3" strokeWidth="1" opacity="0.4"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-[11px] font-bold text-foreground">Building history…</p>
                <p className="text-[11px] text-foreground/70 mt-1">
                  {chartData.length} of 5 snapshots · updates every 15s
                </p>
              </div>
              {/* Mini progress dots */}
              <div className="flex gap-1">
                {[0,1,2,3,4].map(i => (
                  <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i < chartData.length ? "bg-foreground/60" : "bg-[var(--border)]"}`} />
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* ── TOP PANEL: Price (gold line) — own dedicated chart ──── */}
              <div className="px-1 pt-2">
                <div className="flex items-center gap-2 px-2 pb-1">
                  <span className="w-4 h-[2px] rounded-full bg-accent inline-block" />
                  <span className="text-[11px] text-accent font-mono uppercase tracking-widest">{symbol} Price</span>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <ComposedChart data={chartData} margin={{ top: 6, right: 54, left: 0, bottom: 0 }}
                    onMouseMove={(e: any) => { const pt = e?.activePayload?.[0]?.payload as Snapshot | undefined; if (pt) setHovered(pt); }}
                    onMouseLeave={() => setHovered(null)}>
                    <FlowGradients />
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="t" hide />
                    <YAxis
                      yAxisId="price"
                      orientation="right"
                      domain={[priceMin, priceMax]}
                      tickFormatter={v => `$${Number(v).toFixed(2)}`}
                      tick={<PriceTick />}
                      axisLine={false} tickLine={false} width={58}
                      tickCount={5}
                    />
                    <Tooltip content={<ChartTooltip />}
                      cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1, strokeDasharray: "3 3" }} />
                    <Area yAxisId="price" type="monotone" dataKey="price" name="Price"
                      stroke={PRICE_COLOR} strokeWidth={2.5}
                      fill="url(#gPrice)"
                      dot={false} activeDot={{ r: 5, fill: PRICE_COLOR, stroke: "#000", strokeWidth: 1.5 }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Divider with label */}
              <div className="mx-3 flex items-center gap-2 opacity-60">
                <div className="flex-1 border-t border-dashed border-[var(--border)]" />
                <span className="text-[11px] text-foreground/60 font-semibold uppercase tracking-widest">Premium</span>
                <div className="flex-1 border-t border-dashed border-[var(--border)]" />
              </div>

              {/* ── BOTTOM PANEL: Call + Put premium + volume bars ──────── */}
              <div className="px-1 pb-2">
                <div className="flex items-center gap-4 px-2 py-1">
                  <span className="flex items-center gap-1.5 text-[11px] text-gain/80 uppercase tracking-wide font-bold">
                    <span className="w-3 h-[2px] bg-gain rounded-full inline-block" />Call
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-loss/80 uppercase tracking-wide font-bold">
                    <span className="w-3 h-[2px] bg-loss rounded-full inline-block" />Put
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-foreground/60 uppercase tracking-wide font-semibold">
                    <span className="w-2.5 h-2 bg-gray-600/50 rounded-sm inline-block" />Vol
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 54, left: 0, bottom: 16 }}
                    onMouseMove={(e: any) => { const pt = e?.activePayload?.[0]?.payload as Snapshot | undefined; if (pt) setHovered(pt); }}
                    onMouseLeave={() => setHovered(null)}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="t"
                      tick={<AxisTick />}
                      axisLine={false} tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      yAxisId="prem"
                      orientation="right"
                      domain={[0, premMax]}
                      tickFormatter={fmtAxis}
                      tick={<AxisTickRight />}
                      axisLine={false} tickLine={false} width={52}
                      tickCount={4}
                    />
                    <YAxis yAxisId="vol" orientation="left" domain={[0, volMax]} hide />
                    <Tooltip content={<ChartTooltip />}
                      cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1, strokeDasharray: "3 3" }} />
                    <Bar yAxisId="vol" dataKey="volume" name="Vol" maxBarSize={5} isAnimationActive={false}>
                      {chartData.map((d, i) => (
                        <Cell key={`vc-${i}`} fill={d.net_flow >= 0 ? VOL_CALL : VOL_PUT} />
                      ))}
                    </Bar>
                    <Area yAxisId="prem" type="monotone" dataKey="put_prem" name="Put Prem"
                      stroke={NET_PUT} strokeWidth={2}
                      fill="url(#gPut)"
                      dot={false} activeDot={{ r: 4, fill: NET_PUT, stroke: "#000", strokeWidth: 1 }} isAnimationActive={false}
                    />
                    <Area yAxisId="prem" type="monotone" dataKey="call_prem" name="Call Prem"
                      stroke={NET_CALL} strokeWidth={2}
                      fill="url(#gCall)"
                      dot={false} activeDot={{ r: 4, fill: NET_CALL, stroke: "#000", strokeWidth: 1 }} isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* ══ BOTTOM ROW: Expiry + Strike side by side ══════════════════════ */}
        {(expiryData.length > 0 || strikeData.length > 0) && (
          <div className="grid grid-cols-2 gap-3">

            {/* Flow by Expiry */}
            {expiryData.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center gap-1.5 mb-3">
                  <div className="w-1 h-3 rounded-full bg-gradient-to-b from-emerald-400 to-red-400" />
                  <p className="text-[11px] text-foreground uppercase tracking-widest font-bold">Flow by Expiry</p>
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={expiryData} barCategoryGap="28%" barGap={2} margin={{ top: 2, right: 2, left: 0, bottom: 2 }}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.07)" />
                    <XAxis dataKey="expiry" tick={<AxisTick color="#d1d5db" size={8} />} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtAxis} tick={<AxisTickRight color="#d1d5db" size={8} />} axisLine={false} tickLine={false} width={36} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                    <Bar dataKey="Calls" fill={CALL_COLOR} radius={[3, 3, 0, 0]} maxBarSize={14} />
                    <Bar dataKey="Puts"  fill={PUT_COLOR}  radius={[3, 3, 0, 0]} maxBarSize={14} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[var(--border)]">
                  <span className="flex items-center gap-1 text-[11px] text-gain uppercase tracking-wide font-semibold">
                    <span className="w-2 h-2 rounded-sm bg-gain inline-block" />Calls
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-loss uppercase tracking-wide font-semibold">
                    <span className="w-2 h-2 rounded-sm bg-loss inline-block" />Puts
                  </span>
                </div>
              </div>
            )}

            {/* Net Flow by Strike */}
            {strikeData.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center gap-1.5 mb-3">
                  <div className="w-1 h-3 rounded-full bg-gradient-to-b from-emerald-400 to-red-400" />
                  <p className="text-[11px] text-foreground uppercase tracking-widest font-bold">Net by Strike</p>
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={strikeData} layout="vertical" margin={{ top: 2, right: 2, left: 0, bottom: 2 }}>
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.07)" />
                    <XAxis type="number" tickFormatter={fmtAxis} tick={<AxisTick color="#d1d5db" size={8} />} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="strike" tick={<StrikeTick />} axisLine={false} tickLine={false} width={52} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                    <ReferenceLine x={0} stroke="rgba(128,128,128,0.25)" strokeDasharray="3 3" />
                    <Bar dataKey="Net" radius={[0, 3, 3, 0]} maxBarSize={12}>
                      {strikeData.map((e, i) => (
                        <Cell key={`sc-${i}`} fill={e.Net >= 0 ? CALL_COLOR : PUT_COLOR} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ══ TOP FLOW STRIKES TABLE ════════════════════════════════════════ */}
        {tableStrikes.length > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center gap-2">
              <div className="w-1 h-3 rounded-full bg-gradient-to-b from-emerald-400 to-red-400" />
              <p className="text-[11px] text-foreground uppercase tracking-widest font-bold">Top Flow Strikes</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left px-4 py-2 font-bold tracking-wide text-[11px] uppercase text-foreground">Strike</th>
                    <th className="text-right px-3 py-2 font-bold tracking-wide text-[11px] uppercase text-gain">Call $</th>
                    <th className="text-right px-3 py-2 font-bold tracking-wide text-[11px] uppercase text-loss">Put $</th>
                    <th className="text-right px-3 py-2 font-bold tracking-wide text-[11px] uppercase text-foreground">Net</th>
                    <th className="text-center px-3 py-2 font-bold tracking-wide text-[11px] uppercase text-foreground">Split</th>
                    <th className="text-center px-3 py-2 font-bold tracking-wide text-[11px] uppercase text-foreground">Bias</th>
                  </tr>
                </thead>
                <tbody>
                  {tableStrikes.map((s, i) => {
                    const total = s.call_prem + s.put_prem;
                    const cPct  = total > 0 ? (s.call_prem / total) * 100 : 50;
                    return (
                    <tr key={s.strike} className={`border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors ${i % 2 === 0 ? "" : "bg-foreground/[0.02]"}`}>
                      <td className="px-4 py-2 font-mono font-medium text-foreground tabular-nums">${s.strike.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-gain tabular-nums font-semibold">{fmt(s.call_prem)}</td>
                      <td className="px-3 py-2 text-right text-loss tabular-nums font-semibold">{fmt(s.put_prem)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-black ${s.net >= 0 ? "text-gain" : "text-loss"}`}>{fmt(s.net)}</td>
                      <td className="px-3 py-2">
                        <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-[var(--border)] min-w-[48px]">
                          <div className="bg-gradient-to-r from-emerald-600 to-emerald-400 h-full rounded-l-full" style={{ width: `${cPct}%` }} />
                          <div className="bg-gradient-to-l from-red-600 to-red-400 h-full rounded-r-full" style={{ width: `${100-cPct}%` }} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block text-[11px] font-black px-2 py-0.5 rounded-full tracking-wider ${
                          s.bias === "call"
                            ? "bg-gain/15 text-gain border border-gain/25"
                            : "bg-loss/15 text-loss border border-loss/25"
                        }`}>{s.bias === "call" ? "▲ CALL" : "▼ PUT"}</span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

