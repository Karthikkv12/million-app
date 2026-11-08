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
  /** With both boards on, put them side by side (only one ticker on screen) instead of stacked. */
  sideBySide?: boolean;
  canRemove: boolean;
  onRemove: () => void;
  onInputChange: (v: string) => void;
  onSelect: (symbol: string) => void;
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
  slot, accentColor, nStrikes, heatOpts, sideBySide = false, canRemove, onRemove, onInputChange, onSelect,
  data, isLoading, isError, errorText, isFetching, onRefresh, dataUpdatedAt,
}: TickerPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const gexBoard = useRef<BoardHandle>(null);
  const vexBoard = useRef<BoardHandle>(null);
  const boardView = heatOpts.board ?? "gex";
  const metrics: Metric[] = boardView === "both" ? ["gex", "vex"] : [boardView];
  const both = metrics.length === 2;
  const boards = () => [gexBoard.current, vexBoard.current];
  // Prefer the time the backend computed the result; fall back to when we received it.
  const asOf = data?.as_of ? new Date(data.as_of).getTime() : dataUpdatedAt;
  const lastUpdated = asOf
    ? new Date(asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const apiError = data?.error;
  const shownAt = asOf ? new Date(asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  // Keep showing the last good data with a quiet note instead of a red error box.
  const staleNote = !data || apiError ? null
    : data.stale ? `Yahoo is rate-limiting; showing data from ${shownAt ?? "earlier"}.`
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
            <button onClick={() => boards().forEach((b) => b?.centerOnSpot())} className="rounded-md px-2 py-0.5 text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground">⌖ Spot</button>
            <button onClick={() => boards().forEach((b) => b?.centerOnKing())} className="rounded-md px-2 py-0.5 text-amber-500 hover:bg-foreground/[0.06]">★ King</button>
            {metrics.includes("vex") && data.net_vex != null && (
              <span className="ml-auto font-mono text-foreground/55" title="Net vanna exposure: $ change in dealer delta per 1 vol-point move in IV">
                Net VEX <span className={data.net_vex >= 0 ? "text-gain" : "text-violet-400"}>{fmtMoney(data.net_vex)}</span>
              </span>
            )}
          </div>
          <div className={both && sideBySide ? "grid grid-cols-1 xl:grid-cols-2 xl:divide-x xl:divide-[var(--border)]" : "flex flex-col"}>
            {metrics.map((m, i) => (
              <div key={m} className={both && i > 0 && !sideBySide ? "border-t border-[var(--border)]" : both && i > 0 ? "border-t border-[var(--border)] xl:border-t-0" : ""}>
                {both && (
                  <p className="border-b border-[var(--border)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/55">
                    {m === "gex" ? "GEX · gamma, $ per 1% move" : "VEX · vanna, $ per 1 vol pt"}
                  </p>
                )}
                <GexHeatmap
                  ref={m === "gex" ? gexBoard : vexBoard}
                  data={data}
                  metric={m}
                  nStrikes={nStrikes}
                  opts={heatOpts}
                  maxHeight={both && !sideBySide ? "44vh" : "68vh"}
                />
              </div>
            ))}
          </div>
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
