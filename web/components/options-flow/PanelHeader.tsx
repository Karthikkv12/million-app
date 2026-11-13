"use client";
/** Column header: ticker search, data source, last update, open the stock page, refresh / remove. Flat (desk style). */
import Link from "next/link";
import { CandlestickChart, RefreshCw, X } from "lucide-react";
import { stockHref } from "@/components/TickerLink";
import TickerSearchInput from "@/components/TickerSearchInput";
import type { GexResult } from "@/lib/api";
import { SourceBadge } from "./SourceBadge";

interface Props {
  inputValue: string;
  accentColor: string;
  isFetching: boolean;
  lastUpdated: string | null;
  canRemove: boolean;
  onRemove: () => void;
  onInputChange: (v: string) => void;
  onSelect: (symbol: string) => void;
  onRefresh: () => void;
  /** Latest result, for the LIVE / DELAYED badge */
  data?: GexResult;
}

export function PanelHeader({
  inputValue, accentColor, isFetching, lastUpdated, canRemove,
  onRemove, onInputChange, onSelect, onRefresh, data,
}: Props) {
  return (
    <div className="relative z-10 flex items-center gap-2 px-4 pb-2 pt-4">
      <TickerSearchInput
        value={inputValue}
        onChange={onInputChange}
        onSelect={onSelect}
        accentColor={accentColor}
        placeholder="Ticker…"
        actionLabel="GO"
        className="min-w-0 flex-1"
      />
      <div className="flex shrink-0 items-center gap-1.5 text-foreground/55">
        <SourceBadge data={data} />
        {lastUpdated && <span className="hidden font-mono text-[10px] tabular-nums xl:inline">{lastUpdated}</span>}
        {data?.symbol && !data.error && (
          <Link href={stockHref(data.symbol)} title={`Open the ${data.symbol} stock page (chart, LEAPS score, catalysts)`}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] transition hover:bg-foreground/[0.06] hover:text-foreground">
            <CandlestickChart size={13} /><span className="hidden sm:inline">Chart</span>
            <span className="sr-only sm:hidden">Open {data.symbol} chart</span>
          </Link>
        )}
        <button onClick={onRefresh} className="rounded p-1 transition hover:bg-foreground/[0.06] hover:text-foreground" title="Refresh">
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
        </button>
        {canRemove && (
          <button onClick={onRemove} className="rounded p-1 transition hover:bg-foreground/[0.06] hover:text-foreground" title="Remove ticker">
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
