"use client";
import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPortfolioSummary, fetchPremiumDashboard, fetchHoldings, fetchAllPositions,
  getOrCreateWeek, WeekBreakdown, OptionPosition,
} from "@/lib/api";
import { EmptyState, SkeletonCard } from "@/components/ui";
import { TrendingUp, TrendingDown, BarChart2, Calendar } from "lucide-react";
import { fmt$ } from "./TradesHelpers";

/** Next Friday on or after today (returns YYYY-MM-DD) */
function nextFridayStr(): string {
  const d = new Date(); d.setHours(0,0,0,0);
  const diff = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

type MonthEntry = [string, number] | null;
type CumEntry = { label: string; cumulative: number; weekly: number; iso: string };
type PremRange = "1M" | "3M" | "6M" | "1Y" | "5Y" | "MAX";
const PREM_RANGES: PremRange[] = ["1M", "3M", "6M", "1Y", "5Y", "MAX"];

export function YearTab() {
  const qc = useQueryClient();
  const { data: s, isLoading: summaryLoading } = useQuery({
    queryKey: ["portfolioSummary"],
    queryFn: fetchPortfolioSummary,
    staleTime: 0,
  });
  const { data: premDash, isLoading: premLoading } = useQuery({
    queryKey: ["premiumDashboard"],
    queryFn: fetchPremiumDashboard,
    staleTime: 0,
  });
  const { data: holdings = [] } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
    staleTime: 0,
  });
  const { data: allPositions = [] } = useQuery({
    queryKey: ["allPositions"],
    queryFn: fetchAllPositions,
    staleTime: 0,
  });

  // ── Range toggle state for Premium Accumulation chart ──────────────────
  // Must be declared before any early returns (Rules of Hooks)
  const [premRange, setPremRange] = useState<PremRange>("1Y");

  // Auto-create the upcoming Friday's week on every mount
  const ensureWeekMut = useMutation({
    mutationFn: () => getOrCreateWeek(nextFridayStr()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolioSummary"] }),
  });
  useEffect(() => { ensureWeekMut.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isLoading = summaryLoading || premLoading;
  if (isLoading) return <div className="space-y-3">{[1, 2, 3, 4].map((i) => <SkeletonCard key={i} rows={2} />)}</div>;
  if (!s) return <EmptyState icon={BarChart2} title="No data yet" body="Complete a week to see your performance summary." />;

  const weeksBreakdown    = (s.weeks_breakdown ?? []) as WeekBreakdown[];
  const monthlyPremium    = (s.monthly_premium ?? {}) as Record<string, number>;

  // A week counts as "effective complete" if it is explicitly closed,
  // OR its week_end is in the past/today and it has data,
  // OR it has positions (active current week still counts for consistency).
  // This prevents the Performance tab from going blank when the user hasn't used the "Close Week" button.
  const todayStr = new Date().toISOString().slice(0, 10);
  const isEffectivelyComplete = (w: WeekBreakdown) =>
    w.is_complete ||
    (w.week_end.slice(0, 10) <= todayStr && (w.premium > 0 || w.position_count > 0));

  const effectiveCompleteWeeks = weeksBreakdown.filter(isEffectivelyComplete);
  const completeWeeks     = effectiveCompleteWeeks.length > 0 ? effectiveCompleteWeeks.length : (s.complete_weeks ?? 0);
  const winningWeeks      = effectiveCompleteWeeks.filter((w) => w.premium > 0).length;
  const winRate           = completeWeeks > 0 ? Math.round((winningWeeks / completeWeeks) * 100) : (s.win_rate ?? 0);

  // All completed weeks (including zero/negative) — needed for accurate consistency score
  const completedPremiums = [...weeksBreakdown].filter(isEffectivelyComplete).map((w) => w.premium);
  const weeklyMean        = completedPremiums.length > 0 ? completedPremiums.reduce((a, b) => a + b, 0) / completedPremiums.length : 0;
  const weeklyStdDev      = completedPremiums.length > 1
    ? Math.sqrt(completedPremiums.reduce((a, b) => a + Math.pow(b - weeklyMean, 2), 0) / completedPremiums.length)
    : 0;
  const consistencyScore  = weeklyMean > 0 ? Math.max(0, Math.min(100, 100 - (weeklyStdDev / weeklyMean) * 100)) : 0;

  const completedWeeks    = weeksBreakdown.filter(isEffectivelyComplete);
  const streakBreak       = completedWeeks.findIndex((w) => w.premium <= 0);
  const currentStreak     = streakBreak === -1 ? completedWeeks.length : streakBreak;

  const avgPositionsPerWeek = completeWeeks > 0
    ? weeksBreakdown.filter(isEffectivelyComplete).reduce((a, w) => a + w.position_count, 0) / completeWeeks
    : 0;

  const monthlyEntries2 = Object.entries(monthlyPremium).sort((a, b) => a[0].localeCompare(b[0]));
  const bestMonth  = monthlyEntries2.reduce((best, cur) => !best || cur[1] > best[1] ? cur : best, null as MonthEntry);
  const worstMonth = monthlyEntries2.filter((e) => e[1] > 0).reduce((worst, cur) => !worst || cur[1] < worst[1] ? cur : worst, null as MonthEntry);

  const realizedPrem      = premDash?.grand_total.realized_premium   ?? 0;
  const inFlightPrem      = premDash?.grand_total.unrealized_premium  ?? 0;
  const totalPremForSplit = realizedPrem + inFlightPrem;
  const realizedPct       = totalPremForSplit > 0 ? (realizedPrem / totalPremForSplit) * 100 : 0;

  const monthNames: Record<string, string> = {
    "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
    "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
  };

  const currentYear = new Date().getFullYear();

  // Build a lookup: week_end ISO → premium (all-time, across all years)
  const weekByDate: Record<string, number> = {};
  for (const w of weeksBreakdown) {
    weekByDate[w.week_end] = (weekByDate[w.week_end] ?? 0) + w.premium;
  }

  // All-time sorted Friday list from earliest week_end to last Friday of current year
  const allTimeFridays: CumEntry[] = (() => {
    if (weeksBreakdown.length === 0) return [];
    // Find the earliest Friday we have data for
    const sortedISOs = Object.keys(weekByDate).sort();
    const firstISO = sortedISOs[0];
    const start = new Date(firstISO + "T00:00:00");

    // Find last Friday of current year
    const dec31 = new Date(currentYear, 11, 31);
    const dec31dow = dec31.getDay();
    const lastFriday = new Date(dec31);
    lastFriday.setDate(dec31.getDate() - ((dec31dow + 2) % 7)); // roll back to Friday

    const entries: CumEntry[] = [];
    let cumulative = 0;
    const cur = new Date(start);
    // Snap cur to the Friday of its week
    const dow = cur.getDay();
    if (dow !== 5) cur.setDate(cur.getDate() + ((5 - dow + 7) % 7));
    while (cur <= lastFriday) {
      const iso = cur.toISOString().slice(0, 10);
      const label = cur.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const weekly = weekByDate[iso] ?? 0;
      cumulative += weekly;
      entries.push({ label, cumulative, weekly, iso });
      cur.setDate(cur.getDate() + 7);
    }
    return entries;
  })();

  // Compute cutoff date based on selected range
  const premCutoff = (() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (premRange === "MAX") return null;
    const months = premRange === "1M" ? 1 : premRange === "3M" ? 3 : premRange === "6M" ? 6 : premRange === "1Y" ? 12 : 60;
    const cut = new Date(now);
    cut.setMonth(cut.getMonth() - months);
    return cut;
  })();

  // Slice to range, trim leading zeros, rebuild cumulative from 0
  // Keep ALL weeks in range (including future) for the bar scaffold,
  // but track which index is the last past/present week for the line.
  const { cumulativeData, lineEndIdx } = (() => {
    const inRange = premCutoff
      ? allTimeFridays.filter((e) => new Date(e.iso + "T00:00:00") >= premCutoff!)
      : allTimeFridays;
    const firstDataIdx = inRange.findIndex((d) => d.weekly > 0);
    const trimmed = firstDataIdx >= 0 ? inRange.slice(firstDataIdx) : inRange;
    let running = 0;
    const data = trimmed.map((d) => { running += d.weekly; return { ...d, cumulative: running }; });
    // Last index where the date is <= today (line stops here, future weeks are scaffold only)
    const todayMs = new Date().setHours(0, 0, 0, 0);
    let lastPast = data.length - 1;
    for (let i = data.length - 1; i >= 0; i--) {
      if (new Date(data[i].iso + "T00:00:00").getTime() <= todayMs) { lastPast = i; break; }
    }
    return { cumulativeData: data, lineEndIdx: lastPast };
  })();

  const chronoWeeks = [...weeksBreakdown].reverse();

  const activePremWeeks  = chronoWeeks.filter((w) => w.premium > 0 && isEffectivelyComplete(w));
  const avgWeeklyPremium = activePremWeeks.length > 0
    ? activePremWeeks.reduce((acc, w) => acc + w.premium, 0) / activePremWeeks.length
    : 0;
  const annualProjection  = avgWeeklyPremium * 52;
  const monthlyProjection = avgWeeklyPremium * 4.33;

  const holdingProjections = holdings
    .filter((h) => h.status === "ACTIVE" && h.shares > 0)
    .map((h) => {
      const weeklyRate    = avgWeeklyPremium > 0
        ? (premDash?.by_symbol.find((r) => r.symbol === h.symbol)?.total_premium_sold ?? 0) / Math.max(1, activePremWeeks.length)
        : 0;
      const weeksToZero   = weeklyRate > 0 ? Math.ceil(Math.max(0, (h.live_adj_basis ?? h.cost_basis) * h.shares) / weeklyRate) : null;
      const pctReduced    = h.cost_basis > 0 ? ((h.cost_basis - (h.live_adj_basis ?? h.cost_basis)) / h.cost_basis) * 100 : 0;
      return {
        symbol: h.symbol, cost_basis: h.cost_basis, live_adj: h.live_adj_basis ?? h.cost_basis,
        pctReduced, weeksToZero, shares: h.shares,
        premiumSold: premDash?.by_symbol.find((r) => r.symbol === h.symbol)?.total_premium_sold ?? 0,
      };
    })
    .sort((a, b) => b.premiumSold - a.premiumSold);

  // ── Per-week net realized (buy-backs) computed from allPositions ──────────
  const weekNetRealizedMap = useMemo(() => {
    const map = new Map<number, { grossCollected: number; costToClose: number }>();
    for (const p of allPositions) {
      if (p.carried_from_id != null) continue; // skip carried duplicates
      const CLOSED_STATUSES = ["CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"];
      if (!CLOSED_STATUSES.includes(p.status)) continue;
      const entry = map.get(p.week_id) ?? { grossCollected: 0, costToClose: 0 };
      entry.grossCollected += (p.premium_in ?? 0) * p.contracts * 100;
      entry.costToClose    += Math.abs(p.premium_out ?? 0) * p.contracts * 100;
      map.set(p.week_id, entry);
    }
    return map;
  }, [allPositions]);

  const monthlyEntries    = Object.entries(monthlyPremium).sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  const maxWeekly         = Math.max(...cumulativeData.map((d) => d.weekly), 1);

  // Per-month average: use actual monthly data if available, else derive from weekly avg
  const activeMonthlyValues = monthlyEntries.filter(([, v]) => v > 0).map(([, v]) => v);
  const avgMonthlyPremium   = activeMonthlyValues.length > 0
    ? activeMonthlyValues.reduce((a, b) => a + b, 0) / activeMonthlyValues.length
    : monthlyProjection;

  // Monthly chart: current month + remaining months of the year, with projected values for future months
  const nowForChart  = new Date();
  const currentYM    = `${nowForChart.getFullYear()}-${String(nowForChart.getMonth() + 1).padStart(2, "0")}`;
  const monthlyEntriesForward: [string, number, boolean][] = Array.from({ length: 12 - nowForChart.getMonth() }, (_, i) => {
    const d   = new Date(nowForChart.getFullYear(), nowForChart.getMonth() + i, 1);
    const ym  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const actual   = monthlyPremium[ym] ?? 0;
    const isFuture = ym > currentYM;
    // future months: show avg projection as a faint placeholder bar
    return [ym, isFuture ? avgMonthlyPremium : actual, isFuture] as [string, number, boolean];
  });
  const maxMonthlyPremium = Math.max(...monthlyEntriesForward.map(([, v]) => v), 1);

  const totalCostBasis     = holdings.reduce((acc, h) => acc + h.cost_basis * h.shares, 0);
  const premiumEfficiency  = totalCostBasis > 0 ? ((premDash?.grand_total.total_premium_sold ?? 0) / totalCostBasis) * 100 : 0;
  const totalPremCollected = premDash?.grand_total.total_premium_sold ?? s.total_premium_collected;
  const weeksToFullCover   = avgWeeklyPremium > 0 ? Math.ceil(totalCostBasis / avgWeeklyPremium) : null;

  // ── Expiry-bucketed premium table ──────────────────────────────────────────
  interface ExpiryBucket {
    expiry: string;           // "YYYY-MM-DD"
    positions: OptionPosition[];
    totalPremium: number;
    dte: number;              // days to expiry (negative = past)
    isSettled: boolean;
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Build week_id → week_end lookup from weeks_breakdown
  const weekEndByWeekId = new Map<number, string>(
    weeksBreakdown.map((w) => [w.id, w.week_end])
  );

  const expiryBucketMap = new Map<string, OptionPosition[]>();
  for (const pos of allPositions) {
    if (!pos.expiry_date) continue;
    // Exclude carried-forward copies — these are duplicates of the original position
    // created when a position carries into a new week. The premium was only collected
    // once (on the original), so counting carried copies would double-count it.
    if (pos.carried_from_id != null) continue;
    // CLOSED positions (bought back early) → bucket by the week they were closed in,
    // not by expiry date (their expiry date may be a future week they never reached).
    // All other statuses → bucket by expiry_date as normal.
    let key: string;
    if (pos.status === "CLOSED") {
      key = weekEndByWeekId.get(pos.week_id) ?? pos.expiry_date.slice(0, 10);
    } else {
      key = pos.expiry_date.slice(0, 10);
    }
    if (!expiryBucketMap.has(key)) expiryBucketMap.set(key, []);
    expiryBucketMap.get(key)!.push(pos);
  }
  const expiryBuckets: ExpiryBucket[] = Array.from(expiryBucketMap.entries())
    .map(([expiry, positions]) => {
      // Parse as local midnight by appending T00:00:00 to the guaranteed YYYY-MM-DD key
      const expiryDate = new Date(expiry + "T00:00:00");
      const dte = isNaN(expiryDate.getTime())
        ? 0
        : Math.round((expiryDate.getTime() - today.getTime()) / 86_400_000);
      // Sum net premium for each position (can be negative for loss buybacks)
      const totalPremium = positions.reduce((sum, p) => sum + (p.total_premium ?? 0), 0);
      return { expiry, positions, totalPremium, dte, isSettled: dte < 0 };
    })
    .sort((a, b) => a.expiry.localeCompare(b.expiry));

  return (
    <div className="space-y-3 sm:space-y-6 pb-6 sm:pb-2">

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Total Collected</p>
          <p className="text-lg sm:text-xl font-black text-green-500">${totalPremCollected.toFixed(0)}</p>
          <p className="text-[9px] sm:text-[10px] text-foreground/50 mt-0.5">{completeWeeks} weeks logged</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Avg / Week</p>
          <p className="text-lg sm:text-xl font-black text-green-500">${avgWeeklyPremium.toFixed(0)}</p>
          <p className="text-[9px] sm:text-[10px] text-foreground/50 mt-0.5">{activePremWeeks.length} active wks</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Annual Run Rate</p>
          <p className="text-lg sm:text-xl font-black text-green-500">${annualProjection.toFixed(0)}</p>
          <p className="text-[9px] sm:text-[10px] text-foreground/50 mt-0.5">${monthlyProjection.toFixed(0)}/mo est</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Yield on Cost</p>
          <p className="text-lg sm:text-xl font-black text-green-500">{premiumEfficiency.toFixed(2)}%</p>
          <p className="text-[9px] sm:text-[10px] text-foreground/50 mt-0.5">prem ÷ cost basis</p>
        </div>
      </div>

      {/* ── Row 2: Win rate + coverage + tax ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4 flex flex-col justify-between">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Win Rate</p>
          <div>
            <p className="text-2xl sm:text-3xl font-black text-green-500">{winRate.toFixed(0)}%</p>
            <p className="text-[11px] text-foreground/50 mt-1">{Math.round(winRate / 100 * completeWeeks)}/{completeWeeks} profitable weeks</p>
          </div>
          <div className="mt-3 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${winRate}%` }} />
          </div>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4 flex flex-col justify-between">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Cost Basis Coverage</p>
          <div>
            <p className="text-2xl sm:text-3xl font-black text-foreground">
              {totalCostBasis > 0 ? ((totalPremCollected / totalCostBasis) * 100).toFixed(2) : "0.00"}%
            </p>
            <p className="text-[11px] text-foreground/50 mt-1">
              ${totalPremCollected.toFixed(0)} of ${totalCostBasis.toFixed(0)}
            </p>
          </div>
          <div className="mt-3 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, totalCostBasis > 0 ? (totalPremCollected / totalCostBasis) * 100 : 0)}%` }}
            />
          </div>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4 flex flex-col justify-between">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Est. Tax ({(s.cap_gains_tax_rate * 100).toFixed(0)}%)</p>
          <div>
            <p className="text-2xl sm:text-3xl font-black text-red-600">${s.estimated_tax.toFixed(0)}</p>
            <p className="text-[11px] text-foreground/50 mt-1">on ${s.realized_pnl.toFixed(0)} realized P/L</p>
          </div>
          {weeksToFullCover && (
            <p className="mt-3 text-[9px] sm:text-[10px] text-foreground/40">
              ~{weeksToFullCover} wks to cover cost basis
            </p>
          )}
        </div>
      </div>

      {/* ── Premium Accumulation + Annual Projection side by side ── */}
      {(cumulativeData.length > 0 || avgWeeklyPremium > 0) && (
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch">

          {/* Cumulative premium curve */}
          {cumulativeData.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 sm:p-5 w-full sm:w-1/2 shrink-0 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp size={14} className="text-green-500" />
                  <h3 className="text-sm font-bold text-foreground">Premium Accumulation</h3>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-foreground/50">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 bg-green-500/70 rounded" />Weekly</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 bg-blue-400 rounded" />Cumulative</span>
                </div>
              </div>
              {/* Range toggle buttons */}
              <div className="flex gap-0.5 sm:gap-1 mb-3 flex-wrap">
                {PREM_RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setPremRange(r)}
                    className={`px-1.5 sm:px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-semibold transition-colors ${
                      premRange === r
                        ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                        : "text-foreground/40 hover:text-foreground/70 border border-transparent"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Pure SVG chart — bars + line in one coordinate system */}
              <svg viewBox="0 0 300 120" preserveAspectRatio="none" className="w-full" style={{ height: "140px" }}>
                {(() => {
                  const n = cumulativeData.length;
                  if (n === 0) return null;
                  const W = 300, H = 120;
                  const padL = 10, padR = 10, padTop = 10, padBot = 16;
                  const chartW = W - padL - padR;
                  const chartH = H - padTop - padBot;
                  const step = n > 1 ? chartW / (n - 1) : chartW;
                  const barHalfW = Math.min(3, step * 0.3);

                  const maxWeeklyVal = Math.max(...cumulativeData.map((d) => d.weekly), 1);
                  const maxCumVal    = Math.max(...cumulativeData.slice(0, lineEndIdx + 1).map((d) => d.cumulative), 1);

                  const xOf = (i: number) => padL + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
                  const yBar = (v: number) => padTop + chartH - (v / maxWeeklyVal) * chartH;
                  const yCum = (v: number) => padTop + chartH - (v / maxCumVal) * (chartH - 4);

                  // Line + area only up to lineEndIdx (past/present weeks)
                  const pastData = cumulativeData.slice(0, lineEndIdx + 1);
                  const linePts = pastData.map((d, i) => `${xOf(i)},${yCum(d.cumulative)}`);
                  const lastX = xOf(lineEndIdx);
                  const areaPath = linePts.length > 0
                    ? `M${xOf(0)},${yCum(pastData[0].cumulative)} ${linePts.join(" ")} L${lastX},${padTop + chartH} L${xOf(0)},${padTop + chartH} Z`
                    : "";

                  // Label strategy depends on range:
                  //   5Y / MAX  → show 2-digit year ('26) on first occurrence of each year
                  //   others    → show 1-letter month on first week of each month
                  const isMultiYear = premRange === "5Y" || premRange === "MAX";
                  const shownKeys = new Set<string>();
                  const labelFor = (d: CumEntry): string | null => {
                    if (isMultiYear) {
                      const yr = d.iso.slice(0, 4); // "2026"
                      if (shownKeys.has(yr)) return null;
                      shownKeys.add(yr);
                      return `'${yr.slice(2)}`; // "'26"
                    } else {
                      const monthAbbr = d.label.split(" ")[0]; // "Mar"
                      if (shownKeys.has(monthAbbr)) return null;
                      shownKeys.add(monthAbbr);
                      return monthAbbr[0]; // "M"
                    }
                  };

                  return (
                    <>
                      <defs>
                        <linearGradient id="cumGrad2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.18" />
                          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
                        </linearGradient>
                      </defs>

                      {/* Baseline */}
                      <line x1={padL} y1={padTop + chartH} x2={W - padR} y2={padTop + chartH} stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />

                      {/* Future week tick marks — faint on the baseline */}
                      {cumulativeData.map((d, i) => {
                        if (i <= lineEndIdx) return null;
                        return <line key={i} x1={xOf(i)} y1={padTop + chartH - 1} x2={xOf(i)} y2={padTop + chartH + 1} stroke="var(--border)" strokeWidth="0.5" opacity="0.3" />;
                      })}

                      {/* Weekly bars — thin, green (past only) */}
                      {cumulativeData.map((d, i) => {
                        if (d.weekly <= 0 || i > lineEndIdx) return null;
                        const x = xOf(i);
                        const barTop = yBar(d.weekly);
                        const barH2 = padTop + chartH - barTop;
                        return (
                          <rect key={i} x={x - barHalfW} y={barTop} width={barHalfW * 2} height={Math.max(2, barH2)} fill="#22c55e" opacity="0.75" rx="1" />
                        );
                      })}

                      {/* Cumulative area fill (past only) */}
                      {areaPath && <path d={areaPath} fill="url(#cumGrad2)" />}

                      {/* Cumulative line (past only) */}
                      {linePts.length > 1 && (
                        <polyline points={linePts.join(" ")} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinejoin="round" />
                      )}

                      {/* Dot at the current end of line */}
                      {pastData.length > 0 && (
                        <circle cx={lastX} cy={yCum(pastData[pastData.length - 1].cumulative)} r="3" fill="#60a5fa" stroke="var(--surface)" strokeWidth="1.5" />
                      )}

                      {/* Dots on past weeks with premium */}
                      {pastData.map((d, i) =>
                        d.weekly > 0 && i < pastData.length - 1 ? (
                          <circle key={i} cx={xOf(i)} cy={yCum(d.cumulative)} r="2" fill="#60a5fa" stroke="var(--surface)" strokeWidth="1" />
                        ) : null
                      )}

                      {/* X-axis labels — one letter per month, first occurrence only */}
                      {cumulativeData.map((d, i) => {
                        const letter = labelFor(d);
                        if (!letter) return null;
                        return (
                          <g key={i}>
                            <line x1={xOf(i)} y1={padTop + chartH} x2={xOf(i)} y2={padTop + chartH + 3} stroke="currentColor" strokeWidth="0.5" opacity={i <= lineEndIdx ? 0.3 : 0.15} />
                            <text x={xOf(i)} y={H - 2} textAnchor="middle" fontSize="7" fill="currentColor" opacity={i <= lineEndIdx ? 0.5 : 0.25}>{letter}</text>
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>

              <div className="mt-2 pt-3 border-t border-[var(--border)] flex items-center justify-between">
                <span className="text-xs text-foreground/50">
                  {premRange === "MAX" ? "All time" : `Last ${premRange}`} · running total
                </span>
                <span className="text-sm font-black text-green-500">
                  ${(cumulativeData[cumulativeData.length - 1]?.cumulative ?? 0).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Annual projection */}
          {avgWeeklyPremium > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 sm:p-5 w-full sm:flex-1 sm:min-w-0 flex flex-col">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <TrendingUp size={13} className="text-green-500" />
                <h3 className="text-sm font-bold text-foreground">Annual Projection</h3>
                <span className="ml-auto text-[9px] sm:text-[10px] text-foreground/40">${avgMonthlyPremium.toFixed(0)}/mo avg</span>
              </div>
              <div className="space-y-1.5 sm:space-y-2">
                {[3, 6, 9, 12].map((months) => {
                  const proj = avgMonthlyPremium * months;
                  const pct  = Math.min(100, (proj / (avgMonthlyPremium * 12 * 1.1)) * 100);
                  const label = months === 12 ? "12 mo" : `${months} mo`;
                  return (
                    <div key={months} className="flex items-center gap-2">
                      <span className="text-[10px] text-foreground/60 w-12 sm:w-16 shrink-0">{label}</span>
                      <div className="flex-1 h-5 bg-[var(--surface-2)] rounded-lg overflow-hidden">
                        <div
                          className="h-full bg-green-500/70 rounded-lg flex items-center px-1.5 sm:px-2 transition-all"
                          style={{ width: `${pct}%` }}
                        >
                          {pct > 25 && <span className="text-[9px] sm:text-[10px] font-bold text-white">${proj.toFixed(0)}</span>}
                        </div>
                      </div>
                      {pct <= 25 && <span className="text-[10px] sm:text-[11px] font-bold text-green-500 shrink-0">${proj.toFixed(0)}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 sm:mt-4 grid grid-cols-3 gap-2 text-center">
                {[["Monthly", avgMonthlyPremium], ["Quarterly", avgMonthlyPremium * 3], ["Annual", avgMonthlyPremium * 12]].map(([label, val]) => (
                  <div key={label as string} className="bg-[var(--surface-2)] rounded-lg p-1.5 sm:p-2">
                    <p className="text-[8px] sm:text-[9px] text-foreground/50 uppercase tracking-wide">{label}</p>
                    <p className="text-xs sm:text-sm font-black text-green-500">${(val as number).toFixed(0)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Basis reduction by holding ── */}
      {holdingProjections.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 sm:p-5">
          <div className="flex items-center gap-2 mb-3 sm:mb-4">
            <TrendingDown size={13} className="text-green-500" />
            <h3 className="text-sm font-bold text-foreground">Cost Basis Reduction</h3>
            <span className="ml-auto text-[9px] sm:text-[10px] text-foreground/40 hidden sm:inline">live adj vs original cost</span>
          </div>
          <div className="space-y-3">
            {holdingProjections.map((h) => {
              const reduction    = h.cost_basis - h.live_adj;
              const reductionPct = h.cost_basis > 0 ? (reduction / h.cost_basis) * 100 : 0;
              return (
                <div key={h.symbol}>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-bold text-foreground truncate">{h.symbol}</span>
                      <span className="text-[9px] sm:text-[10px] text-foreground/50 shrink-0">{h.shares}sh</span>
                    </div>
                    <div className="flex items-center gap-2 text-right shrink-0">
                      <span className="text-[10px] sm:text-[11px] text-foreground/50 hidden sm:inline">
                        ${h.cost_basis.toFixed(2)} → <span className="text-green-500 font-semibold">${h.live_adj.toFixed(2)}</span>
                      </span>
                      <span className="text-[10px] sm:text-[11px] font-bold text-green-500">-{reductionPct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="h-4 bg-[var(--surface-2)] rounded-lg overflow-hidden relative">
                    <div className="h-full bg-green-500/25 rounded-lg" style={{ width: "100%" }} />
                    <div className="absolute inset-y-0 left-0 bg-green-500 rounded-lg" style={{ width: `${Math.min(100, reductionPct)}%` }} />
                    {h.weeksToZero && (
                      <span className="absolute right-2 inset-y-0 flex items-center text-[9px] text-foreground/40">
                        ~{h.weeksToZero}w
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] text-foreground/40">${h.premiumSold.toFixed(0)} collected</span>
                    <span className="text-[9px] text-foreground/40 hidden sm:inline">${(h.cost_basis * h.shares).toFixed(0)} total position</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Consistency + Streak + Avg Positions ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4 flex flex-col justify-between">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Consistency</p>
          <div>
            {completedPremiums.length < 3 ? (
              <>
                <p className="text-2xl sm:text-3xl font-black text-foreground/30">—<span className="text-base sm:text-lg font-semibold text-foreground/40">/100</span></p>
                <p className="text-[11px] text-foreground/40 mt-1">Need 3+ complete weeks</p>
              </>
            ) : (
              <>
                <p className="text-2xl sm:text-3xl font-black" style={{ color: consistencyScore >= 70 ? "#22c55e" : consistencyScore >= 40 ? "#f59e0b" : "#ef4444" }}>
                  {consistencyScore.toFixed(0)}<span className="text-base sm:text-lg font-semibold text-foreground/40">/100</span>
                </p>
                <p className="text-[11px] text-foreground/50 mt-1">σ ${weeklyStdDev.toFixed(0)} · avg ${weeklyMean.toFixed(0)}/wk</p>
              </>
            )}
          </div>
          <div className="mt-3 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${completedPremiums.length < 3 ? 0 : consistencyScore}%`, background: consistencyScore >= 70 ? "#22c55e" : consistencyScore >= 40 ? "#f59e0b" : "#ef4444" }} />
          </div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4 flex flex-col justify-between">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Current Streak</p>
          <div>
            <p className="text-2xl sm:text-3xl font-black text-green-500">{currentStreak}<span className="text-base sm:text-lg font-semibold text-foreground/40"> wks</span></p>
            <p className="text-[11px] text-foreground/50 mt-1">consecutive profitable weeks</p>
          </div>
          {/* Dot sparkline — last 12 complete weeks, newest on right */}
          {(() => {
            const last12 = [...weeksBreakdown].filter((w) => w.is_complete).slice(0, 12).reverse();
            const maxPrem = Math.max(...last12.map((w) => Math.abs(w.premium)), 1);
            return (
              <div className="mt-3 flex items-end gap-0.5 h-8">
                {last12.map((w, i) => {
                  const h = Math.max(4, Math.round((Math.abs(w.premium) / maxPrem) * 28));
                  const color = w.premium > 0 ? "#facc15" : "#ef4444";
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end">
                      <div className="w-full rounded-sm" style={{ height: h, background: color, opacity: 0.85 }} />
                    </div>
                  );
                })}
                {last12.length === 0 && (
                  <span className="text-[10px] text-foreground/30">No complete weeks yet</span>
                )}
              </div>
            );
          })()}
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4 flex flex-col justify-between">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Avg Positions / Week</p>
          <div>
            <p className="text-2xl sm:text-3xl font-black text-green-500">{avgPositionsPerWeek.toFixed(1)}</p>
            <p className="text-[11px] text-foreground/50 mt-1">across {completeWeeks} complete weeks</p>
          </div>
          <p className="mt-3 text-[9px] sm:text-[10px] text-foreground/40">
            ${avgPositionsPerWeek > 0 ? (weeklyMean / avgPositionsPerWeek).toFixed(2) : "0.00"} avg per position
          </p>
        </div>
      </div>

      {/* ── Realized vs In-flight + Best/Worst month ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
        {totalPremForSplit > 0 && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4">
            <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-3">Realized vs In-Flight</p>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-lg sm:text-xl font-black text-green-500">${realizedPrem.toFixed(0)}</span>
              <span className="text-xs sm:text-sm text-foreground/40 mb-0.5">locked in</span>
              <span className="ml-auto text-lg sm:text-xl font-black text-green-500">${inFlightPrem.toFixed(0)}</span>
              <span className="text-xs sm:text-sm text-foreground/40 mb-0.5">active</span>
            </div>
            <div className="h-3 bg-[var(--surface-2)] rounded-full overflow-hidden flex">
              <div className="h-full bg-green-500 rounded-l-full transition-all" style={{ width: `${realizedPct}%` }} />
              <div className="h-full bg-green-500/50 flex-1 rounded-r-full" />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-foreground/40">
              <span>{realizedPct.toFixed(0)}% realized</span>
              <span>{(100 - realizedPct).toFixed(0)}% in-flight</span>
            </div>
          </div>
        )}
        {(bestMonth || worstMonth) && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4">
            <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-3">Best / Worst Month</p>
            <div className="flex gap-3 sm:gap-4">
              {bestMonth && (
                <div className="flex-1">
                  <p className="text-[9px] sm:text-[10px] text-green-500 font-semibold uppercase mb-1">Best</p>
                  <p className="text-base sm:text-lg font-black text-green-500">${bestMonth[1].toFixed(0)}</p>
                  <p className="text-[11px] text-foreground/50">{monthNames[bestMonth[0].split("-")[1]] ?? bestMonth[0]}</p>
                </div>
              )}
              {worstMonth && bestMonth && worstMonth[0] !== bestMonth[0] && (
                <div className="flex-1">
                  <p className="text-[9px] sm:text-[10px] text-red-600 font-semibold uppercase mb-1">Lightest</p>
                  <p className="text-base sm:text-lg font-black text-red-600">${worstMonth[1].toFixed(0)}</p>
                  <p className="text-[11px] text-foreground/50">{monthNames[worstMonth[0].split("-")[1]] ?? worstMonth[0]}</p>
                </div>
              )}
              {bestMonth && worstMonth && bestMonth[0] !== worstMonth[0] && (
                <div className="flex-1">
                  <p className="text-[9px] sm:text-[10px] text-foreground/40 font-semibold uppercase mb-1">Range</p>
                  <p className="text-base sm:text-lg font-black text-foreground/60">${(bestMonth[1] - worstMonth[1]).toFixed(0)}</p>
                  <p className="text-[11px] text-foreground/50">spread</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Best / Worst week ── */}
      {(s.best_week || s.worst_week) && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-4">
          <p className="text-[9px] sm:text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-3">Best / Weakest Week</p>
          <div className="flex gap-3 sm:gap-4">
            {s.best_week && s.best_week.premium > 0 && (
              <div className="flex-1">
                <p className="text-[10px] text-green-500 font-semibold uppercase mb-1">Best</p>
                <p className="text-lg font-black text-green-500">${s.best_week.premium.toFixed(0)}</p>
                <p className="text-xs text-foreground/50">{s.best_week.week_end}</p>
                <p className="text-[10px] text-foreground/40">{s.best_week.position_count} positions</p>
              </div>
            )}
            {s.worst_week && s.worst_week.id !== s.best_week?.id && (
              <div className="flex-1">
                <p className="text-[10px] text-red-600 font-semibold uppercase mb-1">Weakest</p>
                <p className={`text-lg font-black ${s.worst_week.premium >= 0 ? "text-red-600" : "text-red-600"}`}>{fmt$(s.worst_week.premium)}</p>
                <p className="text-xs text-foreground/50">{s.worst_week.week_end}</p>
                <p className="text-[10px] text-foreground/40">{s.worst_week.position_count} positions</p>
              </div>
            )}
            {s.best_week && s.worst_week && s.best_week.premium > 0 && s.worst_week.id !== s.best_week?.id && (
              <div className="flex-1">
                <p className="text-[10px] text-foreground/40 font-semibold uppercase mb-1">Range</p>
                <p className="text-lg font-black text-foreground/60">${(s.best_week.premium - s.worst_week.premium).toFixed(0)}</p>
                <p className="text-xs text-foreground/50">spread</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Monthly chart + Week-by-week ── */}
      {(monthlyEntries.length > 0 || weeksBreakdown.length > 0) && (
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-start">
          {monthlyEntriesForward.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 sm:p-5 w-full sm:shrink-0 sm:w-auto" style={{ minWidth: 0 }}>
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Calendar size={13} className="text-green-500" />
                <h3 className="text-sm font-bold text-foreground">Monthly Premium</h3>
                <span className="ml-auto text-[9px] sm:text-[10px] text-foreground/40 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-sm bg-green-500" /> actual
                  <span className="inline-block w-2 h-2 rounded-sm bg-[var(--surface-2)] border border-dashed border-foreground/20" /> proj
                </span>
              </div>
              <div className="flex items-end gap-1 sm:gap-1.5 h-44 sm:h-56 overflow-x-auto">
                {monthlyEntriesForward.map(([ym, val, isFuture]) => {
                  const [, month] = ym.split("-");
                  const pct = Math.max(3, Math.round((val / maxMonthlyPremium) * 100));
                  const isCurrentMonth = ym === currentYM;
                  return (
                    <div key={ym} className="flex flex-col items-center gap-0.5 h-full justify-end" style={{ minWidth: "22px", flex: "1 1 0" }}>
                      <span className="text-[9px] font-semibold leading-none mb-0.5 whitespace-nowrap"
                        style={{ color: isFuture ? "var(--foreground-muted, rgba(255,255,255,0.25))" : "rgba(255,255,255,0.7)" }}>
                        {isFuture
                          ? (val >= 1000 ? "~$" + (val / 1000).toFixed(1) + "k" : "~$" + val.toFixed(0))
                          : val > 0 ? (val >= 1000 ? "$" + (val / 1000).toFixed(1) + "k" : "$" + val.toFixed(0)) : ""}
                      </span>
                      <div
                        className="w-full rounded-t transition-all"
                        style={{
                          height: `${pct}%`,
                          background: isFuture ? "transparent" : "#22c55e",
                          border: isFuture ? "1px dashed rgba(255,255,255,0.15)" : "none",
                          opacity: isCurrentMonth ? 1 : isFuture ? 0.5 : 0.85,
                        }}
                      />
                      <span className={`text-[9px] leading-none mt-0.5 whitespace-nowrap font-${isCurrentMonth ? "bold" : "normal"}`}
                        style={{ color: isCurrentMonth ? "#22c55e" : isFuture ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.5)" }}>
                        {monthNames[month] ?? month}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {weeksBreakdown.length > 0 && (() => {
            // Build a full-year scaffold: every Friday of the current year
            // find first Friday of the year
            const firstFri = new Date(currentYear, 0, 1);
            firstFri.setDate(firstFri.getDate() + ((5 - firstFri.getDay() + 7) % 7));

            const yearEndStr = `${currentYear}-12-31`;
            const allFridays: string[] = [];
            const cur2 = new Date(firstFri);
            // use string comparison to avoid timezone/mutation issues
            while (true) {
              const iso = cur2.toISOString().slice(0, 10);
              if (iso > yearEndStr) break;
              allFridays.push(iso);
              cur2.setDate(cur2.getDate() + 7);
            }

            // Lookup actual premium by week_end iso
            const premByDate: Record<string, number> = {};
            const posByDate:  Record<string, number> = {};
            for (const w of weeksBreakdown) {
              premByDate[w.week_end] = (premByDate[w.week_end] ?? 0) + w.premium;
              posByDate[w.week_end]  = (posByDate[w.week_end]  ?? 0) + w.position_count;
            }

            const allPoints = allFridays.map((iso) => {
              const isFuture = iso > todayStr;
              const actual   = premByDate[iso] ?? 0;
              return {
                iso,
                value: isFuture ? avgWeeklyPremium : actual,
                future: isFuture,
                positions: posByDate[iso] ?? 0,
                hasData: !isFuture && actual > 0,
              };
            });

            const pastWeeks = allPoints.filter((p) => !p.future && p.hasData);
            const maxVal = Math.max(...allPoints.map((p) => p.value), 1);
            const n = allPoints.length;

            const W = 400, H = 130;
            const padL = 36, padR = 8, padTop = 14, padBot = 20;
            const chartW = W - padL - padR;
            const chartH = H - padTop - padBot;

            const xOf = (i: number) => padL + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
            const yOf = (v: number) => padTop + chartH - Math.max(0, Math.min(1, v / maxVal)) * (chartH - 4);

            const lastPastIdx = allPoints.reduce((acc, p, i) => (!p.future ? i : acc), -1);
            const joinIdx = lastPastIdx;

            // Past solid line (only connect points that have actual data — skip zero-gap weeks)
            const pastLinePts = allPoints
              .slice(0, lastPastIdx + 1)
              .filter((p) => p.hasData)
              .map((p) => {
                const i = allFridays.indexOf(p.iso);
                return `${xOf(i)},${yOf(p.value)}`;
              })
              .join(" ");

            // Future dashed line from last past point to end of year
            const futurePts = allPoints
              .slice(joinIdx)
              .map((p, i) => `${xOf(joinIdx + i)},${yOf(p.value)}`)
              .join(" ");

            // Y-axis ticks (0, 50%, 100%)
            const yTicks = [0, 0.5, 1].map((pct) => ({
              y: padTop + chartH - pct * (chartH - 4),
              label: "$" + (maxVal * pct >= 1000 ? (maxVal * pct / 1000).toFixed(1) + "k" : Math.round(maxVal * pct).toString()),
            }));

            // Avg line y
            const avgY = yOf(avgWeeklyPremium);

            // Area under past line — built from same filtered points as pastLinePts
            const pastDataPoints = allPoints
              .slice(0, lastPastIdx + 1)
              .filter((p) => p.hasData)
              .map((p) => ({ i: allFridays.indexOf(p.iso), v: p.value }));
            const areaPath = pastDataPoints.length > 0
              ? `M${xOf(pastDataPoints[0].i)},${yOf(pastDataPoints[0].v)} ` +
                pastDataPoints.map(({ i, v }) => `${xOf(i)},${yOf(v)}`).join(" ") +
                ` L${xOf(pastDataPoints[pastDataPoints.length - 1].i)},${padTop + chartH}` +
                ` L${xOf(pastDataPoints[0].i)},${padTop + chartH} Z`
              : "";

            // Month labels — show 1-letter month at first Friday of each month
            const shownMonths = new Set<string>();
            const monthLabels = allPoints.map((p, i) => {
              const m = p.iso.slice(5, 7);
              if (shownMonths.has(m)) return null;
              shownMonths.add(m);
              const names: Record<string, string> = { "01":"J","02":"F","03":"M","04":"A","05":"M","06":"J","07":"J","08":"A","09":"S","10":"O","11":"N","12":"D" };
              return { i, label: names[m] ?? m, future: p.future };
            }).filter(Boolean) as { i: number; label: string; future: boolean }[];

            return (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden w-full sm:flex-1 sm:min-w-0 flex flex-col">
                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
                  <h3 className="text-sm font-bold text-foreground">Weekly Premium — {currentYear}</h3>
                  <span className="text-[10px] text-foreground/40 flex items-center gap-3">
                    <span className="flex items-center gap-1.5"><span className="inline-block w-5" style={{borderTop:"2px solid #4ade80", display:"inline-block"}} />actual</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-5" style={{borderTop:"2px dashed rgba(96,165,250,0.6)", display:"inline-block"}} />projected</span>
                  </span>
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: "190px" }}>
                    <defs>
                      <linearGradient id="wkGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4ade80" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {/* Y grid lines + labels */}
                    {yTicks.map(({ y, label }) => (
                      <g key={label}>
                        <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />
                        <text x={padL - 3} y={y + 3} textAnchor="end" fontSize="7" fill="currentColor" opacity="0.4">{label}</text>
                      </g>
                    ))}

                    {/* Avg dashed horizontal reference line */}
                    {avgWeeklyPremium > 0 && (
                      <>
                        <line x1={padL} y1={avgY} x2={W - padR} y2={avgY}
                          stroke="#a78bfa" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5" />
                        <text x={W - padR + 1} y={avgY + 3} fontSize="6" fill="#a78bfa" opacity="0.6">avg</text>
                      </>
                    )}

                    {/* Today marker */}
                    {lastPastIdx >= 0 && (
                      <line x1={xOf(lastPastIdx)} y1={padTop} x2={xOf(lastPastIdx)} y2={padTop + chartH}
                        stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                    )}

                    {/* Area fill under past line */}
                    {areaPath && <path d={areaPath} fill="url(#wkGrad)" />}

                    {/* Past actual line */}
                    {pastLinePts && (
                      <polyline points={pastLinePts} fill="none" stroke="#4ade80" strokeWidth="1.8" strokeLinejoin="round" />
                    )}

                    {/* Future projected dashed line */}
                    {joinIdx >= 0 && futurePts && (
                      <polyline points={futurePts} fill="none" stroke="#60a5fa" strokeWidth="1.2"
                        strokeDasharray="4 3" strokeLinejoin="round" opacity="0.55" />
                    )}

                    {/* Dots on past data points only */}
                    {allPoints.map((p, i) => {
                      if (!p.hasData) return null;
                      return (
                        <circle key={i} cx={xOf(i)} cy={yOf(p.value)} r={i === lastPastIdx ? 3 : 1.8}
                          fill={p.value >= avgWeeklyPremium ? "#4ade80" : "#dc2626"}
                          stroke="var(--surface)" strokeWidth="1" />
                      );
                    })}

                    {/* Month labels on x-axis */}
                    {monthLabels.map(({ i, label, future }) => (
                      <g key={i}>
                        <line x1={xOf(i)} y1={padTop + chartH} x2={xOf(i)} y2={padTop + chartH + 3}
                          stroke="currentColor" strokeWidth="0.5" opacity={future ? 0.15 : 0.3} />
                        <text x={xOf(i)} y={H - 3} textAnchor="middle" fontSize="7.5" fontWeight="600"
                          fill="currentColor" opacity={future ? 0.2 : 0.5}>{label}</text>
                      </g>
                    ))}
                  </svg>

                  {/* Summary row */}
                  <div className="mt-2 pt-3 border-t border-[var(--border)] grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[9px] text-foreground/40 uppercase tracking-wide">Avg / wk</p>
                      <p className="text-xs font-black text-green-500">${avgWeeklyPremium.toFixed(0)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-foreground/40 uppercase tracking-wide">Rest of year proj</p>
                      {(() => {
                        const remWks = allPoints.filter((p) => p.future).length;
                        const proj = avgWeeklyPremium * remWks;
                        return <p className="text-xs font-black text-green-500">${proj >= 1000 ? (proj / 1000).toFixed(1) + "k" : proj.toFixed(0)} <span className="text-[9px] font-normal opacity-50">({remWks}wk)</span></p>;
                      })()}
                    </div>
                    <div>
                      <p className="text-[9px] text-foreground/40 uppercase tracking-wide">Best wk</p>
                      <p className="text-xs font-black text-green-500">${Math.max(...pastWeeks.map((p) => p.value), 0).toFixed(0)}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {weeksBreakdown.length === 0 && (
        <EmptyState icon={Calendar} title="No completed weeks yet" body="Mark a week complete to populate your performance summary." />
      )}

      {/* ── Expiry-Bucketed Premium Table ── */}
      {expiryBuckets.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div className="px-3 sm:px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Premium by Expiry</h3>
            <span className="text-[10px] text-foreground/40">{expiryBuckets.length} expiries</span>
          </div>
          {/* Column headers — hidden on mobile, shown on sm+ */}
          <div className="hidden sm:grid grid-cols-[100px_1fr_auto_90px_90px] gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]">
            <span className="text-[10px] font-semibold text-foreground/50 uppercase">Expiry</span>
            <span className="text-[10px] font-semibold text-foreground/50 uppercase">Symbols</span>
            <span className="text-[10px] font-semibold text-foreground/50 uppercase text-center"># Pos</span>
            <span className="text-[10px] font-semibold text-foreground/50 uppercase text-right">Premium</span>
            <span className="text-[10px] font-semibold text-foreground/50 uppercase text-right">Status</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {expiryBuckets.map((bucket) => {
              const dateLabel = new Date(bucket.expiry + "T00:00:00").toLocaleDateString("en-US", {
                month: "short", day: "numeric",
              });
              const symbolSet = Array.from(new Set(bucket.positions.map((p) => p.symbol)));
              let statusLabel: string;
              let statusClass: string;
              if (bucket.isSettled) {
                statusLabel = "Settled";
                statusClass = "bg-[var(--surface-2)] text-foreground/40";
              } else if (bucket.dte === 0) {
                statusLabel = "Today";
                statusClass = "bg-red-600/20 text-red-600";
              } else if (bucket.dte <= 3) {
                statusLabel = `${bucket.dte}d`;
                statusClass = "bg-red-600/15 text-red-600";
              } else if (bucket.dte <= 7) {
                statusLabel = `${bucket.dte}d`;
                statusClass = "bg-green-500/15 text-green-500";
              } else {
                statusLabel = `${bucket.dte}d`;
                statusClass = "bg-green-500/15 text-green-500";
              }
              return (
                <div
                  key={bucket.expiry}
                  className={`transition-colors hover:bg-[var(--surface-2)] ${
                    bucket.isSettled ? "opacity-50" : ""
                  }`}
                >
                  {/* Mobile layout: two-line card */}
                  <div className="sm:hidden px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-semibold text-foreground tabular-nums">{dateLabel}</p>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${statusClass}`}>{statusLabel}</span>
                      </div>
                      <p className={`text-[12px] font-black tabular-nums ${
                        bucket.totalPremium > 0 ? "text-green-500" : bucket.totalPremium < 0 ? "text-red-600" : "text-foreground/40"
                      }`}>{fmt$(bucket.totalPremium)}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {symbolSet.slice(0, 6).map((sym) => (
                        <span key={sym} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">{sym}</span>
                      ))}
                      {symbolSet.length > 6 && <span className="text-[9px] text-foreground/40">+{symbolSet.length - 6}</span>}
                      <span className="ml-auto text-[9px] text-foreground/40">{bucket.positions.length} pos</span>
                    </div>
                  </div>
                  {/* Desktop layout: table row */}
                  <div className="hidden sm:grid grid-cols-[100px_1fr_auto_90px_90px] gap-2 px-4 py-2.5 items-center">
                    <p className="text-[11px] font-semibold text-foreground tabular-nums">{dateLabel}</p>
                    <div className="flex flex-wrap gap-1">
                      {symbolSet.map((sym) => (
                        <span key={sym} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">{sym}</span>
                      ))}
                    </div>
                    <p className="text-[11px] text-foreground/60 text-center tabular-nums">{bucket.positions.length}</p>
                    <p className={`text-[12px] font-black tabular-nums text-right ${
                      bucket.totalPremium > 0 ? "text-green-500" : bucket.totalPremium < 0 ? "text-red-600" : "text-foreground/40"
                    }`}>{fmt$(bucket.totalPremium)}</p>
                    <div className="flex justify-end">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${statusClass}`}>{statusLabel}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* ── Net Realized — per-week breakdown ── */}
      {weeksBreakdown.length > 0 && (() => {
        const rows = [...weeksBreakdown]
          .filter((w) => w.position_count > 0 || w.premium > 0)
          .reverse(); // newest first

        return (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
            <div className="px-3 sm:px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">Net Realized</h3>
              <span className="text-[10px] text-foreground/40">{rows.length} week{rows.length !== 1 ? "s" : ""}</span>
            </div>
            {/* Desktop column headers */}
            <div className="hidden sm:grid grid-cols-[130px_60px_110px_110px_110px_80px] gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]">
              {["Week", "Pos", "Gross Collected", "Cost to Close", "Net Realized", "Status"].map((h) => (
                <span key={h} className="text-[10px] font-semibold text-foreground/50 uppercase tracking-wide last:text-right">{h}</span>
              ))}
            </div>
            <div className="divide-y divide-[var(--border)]">
              {rows.map((w) => {
                const netData  = weekNetRealizedMap.get(w.id);
                const gross    = netData?.grossCollected ?? 0;
                const cost     = netData?.costToClose   ?? 0;
                const net      = gross - cost;
                const hasClose = cost > 0;

                // Parse week label as local date to avoid UTC off-by-one
                const weekLabel = new Date(w.week_end.slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

                return (
                  <div key={w.id} className="hover:bg-[var(--surface-2)] transition-colors">
                    {/* Mobile */}
                    <div className="sm:hidden px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-foreground">{weekLabel}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isEffectivelyComplete(w) ? "bg-green-500/15 text-green-500" : "bg-yellow-500/15 text-yellow-500"}`}>
                          {isEffectivelyComplete(w) ? "Complete" : "Open"}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-foreground/50">{w.position_count} pos</span>
                        <span className="text-green-500 font-semibold">${w.premium.toFixed(2)}</span>
                        {hasClose && <span className="text-red-600 font-semibold">-${cost.toFixed(2)}</span>}
                        {hasClose && (
                          <span className={`font-bold ${net >= 0 ? "text-green-500" : "text-red-600"}`}>
                            net {net >= 0 ? "$" : "-$"}{Math.abs(net).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Desktop */}
                    <div className="hidden sm:grid grid-cols-[130px_60px_110px_110px_110px_80px] gap-2 px-4 py-2.5 items-center">
                      <span className="text-[11px] font-semibold text-foreground">{weekLabel}</span>
                      <span className="text-[11px] text-foreground/60 tabular-nums">{w.position_count}</span>
                      <span className="text-[12px] font-bold text-green-500 tabular-nums">
                        {w.premium > 0 ? `$${w.premium.toFixed(2)}` : <span className="text-foreground/30">—</span>}
                      </span>
                      <span className="text-[12px] font-bold tabular-nums">
                        {hasClose
                          ? <span className="text-red-600">-${cost.toFixed(2)}</span>
                          : <span className="text-foreground/30">—</span>}
                      </span>
                      <span className="text-[12px] font-bold tabular-nums">
                        {hasClose
                          ? <span className={net >= 0 ? "text-green-500" : "text-red-600"}>
                              {net >= 0 ? "$" : "-$"}{Math.abs(net).toFixed(2)}
                            </span>
                          : w.premium > 0
                            ? <span className="text-green-500">${w.premium.toFixed(2)}</span>
                            : <span className="text-foreground/30">—</span>}
                      </span>
                      <div className="flex justify-end">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isEffectivelyComplete(w) ? "bg-green-500/15 text-green-500" : "bg-yellow-500/15 text-yellow-500"}`}>
                          {isEffectivelyComplete(w) ? "Complete" : "Open"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
