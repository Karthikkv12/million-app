"use client";
import { X, ChevronDown } from "lucide-react";
import { isToday } from "@/lib/gex";

interface Props {
  expiryDates: string[];
  /** Currently active single-expiry selection (null = all) */
  selectedExpiry: string | null;
  accentColor: string;
  onSelect: (date: string) => void;
  onClear: () => void;
}

export function ExpiryFilter({
  expiryDates,
  selectedExpiry,
  accentColor,
  onSelect,
  onClear,
}: Props) {
  if (expiryDates.length <= 1) return null;

  const todayExp = expiryDates.find(isToday) ?? null;

  return (
    <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center gap-3">
      <span className="text-[9px] text-foreground uppercase tracking-widest font-semibold shrink-0">
        Expiry
      </span>

      <div className="relative flex-1 max-w-[220px]">
        <select
          value={selectedExpiry ?? (todayExp ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") onClear();
            else onSelect(v);
          }}
          className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[11px] font-bold text-foreground pl-3 pr-7 py-1.5 focus:outline-none cursor-pointer"
          style={{ color: selectedExpiry ?? todayExp ? accentColor : undefined }}
        >
          <option value="">All expiries ({expiryDates.length})</option>
          {expiryDates.map((d) => (
            <option key={d} value={d}>
              {isToday(d) ? `⚡ 0DTE · ${d}` : d}
            </option>
          ))}
        </select>
        <ChevronDown
          size={11}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/60 pointer-events-none"
        />
      </div>

      {selectedExpiry && (
        <button
          onClick={onClear}
          className="text-[10px] text-foreground/70 hover:text-foreground transition flex items-center gap-1"
        >
          <X size={10} /> Clear
        </button>
      )}
    </div>
  );
}
