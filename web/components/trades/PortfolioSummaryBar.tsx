"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPortfolioSummary, fetchWeeks, getOrCreateWeek, WeeklySnapshot } from "@/lib/api";
import { DollarSign, TrendingUp, Activity, AlertCircle, ChevronDown, Plus } from "lucide-react";
import { fmt$, weekLabel } from "./TradesHelpers";

export function PortfolioSummaryBar() {
  const { data: summary } = useQuery({
    queryKey: ["portfolioSummary"],
    queryFn: fetchPortfolioSummary,
    staleTime: 60_000,
  });
  if (!summary) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <DollarSign size={11} className="text-green-500" />
          <p className="text-[9px] font-semibold text-foreground/60 uppercase tracking-wide">Total Premium</p>
        </div>
        <p className="text-base font-black text-green-500">${summary.total_premium_collected.toFixed(2)}</p>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <TrendingUp size={11} className="text-blue-500" />
          <p className="text-[9px] font-semibold text-foreground/60 uppercase tracking-wide">Realized P/L</p>
        </div>
        <p className={`text-base font-black ${summary.realized_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
          {fmt$(summary.realized_pnl)}
        </p>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Activity size={11} className="text-blue-400" />
          <p className="text-[9px] font-semibold text-foreground/60 uppercase tracking-wide">Active Positions</p>
        </div>
        <p className="text-base font-black text-blue-500">{summary.active_positions}</p>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <AlertCircle size={11} className="text-orange-400" />
          <p className="text-[9px] font-semibold text-foreground/60 uppercase tracking-wide">
            Est. Tax ({(summary.cap_gains_tax_rate * 100).toFixed(0)}%)
          </p>
        </div>
        <p className="text-base font-black text-orange-400">${summary.estimated_tax.toFixed(2)}</p>
      </div>
    </div>
  );
}

export function WeekSelector({
  weeks,
  selectedId,
  onSelect,
  onNewWeek,
}: {
  weeks: WeeklySnapshot[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNewWeek: () => void;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);

  // Drop future blank weeks (no account_value), but always keep the selected + most-recent
  const mostRecentId = weeks[0]?.id;
  const filtered = weeks.filter((w) => {
    if (w.id === selectedId || w.id === mostRecentId) return true;
    if (w.week_end.slice(0, 10) > todayStr && !w.account_value) return false;
    return true;
  });

  // Group by year, sort years descending
  const byYear = new Map<string, WeeklySnapshot[]>();
  for (const w of filtered) {
    const yr = w.week_end.slice(0, 4);
    if (!byYear.has(yr)) byYear.set(yr, []);
    byYear.get(yr)!.push(w);
  }
  const years = [...byYear.keys()].sort((a, b) => b.localeCompare(a));

  // Default the active year to whichever year the selected week belongs to
  const selectedYear = selectedId
    ? (filtered.find((w) => w.id === selectedId)?.week_end.slice(0, 4) ?? years[0])
    : years[0];
  const [activeYear, setActiveYear] = useState<string>(selectedYear);

  // If the selected week isn't in the active year, snap the year
  const effectiveYear = byYear.has(activeYear) ? activeYear : years[0];
  const weeksForYear = byYear.get(effectiveYear) ?? [];

  return (
    <div className="flex items-center gap-2">
      {/* ── Year dropdown ── */}
      <div className="relative">
        <select
          value={effectiveYear}
          onChange={(e) => setActiveYear(e.target.value)}
          className="appearance-none border border-[var(--border)] rounded-xl px-3 py-2 pr-7 text-sm bg-[var(--surface)] text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
        >
          {years.map((yr) => (
            <option key={yr} value={yr}>{yr}</option>
          ))}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/50 pointer-events-none" />
      </div>

      {/* ── Week dropdown — scoped to selected year ── */}
      <div className="relative">
        <select
          value={selectedId ?? ""}
          onChange={(e) => onSelect(Number(e.target.value))}
          className="appearance-none border border-[var(--border)] rounded-xl px-3 py-2 pr-7 text-sm bg-[var(--surface)] text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold w-[320px]"
        >
          <option value="" disabled>Select week…</option>
          {weeksForYear.map((w) => (
            <option key={w.id} value={w.id}>
              {weekLabel(w)}{w.is_complete ? " ✓" : ""}
            </option>
          ))}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/50 pointer-events-none" />
      </div>

      {/* ── New Week button ── */}
      <button
        onClick={onNewWeek}
        className="flex items-center gap-1 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-foreground hover:bg-[var(--surface-2)] transition"
      >
        <Plus size={11} /> New Week
      </button>
    </div>
  );
}
