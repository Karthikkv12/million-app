"use client";
import { useQuery } from "@tanstack/react-query";
import {
  fetchPortfolioSummary, fetchPremiumDashboard, fetchHoldings, fetchAllPositions,
  WeekBreakdown, OptionPosition,
} from "@/lib/api";
import { EmptyState, SkeletonCard } from "@/components/ui";
import { TrendingUp, TrendingDown, BarChart2, Calendar } from "lucide-react";
import { fmt$ } from "./TradesHelpers";

type MonthEntry = [string, number] | null;
type CumEntry = { label: string; cumulative: number; weekly: number };

export function YearTab() {
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

  const isLoading = summaryLoading || premLoading;
  if (isLoading) return <div className="space-y-3">{[1, 2, 3, 4].map((i) => <SkeletonCard key={i} rows={2} />)}</div>;
  if (!s) return <EmptyState icon={BarChart2} title="No data yet" body="Complete a week to see your performance summary." />;

  const weeksBreakdown    = (s.weeks_breakdown ?? []) as WeekBreakdown[];
  const monthlyPremium    = (s.monthly_premium ?? {}) as Record<string, number>;
  const winRate           = s.win_rate ?? 0;
  const completeWeeks     = s.complete_weeks ?? 0;

  const completedPremiums = [...weeksBreakdown].filter((w) => w.is_complete && w.premium > 0).map((w) => w.premium);
  const weeklyMean        = completedPremiums.length > 0 ? completedPremiums.reduce((a, b) => a + b, 0) / completedPremiums.length : 0;
  const weeklyStdDev      = completedPremiums.length > 1
    ? Math.sqrt(completedPremiums.reduce((a, b) => a + Math.pow(b - weeklyMean, 2), 0) / completedPremiums.length)
    : 0;
  const consistencyScore  = weeklyMean > 0 ? Math.max(0, Math.min(100, 100 - (weeklyStdDev / weeklyMean) * 100)) : 0;

  const completedWeeks    = weeksBreakdown.filter((w) => w.is_complete);
  const streakBreak       = completedWeeks.findIndex((w) => w.premium <= 0);
  const currentStreak     = streakBreak === -1 ? completedWeeks.length : streakBreak;

  const avgPositionsPerWeek = completeWeeks > 0
    ? weeksBreakdown.filter((w) => w.is_complete).reduce((a, w) => a + w.position_count, 0) / completeWeeks
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

  // Build a full 52-Friday skeleton for the current year, filled with actual data where available
  const currentYear = new Date().getFullYear();
  const allFridaysOfYear: CumEntry[] = (() => {
    // Find first Friday of the year
    const jan1 = new Date(currentYear, 0, 1);
    const dayOfWeek = jan1.getDay(); // 0=Sun … 6=Sat
    const daysToFirstFri = dayOfWeek <= 5 ? 5 - dayOfWeek : 6; // days until first Friday
    const firstFriday = new Date(currentYear, 0, 1 + daysToFirstFri);

    // Build a lookup: week_end date string → premium
    const weekByDate: Record<string, number> = {};
    for (const w of weeksBreakdown) {
      weekByDate[w.week_end] = (weekByDate[w.week_end] ?? 0) + w.premium;
    }

    const entries: CumEntry[] = [];
    let cumulative = 0;
    for (let i = 0; i < 52; i++) {
      const d = new Date(firstFriday);
      d.setDate(firstFriday.getDate() + i * 7);
      if (d.getFullYear() !== currentYear) break;
      const iso = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const weekly = weekByDate[iso] ?? 0;
      cumulative += weekly;
      entries.push({ label, cumulative, weekly });
    }
    return entries;
  })();

  const cumulativeData = allFridaysOfYear;
  const chronoWeeks   = [...weeksBreakdown].reverse();

  const activePremWeeks  = chronoWeeks.filter((w) => w.premium > 0 && w.is_complete);
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

  const monthlyEntries    = Object.entries(monthlyPremium).sort((a, b) => a[0].localeCompare(b[0]));
  const maxMonthlyPremium = Math.max(...monthlyEntries.map((e) => e[1]), 1);
  const maxWeekly         = Math.max(...cumulativeData.map((d) => d.weekly), 1);

  // Per-month average: use actual monthly data if available, else derive from weekly avg
  const activeMonthlyValues = monthlyEntries.filter(([, v]) => v > 0).map(([, v]) => v);
  const avgMonthlyPremium   = activeMonthlyValues.length > 0
    ? activeMonthlyValues.reduce((a, b) => a + b, 0) / activeMonthlyValues.length
    : monthlyProjection;

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
  const expiryBucketMap = new Map<string, OptionPosition[]>();
  for (const pos of allPositions) {
    if (!pos.expiry_date) continue;
    // Exclude carried-forward copies — these are duplicates of the original position
    // created when a position carries into a new week. The premium was only collected
    // once (on the original), so counting carried copies would double-count it.
    if (pos.carried_from_id != null) continue;
    // Normalise to "YYYY-MM-DD" regardless of whether the backend returns
    // a full ISO datetime ("2026-03-07T00:00:00") or a bare date string.
    const key = pos.expiry_date.slice(0, 10);
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
      const totalPremium = positions.reduce((sum, p) => sum + (p.total_premium ?? 0), 0);
      return { expiry, positions, totalPremium, dte, isSettled: dte < 0 };
    })
    .sort((a, b) => a.expiry.localeCompare(b.expiry));

  return (
    <div className="space-y-6">

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Total Collected</p>
          <p className="text-xl font-black text-green-500">${totalPremCollected.toFixed(2)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">{completeWeeks} weeks logged</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Avg / Week</p>
          <p className="text-xl font-black text-blue-500">${avgWeeklyPremium.toFixed(2)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">from {activePremWeeks.length} active weeks</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Annual Run Rate</p>
          <p className="text-xl font-black text-purple-500">${annualProjection.toFixed(0)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">${monthlyProjection.toFixed(0)}/mo projected</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Yield on Cost</p>
          <p className="text-xl font-black text-orange-400">{premiumEfficiency.toFixed(2)}%</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">premium ÷ total cost basis</p>
        </div>
      </div>

      {/* ── Row 2: Win rate + coverage + tax ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Win Rate</p>
          <div>
            <p className="text-3xl font-black text-blue-500">{winRate.toFixed(0)}%</p>
            <p className="text-xs text-foreground/50 mt-1">{completeWeeks}/{s.total_weeks} weeks profitable</p>
          </div>
          <div className="mt-3 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${winRate}%` }} />
          </div>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Cost Basis Coverage</p>
          <div>
            <p className="text-3xl font-black text-foreground">
              {totalCostBasis > 0 ? ((totalPremCollected / totalCostBasis) * 100).toFixed(2) : "0.00"}%
            </p>
            <p className="text-xs text-foreground/50 mt-1">
              ${totalPremCollected.toFixed(0)} of ${totalCostBasis.toFixed(0)} total cost
            </p>
          </div>
          <div className="mt-3 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, totalCostBasis > 0 ? (totalPremCollected / totalCostBasis) * 100 : 0)}%` }}
            />
          </div>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Est. Tax ({(s.cap_gains_tax_rate * 100).toFixed(0)}%)</p>
          <div>
            <p className="text-3xl font-black text-orange-400">${s.estimated_tax.toFixed(2)}</p>
            <p className="text-xs text-foreground/50 mt-1">on ${s.realized_pnl.toFixed(2)} realized P/L</p>
          </div>
          {weeksToFullCover && (
            <p className="mt-3 text-[10px] text-foreground/40">
              ~{weeksToFullCover} weeks to fully cover cost basis at current rate
            </p>
          )}
        </div>
      </div>

      {/* ── Premium Accumulation + Annual Projection side by side ── */}
      {(cumulativeData.length > 0 || avgWeeklyPremium > 0) && (
        <div className="flex flex-col sm:flex-row gap-4 items-stretch">

          {/* Cumulative premium curve */}
          {cumulativeData.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 w-full sm:w-1/2 shrink-0 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp size={14} className="text-green-500" />
                  <h3 className="text-sm font-bold text-foreground">Premium Accumulation</h3>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-foreground/50">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 bg-green-500 rounded" />Weekly</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 bg-blue-400 rounded" />Cumulative</span>
                </div>
              </div>
              <div className="relative h-40">
                <div className="absolute inset-0 flex items-end px-1" style={{ gap: "1px" }}>
                  {cumulativeData.map((d, i) => {
                    const barPct = d.weekly > 0 ? Math.max(2, Math.round((d.weekly / maxWeekly) * 75)) : 0;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center" style={{ minWidth: 0 }}>
                        {barPct > 0
                          ? <div className="w-full rounded-t bg-green-500/40 border-t border-x border-green-500/60" style={{ height: `${barPct}%` }} />
                          : <div className="w-full" style={{ height: "2px", background: "var(--border)" }} />
                        }
                      </div>
                    );
                  })}
                </div>
                <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                  {(() => {
                    const maxCum = Math.max(...cumulativeData.map((d) => d.cumulative), 1);
                    const n = cumulativeData.length;
                    if (n < 2) return null;
                    const pts = cumulativeData.map((d, i) => {
                      const x = (i / (n - 1)) * 100;
                      const y = 100 - (d.cumulative / maxCum) * 85;
                      return `${x},${y}`;
                    });
                    const areaPath = `M${pts[0]} L${pts.join(" L")} L100,100 L0,100 Z`;
                    return (
                      <>
                        <defs>
                          <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path d={areaPath} fill="url(#cumGrad)" />
                        <polyline points={pts.join(" ")} fill="none" stroke="#60a5fa" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        {cumulativeData.map((d, i) => {
                          if (d.weekly === 0) return null;
                          const x = (i / (n - 1)) * 100;
                          const y = 100 - (d.cumulative / maxCum) * 85;
                          return <circle key={i} cx={`${x}%`} cy={`${y}%`} r="2.5" fill="#60a5fa" />;
                        })}
                      </>
                    );
                  })()}
                </svg>
              </div>
              {/* X-axis labels: vertical, sitting below the chart with a 1px tick line */}
              <div className="flex px-1 mt-0" style={{ gap: "1px" }}>
                {cumulativeData.map((d, i) => {
                  const show = i % 4 === 0 || i === cumulativeData.length - 1;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center" style={{ minWidth: 0 }}>
                      <div style={{ width: "1px", height: show ? "4px" : "2px", background: show ? "var(--foreground)" : "var(--border)", opacity: show ? 0.3 : 0.15 }} />
                      {show ? (
                        <span
                          className="text-[8px] text-foreground/40"
                          style={{ writingMode: "vertical-lr", transform: "rotate(180deg)", lineHeight: 1, whiteSpace: "nowrap", marginTop: "1px" }}
                        >
                          {d.label}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between">
                <span className="text-xs text-foreground/50">Running total · {currentYear}</span>
                <span className="text-sm font-black text-blue-400">
                  ${(cumulativeData[cumulativeData.length - 1]?.cumulative ?? 0).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Annual projection */}
          {avgWeeklyPremium > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 w-full sm:flex-1 sm:min-w-0 flex flex-col">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={14} className="text-purple-500" />
                <h3 className="text-sm font-bold text-foreground">Annual Projection</h3>
                <span className="ml-auto text-[10px] text-foreground/40">based on ${avgMonthlyPremium.toFixed(2)}/mo avg</span>
              </div>
              <div className="space-y-2">
                {[3, 6, 9, 12].map((months) => {
                  const proj = avgMonthlyPremium * months;
                  const pct  = Math.min(100, (proj / (avgMonthlyPremium * 12 * 1.1)) * 100);
                  const label = months === 12 ? "12 mo (full year)" : `${months} mo`;
                  return (
                    <div key={months} className="flex items-center gap-3">
                      <span className="text-[11px] text-foreground/60 w-24 shrink-0">{label}</span>
                      <div className="flex-1 h-5 bg-[var(--surface-2)] rounded-lg overflow-hidden">
                        <div
                          className="h-full bg-purple-500/70 rounded-lg flex items-center px-2 transition-all"
                          style={{ width: `${pct}%` }}
                        >
                          {pct > 20 && <span className="text-[10px] font-bold text-white">${proj.toFixed(0)}</span>}
                        </div>
                      </div>
                      {pct <= 20 && <span className="text-[11px] font-bold text-purple-400">${proj.toFixed(0)}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[["Monthly", avgMonthlyPremium], ["Quarterly", avgMonthlyPremium * 3], ["Annual", avgMonthlyPremium * 12]].map(([label, val]) => (
                  <div key={label as string} className="bg-[var(--surface-2)] rounded-lg p-2">
                    <p className="text-[9px] text-foreground/50 uppercase tracking-wide">{label}</p>
                    <p className="text-sm font-black text-purple-400">${(val as number).toFixed(0)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Basis reduction by holding ── */}
      {holdingProjections.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown size={14} className="text-green-500" />
            <h3 className="text-sm font-bold text-foreground">Cost Basis Reduction by Holding</h3>
            <span className="ml-auto text-[10px] text-foreground/40">live adj vs original cost</span>
          </div>
          <div className="space-y-3">
            {holdingProjections.map((h) => {
              const reduction    = h.cost_basis - h.live_adj;
              const reductionPct = h.cost_basis > 0 ? (reduction / h.cost_basis) * 100 : 0;
              return (
                <div key={h.symbol}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{h.symbol}</span>
                      <span className="text-[10px] text-foreground/50">{h.shares} shares</span>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <span className="text-[11px] text-foreground/50">
                        ${h.cost_basis.toFixed(2)} → <span className="text-green-500 font-semibold">${h.live_adj.toFixed(2)}</span>
                      </span>
                      <span className="text-[11px] font-bold text-green-500 w-12 text-right">-{reductionPct.toFixed(2)}%</span>
                    </div>
                  </div>
                  <div className="h-4 bg-[var(--surface-2)] rounded-lg overflow-hidden relative">
                    <div className="h-full bg-green-500/25 rounded-lg" style={{ width: "100%" }} />
                    <div className="absolute inset-y-0 left-0 bg-green-500 rounded-lg" style={{ width: `${Math.min(100, reductionPct)}%` }} />
                    {h.weeksToZero && (
                      <span className="absolute right-2 inset-y-0 flex items-center text-[9px] text-foreground/40">
                        ~{h.weeksToZero}w to break even
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] text-foreground/40">${h.premiumSold.toFixed(2)} collected</span>
                    <span className="text-[9px] text-foreground/40">${(h.cost_basis * h.shares).toFixed(2)} total position</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Consistency + Streak + Avg Positions ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Consistency</p>
          <div>
            <p className="text-3xl font-black" style={{ color: consistencyScore >= 70 ? "#22c55e" : consistencyScore >= 40 ? "#f59e0b" : "#ef4444" }}>
              {consistencyScore.toFixed(0)}<span className="text-lg font-semibold text-foreground/40">/100</span>
            </p>
            <p className="text-xs text-foreground/50 mt-1">σ ${weeklyStdDev.toFixed(2)} · avg ${weeklyMean.toFixed(2)}/wk</p>
          </div>
          <div className="mt-3 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${consistencyScore}%`, background: consistencyScore >= 70 ? "#22c55e" : consistencyScore >= 40 ? "#f59e0b" : "#ef4444" }} />
          </div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Current Streak</p>
          <div>
            <p className="text-3xl font-black text-yellow-400">{currentStreak}<span className="text-lg font-semibold text-foreground/40"> wks</span></p>
            <p className="text-xs text-foreground/50 mt-1">consecutive profitable weeks</p>
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
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Avg Positions / Week</p>
          <div>
            <p className="text-3xl font-black text-blue-400">{avgPositionsPerWeek.toFixed(1)}</p>
            <p className="text-xs text-foreground/50 mt-1">across {completeWeeks} complete weeks</p>
          </div>
          <p className="mt-3 text-[10px] text-foreground/40">
            ${avgPositionsPerWeek > 0 ? (weeklyMean / avgPositionsPerWeek).toFixed(2) : "0.00"} avg per position deployed
          </p>
        </div>
      </div>

      {/* ── Realized vs In-flight + Best/Worst month ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {totalPremForSplit > 0 && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-3">Realized vs In-Flight</p>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-xl font-black text-blue-500">${realizedPrem.toFixed(0)}</span>
              <span className="text-sm text-foreground/40 mb-0.5">locked in</span>
              <span className="ml-auto text-xl font-black text-orange-400">${inFlightPrem.toFixed(0)}</span>
              <span className="text-sm text-foreground/40 mb-0.5">active</span>
            </div>
            <div className="h-3 bg-[var(--surface-2)] rounded-full overflow-hidden flex">
              <div className="h-full bg-blue-500 rounded-l-full transition-all" style={{ width: `${realizedPct}%` }} />
              <div className="h-full bg-orange-400 flex-1 rounded-r-full" />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-foreground/40">
              <span>{realizedPct.toFixed(0)}% realized</span>
              <span>{(100 - realizedPct).toFixed(0)}% in-flight</span>
            </div>
          </div>
        )}
        {(bestMonth || worstMonth) && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-3">Best / Worst Month</p>
            <div className="flex gap-4">
              {bestMonth && (
                <div className="flex-1">
                  <p className="text-[10px] text-green-500 font-semibold uppercase mb-1">Best</p>
                  <p className="text-lg font-black text-green-500">${bestMonth[1].toFixed(0)}</p>
                  <p className="text-xs text-foreground/50">{monthNames[bestMonth[0].split("-")[1]] ?? bestMonth[0]}</p>
                </div>
              )}
              {worstMonth && (
                <div className="flex-1">
                  <p className="text-[10px] text-orange-400 font-semibold uppercase mb-1">Lightest</p>
                  <p className="text-lg font-black text-orange-400">${worstMonth[1].toFixed(0)}</p>
                  <p className="text-xs text-foreground/50">{monthNames[worstMonth[0].split("-")[1]] ?? worstMonth[0]}</p>
                </div>
              )}
              {bestMonth && worstMonth && bestMonth[0] !== worstMonth[0] && (
                <div className="flex-1">
                  <p className="text-[10px] text-foreground/40 font-semibold uppercase mb-1">Range</p>
                  <p className="text-lg font-black text-foreground/60">${(bestMonth[1] - worstMonth[1]).toFixed(0)}</p>
                  <p className="text-xs text-foreground/50">spread</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Best / Worst week ── */}
      {(s.best_week || s.worst_week) && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-3">Best / Weakest Week</p>
          <div className="flex gap-4">
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
                <p className="text-[10px] text-orange-400 font-semibold uppercase mb-1">Weakest</p>
                <p className={`text-lg font-black ${s.worst_week.premium >= 0 ? "text-orange-400" : "text-red-500"}`}>{fmt$(s.worst_week.premium)}</p>
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
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          {monthlyEntries.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 w-full sm:shrink-0 sm:w-auto" style={{ minWidth: 0 }}>
              <div className="flex items-center gap-2 mb-4">
                <Calendar size={14} className="text-green-500" />
                <h3 className="text-sm font-bold text-foreground">Monthly Premium</h3>
              </div>
              <div className="flex items-end gap-1.5 h-56 overflow-x-auto">
                {monthlyEntries.map((entry) => {
                  const ym = entry[0]; const val = entry[1];
                  const [, month] = ym.split("-");
                  const pct = Math.max(3, Math.round((val / maxMonthlyPremium) * 100));
                  const hasData = val > 0;
                  return (
                    <div key={ym} className="flex flex-col items-center gap-1 h-full justify-end" style={{ minWidth: "28px", flex: "1 1 0" }}>
                      <span className="text-[9px] text-foreground/70 font-semibold leading-none mb-0.5 whitespace-nowrap">
                        {hasData ? (val >= 1000 ? "$" + (val / 1000).toFixed(1) + "k" : "$" + val.toFixed(0)) : ""}
                      </span>
                      <div className={`w-full rounded-t ${hasData ? "bg-green-500" : "bg-[var(--surface-2)]"}`} style={{ height: `${pct}%` }} />
                      <span className="text-[9px] text-foreground/50 leading-none mt-0.5 whitespace-nowrap">{monthNames[month] ?? month}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {weeksBreakdown.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden w-full sm:flex-1 sm:min-w-0">
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">Week-by-Week</h3>
                <span className="text-[10px] text-foreground/40">{weeksBreakdown.length} weeks</span>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {weeksBreakdown.map((w) => {
                  const vsAvg = avgWeeklyPremium > 0 ? ((w.premium - avgWeeklyPremium) / avgWeeklyPremium) * 100 : null;
                  const barPct = maxWeekly > 0 ? Math.max(0, Math.min(100, (w.premium / maxWeekly) * 100)) : 0;
                  const dateShort = new Date(w.week_end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  return (
                    <div key={w.id} className="px-4 py-2.5 hover:bg-[var(--surface-2)] transition-colors">
                      <div className="flex items-center gap-3">
                        {/* Date + status dot */}
                        <div className="w-20 shrink-0">
                          <p className="text-[11px] font-semibold text-foreground">{dateShort}</p>
                          <p className="text-[9px] text-foreground/40">{w.position_count} pos</p>
                        </div>
                        {/* Sparkline bar */}
                        <div className="flex-1 h-5 bg-[var(--surface-2)] rounded-md overflow-hidden">
                          <div
                            className="h-full rounded-md transition-all"
                            style={{
                              width: `${barPct}%`,
                              background: w.premium > avgWeeklyPremium * 1.1
                                ? "#22c55e"
                                : w.premium > 0
                                ? "#86efac"
                                : "#ef4444",
                            }}
                          />
                        </div>
                        {/* Premium value */}
                        <div className="w-24 shrink-0 text-right">
                          <p className={`text-[12px] font-black tabular-nums ${
                            w.premium > 0 ? "text-green-500" : w.premium < 0 ? "text-red-500" : "text-foreground/40"
                          }`}>{fmt$(w.premium)}</p>
                          <p className="text-[9px] text-foreground/40">prem sold</p>
                          {vsAvg !== null && w.is_complete && (
                            <p className={`text-[9px] font-semibold ${
                              vsAvg >= 0 ? "text-green-400" : "text-red-400"
                            }`}>{vsAvg >= 0 ? "▲" : "▼"}{Math.abs(vsAvg).toFixed(0)}% vs avg</p>
                          )}
                        </div>
                        {/* Status pill */}
                        <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          w.is_complete
                            ? "bg-green-500/15 text-green-400"
                            : "bg-blue-500/15 text-blue-400"
                        }`}>
                          {w.is_complete ? "✓" : "•"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {weeksBreakdown.length === 0 && (
        <EmptyState icon={Calendar} title="No completed weeks yet" body="Mark a week complete to populate your performance summary." />
      )}

      {/* ── Expiry-Bucketed Premium Table ── */}
      {expiryBuckets.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Premium by Expiry</h3>
            <span className="text-[10px] text-foreground/40">{expiryBuckets.length} expiries</span>
          </div>
          {/* Column headers */}
          <div className="grid grid-cols-[100px_1fr_auto_90px_90px] gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]">
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
              // Unique symbols in this bucket
              const symbolSet = Array.from(new Set(bucket.positions.map((p) => p.symbol)));
              // Status badge
              let statusLabel: string;
              let statusClass: string;
              if (bucket.isSettled) {
                statusLabel = "Settled";
                statusClass = "bg-[var(--surface-2)] text-foreground/40";
              } else if (bucket.dte === 0) {
                statusLabel = "Expires today";
                statusClass = "bg-red-500/20 text-red-400";
              } else if (bucket.dte <= 3) {
                statusLabel = `${bucket.dte}d`;
                statusClass = "bg-red-500/15 text-red-400";
              } else if (bucket.dte <= 7) {
                statusLabel = `${bucket.dte}d`;
                statusClass = "bg-orange-500/15 text-orange-400";
              } else {
                statusLabel = `${bucket.dte}d`;
                statusClass = "bg-green-500/15 text-green-400";
              }
              return (
                <div
                  key={bucket.expiry}
                  className={`grid grid-cols-[100px_1fr_auto_90px_90px] gap-2 px-4 py-2.5 items-center hover:bg-[var(--surface-2)] transition-colors ${
                    bucket.isSettled ? "opacity-50" : ""
                  }`}
                >
                  {/* Expiry date */}
                  <p className="text-[11px] font-semibold text-foreground tabular-nums">{dateLabel}</p>
                  {/* Symbol pills */}
                  <div className="flex flex-wrap gap-1">
                    {symbolSet.map((sym) => (
                      <span key={sym} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
                        {sym}
                      </span>
                    ))}
                  </div>
                  {/* # positions */}
                  <p className="text-[11px] text-foreground/60 text-center tabular-nums">{bucket.positions.length}</p>
                  {/* Total premium */}
                  <p className={`text-[12px] font-black tabular-nums text-right ${
                    bucket.totalPremium > 0 ? "text-green-500" : bucket.totalPremium < 0 ? "text-red-500" : "text-foreground/40"
                  }`}>{fmt$(bucket.totalPremium)}</p>
                  {/* Status badge */}
                  <div className="flex justify-end">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${statusClass}`}>
                      {statusLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
