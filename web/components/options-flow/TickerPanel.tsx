"use client";
/**
 * TickerPanel — one compact column: search header, key levels, GEX heatmap,
 * and a Details button that opens every secondary section in a drawer.
 * TickerPanelWithQuery — wraps TickerPanel with its own react-query fetch.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PanelRight } from "lucide-react";
import { fetchGex, GexResult } from "@/lib/api";
import { SkeletonStatGrid, ErrorBanner } from "@/components/ui";
import { PanelHeader } from "./PanelHeader";
import { LevelsStrip } from "./LevelsStrip";
import { GexHeatmap } from "./GexHeatmap";
import type { HeatOpts, BoardHandle } from "./GexHeatmap";
import { DetailsDrawer } from "./DetailsDrawer";

// ── Slot type shared across the page ─────────────────────────────────────────
export interface Slot {
  ticker: string;
  input: string;
  /** Kept for compatibility with saved layouts; no longer used by the UI. */
  expiryFilter: string[] | null;
}

export function makeSlot(ticker: string): Slot {
  return { ticker, input: ticker, expiryFilter: null };
}

/** Strike-window sizes (backend sends at most 40 strikes around spot). */
export const STRIKE_OPTIONS = [10, 20, 30, 40] as const;

// ── TickerPanel: presentational ──────────────────────────────────────────────
export interface TickerPanelProps {
  slot: Slot;
  accentColor: string;
  nStrikes: number;
  heatOpts: HeatOpts;
  canRemove: boolean;
  onRemove: () => void;
  onInputChange: (v: string) => void;
  onSelect: (symbol: string) => void;
  data: GexResult | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRefresh: () => void;
  dataUpdatedAt: number;
}

export function TickerPanel({
  slot, accentColor, nStrikes, heatOpts, canRemove, onRemove, onInputChange, onSelect,
  data, isLoading, isError, isFetching, onRefresh, dataUpdatedAt,
}: TickerPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const board = useRef<BoardHandle>(null);
  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const apiError = data?.error;

  return (
    <section
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm"
    >
      <PanelHeader
        inputValue={slot.input}
        accentColor={accentColor}
        isFetching={isFetching}
        lastUpdated={lastUpdated}
        canRemove={canRemove}
        onRemove={onRemove}
        onInputChange={onInputChange}
        onSelect={onSelect}
        onRefresh={onRefresh}
      />

      {isLoading && <div className="p-4"><SkeletonStatGrid count={3} /></div>}
      {(isError || apiError) && (
        <div className="p-4"><ErrorBanner message={apiError || `Failed to load GEX for ${slot.ticker}.`} /></div>
      )}

      {data && !apiError && (
        <>
          <LevelsStrip data={data} />
          <div className="flex items-center gap-1 border-b border-[var(--border)] px-3 py-1.5 text-[11px]">
            <button onClick={() => board.current?.centerOnSpot()} className="rounded-md px-2 py-0.5 text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground">⌖ Spot</button>
            <button onClick={() => board.current?.centerOnKing()} className="rounded-md px-2 py-0.5 text-amber-500 hover:bg-foreground/[0.06]">★ King</button>
          </div>
          <GexHeatmap ref={board} data={data} nStrikes={nStrikes} opts={heatOpts} maxHeight="68vh" />
          <button
            onClick={() => setDetailsOpen(true)}
            className="flex items-center justify-center gap-1.5 border-t border-[var(--border)] px-3 py-2.5 text-[11px] font-bold text-foreground/70 transition hover:bg-[var(--surface-2)] hover:text-foreground"
          >
            <PanelRight size={13} /> Details: levels, premium &amp; net flow
          </button>
          <DetailsDrawer
            open={detailsOpen}
            onClose={() => setDetailsOpen(false)}
            data={data}
            ticker={slot.ticker}
            accentColor={accentColor}
          />
        </>
      )}
    </section>
  );
}

// ── TickerPanelWithQuery: owns its own react-query fetch ──────────────────────
export type TickerPanelWithQueryProps = Omit<
  TickerPanelProps,
  "data" | "isLoading" | "isError" | "isFetching" | "onRefresh" | "dataUpdatedAt"
>;

export function TickerPanelWithQuery(props: TickerPanelWithQueryProps) {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery<GexResult>({
    queryKey: ["gex", props.slot.ticker],
    queryFn: () => fetchGex(props.slot.ticker),
    staleTime: 30_000,
    // Yahoo data is ~15 min delayed, so polling every 10s only burns rate limit
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  return (
    <TickerPanel
      {...props}
      data={data}
      isLoading={isLoading}
      isError={isError}
      isFetching={isFetching}
      onRefresh={refetch}
      dataUpdatedAt={dataUpdatedAt}
    />
  );
}
