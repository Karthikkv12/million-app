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

function parseIso(isoUtc: string): Date {
  let s = isoUtc.replace(" ", "T");
  s = s.replace(/[+-]00:?00$/, "Z");
  if (!s.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  return new Date(s);
}

function fmtSnapTime(isoUtc: string, days: DayRange): string {
  try {
    const d = parseIso(isoUtc);
    if (isNaN(d.getTime())) return "--";
    const mo = d.getMonth() + 1;
    const dy = d.getDate();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (days === 1)  return `${hh}:${mm}`;
    if (days <= 3)   return `${mo}/${dy} ${hh}:${mm}`;
    return `${mo}/${dy}`;
  } catch { return "--"; }
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

const CALL_COLOR  = "#34d399";
const PUT_COLOR   = "#f87171";
const PRICE_COLOR = "#facc15";
const NET_CALL    = "#22c55e";
const NET_PUT     = "#ef4444";
const VOL_CALL    = "#22c55e99";
const VOL_PUT     = "#ef444499";

// ── Tooltip ────────────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] shadow-2xl space-y-0.5 min-w-[180px]">
      <p className="text-gray-400 font-semibold mb-1.5">{label}</p>
      {payload.map((p: any) => {
        const val = p.value;
        let display: string;
        if (p.name === "Price")   display = `$${Number(val).toFixed(2)}`;
        else if (p.name === "Vol") display = fmtVol(val);
        else                       display = fmt(val);
        return (
          <div key={p.name} className="flex justify-between gap-4">
            <span style={{ color: p.stroke ?? p.fill }}>{p.name}</span>
            <span className="text-gray-700 dark:text-gray-200 tabular-nums font-semibold">{display}</span>
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
      const snaps = await api.get<Snapshot[]>(`/options/net-flow-history/${symbol}?days=${d}`);
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
      return history.map(s => ({ ...s, t: fmtSnapTime(s.ts, days) }));
    }
    if (!spot) return [];
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    return [{ ts: new Date().toISOString(), t: now, price: spot, call_prem: call_premium,
              put_prem: put_premium, net_flow, total_prem: total, volume: total_volume }];
  }, [history, days, spot, call_premium, put_premium, net_flow, total, total_volume]);

  // ── Price domain — tight around actual range ──────────────────────────────
  const [priceMin, priceMax] = useMemo(() => {
    if (!chartData.length) return [0, 1];
    const p = chartData.map(d => d.price).filter(v => v > 0);
    if (!p.length) return [0, 1];
    const mn = Math.min(...p), mx = Math.max(...p);
    const range = mx - mn;
    // Pad by 50% of actual range each side — line fills middle ~50% of chart.
    // Tiny absolute fallback (0.03% of price) for single-snapshot flat case.
    const pad = range > 0 ? range * 0.5 : mx * 0.0003;
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
    <div className="rounded-2xl border border-white/10 bg-[#0d0f18] overflow-hidden shadow-2xl">

      {/* ══ HEADER BAND ══════════════════════════════════════════════════════ */}
      <div className="relative flex items-center justify-between px-5 py-4 border-b border-white/8 bg-gradient-to-r from-[#181b28] to-[#0d0f18]">
        {/* Ambient glow behind bias badge */}
        <div className={`absolute right-0 top-0 w-32 h-full opacity-10 pointer-events-none ${isCallBias ? "bg-emerald-500" : "bg-red-500"}`}
          style={{ maskImage: "linear-gradient(to left, black, transparent)" }} />
        <div className="flex items-center gap-3 z-10">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
            style={{ background: isCallBias ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)", border: `1px solid ${isCallBias ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}` }}>
            <span className="text-base leading-none">{isCallBias ? "▲" : "▼"}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-300 uppercase tracking-widest font-semibold">Net Flow</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-[var(--border)] text-gray-500 uppercase tracking-wide">{symbol}</span>
            </div>
            {spot > 0 && (
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-2xl font-black text-white tabular-nums leading-none drop-shadow-[0_0_12px_rgba(250,204,21,0.8)]" style={{textShadow:'0 0 20px rgba(250,204,21,0.6)'}}>${spot.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 z-10">
          <span className={`text-[11px] font-black px-3 py-1.5 rounded-full tracking-wider shadow-sm ${
            isCallBias
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-emerald-500/10"
              : "bg-red-500/15 text-red-400 border border-red-500/30 shadow-red-500/10"
          }`}>
            {isCallBias ? "▲ CALLS" : "▼ PUTS"}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3.5">

        {/* ══ KPI ROW ══════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-3 gap-2">
          {/* Call Premium */}
          <div className="relative rounded-xl overflow-hidden bg-emerald-500/10 border border-emerald-500/30 px-3 py-3">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/15 to-transparent pointer-events-none" />
            <p className="text-[9px] text-emerald-300 uppercase tracking-widest font-bold mb-1.5">Call Prem</p>
            <p className="text-[16px] font-black text-emerald-300 tabular-nums leading-none">{fmt(call_premium)}</p>
            <p className="text-[8px] text-emerald-400/70 mt-1 font-semibold">{callPct.toFixed(1)}% of total</p>
          </div>
          {/* Net Flow */}
          <div className={`relative rounded-xl overflow-hidden border px-3 py-3 ${
            isCallBias ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"
          }`}>
            <div className={`absolute inset-0 bg-gradient-to-br pointer-events-none ${isCallBias ? "from-emerald-500/15 to-transparent" : "from-red-500/15 to-transparent"}`} />
            <p className={`text-[9px] uppercase tracking-widest font-bold mb-1.5 ${isCallBias ? "text-emerald-300" : "text-red-300"}`}>Net Flow</p>
            <p className={`text-[16px] font-black tabular-nums leading-none ${isCallBias ? "text-emerald-300" : "text-red-300"}`}>{fmt(net_flow)}</p>
            <p className={`text-[8px] mt-1 font-semibold ${isCallBias ? "text-emerald-400/70" : "text-red-400/70"}`}>{isCallBias ? "call dominant" : "put dominant"}</p>
          </div>
          {/* Put Premium */}
          <div className="relative rounded-xl overflow-hidden bg-red-500/10 border border-red-500/30 px-3 py-3">
            <div className="absolute inset-0 bg-gradient-to-br from-red-500/15 to-transparent pointer-events-none" />
            <p className="text-[9px] text-red-300 uppercase tracking-widest font-bold mb-1.5">Put Prem</p>
            <p className="text-[16px] font-black text-red-300 tabular-nums leading-none">{fmt(put_premium)}</p>
            <p className="text-[8px] text-red-400/70 mt-1 font-semibold">{putPct.toFixed(1)}% of total</p>
          </div>
        </div>

        {/* ══ CALL / PUT SPLIT BAR ═════════════════════════════════════════ */}
        <div className="rounded-xl border border-white/10 bg-[#181b28] px-3 py-2.5">
          <div className="flex justify-between text-[9px] font-bold uppercase tracking-widest mb-2">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              Calls {callPct.toFixed(1)}%
            </span>
            <span className="text-gray-200 text-[8px] font-semibold tabular-nums">Total {fmt(call_premium + put_premium)}</span>
            <span className="flex items-center gap-1.5 text-red-400">
              Puts {putPct.toFixed(1)}%
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden flex bg-[var(--border)] gap-px">
            <div className="bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-l-full transition-all duration-700 shadow-sm" style={{ width: `${callPct}%` }} />
            <div className="bg-gradient-to-l from-red-600 to-red-400 rounded-r-full transition-all duration-700 shadow-sm" style={{ width: `${putPct}%` }} />
          </div>
        </div>

        {/* ══ CHART SECTION ════════════════════════════════════════════════ */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden">

          {/* Chart controls row */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-white/8">
            <div className="flex items-center gap-3 text-[10px]">
              {spot > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
                  <span className="text-yellow-400 font-black tabular-nums">${(stats.price ?? spot).toFixed(2)}</span>
                </span>
              )}
              <span className="text-gray-400">
                Prem <span className="text-white font-bold tabular-nums">{fmt(stats.total_prem ?? 0)}</span>
              </span>
              <span className={`font-black tabular-nums ${(stats.net_flow ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {(stats.net_flow ?? 0) >= 0 ? "▲" : "▼"} {fmt(Math.abs(stats.net_flow ?? 0))}
              </span>
            </div>
            <div className="flex items-center bg-[#181b28] rounded-lg p-0.5 gap-0.5 border border-white/10">
              {DAY_RANGES.map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`px-2 py-0.5 rounded-md text-[9px] font-bold transition-all ${
                    days === d
                      ? "bg-white/15 text-white shadow-sm"
                      : "text-gray-400 hover:text-white"
                  }`}>{d}D</button>
              ))}
            </div>
          </div>

          {!hasEnoughData ? (
            <div className="flex flex-col items-center justify-center h-[340px] gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[var(--border)] flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-500">
                  <path d="M3 17l4-8 4 5 3-4 4 6"/><path d="M21 21H3" strokeWidth="1" opacity="0.4"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-[11px] font-bold text-gray-400">Building history…</p>
                <p className="text-[9px] text-gray-500 mt-1">
                  {chartData.length} of 5 snapshots · updates every 15s
                </p>
              </div>
              {/* Mini progress dots */}
              <div className="flex gap-1">
                {[0,1,2,3,4].map(i => (
                  <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i < chartData.length ? "bg-purple-500" : "bg-[var(--border)]"}`} />
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* ── TOP PANEL: Price (gold line) — own dedicated chart ──── */}
              <div className="px-1 pt-2">
                <div className="flex items-center gap-2 px-2 pb-1">
                  <span className="w-4 h-[2px] rounded-full bg-yellow-400 inline-block shadow-[0_0_6px_rgba(250,204,21,0.6)]" />
                  <span className="text-[9px] text-yellow-400/80 font-bold uppercase tracking-widest">{symbol} Price</span>
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
                      tick={{ fill: "#fde68a", fontSize: 10, fontWeight: 800 }}
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
                <span className="text-[8px] text-gray-500 font-semibold uppercase tracking-widest">Premium</span>
                <div className="flex-1 border-t border-dashed border-[var(--border)]" />
              </div>

              {/* ── BOTTOM PANEL: Call + Put premium + volume bars ──────── */}
              <div className="px-1 pb-2">
                <div className="flex items-center gap-4 px-2 py-1">
                  <span className="flex items-center gap-1.5 text-[9px] text-emerald-400/80 uppercase tracking-wide font-bold">
                    <span className="w-3 h-[2px] bg-emerald-400 rounded-full inline-block" />Call
                  </span>
                  <span className="flex items-center gap-1.5 text-[9px] text-red-400/80 uppercase tracking-wide font-bold">
                    <span className="w-3 h-[2px] bg-red-400 rounded-full inline-block" />Put
                  </span>
                  <span className="flex items-center gap-1.5 text-[9px] text-gray-500 uppercase tracking-wide font-semibold">
                    <span className="w-2.5 h-2 bg-gray-600/50 rounded-sm inline-block" />Vol
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 54, left: 0, bottom: 0 }}
                    onMouseMove={(e: any) => { const pt = e?.activePayload?.[0]?.payload as Snapshot | undefined; if (pt) setHovered(pt); }}
                    onMouseLeave={() => setHovered(null)}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="t"
                      tick={{ fill: "#9ca3af", fontSize: 9, fontWeight: 600 }}
                      axisLine={false} tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      yAxisId="prem"
                      orientation="right"
                      domain={[0, premMax]}
                      tickFormatter={fmtAxis}
                      tick={{ fill: "#d1d5db", fontSize: 9, fontWeight: 600 }}
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
              <div className="rounded-xl border border-white/10 bg-[#0d0f18] p-3">
                <div className="flex items-center gap-1.5 mb-3">
                  <div className="w-1 h-3 rounded-full bg-gradient-to-b from-emerald-400 to-red-400" />
                  <p className="text-[9px] text-gray-200 uppercase tracking-widest font-bold">Flow by Expiry</p>
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={expiryData} barCategoryGap="28%" barGap={2} margin={{ top: 2, right: 2, left: 0, bottom: 2 }}>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.07)" />
                    <XAxis dataKey="expiry" tick={{ fill: "#d1d5db", fontSize: 8, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtAxis} tick={{ fill: "#d1d5db", fontSize: 8, fontWeight: 600 }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                    <Bar dataKey="Calls" fill={CALL_COLOR} radius={[3, 3, 0, 0]} maxBarSize={14} />
                    <Bar dataKey="Puts"  fill={PUT_COLOR}  radius={[3, 3, 0, 0]} maxBarSize={14} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/10">
                  <span className="flex items-center gap-1 text-[8px] text-emerald-300 uppercase tracking-wide font-semibold">
                    <span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" />Calls
                  </span>
                  <span className="flex items-center gap-1 text-[8px] text-red-300 uppercase tracking-wide font-semibold">
                    <span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />Puts
                  </span>
                </div>
              </div>
            )}

            {/* Net Flow by Strike */}
            {strikeData.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-[#0d0f18] p-3">
                <div className="flex items-center gap-1.5 mb-3">
                  <div className="w-1 h-3 rounded-full bg-gradient-to-b from-emerald-400 to-red-400" />
                  <p className="text-[9px] text-gray-200 uppercase tracking-widest font-bold">Net by Strike</p>
                </div>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={strikeData} layout="vertical" margin={{ top: 2, right: 2, left: 0, bottom: 2 }}>
                    <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.07)" />
                    <XAxis type="number" tickFormatter={fmtAxis} tick={{ fill: "#d1d5db", fontSize: 8, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="strike" tick={{ fill: "#f9fafb", fontSize: 9, fontWeight: 700 }} axisLine={false} tickLine={false} width={52} />
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
          <div className="rounded-xl border border-white/10 bg-[#0d0f18] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-2">
              <div className="w-1 h-3 rounded-full bg-gradient-to-b from-purple-400 to-blue-400" />
              <p className="text-[9px] text-gray-200 uppercase tracking-widest font-bold">Top Flow Strikes</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left px-4 py-2 font-bold tracking-wide text-[9px] uppercase text-gray-300">Strike</th>
                    <th className="text-right px-3 py-2 font-bold tracking-wide text-[9px] uppercase text-emerald-300">Call $</th>
                    <th className="text-right px-3 py-2 font-bold tracking-wide text-[9px] uppercase text-red-300">Put $</th>
                    <th className="text-right px-3 py-2 font-bold tracking-wide text-[9px] uppercase text-gray-300">Net</th>
                    <th className="text-center px-3 py-2 font-bold tracking-wide text-[9px] uppercase text-gray-300">Split</th>
                    <th className="text-center px-3 py-2 font-bold tracking-wide text-[9px] uppercase text-gray-300">Bias</th>
                  </tr>
                </thead>
                <tbody>
                  {tableStrikes.map((s, i) => {
                    const total = s.call_prem + s.put_prem;
                    const cPct  = total > 0 ? (s.call_prem / total) * 100 : 50;
                    return (
                    <tr key={s.strike} className={`border-b border-white/5 hover:bg-white/5 transition-colors ${i % 2 === 0 ? "" : "bg-white/[0.03]"}`}>
                      <td className="px-4 py-2 font-black text-white tabular-nums">${s.strike.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-emerald-300 tabular-nums font-semibold">{fmt(s.call_prem)}</td>
                      <td className="px-3 py-2 text-right text-red-300 tabular-nums font-semibold">{fmt(s.put_prem)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-black ${s.net >= 0 ? "text-emerald-300" : "text-red-300"}`}>{fmt(s.net)}</td>
                      <td className="px-3 py-2">
                        <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-[var(--border)] min-w-[48px]">
                          <div className="bg-gradient-to-r from-emerald-600 to-emerald-400 h-full rounded-l-full" style={{ width: `${cPct}%` }} />
                          <div className="bg-gradient-to-l from-red-600 to-red-400 h-full rounded-r-full" style={{ width: `${100-cPct}%` }} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-block text-[8px] font-black px-2 py-0.5 rounded-full tracking-wider ${
                          s.bias === "call"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                            : "bg-red-500/15 text-red-400 border border-red-500/25"
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

