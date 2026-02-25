"use client";

import React, { useMemo, useEffect, useState, useRef, useCallback } from "react";
import {
  ComposedChart,
  Area,
  Line,
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
  ts: string;   // raw ISO-8601 UTC from backend
  t?: string;   // formatted label (computed on frontend)
  price: number;
  call_prem: number;
  put_prem: number;
  net_flow: number;
  total_prem: number;
  volume: number;
}

type DayRange = 1 | 2 | 3 | 7 | 14 | 30;
const DAY_RANGES: DayRange[] = [1, 2, 3, 7, 14, 30];

// Parse an ISO-8601 UTC string robustly across all browsers.
// Handles: "2026-02-24T14:30:00Z", "2026-02-24T14:30:00+00:00",
//          "2026-02-24 14:30:00+00:00" (pandas space format), bare no-tz strings.
function parseIso(isoUtc: string): Date {
  // Normalise: space → T, +00:00 or +0000 → Z
  let s = isoUtc.replace(" ", "T");
  s = s.replace(/[+-]00:?00$/, "Z");
  // If still no tz indicator, treat as UTC
  if (!s.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  return new Date(s);
}

// Format a raw ISO-8601 UTC string into a human label in the browser's local timezone
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
  } catch {
    return "--";
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────
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

// ── SVG gradient defs ─────────────────────────────────────────────────────────
function FlowGradients() {
  return (
    <defs>
      <linearGradient id="gCall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={NET_CALL} stopOpacity={0.5} />
        <stop offset="95%" stopColor={NET_CALL} stopOpacity={0.04} />
      </linearGradient>
      <linearGradient id="gPut" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={NET_PUT} stopOpacity={0.04} />
        <stop offset="95%" stopColor={NET_PUT} stopOpacity={0.5} />
      </linearGradient>
    </defs>
  );
}

export default function NetFlowPanel({ data }: Props) {
  const {
    symbol,
    spot        = 0,
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

  // ── Day-range selector ────────────────────────────────────────────────────
  const [days, setDays] = useState<DayRange>(1);

  // ── Hover crosshair state for stats bar ──────────────────────────────────
  const [hovered, setHovered] = useState<Snapshot | null>(null);

  // ── History fetch ─────────────────────────────────────────────────────────
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

  // Seed with current snapshot while history loads
  const chartData = useMemo(() => {
    if (history.length > 0) {
      return history.map(s => ({ ...s, t: fmtSnapTime(s.ts, days) }));
    }
    if (!spot) return [];
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    return [{ ts: new Date().toISOString(), t: now, price: spot, call_prem: call_premium,
              put_prem: put_premium, net_flow, total_prem: total, volume: total_volume }];
  }, [history, days, spot, call_premium, put_premium, net_flow, total, total_volume]);

  // Domains
  const [priceMin, priceMax] = useMemo(() => {
    if (!chartData.length) return [0, 1];
    const p = chartData.map(d => d.price);
    const mn = Math.min(...p), mx = Math.max(...p);
    const pad = (mx - mn) * 0.15 || mx * 0.005;
    return [mn - pad, mx + pad];
  }, [chartData]);

  const premMax = useMemo(() => {
    if (!chartData.length) return 1;
    return Math.max(...chartData.flatMap(d => [d.call_prem, d.put_prem])) * 1.25;
  }, [chartData]);

  const volMax = useMemo(() => {
    if (!chartData.length) return 1;
    return Math.max(...chartData.map(d => d.volume)) * 4; // push vol bars to bottom quarter
  }, [chartData]);

  // Stats to show in the header — live or hovered
  const stats = hovered ?? {
    price:      spot,
    volume:     total_volume,
    total_prem: total,
    net_flow,
    call_prem:  call_premium,
  };

  // ── Expiry bar data ───────────────────────────────────────────────────────
  const expiryData = useMemo(() =>
    [...flow_by_expiry]
      .sort((a, b) => a.expiry.localeCompare(b.expiry))
      .slice(0, 8)
      .map(r => ({ expiry: r.expiry, Calls: r.call_prem, Puts: r.put_prem })),
  [flow_by_expiry]);

  // ── Strike diverging bar data ─────────────────────────────────────────────
  const strikeData = useMemo(() =>
    [...top_flow_strikes]
      .sort((a, b) => a.strike - b.strike)
      .map(s => ({ strike: s.strike.toLocaleString(), Net: s.net, bias: s.bias })),
  [top_flow_strikes]);

  // ── Table ─────────────────────────────────────────────────────────────────
  const tableStrikes: TopFlowStrike[] = useMemo(() =>
    [...top_flow_strikes].sort((a, b) => b.call_prem + b.put_prem - (a.call_prem + a.put_prem)),
  [top_flow_strikes]);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">

      {/* ══ HEADER BAND ══════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-[11px] text-gray-400 uppercase tracking-widest font-medium leading-none mb-0.5">Net Flow</span>
            <span className="text-lg font-bold text-gray-900 dark:text-white tracking-tight leading-none">{symbol}</span>
          </div>
          {spot > 0 && (
            <span className="text-[13px] font-semibold text-yellow-500 dark:text-yellow-400 tabular-nums ml-1">
              ${spot.toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide ${
            isCallBias
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
              : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
          }`}>
            {isCallBias ? "▲ CALLS" : "▼ PUTS"}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">

        {/* ══ KPI ROW ══════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-3 gap-2">
          {/* Call Premium */}
          <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 px-3 py-2.5">
            <p className="text-[9px] text-emerald-600 dark:text-emerald-400 opacity-70 uppercase tracking-widest font-semibold mb-1">Call Prem</p>
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums leading-none">{fmt(call_premium)}</p>
          </div>
          {/* Net Flow */}
          <div className={`rounded-xl border px-3 py-2.5 ${
            isCallBias
              ? "bg-emerald-500/[0.08] border-emerald-500/20"
              : "bg-red-500/[0.08] border-red-500/20"
          }`}>
            <p className={`text-[9px] uppercase tracking-widest font-semibold mb-1 opacity-70 ${isCallBias ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>Net Flow</p>
            <p className={`text-sm font-bold tabular-nums leading-none ${isCallBias ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{fmt(net_flow)}</p>
          </div>
          {/* Put Premium */}
          <div className="rounded-xl bg-red-500/[0.08] border border-red-500/20 px-3 py-2.5">
            <p className="text-[9px] text-red-600 dark:text-red-400 opacity-70 uppercase tracking-widest font-semibold mb-1">Put Prem</p>
            <p className="text-sm font-bold text-red-600 dark:text-red-400 tabular-nums leading-none">{fmt(put_premium)}</p>
          </div>
        </div>

        {/* ══ CALL / PUT SPLIT BAR ═════════════════════════════════════════ */}
        <div>
          <div className="flex justify-between text-[9px] font-semibold uppercase tracking-widest mb-1.5">
            <span className="text-emerald-600 dark:text-emerald-400 opacity-80">Calls {callPct.toFixed(1)}%</span>
            <span className="text-red-600 dark:text-red-400 opacity-80">Puts {putPct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden flex bg-[var(--surface-2)]">
            <div className="bg-emerald-500 rounded-l-full transition-all duration-700" style={{ width: `${callPct}%` }} />
            <div className="bg-red-500 rounded-r-full transition-all duration-700" style={{ width: `${putPct}%` }} />
          </div>
        </div>

        {/* ══ CHART SECTION ════════════════════════════════════════════════ */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden">

          {/* Chart controls row */}
          <div className="flex items-center justify-between px-3 pt-3 pb-2">

            {/* Live stats */}
            <div className="flex items-center gap-3 text-[10px]">
              {spot > 0 && (
                <span className="text-gray-500">
                  <span className="text-yellow-500 dark:text-yellow-400 font-bold tabular-nums">${(stats.price ?? spot).toFixed(2)}</span>
                </span>
              )}
              <span className="text-gray-400">
                Prem <span className="text-gray-600 dark:text-gray-300 font-semibold tabular-nums">{fmt(stats.total_prem ?? 0)}</span>
              </span>
              <span className="text-gray-400">
                Net <span className={`font-bold tabular-nums ${(stats.net_flow ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {fmt(stats.net_flow ?? 0)}
                </span>
              </span>
              <span className="text-gray-400">
                Vol <span className="text-gray-600 dark:text-gray-300 font-semibold tabular-nums">{fmtVol(stats.volume ?? 0)}</span>
              </span>
            </div>

            {/* Range pills */}
            <div className="flex gap-0.5">
              {DAY_RANGES.map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${
                    days === d
                      ? "bg-[var(--surface)] text-gray-900 dark:text-white shadow-sm border border-[var(--border)]"
                      : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  {d}D
                </button>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-3 pb-2">
            <span className="flex items-center gap-1.5 text-[9px] text-gray-400 uppercase tracking-wide font-semibold">
              <span className="inline-block w-4 h-0.5 bg-yellow-400 rounded-full" />{symbol}
            </span>
            <span className="flex items-center gap-1.5 text-[9px] text-gray-400 uppercase tracking-wide font-semibold">
              <span className="inline-block w-4 h-0.5 bg-emerald-500 rounded-full" />Call Prem
            </span>
            <span className="flex items-center gap-1.5 text-[9px] text-gray-400 uppercase tracking-wide font-semibold">
              <span className="inline-block w-4 h-0.5 bg-red-500 rounded-full" />Put Prem
            </span>
          </div>

          {/* Chart */}
          {chartData.length < 5 ? (
          <div className="flex flex-col items-center justify-center h-[260px] gap-2.5 text-gray-300 dark:text-gray-600">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 17l4-8 4 5 3-4 4 6"/>
              <path d="M21 21H3" strokeWidth="1" opacity="0.4"/>
            </svg>
            <p className="text-[11px] font-semibold text-gray-400">Building history…</p>
            <p className="text-[9px] text-gray-400 text-center max-w-[180px] leading-relaxed">
                {chartData.length} snapshot{chartData.length !== 1 ? "s" : ""} collected.
                Updates every 15s.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart
                data={chartData}
                margin={{ top: 4, right: 52, left: 0, bottom: 0 }}
                onMouseMove={(e: any) => {
                  const pt = e?.activePayload?.[0]?.payload as Snapshot | undefined;
                  if (pt) setHovered(pt);
                }}
                onMouseLeave={() => setHovered(null)}
              >
                <FlowGradients />
                <CartesianGrid stroke="rgba(128,128,128,0.12)" strokeDasharray="4 4" vertical={false} />

                {/* No XAxis — timestamps removed */}
                <XAxis dataKey="t" hide />

                {/* Left: price */}
                <YAxis
                  yAxisId="price"
                  orientation="left"
                  domain={[priceMin, priceMax]}
                  tickFormatter={v => `$${Number(v).toFixed(0)}`}
                  tick={{ fill: "#9ca3af", fontSize: 9 }}
                  axisLine={false} tickLine={false} width={50}
                />

                {/* Right: premium */}
                <YAxis
                  yAxisId="prem"
                  orientation="right"
                  domain={[0, premMax]}
                  tickFormatter={fmtAxis}
                  tick={{ fill: "#9ca3af", fontSize: 9 }}
                  axisLine={false} tickLine={false} width={42}
                />

                {/* Hidden axis for volume bars (bottom quarter) */}
                <YAxis yAxisId="vol" orientation="right" domain={[0, volMax]} hide />

                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: "rgba(255,255,255,0.12)", strokeWidth: 1 }}
                />

                {/* Volume bars */}
                <Bar yAxisId="vol" dataKey="volume" name="Vol" maxBarSize={6} isAnimationActive={false}>
                  {chartData.map((d, i) => (
                    <Cell key={`vc-${i}`} fill={d.net_flow >= 0 ? VOL_CALL : VOL_PUT} />
                  ))}
                </Bar>

                {/* Call premium area */}
                <Area yAxisId="prem" type="linear" dataKey="call_prem" name="Net Call Prem"
                  stroke={NET_CALL} strokeWidth={1.5} fill="url(#gCall)"
                  dot={false} activeDot={{ r: 3, fill: NET_CALL }} isAnimationActive={false}
                />

                {/* Put premium area */}
                <Area yAxisId="prem" type="linear" dataKey="put_prem" name="Net Put Prem"
                  stroke={NET_PUT} strokeWidth={1.5} fill="url(#gPut)"
                  dot={false} activeDot={{ r: 3, fill: NET_PUT }} isAnimationActive={false}
                />

                {/* Price line */}
                <Line yAxisId="price" type="linear" dataKey="price" name="Price"
                  stroke={PRICE_COLOR} strokeWidth={2}
                  dot={false} activeDot={{ r: 3, fill: PRICE_COLOR }} isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ══ BOTTOM ROW: Expiry + Strike side by side ══════════════════════ */}
        {(expiryData.length > 0 || strikeData.length > 0) && (
          <div className="grid grid-cols-2 gap-3">

            {/* Flow by Expiry */}
            {expiryData.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold mb-3">Flow by Expiry</p>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={expiryData} barCategoryGap="30%" barGap={2} margin={{ top: 2, right: 2, left: 0, bottom: 2 }}>
                    <CartesianGrid vertical={false} stroke="rgba(128,128,128,0.12)" />
                    <XAxis dataKey="expiry" tick={{ fill: "#9ca3af", fontSize: 8 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtAxis} tick={{ fill: "#9ca3af", fontSize: 8 }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                    <Bar dataKey="Calls" fill={CALL_COLOR} radius={[3, 3, 0, 0]} maxBarSize={16} />
                    <Bar dataKey="Puts"  fill={PUT_COLOR}  radius={[3, 3, 0, 0]} maxBarSize={16} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-3 mt-2">
                  <span className="flex items-center gap-1 text-[8px] text-gray-400 uppercase tracking-wide font-semibold">
                    <span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />Calls
                  </span>
                  <span className="flex items-center gap-1 text-[8px] text-gray-400 uppercase tracking-wide font-semibold">
                    <span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />Puts
                  </span>
                </div>
              </div>
            )}

            {/* Net Flow by Strike */}
            {strikeData.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold mb-3">Net Flow by Strike</p>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={strikeData} layout="vertical" margin={{ top: 2, right: 2, left: 0, bottom: 2 }}>
                    <CartesianGrid horizontal={false} stroke="rgba(128,128,128,0.12)" />
                    <XAxis type="number" tickFormatter={fmtAxis} tick={{ fill: "#9ca3af", fontSize: 8 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="strike" tick={{ fill: "#6b7280", fontSize: 8 }} axisLine={false} tickLine={false} width={46} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                    <ReferenceLine x={0} stroke="rgba(128,128,128,0.3)" strokeDasharray="3 3" />
                    <Bar dataKey="Net" radius={[0, 3, 3, 0]} maxBarSize={14}>
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
            <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]">
              <p className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Top Flow Strikes</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="text-gray-400 border-b border-[var(--border)]">
                    <th className="text-left   px-4 py-2 font-semibold tracking-wide text-[9px] uppercase">Strike</th>
                    <th className="text-right  px-4 py-2 font-semibold tracking-wide text-[9px] uppercase text-emerald-500/70">Call $</th>
                    <th className="text-right  px-4 py-2 font-semibold tracking-wide text-[9px] uppercase text-red-500/70">Put $</th>
                    <th className="text-right  px-4 py-2 font-semibold tracking-wide text-[9px] uppercase">Net</th>
                    <th className="text-center px-4 py-2 font-semibold tracking-wide text-[9px] uppercase">Bias</th>
                  </tr>
                </thead>
                <tbody>
                  {tableStrikes.map((s, i) => (
                    <tr key={s.strike} className={`border-b border-[var(--border)] hover:bg-[var(--surface)] transition-colors ${i % 2 === 0 ? "" : "bg-[var(--surface)]/40"}`}>
                      <td className="px-4 py-2 font-bold text-gray-700 dark:text-gray-200 tabular-nums">{s.strike.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-emerald-600 dark:text-emerald-400 tabular-nums font-medium">{fmt(s.call_prem)}</td>
                      <td className="px-4 py-2 text-right text-red-600 dark:text-red-400 tabular-nums font-medium">{fmt(s.put_prem)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums font-bold ${s.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{fmt(s.net)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`inline-block text-[8px] font-bold px-2 py-0.5 rounded-full tracking-wider ${
                          s.bias === "call"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
                        }`}>{s.bias.toUpperCase()}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
