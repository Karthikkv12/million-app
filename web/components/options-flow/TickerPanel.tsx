"use client";
/**
 * TickerPanel — assembles all GEX sub-sections for a single ticker.
 * TickerPanelWithQuery — wraps TickerPanel with its own react-query data fetch.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGex, GexResult } from "@/lib/api";
import { BarChart2, Zap, TrendingUp } from "lucide-react";
import { SkeletonStatGrid, ErrorBanner } from "@/components/ui";
import GexStrikeTable from "@/components/gex/GexStrikeTable";
import NetFlowPanel from "@/components/gex/NetFlowPanel";

import { PanelHeader } from "./PanelHeader";
import { GexKeyLevels } from "./GexKeyLevels";
import { InsightBar } from "./InsightBar";
import { ExpiryFilter } from "./ExpiryFilter";
import { PremiumFlow } from "./PremiumFlow";
import { TopFlowStrikes } from "./TopFlowStrikes";
import { FlowByExpiry } from "./FlowByExpiry";
import { KeyLevelsRuler } from "./KeyLevelsRuler";
import { GexProfileChart } from "./GexProfileChart";
import { GammaConcentration } from "./GammaConcentration";
import { DealerNarrative } from "./DealerNarrative";
import { FlowMomentumChart } from "./FlowMomentumChart";

// ── Slot type shared across the page ─────────────────────────────────────────
export interface Slot {
  ticker: string;
  input: string;
  expiryFilter: string[] | null;
}

export function makeSlot(ticker: string): Slot {
  return { ticker, input: ticker, expiryFilter: null };
}

// ── Available strike-depth options ───────────────────────────────────────────
export const STRIKE_OPTIONS = [10, 20, 30, 40, 50] as const;

// ── Panel tabs ────────────────────────────────────────────────────────────────
type PanelTab = "gex" | "flow";
const TABS: { id: PanelTab; label: string; icon: typeof Zap }[] = [
  { id: "gex",  label: "GEX",      icon: Zap       },
  { id: "flow", label: "Net Flow", icon: TrendingUp },
];

// ── Strikes depth selector (reusable inside panel header area) ────────────────
function StrikesSelector({
  nStrikes,
  accentColor,
  onSetNStrikes,
}: {
  nStrikes: number;
  accentColor: string;
  onSetNStrikes: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-foreground uppercase tracking-widest font-semibold hidden sm:block">
        Strikes
      </span>
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
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── TickerPanel: pure presentational (no data fetching) ──────────────────────
export interface TickerPanelProps {
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
}

export function TickerPanel({
  slot,
  accentColor,
  nStrikes,
  onSetNStrikes,
  onInputChange,
  onSelect,
  onToggleExpiry,
  onClearExpiry,
  data,
  isLoading,
  isError,
  isFetching,
  onRefresh,
  dataUpdatedAt,
}: TickerPanelProps) {
  const expiryDates: string[] = data
    ? Array.from(new Set(data.heatmap_expiries ?? [])).sort()
    : [];

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  // Derive single selected expiry from the slot's filter array
  const selectedExpiry = slot.expiryFilter?.[0] ?? null;

  const [activeTab, setActiveTab] = useState<PanelTab>("gex");

  return (
    <div
      className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
      style={{
        boxShadow: `0 0 0 1px ${accentColor}30, 0 8px 32px rgba(0,0,0,0.18)`,
      }}
    >
      {/* Thick accent gradient bar */}
      <div
        className="h-[3px] w-full rounded-t-2xl overflow-hidden"
        style={{
          background: `linear-gradient(90deg, ${accentColor}, ${accentColor}55, transparent)`,
        }}
      />

      {/* ── Tab selector ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-4 pt-2.5 pb-0 border-b border-[var(--border)] bg-[var(--surface-2)]">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold tracking-wide rounded-t-lg border-b-2 transition-all ${
                active
                  ? "border-b-[var(--border)] text-foreground bg-[var(--surface)]"
                  : "border-transparent text-foreground/50 hover:text-foreground/80 hover:bg-[var(--surface)]/50"
              }`}
              style={active ? { borderBottomColor: accentColor, color: accentColor } : undefined}
            >
              <Icon size={11} strokeWidth={active ? 2.5 : 1.8} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Search header */}
      <PanelHeader
        inputValue={slot.input}
        accentColor={accentColor}
        dataSource={data?.data_source}
        isFetching={isFetching}
        lastUpdated={lastUpdated}
        onInputChange={onInputChange}
        onSelect={onSelect}
        onRefresh={onRefresh}
      />

      {isLoading && (
        <div className="p-4">
          <SkeletonStatGrid count={6} />
        </div>
      )}
      {isError && (
        <div className="p-4">
          <ErrorBanner message={`Failed to load GEX for ${slot.ticker}.`} />
        </div>
      )}

      {data && (
        <>
          {/* ── GEX Tab ─────────────────────────────────────────────── */}
          {activeTab === "gex" && (
            <>
              {/* Key level cards */}
              <GexKeyLevels data={data} ticker={slot.ticker} />

              {/* Dealer insight text */}
              <InsightBar data={data} />

              {/* Expiry picker */}
              <ExpiryFilter
                expiryDates={expiryDates}
                selectedExpiry={selectedExpiry}
                accentColor={accentColor}
                onSelect={(d) => onToggleExpiry(d)}
                onClear={onClearExpiry}
              />

              {/* Premium flow P/C */}
              <PremiumFlow data={data} />

              {/* Top flow strikes */}
              <TopFlowStrikes data={data} />

              {/* Flow by expiry */}
              <FlowByExpiry data={data} />

              {/* Key levels ruler */}
              <KeyLevelsRuler data={data} />

              {/* GEX profile chart */}
              <GexProfileChart data={data} accentColor={accentColor} />

              {/* Gamma concentration */}
              <GammaConcentration data={data} />

              {/* Dealer narrative */}
              <DealerNarrative data={data} />

              {/* GEX Strike Table */}
              <div className="border-b border-[var(--border)]">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[var(--surface-2)]">
                  <div className="flex items-center gap-2">
                    <BarChart2 size={11} className="text-foreground/60" />
                    <span className="text-[9px] text-foreground uppercase tracking-widest font-black">
                      GEX by Strike
                    </span>
                    <span
                      className="text-[9px] font-black px-2 py-0.5 rounded-md ml-1"
                      style={{
                        background: `${accentColor}18`,
                        color: accentColor,
                        border: `1px solid ${accentColor}30`,
                      }}
                    >
                      {slot.ticker}
                    </span>
                  </div>
                  <StrikesSelector
                    nStrikes={nStrikes}
                    accentColor={accentColor}
                    onSetNStrikes={onSetNStrikes}
                  />
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

          {/* ── Net Flow Tab ─────────────────────────────────────────── */}
          {activeTab === "flow" && (
            <>
              <div className="p-4">
                <NetFlowPanel data={data} accentColor={accentColor} />
              </div>
              <FlowMomentumChart symbol={slot.ticker} accentColor={accentColor} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── TickerPanelWithQuery: owns its own react-query fetch ──────────────────────
export interface TickerPanelWithQueryProps {
  slot: Slot;
  accentColor: string;
  nStrikes: number;
  onSetNStrikes: (n: number) => void;
  enabled: boolean;
  onInputChange: (v: string) => void;
  onSelect: (symbol: string) => void;
  onToggleExpiry: (d: string) => void;
  onClearExpiry: () => void;
}

export function TickerPanelWithQuery({
  slot,
  accentColor,
  nStrikes,
  onSetNStrikes,
  enabled,
  onInputChange,
  onSelect,
  onToggleExpiry,
  onClearExpiry,
}: TickerPanelWithQueryProps) {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } =
    useQuery<GexResult>({
      queryKey: ["gex", slot.ticker],
      queryFn: () => fetchGex(slot.ticker),
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
