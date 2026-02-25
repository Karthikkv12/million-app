"use client";
import { Shield, Activity } from "lucide-react";

// ── GEX regime interpretation badge ──────────────────────────────────────────
export function GexRegimeBadge({ netGex }: { netGex: number }) {
  const isLong = netGex >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border ${
        isLong
          ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-500 dark:text-emerald-400"
          : "bg-red-500/10 border-red-500/25 text-red-500 dark:text-red-400"
      }`}
    >
      {isLong ? <Shield size={9} /> : <Activity size={9} />}
      {isLong ? "Long γ — mean reversion" : "Short γ — trending"}
    </span>
  );
}

// ── Static key-level label + value display ────────────────────────────────────
export function KeyLevelBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-foreground/70 mb-0.5">
        {label}
      </span>
      <span className={`text-sm font-bold tabular-nums truncate ${color}`}>
        {value}
      </span>
    </div>
  );
}
