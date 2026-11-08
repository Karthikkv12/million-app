"use client";
/**
 * TickerPanel — one compact column: search header, key levels, GEX and/or VEX heatmap,
 * and a Details button that opens every secondary section in a drawer.
 * TickerPanelWithQuery — wraps TickerPanel with its own react-query fetch.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, PanelRight } from "lucide-react";
import { fetchGex, GexResult } from "@/lib/api";
import { useGexStream } from "@/lib/useGexStream";
import { SkeletonStatGrid, ErrorBanner } from "@/components/ui";
import { PanelHeader } from "./PanelHeader";
import { LevelsStrip } from "./LevelsStrip";
import { GexHeatmap, fmtMoney } from "./GexHeatmap";
import type { HeatOpts, BoardHandle, Metric } from "./GexHeatmap";
import { DetailsDrawer } from "./DetailsDrawer";
import { sourceName } from "./SourceBadge";

// ── Slot type shared across the page ─────────────────────────────────────────
export interface Slot {
  ticker: string;
  input: string;
  /** Kept for compatibility with saved layouts; no longer used by the UI. */
  expiryFilter: string[] | null;
  /** Which exposure this ticker's table shows (tab above the table). */
  metric: Metric;
}

export function makeSlot(ticker: string, metric?: unknown): Slot {
  return { ticker, input: ticker, expiryFilter: null, metric: metric === "vex" ? "vex" : "gex" };
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
  onMetricChange: (metric: Metric) => void;
  data: GexResult | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Message from the failed request (e.g. the backend's 503 text), shown when there's no data. */
  errorText?: string;
  isFetching: boolean;
  onRefresh: () => void;
  dataUpdatedAt: number;
}

export function TickerPanel({
  slot, accentColor, nStrikes, heatOpts, canRemove, onRemove, onInputChange, onSelect, onMetricChange,
  data, isLoading, isError, errorText, isFetching, onRefresh, dataUpdatedAt,
}: TickerPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const board = useRef<BoardHandle>(null);
  const metric = slot.metric ?? "gex";
  // Prefer the time the backend computed the result; fall back to when we received it.
  const asOf = data?.as_of ? new Date(data.as_of).getTime() : dataUpdatedAt;
  const lastUpdated = asOf
    ? new Date(asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const apiError = data?.error;
  const shownAt = asOf ? new Date(asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  // Keep showing the last good data with a quiet note instead of a red error box.
  const staleNote = !data || apiError ? null
    : data.stale ? `${sourceName(data)} is rate-limiting; showing data from ${shownAt ?? "earlier"}.`
    : isError ? `Couldn't refresh; showing data from ${shownAt ?? "earlier"}.`
    : null;

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
        data={data}
      />

      {isLoading && <div className="p-4"><SkeletonStatGrid count={3} /></div>}
      {((isError && !data) || apiError) && (
        <div className="p-4"><ErrorBanner message={apiError || errorText || `Failed to load GEX for ${slot.ticker}.`} /></div>
      )}

      {data && !apiError && (
        <>
          {staleNote && (
            <p role="status" className="flex items-center gap-1.5 border-b border-[var(--border)] bg-amber-500/[0.06] px-3 py-1.5 text-[11px] text-foreground/70">
              <Clock size={12} className="shrink-0 text-amber-500" /> {staleNote}
            </p>
          )}
          <LevelsStrip data={data} />
          <div className="flex items-center gap-1 border-b border-[var(--border)] px-3 py-1.5 text-[11px]">
            <div role="tablist" aria-label="Exposure" className="mr-2 inline-flex rounded-md border border-[var(--border)] p-0.5">
              {(["gex", "vex"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={metric === m}
                  onClick={() => onMetricChange(m)}
                  title={m === "gex" ? "Gamma exposure, $ per 1% move" : "Vanna exposure, $ per 1 vol point"}
                  className={`rounded px-2.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] transition ${
                    metric === m ? "bg-foreground text-[var(--background)]" : "text-foreground/60 hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <button onClick={() => board.current?.centerOnSpot()} className="rounded-md px-2 py-0.5 text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground">⌖ Spot</button>
            <button onClick={() => board.current?.centerOnKing()} className="rounded-md px-2 py-0.5 text-amber-500 hover:bg-foreground/[0.06]">★ King</button>
            {metric === "vex" && data.net_vex != null && (
              <span className="ml-auto font-mono text-foreground/55" title="Net vanna exposure: $ change in dealer delta per 1 vol-point move in IV">
                Net VEX <span className={data.net_vex >= 0 ? "text-gain" : "text-violet-400"}>{fmtMoney(data.net_vex)}</span>
              </span>
            )}
          </div>
          <GexHeatmap ref={board} data={data} metric={metric} nStrikes={nStrikes} opts={heatOpts} maxHeight="68vh" />
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
  "data" | "isLoading" | "isError" | "errorText" | "isFetching" | "onRefresh" | "dataUpdatedAt"
>;

export function TickerPanelWithQuery(props: TickerPanelWithQueryProps) {
  // Live updates over SSE; while the stream is down, poll slowly instead.
  const live = useGexStream(props.slot.ticker || undefined);
  const { data, isLoading, isError, error, isFetching, refetch, dataUpdatedAt } = useQuery<GexResult>({
    queryKey: ["gex", props.slot.ticker],
    queryFn: () => fetchGex(props.slot.ticker),
    staleTime: 60_000,
    // Yahoo data is ~15 min delayed; the stream pushes changes, polling is only a fallback.
    refetchInterval: live ? false : 120_000,
    refetchIntervalInBackground: false,
  });

  return (
    <TickerPanel
      {...props}
      data={data}
      isLoading={isLoading}
      isError={isError}
      errorText={error instanceof Error ? error.message : undefined}
      isFetching={isFetching}
      onRefresh={refetch}
      dataUpdatedAt={dataUpdatedAt}
    />
  );
}
