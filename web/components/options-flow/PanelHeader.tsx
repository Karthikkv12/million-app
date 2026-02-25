"use client";
import { RefreshCw } from "lucide-react";
import TickerSearchInput from "@/components/TickerSearchInput";

interface Props {
  /** Current text value in the search box */
  inputValue: string;
  accentColor: string;
  dataSource?: string;
  isFetching: boolean;
  lastUpdated: string | null;
  onInputChange: (v: string) => void;
  onSelect: (symbol: string) => void;
  onRefresh: () => void;
}

export function PanelHeader({
  inputValue,
  accentColor,
  dataSource,
  isFetching,
  lastUpdated,
  onInputChange,
  onSelect,
  onRefresh,
}: Props) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)] overflow-visible relative z-10">
      <TickerSearchInput
        value={inputValue}
        onChange={onInputChange}
        onSelect={onSelect}
        accentColor={accentColor}
        placeholder="Ticker or company…"
        actionLabel="LOAD"
        className="flex-1 max-w-[280px]"
      />

      {/* Live status */}
      <div className="flex items-center gap-2 ml-auto">
        {dataSource && (
          <span
            className={`text-[9px] font-black px-2.5 py-1 rounded-full border tracking-wide ${
              dataSource === "tradier"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-amber-500/10 border-amber-500/30 text-amber-400"
            }`}
          >
            {dataSource === "tradier" ? "● LIVE" : "◌ 15min delay"}
          </span>
        )}

        <div className="flex items-center gap-1.5 text-foreground/70">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isFetching
                ? "bg-amber-400 animate-pulse"
                : "bg-emerald-500 animate-pulse"
            }`}
          />
          {lastUpdated && (
            <span className="text-[9px] font-mono tabular-nums hidden sm:block opacity-60">
              {lastUpdated}
            </span>
          )}
          <button
            onClick={onRefresh}
            className="hover:text-foreground transition p-1 rounded-md hover:bg-[var(--border)]"
            title="Refresh"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
    </div>
  );
}
