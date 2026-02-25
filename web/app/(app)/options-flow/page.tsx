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
      <span className="text-[9px] font-semibold uppercase tracking-widest text-foreground/70 mb-0.5">{label}</span>
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
      className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
      style={{ boxShadow: `0 0 0 1px ${accentColor}30, 0 8px 32px rgba(0,0,0,0.18)` }}
    >
      {/* ── Thick accent bar with gradient glow ──────────────────────── */}
      <div className="h-[3px] w-full rounded-t-2xl overflow-hidden" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}55, transparent)` }} />

      {/* ── Header: search + status ──────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)] overflow-visible relative z-10">
        <TickerSearchInput
          value={slot.input}
          onChange={onInputChange}
          onSelect={onSelect}
          accentColor={accentColor}
          placeholder="Ticker or company…"
          actionLabel="LOAD"
          className="flex-1 max-w-[280px]"
        />

        {/* Live status */}
        <div className="flex items-center gap-2 ml-auto">
          {data && (
            <span className={`text-[9px] font-black px-2.5 py-1 rounded-full border tracking-wide ${
              data.data_source === "tradier"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-amber-500/10 border-amber-500/30 text-amber-400"
            }`}>
              {data.data_source === "tradier" ? "● LIVE" : "◌ 15min delay"}
            </span>
          )}
          <div className="flex items-center gap-1.5 text-foreground/70">
            <span className={`w-1.5 h-1.5 rounded-full ${isFetching ? "bg-amber-400 animate-pulse" : "bg-emerald-500 animate-pulse"}`} />
            {lastUpdated && <span className="text-[9px] font-mono tabular-nums hidden sm:block opacity-60">{lastUpdated}</span>}
            <button onClick={onRefresh} className="hover:text-foreground transition p-1 rounded-md hover:bg-[var(--border)]" title="Refresh">
              <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {isLoading && <div className="p-4"><SkeletonStatGrid count={6} /></div>}
      {isError && <div className="p-4"><ErrorBanner message={`Failed to load GEX for ${slot.ticker}.`} /></div>}

      {data && (
        <>
          {/* ── GEX Key Levels ────────────────────────────────────────────── */}
          <div className="px-4 pt-4 pb-3 border-b border-[var(--border)]">
            {/* Top row: spot price + regime */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="text-[28px] font-black tabular-nums text-[var(--foreground)] leading-none">
                  {data.spot != null ? `$${data.spot.toFixed(2)}` : "—"}
                </span>
                <span className="text-[11px] text-foreground font-bold tracking-wide">{slot.ticker}</span>
              </div>
              <GexRegimeBadge netGex={netGex} />
              {impliedMove != null && (
                <span className="text-[9px] text-foreground border border-foreground/20 rounded-full px-2.5 py-1 font-bold tracking-wide">
                  {impliedMove.toFixed(1)}% to zero-γ
                </span>
              )}
            </div>

            {/* Key level cards */}
            <div className="grid grid-cols-5 gap-2">
              {/* Net GEX */}
              <div className={`rounded-xl border px-2.5 py-2 ${isCallBias ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20"}`}>
                <p className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold mb-1">Net GEX</p>
                <p className={`text-[13px] font-black tabular-nums leading-none ${isCallBias ? "text-emerald-400" : "text-red-400"}`}>{fmtGexUtil(netGex)}</p>
              </div>
              {/* Zero Gamma */}
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-2.5 py-2">
                <p className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold mb-1">Zero γ</p>
                <p className="text-[13px] font-black tabular-nums text-yellow-400 leading-none">{data.zero_gamma != null ? `$${data.zero_gamma.toFixed(0)}` : "—"}</p>
              </div>
              {/* Call Wall */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
                <p className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold mb-1">Call Wall</p>
                <p className="text-[13px] font-black tabular-nums text-emerald-400 leading-none">{data.max_call_wall != null ? `$${data.max_call_wall.toFixed(0)}` : "—"}</p>
              </div>
              {/* Put Wall */}
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-2.5 py-2">
                <p className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold mb-1">Put Wall</p>
                <p className="text-[13px] font-black tabular-nums text-red-400 leading-none">{data.max_put_wall != null ? `$${data.max_put_wall.toFixed(0)}` : "—"}</p>
              </div>
              {/* Max GEX */}
              <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 px-2.5 py-2">
                <p className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold mb-1">Max GEX</p>
                <p className="text-[13px] font-black tabular-nums text-purple-400 leading-none">{data.max_gex_strike != null ? `$${data.max_gex_strike.toFixed(0)}` : "—"}</p>
              </div>
            </div>
          </div>

          {/* ── Insight bar ───────────────────────────────────────────────── */}
          {data.spot != null && data.max_call_wall != null && data.max_put_wall != null && (
            <div className={`px-4 py-2.5 border-b border-[var(--border)] ${ isCallBias ? "bg-emerald-500/[0.04]" : "bg-red-500/[0.04]"}`}>
              <div className="flex items-center gap-2 text-[10px] text-foreground/80">
                {isCallBias ? <TrendingDown size={11} className="text-emerald-400 shrink-0" /> : <TrendingUp size={11} className="text-red-400 shrink-0" />}
                <span>
                  Price <strong className="text-foreground">{data.spot > data.zero_gamma! ? "above" : "below"} zero-gamma</strong>
                  {" "}— dealers {isCallBias ? "hedge by selling rallies & buying dips" : "amplify moves (trending mode)"}
                  {data.max_call_wall && data.spot < data.max_call_wall && (
                    <span className="ml-2 text-emerald-400">
                      · Resistance <strong>${data.max_call_wall.toFixed(0)}</strong>
                    </span>
                  )}
                  {data.max_put_wall && data.spot > data.max_put_wall && (
                    <span className="ml-2 text-red-400">
                      · Support <strong>${data.max_put_wall.toFixed(0)}</strong>
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* ── Expiry filter dropdown ─────────────────────────────────────── */}
          {expiryDates.length > 1 && (
            <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center gap-3">
              <span className="text-[9px] text-foreground uppercase tracking-widest font-semibold shrink-0">Expiry</span>
              <div className="relative flex-1 max-w-[220px]">
                <select
                  value={slot.expiryFilter?.[0] ?? (todayExp ?? "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") onClearExpiry();
                    else onToggleExpiry(v);
                  }}
                  className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[11px] font-bold text-foreground pl-3 pr-7 py-1.5 focus:outline-none cursor-pointer"
                  style={{ color: slot.expiryFilter ?? todayExp ? accentColor : undefined }}
                >
                  <option value="">All expiries ({expiryDates.length})</option>
                  {expiryDates.map((d) => (
                    <option key={d} value={d}>
                      {isToday(d) ? `⚡ 0DTE · ${d}` : d}
                    </option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/60 pointer-events-none" />
              </div>
              {slot.expiryFilter && (
                <button onClick={onClearExpiry} className="text-[10px] text-foreground/70 hover:text-foreground transition flex items-center gap-1">
                  <X size={10} /> Clear
                </button>
              )}
            </div>
          )}

          {/* ── P/C Ratio + Flow breakdown ───────────────────────────────────── */}
          {(data.call_premium > 0 || data.put_premium > 0) && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 mb-3">
                <Zap size={10} className="text-foreground/60" />
                <span className="text-[9px] text-foreground uppercase tracking-widest font-black">Premium Flow</span>
              </div>
              <div className="flex items-center gap-3">
                {/* Call premium bar */}
                <div className="flex-1">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-[9px] text-emerald-400 font-black uppercase tracking-wide">Calls</span>
                    <span className="text-[10px] font-black text-emerald-400 tabular-nums">${(data.call_premium / 1e6).toFixed(1)}M</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-sm" style={{ width: `${Math.round((data.call_premium / (data.call_premium + data.put_premium)) * 100)}%` }} />
                  </div>
                </div>
                {/* P/C ratio badge */}
                <div className="flex flex-col items-center px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] shrink-0">
                  <span className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold">P/C</span>
                  <span className={`text-[15px] font-black tabular-nums leading-none mt-0.5 ${
                    data.put_premium / Math.max(data.call_premium, 1) > 1
                      ? "text-red-400"
                      : "text-emerald-400"
                  }`}>{(data.put_premium / Math.max(data.call_premium, 1)).toFixed(2)}</span>
                </div>
                {/* Put premium bar */}
                <div className="flex-1">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-[9px] text-red-400 font-black uppercase tracking-wide">Puts</span>
                    <span className="text-[10px] font-black text-red-400 tabular-nums">${(data.put_premium / 1e6).toFixed(1)}M</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-400 shadow-sm" style={{ width: `${Math.round((data.put_premium / (data.call_premium + data.put_premium)) * 100)}%` }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Top Flow Strikes ─────────────────────────────────────────────── */}
          {data.top_flow_strikes && data.top_flow_strikes.length > 0 && (
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 mb-2.5">
                <BarChart2 size={10} className="text-foreground/60" />
                <span className="text-[9px] text-foreground uppercase tracking-widest font-black">Top Flow Strikes</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {data.top_flow_strikes.slice(0, 5).map((tf) => {
                  const total = Math.max(tf.call_prem + tf.put_prem, 1);
                  const callPct = Math.round((tf.call_prem / total) * 100);
                  const isCallBias = tf.bias === "call";
                  return (
                    <div key={tf.strike} className="flex items-center gap-2 text-[10px]">
                      <span className="w-[52px] font-black tabular-nums text-white shrink-0">${tf.strike.toFixed(0)}</span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden flex bg-[var(--border)] min-w-0">
                        <div className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-l-full" style={{ width: `${callPct}%` }} />
                        <div className="h-full bg-gradient-to-l from-red-600 to-red-400 rounded-r-full" style={{ width: `${100 - callPct}%` }} />
                      </div>
                      <span className={`shrink-0 font-black text-[8px] flex items-center gap-0.5 ${ isCallBias ? "text-emerald-400" : "text-red-400" }`}>
                        {isCallBias ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                        {isCallBias ? "CALL" : "PUT"}
                      </span>
                      <span className="text-foreground/70 tabular-nums shrink-0 font-mono text-[9px]">${(Math.abs(tf.net) / 1e6).toFixed(1)}M</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Flow by Expiry ────────────────────────────────────────────────── */}
          {data.flow_by_expiry && data.flow_by_expiry.length > 0 && (
            <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <div className="flex items-center gap-2 mb-2.5">
                <Activity size={10} className="text-foreground/60" />
                <span className="text-[9px] text-foreground uppercase tracking-widest font-black">Flow by Expiry</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
                {data.flow_by_expiry.slice(0, 6).map((fe) => {
                  const isPos = fe.net >= 0;
                  const dte0 = isToday(fe.expiry);
                  return (
                    <div key={fe.expiry} className={`flex items-center justify-between gap-2 px-2 py-1 rounded-lg ${
                      dte0 ? "bg-amber-500/8 border border-amber-500/20" : "bg-[var(--border)]/30"
                    }`}>
                      <span className={`text-[8px] font-mono truncate font-bold ${dte0 ? "text-amber-400" : "text-foreground/70"}`}>
                        {dte0 ? "⚡ 0DTE" : fe.expiry}
                      </span>
                      <span className={`text-[9px] font-black tabular-nums shrink-0 ${ isPos ? "text-emerald-400" : "text-red-400" }`}>
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
            <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--surface-2)]">
              <div className="flex items-center gap-2">
                <BarChart2 size={11} className="text-foreground/60" />
                <span className="text-[9px] text-foreground uppercase tracking-widest font-black">GEX by Strike</span>
                <span className="text-[9px] font-black px-2 py-0.5 rounded-md ml-1"
                  style={{ background: `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}30` }}>
                  {slot.ticker}
                </span>
              </div>
              {/* Strikes depth selector — lives here, not in the page header */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-foreground uppercase tracking-widest font-semibold hidden sm:block">Strikes</span>
                <div className="flex items-center bg-[var(--surface)] rounded-lg p-0.5 gap-0.5 border border-[var(--border)]">
                  {STRIKE_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => onSetNStrikes(n)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition ${
                        nStrikes === n
                          ? "text-white"
                          : "text-foreground/60 hover:text-foreground"
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
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-lg"
                style={{ background: "linear-gradient(135deg, #a855f7 0%, #6366f1 50%, #3b82f6 100%)", boxShadow: "0 4px 14px rgba(168,85,247,0.3)" }}>
                <Activity size={16} className="text-white" />
              </div>
              <div>
                <h1 className="text-[15px] font-black text-white leading-none tracking-tight">Options Flow</h1>
                <p className="text-[10px] text-foreground/70 mt-0.5 font-semibold tracking-wide">GEX · Net Premium · Strike Levels</p>
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
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-foreground/70 border border-dashed border-[var(--border)] hover:border-purple-400 hover:text-purple-500 transition"
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

