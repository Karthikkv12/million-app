"use client";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGex, GexResult } from "@/lib/api";
import GexStrikeTable from "@/components/gex/GexStrikeTable";
import NetFlowPanel from "@/components/gex/NetFlowPanel";
import { fmtGex as fmtGexUtil } from "@/lib/gex";
import { Search, TrendingUp, X, Plus } from "lucide-react";
import { PageHeader, SkeletonStatGrid, ErrorBanner, RefreshButton } from "@/components/ui";

const STRIKE_OPTIONS = [10, 20, 30, 40, 50] as const;
const MAX_TICKERS = 4;
const ACCENTS = ["#a855f7", "#f59e0b", "#22d3ee", "#f87171"]; // purple, amber, cyan, red
const DEFAULT_TICKERS = ["SPY", "QQQ", "AAPL", "TSLA"];

// ── Per-slot state ────────────────────────────────────────────────────────────
interface Slot {
  ticker: string;
  input: string;
  expiryFilter: string[] | null;
}

function makeSlot(ticker: string): Slot {
  return { ticker, input: ticker, expiryFilter: null };
}

// ── Summary cards ─────────────────────────────────────────────────────────────
// panelCount: how many panels are visible — drives how many cols to use
function SummaryCards({ data, panelCount }: { data: GexResult; panelCount: number }) {
  const items = [
    { label: "Net GEX",    value: fmtGexUtil(data.net_gex),                                             pos: (data.net_gex ?? 0) >= 0 },
    { label: "Zero γ",     value: data.zero_gamma    != null ? `$${data.zero_gamma.toFixed(2)}`    : "—", pos: null },
    { label: "Spot",       value: data.spot          != null ? `$${data.spot.toFixed(2)}`          : "—", pos: null },
    { label: "Call Wall",  value: data.max_call_wall  != null ? `$${data.max_call_wall.toFixed(2)}`  : "—", pos: true  },
    { label: "Put Wall",   value: data.max_put_wall   != null ? `$${data.max_put_wall.toFixed(2)}`   : "—", pos: false },
    { label: "Max GEX",    value: data.max_gex_strike != null ? `$${data.max_gex_strike.toFixed(2)}` : "—", pos: true  },
  ];
  // Always 2 cols per row so values never overflow; single panel gets 3
  const gridCols = panelCount === 1 ? "grid-cols-3" : "grid-cols-2";
  return (
    <div className={`grid ${gridCols} gap-1.5 mb-3`}>
      {items.map(({ label, value, pos }) => (
        <div key={label} className="bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2.5 py-2 min-w-0">
          <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5 truncate">{label}</p>
          <p className={`text-xs font-black truncate ${
            pos === null ? "text-gray-900 dark:text-white" : pos ? "text-green-500" : "text-red-500"
          }`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Single ticker panel ───────────────────────────────────────────────────────
function TickerPanel({
  slot, accentColor, nStrikes, panelCount,
  onInputChange, onSearch, onToggleExpiry, onClearExpiry,
  data, isLoading, isError, isFetching, onRefresh,
}: {
  slot: Slot;
  accentColor: string;
  nStrikes: number;
  panelCount: number;
  onInputChange: (v: string) => void;
  onSearch: (e: React.FormEvent) => void;
  onToggleExpiry: (d: string) => void;
  onClearExpiry: () => void;
  data: GexResult | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  const expiryDates: string[] = data
    ? Array.from(new Set(data.heatmap_expiries ?? [])).sort()
    : [];

  return (
    <div
      className="flex flex-col gap-3 min-w-0 rounded-2xl border border-[var(--border)] p-4 bg-[var(--surface)]"
      style={{ borderTopColor: accentColor, borderTopWidth: 3 }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: accentColor }} />
        <span className="text-sm font-extrabold text-gray-800 dark:text-gray-100 tracking-wide">
          {slot.ticker}
        </span>
        <RefreshButton onRefresh={onRefresh} isRefreshing={isFetching} />
      </div>

      {/* Search bar */}
      <form
        onSubmit={onSearch}
        className="flex items-center gap-0 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl overflow-hidden focus-within:ring-2 transition"
        style={{ "--tw-ring-color": accentColor } as React.CSSProperties}
      >
        <span className="pl-3 pr-2 text-gray-400 shrink-0"><Search size={13} /></span>
        <input
          value={slot.input}
          onChange={(e) => onInputChange(e.target.value.toUpperCase())}
          placeholder="SPY, QQQ, AAPL…"
          className="flex-1 py-2 text-xs bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
        />
        <button
          type="submit"
          className="m-1 px-3 py-1.5 rounded-lg text-white text-[11px] font-bold tracking-wide transition flex items-center gap-1 shrink-0"
          style={{ background: accentColor }}
        >
          <TrendingUp size={11} /> Load
        </button>
      </form>

      {isLoading && <SkeletonStatGrid count={6} />}
      {isError && <ErrorBanner message={`Failed to load GEX for ${slot.ticker}.`} />}

      {data && (
        <>
          <SummaryCards data={data} panelCount={panelCount} />

          <NetFlowPanel data={data} accentColor={accentColor} />

          {/* Expiry filter chips */}
          {expiryDates.length > 1 && (
            <div className="mb-1">
              <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wide">Filter expiry</p>
              <div className="flex flex-wrap gap-1 overflow-x-auto pb-1">
                <button
                  onClick={onClearExpiry}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition shrink-0 ${
                    slot.expiryFilter === null ? "text-white" : "bg-[var(--surface-2)] text-gray-500"
                  }`}
                  style={slot.expiryFilter === null ? { background: accentColor } : undefined}
                >All</button>
                {expiryDates.map((d) => (
                  <button
                    key={d}
                    onClick={() => onToggleExpiry(d)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition shrink-0 ${
                      slot.expiryFilter?.includes(d) ? "text-white" : "bg-[var(--surface-2)] text-gray-500"
                    }`}
                    style={slot.expiryFilter?.includes(d) ? { background: accentColor } : undefined}
                  >{d}</button>
                ))}
              </div>
            </div>
          )}

          {/* Strike table */}
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <h2 className="text-xs font-bold text-gray-700 dark:text-gray-300">
                Strike-Level GEX — <span style={{ color: accentColor }}>{slot.ticker}</span>
              </h2>
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
        </>
      )}
    </div>
  );
}

// ── Wrapper that owns its own query ───────────────────────────────────────────
function TickerPanelWithQuery({
  slot, accentColor, nStrikes, enabled, panelCount,
  onInputChange, onSearch, onToggleExpiry, onClearExpiry,
}: {
  slot: Slot;
  accentColor: string;
  nStrikes: number;
  enabled: boolean;
  panelCount: number;
  onInputChange: (v: string) => void;
  onSearch: (e: React.FormEvent) => void;
  onToggleExpiry: (d: string) => void;
  onClearExpiry: () => void;
}) {
  const { data, isLoading, isError, isFetching, refetch } = useQuery<GexResult>({
    queryKey: ["gex", slot.ticker],
    queryFn:  () => fetchGex(slot.ticker),
    staleTime: 30_000,
    enabled,
  });

  return (
    <TickerPanel
      slot={slot}
      accentColor={accentColor}
      nStrikes={nStrikes}
      panelCount={panelCount}
      onInputChange={onInputChange}
      onSearch={onSearch}
      onToggleExpiry={onToggleExpiry}
      onClearExpiry={onClearExpiry}
      data={data}
      isLoading={isLoading}
      isError={isError}
      isFetching={isFetching}
      onRefresh={refetch}
    />
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OptionsFlowPage() {
  const [slots, setSlots] = useState<Slot[]>([makeSlot("SPY")]);
  const [nStrikes, setNStrikes] = useState<number>(20);

  const addSlot = () => {
    if (slots.length >= MAX_TICKERS) return;
    const next = DEFAULT_TICKERS.find((t) => !slots.some((s) => s.ticker === t)) ?? "AAPL";
    setSlots((prev) => [...prev, makeSlot(next)]);
  };

  const removeSlot = (idx: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSlot = useCallback((idx: number, patch: Partial<Slot>) => {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }, []);

  const gridClass =
    slots.length === 1 ? "grid-cols-1" :
    slots.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
    slots.length === 3 ? "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3" :
                         "grid-cols-1 lg:grid-cols-2 xl:grid-cols-4";

  return (
    <div className="p-4 sm:p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Options Flow"
        sub={
          slots.length === 1
            ? `GEX analysis — ${slots[0].ticker}`
            : `Comparing ${slots.map((s) => s.ticker).join(" vs ")}`
        }
      />

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {/* Strikes */}
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide shrink-0">Strikes</span>
        <div className="flex items-center bg-[var(--surface-2)] rounded-xl p-0.5 gap-0.5">
          {STRIKE_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setNStrikes(n)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                nStrikes === n
                  ? "bg-white dark:bg-gray-700 text-purple-700 dark:text-purple-300 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
            >{n}</button>
          ))}
        </div>

        {/* Ticker tab pills */}
        <div className="flex items-center gap-1.5 ml-4 flex-wrap">
          {slots.map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border"
              style={{ borderColor: ACCENTS[i], color: ACCENTS[i], background: `${ACCENTS[i]}18` }}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-0.5" style={{ background: ACCENTS[i] }} />
              {s.ticker}
              {slots.length > 1 && (
                <button
                  onClick={() => removeSlot(i)}
                  className="ml-0.5 opacity-60 hover:opacity-100 transition"
                  title={`Remove ${s.ticker}`}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          ))}

          {slots.length < MAX_TICKERS && (
            <button
              onClick={addSlot}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-gray-400 border border-dashed border-[var(--border)] hover:border-amber-400 hover:text-amber-500 transition"
            >
              <Plus size={12} /> Add
            </button>
          )}
        </div>
      </div>

      {/* Panels grid */}
      <div className={`grid gap-5 ${gridClass}`}>
        {slots.map((slot, i) => (
          <TickerPanelWithQuery
            key={i}
            slot={slot}
            accentColor={ACCENTS[i]}
            nStrikes={nStrikes}
            panelCount={slots.length}
            enabled={true}
            onInputChange={(v) => updateSlot(i, { input: v })}
            onSearch={(e) => {
              e.preventDefault();
              const t = slot.input.trim().toUpperCase();
              if (t) updateSlot(i, { ticker: t, input: t, expiryFilter: null });
            }}
            onToggleExpiry={(d) =>
              updateSlot(i, {
                expiryFilter: slot.expiryFilter
                  ? slot.expiryFilter.includes(d)
                    ? slot.expiryFilter.filter((x) => x !== d).length === 0
                      ? null
                      : slot.expiryFilter.filter((x) => x !== d)
                    : [...slot.expiryFilter, d]
                  : [d],
              })
            }
            onClearExpiry={() => updateSlot(i, { expiryFilter: null })}
          />
        ))}
      </div>
    </div>
  );
}
