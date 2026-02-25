"use client";
import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGex, watchSymbols, GexResult } from "@/lib/api";
import GexStrikeTable from "@/components/gex/GexStrikeTable";
import NetFlowPanel from "@/components/gex/NetFlowPanel";
import TickerSearchInput from "@/components/TickerSearchInput";
import { fmtGex as fmtGexUtil, isToday } from "@/lib/gex";
import { X, Plus, RefreshCw, TrendingUp, TrendingDown, Activity, BarChart2, Shield, ChevronDown, Zap, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { SkeletonStatGrid, ErrorBanner } from "@/components/ui";

const STRIKE_OPTIONS = [10, 20, 30, 40, 50] as const;
const MAX_TICKERS = 3;
const ACCENTS = ["#a855f7", "#f59e0b", "#22d3ee"] as const;
const DEFAULT_TICKERS = ["SPY", "QQQ", "AAPL"];

interface Slot {
  ticker: string;
  input: string;
  expiryFilter: string[] | null;
}

function makeSlot(ticker: string): Slot {
  return { ticker, input: ticker, expiryFilter: null };
}

// ── GEX regime interpretation ─────────────────────────────────────────────────
function GexRegimeBadge({ netGex }: { netGex: number }) {
  const isLong = netGex >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border ${
      isLong
        ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-500 dark:text-emerald-400"
        : "bg-red-500/10 border-red-500/25 text-red-500 dark:text-red-400"
    }`}>
      {isLong ? <Shield size={9} /> : <Activity size={9} />}
      {isLong ? "Long γ — mean reversion" : "Short γ — trending"}
    </span>
  );
}

// ── Key level badge ───────────────────────────────────────────────────────────
function KeyLevelBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-0.5">{label}</span>
      <span className={`text-sm font-bold tabular-nums truncate ${color}`}>{value}</span>
    </div>
  );
}

// ── Per-ticker panel ──────────────────────────────────────────────────────────
function TickerPanel({
  slot, accentColor, nStrikes, onSetNStrikes,
  onInputChange, onSelect, onToggleExpiry, onClearExpiry,
  data, isLoading, isError, isFetching, onRefresh, dataUpdatedAt,
}: {
  slot: Slot;
  accentColor: string;
  nStrikes: number;
  onSetNStrikes: (n: number) => void;
  onInputChange: (v: string) => void;
  onSelect: (symbol: string) => void;
  onToggleExpiry: (d: string) => void;
  onClearExpiry: () => void;
  data: GexResult | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRefresh: () => void;
  dataUpdatedAt: number;
}) {
  const expiryDates: string[] = data
    ? Array.from(new Set(data.heatmap_expiries ?? [])).sort()
    : [];

  // Auto-select today's expiry (0DTE) when data first loads
  const todayExp = expiryDates.find(isToday);

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  const netGex = data?.net_gex ?? 0;
  const isCallBias = netGex >= 0;

  // Implied move estimate: distance from spot to zero gamma as a %
  const impliedMove = data?.spot && data?.zero_gamma
    ? Math.abs(((data.zero_gamma - data.spot) / data.spot) * 100)
    : null;

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--surface)]"
      style={{ boxShadow: `0 0 0 1.5px ${accentColor}22` }}
    >
      {/* ── Accent bar ───────────────────────────────────────────────────── */}
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${accentColor}dd, ${accentColor}33)` }} />

      {/* ── Header: search + status ──────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
        <TickerSearchInput
          value={slot.input}
          onChange={onInputChange}
          onSelect={onSelect}
          accentColor={accentColor}
          placeholder="Ticker or company…"
          actionLabel="LOAD"
          className="flex-1 max-w-[300px]"
        />

        {/* Live status */}
        <div className="flex items-center gap-2 ml-auto text-gray-400">
          {data && (
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
              data.data_source === "tradier"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                : "bg-amber-500/10 border-amber-500/30 text-amber-500"
            }`}>
              {data.data_source === "tradier" ? "● LIVE" : "◌ 15min delay"}
            </span>
          )}
          <span className={`w-1.5 h-1.5 rounded-full ${isFetching ? "bg-amber-400 animate-pulse" : "bg-emerald-500 animate-pulse"}`} />
          {lastUpdated && <span className="text-[10px] font-mono tabular-nums hidden sm:block">{lastUpdated}</span>}
          <button onClick={onRefresh} className="hover:text-gray-600 dark:hover:text-gray-200 transition" title="Refresh">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {isLoading && <div className="p-4"><SkeletonStatGrid count={6} /></div>}
      {isError && <div className="p-4"><ErrorBanner message={`Failed to load GEX for ${slot.ticker}.`} /></div>}

      {data && (
        <>
          {/* ── GEX Key Levels ────────────────────────────────────────────── */}
          <div className="px-4 py-3 border-b border-[var(--border)]">
            {/* Top row: spot price + regime */}
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black tabular-nums text-gray-900 dark:text-white">
                  {data.spot != null ? `$${data.spot.toFixed(2)}` : "—"}
                </span>
                <span className="text-xs text-gray-400 font-medium">{slot.ticker}</span>
              </div>
              <GexRegimeBadge netGex={netGex} />
              {impliedMove != null && (
                <span className="text-[10px] text-gray-400 border border-[var(--border)] rounded-full px-2 py-0.5 font-medium">
                  {impliedMove.toFixed(1)}% to zero-γ
                </span>
              )}
            </div>

            {/* Stat row */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-4 gap-y-2">
              <KeyLevelBadge
                label="Net GEX"
                value={fmtGexUtil(netGex)}
                color={isCallBias ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}
              />
              <KeyLevelBadge
                label="Zero γ"
                value={data.zero_gamma != null ? `$${data.zero_gamma.toFixed(2)}` : "—"}
                color="text-yellow-500 dark:text-yellow-400"
              />
              <KeyLevelBadge
                label="Call Wall"
                value={data.max_call_wall != null ? `$${data.max_call_wall.toFixed(2)}` : "—"}
                color="text-emerald-500 dark:text-emerald-400"
              />
              <KeyLevelBadge
                label="Put Wall"
                value={data.max_put_wall != null ? `$${data.max_put_wall.toFixed(2)}` : "—"}
                color="text-red-500 dark:text-red-400"
              />
              <KeyLevelBadge
                label="Max GEX"
                value={data.max_gex_strike != null ? `$${data.max_gex_strike.toFixed(2)}` : "—"}
                color="text-gray-700 dark:text-gray-200"
              />
            </div>
          </div>

          {/* ── Insight bar ───────────────────────────────────────────────── */}
          {data.spot != null && data.max_call_wall != null && data.max_put_wall != null && (
            <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                {isCallBias ? <TrendingDown size={12} className="text-emerald-500 shrink-0" /> : <TrendingUp size={12} className="text-red-400 shrink-0" />}
                <span>
                  Price <strong className="text-gray-700 dark:text-gray-200">{data.spot > data.zero_gamma! ? "above" : "below"} zero-gamma</strong>
                  {" "}— dealers {isCallBias ? "hedge by selling rallies, buying dips (stabilising)" : "amplify moves (trending)"}
                  {data.max_call_wall && data.spot < data.max_call_wall && (
                    <span className="ml-2 text-emerald-500">
                      · Call wall resistance at <strong>${data.max_call_wall.toFixed(0)}</strong>
                    </span>
                  )}
                  {data.max_put_wall && data.spot > data.max_put_wall && (
                    <span className="ml-2 text-red-400">
                      · Put wall support at <strong>${data.max_put_wall.toFixed(0)}</strong>
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* ── Expiry filter dropdown ─────────────────────────────────────── */}
          {expiryDates.length > 1 && (
            <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center gap-3">
              <span className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold shrink-0">Expiry</span>
              <div className="relative flex-1 max-w-[220px]">
                <select
                  value={slot.expiryFilter?.[0] ?? (todayExp ?? "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") onClearExpiry();
                    else onToggleExpiry(v);
                  }}
                  className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[11px] font-bold text-gray-700 dark:text-gray-200 pl-3 pr-7 py-1.5 focus:outline-none cursor-pointer"
                  style={{ color: slot.expiryFilter ?? todayExp ? accentColor : undefined }}
                >
                  <option value="">All expiries ({expiryDates.length})</option>
                  {expiryDates.map((d) => (
                    <option key={d} value={d}>
                      {isToday(d) ? `⚡ 0DTE · ${d}` : d}
                    </option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              {slot.expiryFilter && (
                <button onClick={onClearExpiry} className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition flex items-center gap-1">
                  <X size={10} /> Clear
                </button>
              )}
            </div>
          )}

          {/* ── P/C Ratio + Flow breakdown ───────────────────────────────────── */}
          {(data.call_premium > 0 || data.put_premium > 0) && (
            <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={11} className="text-gray-400" />
                <span className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Premium Flow</span>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                {/* Call premium bar */}
                <div className="flex-1 min-w-[120px]">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-wide">Calls</span>
                    <span className="text-[10px] font-bold text-emerald-500 tabular-nums">${(data.call_premium / 1e6).toFixed(1)}M</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((data.call_premium / (data.call_premium + data.put_premium)) * 100)}%` }} />
                  </div>
                </div>
                {/* P/C ratio badge */}
                <div className="flex flex-col items-center px-3 py-1 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                  <span className="text-[8px] text-gray-400 uppercase tracking-widest font-semibold">P/C Ratio</span>
                  <span className={`text-sm font-black tabular-nums ${
                    data.put_premium / Math.max(data.call_premium, 1) > 1
                      ? "text-red-500 dark:text-red-400"
                      : "text-emerald-500 dark:text-emerald-400"
                  }`}>{(data.put_premium / Math.max(data.call_premium, 1)).toFixed(2)}</span>
                </div>
                {/* Put premium bar */}
                <div className="flex-1 min-w-[120px]">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-[9px] text-red-400 font-bold uppercase tracking-wide">Puts</span>
                    <span className="text-[10px] font-bold text-red-400 tabular-nums">${(data.put_premium / 1e6).toFixed(1)}M</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                    <div className="h-full rounded-full bg-red-400" style={{ width: `${Math.round((data.put_premium / (data.call_premium + data.put_premium)) * 100)}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Top Flow Strikes ─────────────────────────────────────────────── */}
          {data.top_flow_strikes && data.top_flow_strikes.length > 0 && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 mb-2">
                <BarChart2 size={11} className="text-gray-400" />
                <span className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Top Flow Strikes</span>
              </div>
              <div className="flex flex-col gap-1">
                {data.top_flow_strikes.slice(0, 5).map((tf) => {
                  const total = Math.max(tf.call_prem + tf.put_prem, 1);
                  const callPct = Math.round((tf.call_prem / total) * 100);
                  const isCallBias = tf.bias === "call";
                  return (
                    <div key={tf.strike} className="flex items-center gap-2 text-[10px]">
                      <span className="w-16 font-bold tabular-nums text-gray-700 dark:text-gray-200 shrink-0">${tf.strike.toFixed(0)}</span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden bg-[var(--border)] relative">
                        <div className="absolute left-0 top-0 h-full rounded-full bg-emerald-500" style={{ width: `${callPct}%` }} />
                        <div className="absolute right-0 top-0 h-full rounded-full bg-red-400" style={{ width: `${100 - callPct}%` }} />
                      </div>
                      <span className={`shrink-0 font-bold text-[9px] flex items-center gap-0.5 ${ isCallBias ? "text-emerald-500" : "text-red-400" }`}>
                        {isCallBias ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                        {isCallBias ? "CALL" : "PUT"}
                      </span>
                      <span className="text-gray-400 tabular-nums shrink-0">${(Math.abs(tf.net) / 1e6).toFixed(1)}M</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Flow by Expiry ────────────────────────────────────────────────── */}
          {data.flow_by_expiry && data.flow_by_expiry.length > 0 && (
            <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={11} className="text-gray-400" />
                <span className="text-[9px] text-gray-400 uppercase tracking-widest font-bold">Flow by Expiry</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                {data.flow_by_expiry.slice(0, 6).map((fe) => {
                  const isPos = fe.net >= 0;
                  const dte0 = isToday(fe.expiry);
                  return (
                    <div key={fe.expiry} className="flex items-center justify-between gap-2">
                      <span className={`text-[9px] font-mono truncate ${dte0 ? "text-amber-500 font-bold" : "text-gray-500 dark:text-gray-400"}`}>
                        {dte0 ? "⚡ 0DTE" : fe.expiry}
                      </span>
                      <span className={`text-[10px] font-bold tabular-nums shrink-0 ${ isPos ? "text-emerald-500" : "text-red-400" }`}>
                        {isPos ? "+" : ""}{(fe.net / 1e6).toFixed(1)}M
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── GEX Strike Table ──────────────────────────────────────────── */}
          <div className="border-b border-[var(--border)]">
            <div className="flex items-center justify-between px-4 py-2 bg-[var(--surface-2)]">
              <div className="flex items-center gap-2">
                <BarChart2 size={12} className="text-gray-400" />
                <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-widest font-bold">GEX by Strike</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-1"
                  style={{ background: `${accentColor}18`, color: accentColor }}>
                  {slot.ticker}
                </span>
              </div>
              {/* Strikes depth selector — lives here, not in the page header */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold hidden sm:block">Strikes</span>
                <div className="flex items-center bg-[var(--surface)] rounded-lg p-0.5 gap-0.5 border border-[var(--border)]">
                  {STRIKE_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => onSetNStrikes(n)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition ${
                        nStrikes === n
                          ? "text-white"
                          : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      }`}
                      style={nStrikes === n ? { background: accentColor } : undefined}
                    >{n}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <GexStrikeTable
                data={data}
                nStrikes={nStrikes}
                expiryFilter={slot.expiryFilter}
                accentColor={accentColor}
              />
            </div>
          </div>

          {/* ── Net Flow Panel ────────────────────────────────────────────── */}
          <div className="p-4">
            <NetFlowPanel data={data} accentColor={accentColor} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Wrapper that owns its own query ───────────────────────────────────────────
function TickerPanelWithQuery({
  slot, accentColor, nStrikes, onSetNStrikes, enabled,
  onInputChange, onSelect, onToggleExpiry, onClearExpiry,
}: {
  slot: Slot;
  accentColor: string;
  nStrikes: number;
  onSetNStrikes: (n: number) => void;
  enabled: boolean;
  onInputChange: (v: string) => void;
  onSelect: (symbol: string) => void;
  onToggleExpiry: (d: string) => void;
  onClearExpiry: () => void;
}) {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery<GexResult>({
    queryKey: ["gex", slot.ticker],
    queryFn:  () => fetchGex(slot.ticker),
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    enabled,
  });

  return (
    <TickerPanel
      slot={slot}
      accentColor={accentColor}
      nStrikes={nStrikes}
      onSetNStrikes={onSetNStrikes}
      onInputChange={onInputChange}
      onSelect={onSelect}
      onToggleExpiry={onToggleExpiry}
      onClearExpiry={onClearExpiry}
      data={data}
      isLoading={isLoading}
      isError={isError}
      isFetching={isFetching}
      onRefresh={refetch}
      dataUpdatedAt={dataUpdatedAt}
    />
  );
}

// ── Persistence helpers ───────────────────────────────────────────────────────
const STORAGE_KEY = "optionsflow_layout";
interface PersistedLayout { slots: Slot[]; nStrikes: number; }

function loadLayout(): PersistedLayout {
  if (typeof window === "undefined") return { slots: [makeSlot("SPY")], nStrikes: 20 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { slots: [makeSlot("SPY")], nStrikes: 20 };
    const parsed = JSON.parse(raw) as PersistedLayout;
    if (!Array.isArray(parsed.slots) || parsed.slots.length === 0) throw new Error();
    const slots = parsed.slots
      .filter((s) => typeof s.ticker === "string" && s.ticker.length > 0)
      .map((s) => ({ ticker: s.ticker, input: s.ticker, expiryFilter: Array.isArray(s.expiryFilter) ? s.expiryFilter : null }));
    if (!slots.length) throw new Error();
    slots.splice(MAX_TICKERS);
    const nStrikes = STRIKE_OPTIONS.includes(parsed.nStrikes as (typeof STRIKE_OPTIONS)[number]) ? parsed.nStrikes : 20;
    return { slots, nStrikes };
  } catch {
    return { slots: [makeSlot("SPY")], nStrikes: 20 };
  }
}

function saveLayout(slots: Slot[], nStrikes: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      slots: slots.map((s) => ({ ticker: s.ticker, input: s.ticker, expiryFilter: s.expiryFilter })),
      nStrikes,
    }));
  } catch { /* ignore */ }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OptionsFlowPage() {
  const [slots, setSlots] = useState<Slot[]>(() => loadLayout().slots);
  const [nStrikes, setNStrikes] = useState<number>(() => loadLayout().nStrikes);

  // Handle ?ticker=XYZ deep-link from dashboard search
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const t = (params.get("ticker") ?? "").trim().toUpperCase();
    if (t) {
      setSlots([makeSlot(t)]);
      // clean up URL without navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("ticker");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => { saveLayout(slots, nStrikes); }, [slots, nStrikes]);

  useEffect(() => {
    const symbols = slots.map((s) => s.ticker);
    watchSymbols(symbols).catch(() => {});
    const id = setInterval(() => watchSymbols(symbols).catch(() => {}), 60_000);
    return () => clearInterval(id);
  }, [slots]);

  const addSlot = () => {
    if (slots.length >= MAX_TICKERS) return;
    const next = DEFAULT_TICKERS.find((t) => !slots.some((s) => s.ticker === t)) ?? "AAPL";
    setSlots((prev) => [...prev, makeSlot(next)]);
  };

  const removeSlot = (idx: number) => setSlots((prev) => prev.filter((_, i) => i !== idx));

  const updateSlot = useCallback((idx: number, patch: Partial<Slot>) => {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }, []);

  const gridClass =
    slots.length === 1 ? "grid-cols-1" :
    slots.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
                         "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="min-h-screen bg-[var(--background)]">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="w-full px-4 sm:px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">

            {/* Title */}
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "linear-gradient(135deg, #a855f7, #6366f1)" }}>
                <Activity size={16} className="text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-gray-900 dark:text-white leading-none">Options Flow</h1>
                <p className="text-[11px] text-gray-400 mt-0.5">GEX · Net Premium · Strike Levels</p>
              </div>
            </div>

            <div className="w-px h-8 bg-[var(--border)] hidden sm:block" />

            {/* Active tickers */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {slots.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border"
                  style={{ borderColor: `${ACCENTS[i]}55`, color: ACCENTS[i], background: `${ACCENTS[i]}12` }}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ACCENTS[i] }} />
                  {s.ticker}
                  {slots.length > 1 && (
                    <button onClick={() => removeSlot(i)} className="opacity-50 hover:opacity-100 transition ml-0.5">
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
              {slots.length < MAX_TICKERS && (
                <button
                  onClick={addSlot}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-gray-400 border border-dashed border-[var(--border)] hover:border-purple-400 hover:text-purple-500 transition"
                >
                  <Plus size={11} /> Add
                </button>
              )}
            </div>



          </div>
        </div>
      </div>

      {/* ── Panels ──────────────────────────────────────────────────────── */}
      <div className="w-full px-4 sm:px-6 py-6">
        <div className={`grid gap-5 ${gridClass}`}>
          {slots.map((slot, i) => (
            <TickerPanelWithQuery
              key={slot.ticker + i}
              slot={slot}
              accentColor={ACCENTS[i]}
              nStrikes={nStrikes}
              onSetNStrikes={setNStrikes}
              enabled={true}
              onInputChange={(v) => updateSlot(i, { input: v })}
              onSelect={(sym) => {
                const t = sym.trim().toUpperCase();
                if (t) updateSlot(i, { ticker: t, input: t, expiryFilter: null });
              }}
              onToggleExpiry={(d) =>
                updateSlot(i, {
                  expiryFilter: slot.expiryFilter
                    ? slot.expiryFilter.includes(d)
                      ? slot.expiryFilter.filter((x) => x !== d).length === 0 ? null : slot.expiryFilter.filter((x) => x !== d)
                      : [...slot.expiryFilter, d]
                    : [d],
                })
              }
              onClearExpiry={() => updateSlot(i, { expiryFilter: null })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

