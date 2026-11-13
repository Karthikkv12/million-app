"use client";
/**
 * TickerPanel — one compact column: search header, key levels, GEX and/or VEX heatmap,
 * and a Details button that opens every secondary section in a drawer.
 * TickerPanelWithQuery — wraps TickerPanel with its own react-query fetch.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, PanelRight, Ruler } from "lucide-react";
import { fetchGex, GexResult } from "@/lib/api";
import { useGexStream } from "@/lib/useGexStream";
import { SkeletonStatGrid, ErrorBanner } from "@/components/ui";
import { PanelHeader } from "./PanelHeader";
import { LevelsStrip } from "./LevelsStrip";
import { GexHeatmap } from "./GexHeatmap";
import type { HeatOpts, BoardHandle, Metric } from "./GexHeatmap";
import { DetailsDrawer } from "./DetailsDrawer";
import { ExpiryPicker } from "./ExpiryPicker";
import { DealerLadder, TradeIdeas } from "./DealerLadder";
import { LeapsLine } from "@/components/insight/LeapsScore";
import { sourceName } from "./SourceBadge";
import { FlowTheory } from "./FlowTheory";

// ── Slot type shared across the page ─────────────────────────────────────────
export interface Slot {
  ticker: string;
  input: string;
  /** Expiry columns this table shows (≤ 6, from the dropdown); null = the nearest 6. Saved with the layout. */
  expiryFilter: string[] | null;
  /** Which exposure this ticker's table shows (tab above the table). */
  metric: Metric;
}

export function makeSlot(ticker: string, metric?: unknown, expiries?: unknown): Slot {
  const exp = Array.isArray(expiries) ? expiries.filter((e): e is string => typeof e === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e)).slice(0, 6) : [];
  return { ticker, input: ticker, expiryFilter: exp.length ? exp : null, metric: metric === "vex" ? "vex" : "gex" };
}

/** Strike-window sizes around spot; 0 = every strike the server sent. The board also grows past
 *  the window to reach each of your positions. */
export const STRIKE_OPTIONS = [10, 20, 30, 40, 0] as const;
export const strikeLabel = (n: number) => (n > 0 ? String(n) : "All");

// ── TickerPanel: presentational ──────────────────────────────────────────────
export interface TickerPanelProps {
  slot: Slot;
  accentColor: string;
  nStrikes: number;
  heatOpts: HeatOpts;
  /** Columns on the board (1–3): alone, the dealer ladder sits beside the heatmap on wide screens. */
  columns?: number;
  canRemove: boolean;
  onRemove: () => void;
  onInputChange: (v: string) => void;
  onSelect: (symbol: string) => void;
  onMetricChange: (metric: Metric) => void;
  /** New expiry choice for this table (null = back to the nearest 6). */
  onExpiriesChange?: (expiries: string[] | null) => void;
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
  slot, accentColor, nStrikes, heatOpts, columns = 1, canRemove, onRemove, onInputChange, onSelect, onMetricChange, onExpiriesChange,
  data, isLoading, isError, errorText, isFetching, onRefresh, dataUpdatedAt,
}: TickerPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ladderOpen, setLadderOpen] = useState(true);
  const beside = columns === 1;        // room for the ladder next to the heatmap (xl and up)
  const compact = columns > 1;         // narrow column: icon-only toolbar buttons
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
    <section className="flex min-w-0 flex-col">
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
            <p role="status" className="flex items-center gap-1.5 px-4 py-1 text-[11px] text-warn">
              <Clock size={12} className="shrink-0 text-warn" /> {staleNote}
            </p>
          )}
          <LevelsStrip data={data} metric={metric} />
          {/* Wraps instead of spilling into the next column; with 2–3 columns the Expiries / Ladder / Details labels
              collapse to icons (names stay as tooltips and screen-reader text). */}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 border-y border-[var(--border)] px-4 py-1.5 text-[11px]">
            <div role="tablist" aria-label="Exposure" className={`inline-flex gap-3 ${compact ? "mr-1" : "mr-3"}`}>
              {(["gex", "vex"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={metric === m}
                  onClick={() => onMetricChange(m)}
                  title={m === "gex" ? "Gamma exposure, $ per 1% move" : "Vanna exposure, $ per 1 vol point"}
                  className={`-mb-[7px] border-b-2 pb-[5px] pt-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] transition ${
                    metric === m ? "border-foreground text-foreground" : "border-transparent text-foreground/45 hover:text-foreground"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <button onClick={() => board.current?.centerOnSpot()} className="rounded-md px-2 py-0.5 text-foreground/65 hover:bg-foreground/[0.06] hover:text-foreground">⌖ Spot</button>
            <button onClick={() => board.current?.centerOnKing()} className="rounded-md px-2 py-0.5 text-amber-500 hover:bg-foreground/[0.06]">★ King</button>
            <span className="ml-auto" />
            <ExpiryPicker available={data.heatmap_expiries ?? []} chosen={slot.expiryFilter}
              onChange={(next) => onExpiriesChange?.(next)} compact={compact} />
            <FlowTheory data={data} compact={compact} />
            <button onClick={() => setLadderOpen((o) => !o)} aria-pressed={ladderOpen} title="Dealer ladder with buy/sell call and put ideas" aria-label="Ladder"
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono uppercase tracking-[0.12em] hover:bg-foreground/[0.06] hover:text-foreground ${ladderOpen ? "text-foreground" : "text-foreground/60"}`}>
              <Ruler size={12} />{!compact && " Ladder"}
            </button>
            <button
              onClick={() => setDetailsOpen(true)} title="Details: flow by expiry and strike" aria-label="Details"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono uppercase tracking-[0.12em] text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <PanelRight size={12} />{!compact && " Details"}
            </button>
          </div>
          {/* Alone on a wide screen the ladder and ideas sit beside the heatmap; otherwise the ladder
              goes above it and the ideas below, so the board stays near the top. */}
          <div className={ladderOpen && beside ? "xl:grid xl:grid-cols-[minmax(0,1fr)_380px]" : undefined}>
            {ladderOpen && (
              <aside className={beside ? "border-b border-[var(--border)] sm:grid sm:grid-cols-2 xl:order-2 xl:block xl:border-b-0 xl:border-l" : "border-b border-[var(--border)]"}>
                <DealerLadder data={data} height={beside ? 250 : 215} />
                {beside && <TradeIdeas data={data} className="xl:border-t xl:border-[var(--border)]" />}
              </aside>
            )}
            <div className="min-w-0">
              <LeapsLine symbol={slot.ticker} className="border-b border-[var(--border)] px-4 py-1.5" />
              <GexHeatmap ref={board} data={data} metric={metric} nStrikes={nStrikes} opts={heatOpts} maxHeight="68vh" expiries={slot.expiryFilter ?? undefined} />
              {ladderOpen && !beside && <TradeIdeas data={data} className="border-t border-[var(--border)]" />}
            </div>
          </div>
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
    refetchInterval: live ? false : 30_000,
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
