"use client";
import { RefreshCw, X } from "lucide-react";
import TickerSearchInput from "@/components/TickerSearchInput";
import type { GexResult } from "@/lib/api";
import { SourceBadge } from "./SourceBadge";

interface Props {
  /** Current text value in the search box */
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
    <div className="relative z-10 flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
      <TickerSearchInput
        value={inputValue}
        onChange={onInputChange}
        onSelect={onSelect}
        accentColor={accentColor}
        placeholder="Ticker…"
        actionLabel="GO"
        className="min-w-0 flex-1"
      />
      <div className="flex shrink-0 items-center gap-1 text-foreground/55">
        <SourceBadge data={data} />
        {isFetching && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/40" title="Refreshing" />}
        {lastUpdated && <span className="hidden font-mono text-[9px] tabular-nums sm:inline">{lastUpdated}</span>}
        <button onClick={onRefresh} className="rounded-md p-1 transition hover:bg-[var(--surface-2)] hover:text-foreground" title="Refresh">
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
        </button>
        {canRemove && (
          <button onClick={onRemove} className="rounded-md p-1 transition hover:bg-[var(--surface-2)] hover:text-foreground" title="Remove ticker">
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
