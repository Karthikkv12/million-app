"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPositions, deletePosition, fetchHoldings, fetchPremiumDashboard,
  fetchMarketQuotes, WeeklySnapshot, OptionPosition,
} from "@/lib/api";
import { EmptyState, SkeletonCard } from "@/components/ui";
import { Plus, CheckCircle2, LockOpen, Activity } from "lucide-react";
import { fmt$ } from "./TradesHelpers";
import { PositionRow } from "./PositionRow";
import { PositionForm } from "./PositionForm";
import { CompleteWeekModal, ReopenWeekModal } from "./TradeModals";

export function PositionsTab({ week }: { week: WeeklySnapshot }) {
  const qc = useQueryClient();
  const { data: positions = [], isLoading } = useQuery({
    queryKey: ["positions", week.id],
    queryFn: () => fetchPositions(week.id),
    staleTime: 30_000,
  });
  const { data: holdings = [] } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
    staleTime: 60_000,
  });
  const { data: premDash } = useQuery({
    queryKey: ["premiumDashboard"],
    queryFn: fetchPremiumDashboard,
    staleTime: 60_000,
  });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OptionPosition | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [showReopen, setShowReopen] = useState(false);

  const deleteMut = useMutation({
    mutationFn: deletePosition,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions", week.id] });
      qc.invalidateQueries({ queryKey: ["holdings"] });
      qc.invalidateQueries({ queryKey: ["premiumDashboard"] });
    },
  });

  const thisWeekPositions = useMemo(() => positions.filter((p) => !p.carried), [positions]);
  const carriedPositions   = useMemo(() => positions.filter((p) => p.carried === true), [positions]);

  const CLOSED_STATUSES = ["CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"];
  const openPositions   = useMemo(() => thisWeekPositions.filter((p) => !CLOSED_STATUSES.includes(p.status)), [thisWeekPositions]);
  const closedPositions = useMemo(() => thisWeekPositions.filter((p) => CLOSED_STATUSES.includes(p.status)),  [thisWeekPositions]);

  const bySymbol = useMemo(() => {
    const map = new Map<string, OptionPosition[]>();
    for (const p of openPositions) {
      const arr = map.get(p.symbol) ?? [];
      arr.push(p);
      map.set(p.symbol, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [openPositions]);

  const bySymbolClosed = useMemo(() => {
    const map = new Map<string, OptionPosition[]>();
    for (const p of closedPositions) {
      const arr = map.get(p.symbol) ?? [];
      arr.push(p);
      map.set(p.symbol, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [closedPositions]);

  const bySymbolCarried = useMemo(() => {
    const map = new Map<string, OptionPosition[]>();
    for (const p of carriedPositions) {
      const arr = map.get(p.symbol) ?? [];
      arr.push(p);
      map.set(p.symbol, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [carriedPositions]);

  const totalPremium = thisWeekPositions.reduce((s, p) => s + (p.total_premium ?? 0), 0);

  const weeklyBasisReduction = useMemo(() => {
    const byHolding = new Map<number, { totalPremDollars: number; shares: number }>();
    for (const p of openPositions) {
      if (p.holding_id == null || p.premium_in == null) continue;
      const holding = holdings.find((h) => h.id === p.holding_id);
      if (!holding) continue;
      const existing = byHolding.get(p.holding_id) ?? { totalPremDollars: 0, shares: holding.shares };
      existing.totalPremDollars += p.premium_in * p.contracts * 100;
      byHolding.set(p.holding_id, existing);
    }
    if (byHolding.size === 0) return null;
    let totalDollars = 0;
    let totalShares  = 0;
    byHolding.forEach(({ totalPremDollars, shares }) => {
      totalDollars += totalPremDollars;
      totalShares  += shares;
    });
    return totalShares > 0 ? totalDollars / totalShares : null;
  }, [openPositions, holdings]);

  const activeCount = openPositions.filter((p) => p.status === "ACTIVE").length;

  const activeSymbols = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const p of positions) {
      if (p.status === "ACTIVE" && !seen.has(p.symbol)) {
        seen.add(p.symbol);
        result.push(p.symbol);
      }
    }
    return result;
  }, [positions]);
  const { data: liveQuotes } = useQuery({
    queryKey: ["liveQuotes", activeSymbols.join(",")],
    queryFn: () => fetchMarketQuotes(activeSymbols),
    enabled: activeSymbols.length > 0,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
  const liveSpotMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of liveQuotes ?? []) {
      if (q.price != null) map.set(q.symbol, q.price);
    }
    return map;
  }, [liveQuotes]);

  // Silence unused import
  void fmt$;

  return (
    <div>
      {positions.length > 0 && (() => {
        const stockValue      = holdings.reduce((acc, h) => acc + h.cost_basis * h.shares, 0);
        const portfolioValue  = week.account_value ?? stockValue;
        const totalPremCollected = premDash?.grand_total.total_premium_sold ?? 0;
        const coveragePct        = portfolioValue > 0 ? (totalPremCollected / portfolioValue) * 100 : null;
        const stockCoveragePct   = stockValue > 0 ? (totalPremCollected / stockValue) * 100 : null;
        const weekPositionsWithPrem = thisWeekPositions.filter((p) => p.premium_in != null && p.strike > 0);
        const avgPremPerK = weekPositionsWithPrem.length > 0
          ? weekPositionsWithPrem.reduce((acc, p) => acc + (p.strike > 0 ? ((p.premium_in ?? 0) / p.strike) * 1000 : 0), 0) / weekPositionsWithPrem.length
          : null;
        const totalCapAtRisk = positions
          .filter((p) => p.status === "ACTIVE")
          .reduce((acc, p) => acc + p.strike * p.contracts * 100, 0);
        const inFlightPrem = premDash?.grand_total.unrealized_premium ?? 0;
        const realizedPrem = premDash?.grand_total.realized_premium   ?? 0;

        // Week realized cost (buy-backs) and net P&L — scoped to this week's non-carried positions
        // premium_out is stored as a negative number (debit), matching PositionRow's (premIn + premOut) formula
        const weekCostToClose = closedPositions.reduce(
          (acc, p) => acc + Math.abs(p.premium_out ?? 0) * p.contracts * 100, 0
        );
        const weekGrossCollected = closedPositions.reduce(
          (acc, p) => acc + (p.premium_in ?? 0) * p.contracts * 100, 0
        );
        const weekNetRealized = weekGrossCollected - weekCostToClose;
        const hasClosed = closedPositions.length > 0;

        // ITM Assignment Risk card — live, updates with liveSpotMap every 30s
        const itmPositions = positions.filter((p) => {
          if (p.status !== "ACTIVE") return false;
          const spot = liveSpotMap.get(p.symbol);
          if (spot == null || spot <= 0) return false;
          if (p.option_type === "CALL") return spot > p.strike;
          if (p.option_type === "PUT")  return spot < p.strike;
          return false;
        });
        const itmAssignmentValue = itmPositions.reduce((acc, p) => acc + p.strike * p.contracts * 100, 0);
        const itmPremCollected   = itmPositions.reduce((acc, p) => acc + (p.premium_in ?? 0) * p.contracts * 100, 0);
        const itmNetProceeds     = itmAssignmentValue + itmPremCollected;
        // Gross collected across ALL this week's positions (open + closed)
        const weekAllGross = thisWeekPositions.reduce(
          (acc, p) => acc + (p.premium_in ?? 0) * p.contracts * 100, 0
        );
        // totalPremium already nets out premium_out on closed positions (backend-computed total_premium)
        // so: net current = totalPremium = weekAllGross − buy-backs paid so far

        const hasLiveData        = liveSpotMap.size > 0;

        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-10 gap-2 mb-4">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Week P&amp;L</p>
              <p className={`text-base font-black ${totalPremium >= 0 ? "text-green-500" : "text-red-400"}`}>
                {totalPremium >= 0 ? "$" : "-$"}{Math.abs(totalPremium).toFixed(2)}
              </p>
              <p className="text-[10px] text-foreground/40 mt-0.5">
                ${weekAllGross.toFixed(2)} gross
                {weekCostToClose > 0 && <span className="text-red-400/70"> − ${weekCostToClose.toFixed(2)} closed</span>}
              </p>
            </div>
            {hasClosed && (
              <div className={`border rounded-xl p-3 ${weekNetRealized >= 0 ? "bg-[var(--surface)] border-[var(--border)]" : "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800"}`}>
                <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Net Realized</p>
                <p className={`text-base font-black ${weekNetRealized >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {weekNetRealized >= 0 ? "$" : "-$"}{Math.abs(weekNetRealized).toFixed(2)}
                </p>
                <p className="text-[10px] text-foreground/40 mt-0.5">locked in (closed positions)</p>
              </div>
            )}
            {weeklyBasisReduction != null && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
                <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Weekly Basis ↓</p>
                <p className="text-base font-black text-emerald-400">-${weeklyBasisReduction.toFixed(2)}<span className="text-xs font-normal text-foreground/40">/sh</span></p>
                <p className="text-[10px] text-foreground/40 mt-0.5">this week&apos;s premium ÷ shares</p>
              </div>
            )}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Active Positions</p>
              <p className="text-base font-black text-blue-500">{activeCount} <span className="text-xs font-normal text-foreground/40">/ {thisWeekPositions.length}</span></p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Avg Prem / $1K</p>
              {avgPremPerK != null
                ? <p className="text-base font-black text-blue-400">${avgPremPerK.toFixed(2)}</p>
                : <p className="text-base font-black text-foreground/30">—</p>}
              <p className="text-[10px] text-foreground/40 mt-0.5">this week&apos;s positions</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Stock Value at Stake</p>
              {stockValue > 0
                ? <p className="text-base font-black text-yellow-500">${stockValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                : <p className="text-base font-black text-foreground/30">—</p>}
              {stockCoveragePct != null && <p className="text-[10px] text-foreground/40 mt-0.5">{stockCoveragePct.toFixed(2)}% covered</p>}
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Portfolio Value</p>
              {week.account_value != null
                ? <p className="text-base font-black text-purple-400">${week.account_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                : <p className="text-base font-black text-foreground/30">—</p>}
              <p className="text-[10px] text-foreground/40 mt-0.5">this week</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Portfolio Coverage</p>
              {coveragePct != null ? (
                <>
                  <p className="text-base font-black text-orange-400">{coveragePct.toFixed(2)}%</p>
                  <div className="mt-1 h-1 bg-[var(--surface-2)] rounded-full overflow-hidden">
                    <div className="h-full bg-orange-400 rounded-full" style={{ width: `${Math.min(100, coveragePct)}%` }} />
                  </div>
                </>
              ) : (
                <p className="text-base font-black text-foreground/30">—</p>
              )}
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Capital at Risk</p>
              {totalCapAtRisk > 0
                ? <p className="text-base font-black text-red-400">${totalCapAtRisk.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                : <p className="text-base font-black text-foreground/30">—</p>}
              <p className="text-[10px] text-foreground/40 mt-0.5">active strike obligations</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
              <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">In-Flight Prem</p>
              {inFlightPrem > 0
                ? <p className="text-base font-black text-cyan-400">${inFlightPrem.toFixed(2)}</p>
                : <p className="text-base font-black text-foreground/30">—</p>}
              <p className="text-[10px] text-foreground/40 mt-0.5">locked: ${realizedPrem.toFixed(2)}</p>
            </div>
            {/* ITM Assignment Risk — live card, only shown when live quotes loaded */}
            <div className={`border rounded-xl p-3 col-span-2 sm:col-span-2 xl:col-span-2 ${
              itmPositions.length > 0
                ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800"
                : "bg-[var(--surface)] border-[var(--border)]"
            }`}>
              <div className="flex items-center gap-1.5 mb-1">
                <p className={`text-[10px] font-semibold uppercase tracking-wide ${
                  itmPositions.length > 0 ? "text-red-500" : "text-foreground/60"
                }`}>
                  ITM / Assignment Risk
                </p>
                {hasLiveData && (
                  <span className="text-[8px] px-1 py-0.5 rounded-full bg-green-500/15 text-green-500 font-bold tracking-wide">● LIVE</span>
                )}
              </div>
              {!hasLiveData ? (
                <p className="text-base font-black text-foreground/30">Loading…</p>
              ) : itmPositions.length === 0 ? (
                <>
                  <p className="text-base font-black text-green-500">All Clear</p>
                  <p className="text-[10px] text-foreground/40 mt-0.5">no active positions ITM</p>
                </>
              ) : (
                <>
                  <p className="text-base font-black text-red-500">
                    ${itmNetProceeds.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-[10px] text-red-400/80 mt-0.5">
                    {itmPositions.length} ITM · ${itmAssignmentValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} at strike
                    {" + "}${itmPremCollected.toLocaleString(undefined, { maximumFractionDigits: 0 })} prem
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {itmPositions.map((p) => {
                      const spot = liveSpotMap.get(p.symbol);
                      const depth = spot != null ? Math.abs(spot - p.strike) : null;
                      return (
                        <span key={p.id} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-500">
                          {p.symbol} ${p.strike}{depth != null ? ` (${depth.toFixed(1)} deep)` : ""}
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          {!week.is_complete && (
            <button
              onClick={() => { setEditing(null); setShowForm((v) => !v); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition"
            >
              <Plus size={12} /> Add Position
            </button>
          )}
          {!week.is_complete && positions.length > 0 && (
            <button
              onClick={() => setShowComplete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition"
            >
              <CheckCircle2 size={12} /> <span className="hidden sm:inline">Mark Week Complete</span><span className="sm:hidden">Complete</span>
            </button>
          )}
        </div>
        {week.is_complete && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs text-green-600 font-semibold">
              <CheckCircle2 size={13} /> Week complete
            </span>
            <button
              onClick={() => setShowReopen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-50 dark:bg-orange-900/20 text-orange-500 dark:text-orange-400 text-xs font-semibold hover:bg-orange-100 dark:hover:bg-orange-900/40 border border-orange-200 dark:border-orange-800 transition"
            >
              <LockOpen size={11} /> Re-open Week
            </button>
          </div>
        )}
      </div>

      {showComplete && <CompleteWeekModal week={week} onDone={() => setShowComplete(false)} />}
      {showReopen   && <ReopenWeekModal  week={week} onDone={() => setShowReopen(false)} />}

      {showForm && !week.is_complete && (
        <PositionForm weekId={week.id} onDone={() => setShowForm(false)} />
      )}
      {editing && (
        <PositionForm weekId={week.id} editPos={editing} onDone={() => setEditing(null)} />
      )}

      {isLoading && <div className="space-y-2">{[1, 2, 3].map((i) => <SkeletonCard key={i} rows={1} />)}</div>}

      {!isLoading && positions.length === 0 && (
        <EmptyState
          icon={Activity}
          title="No positions this week"
          body="Click 'Add Position' to log your first option sell."
        />
      )}

      {!isLoading && positions.length > 0 && (
        <div className="space-y-4">
          {/* ── Open / Active positions ── */}
          {openPositions.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <span className="text-[11px] font-bold uppercase tracking-wide text-foreground/70">Open Positions</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-foreground/50 font-semibold">{openPositions.length}</span>
              </div>
              <div className="sm:hidden divide-y divide-[var(--border)]">
                {bySymbol.map(([, rows]) =>
                  rows.map((p) => (
                    <PositionRow
                      key={p.id}
                      pos={p}
                      liveSpot={liveSpotMap.get(p.symbol)}
                      onEdit={() => { setEditing(p); setShowForm(false); }}
                      onDelete={() => deleteMut.mutate(p.id)}
                    />
                  ))
                )}
              </div>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                      {["Symbol", "Cts", "Strike", "P/C", "Sold", "Expiry", "DTE", "Prem In", "Prem Out", "/$1K", "ROI", "Status", "Actions"].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bySymbol.map(([, rows]) =>
                      rows.map((p) => (
                        <PositionRow
                          key={p.id}
                          pos={p}
                          liveSpot={liveSpotMap.get(p.symbol)}
                          onEdit={() => { setEditing(p); setShowForm(false); }}
                          onDelete={() => deleteMut.mutate(p.id)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Closed / Expired / Assigned this week ── */}
          {closedPositions.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden opacity-80">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
                <span className="text-[11px] font-bold uppercase tracking-wide text-foreground/50">Closed This Week</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-foreground/40 font-semibold">{closedPositions.length}</span>
                <span className="text-[10px] text-foreground/40 hidden sm:inline">— realized P&amp;L locked in</span>
              </div>
              <div className="sm:hidden divide-y divide-[var(--border)]">
                {bySymbolClosed.map(([, rows]) =>
                  rows.map((p) => (
                    <PositionRow
                      key={p.id}
                      pos={p}
                      liveSpot={null}
                      onEdit={() => { setEditing(p); setShowForm(false); }}
                      onDelete={() => deleteMut.mutate(p.id)}
                    />
                  ))
                )}
              </div>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] text-foreground/40 uppercase tracking-wide bg-[var(--surface)]">
                      {["Symbol", "Cts", "Strike", "P/C", "Sold", "Expiry", "DTE", "Prem In", "Prem Out", "Net P&L", "Status", "Actions"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bySymbolClosed.map(([, rows]) =>
                      rows.map((p) => (
                        <PositionRow
                          key={p.id}
                          pos={p}
                          liveSpot={null}
                          onEdit={() => { setEditing(p); setShowForm(false); }}
                          onDelete={() => deleteMut.mutate(p.id)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {carriedPositions.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">↳ Carried from prior weeks</span>
                <span className="text-[10px] text-foreground/40 hidden sm:inline">— still open, P&amp;L realises when you close them</span>
              </div>
              <div className="bg-[var(--surface)] border border-amber-200 dark:border-amber-800/50 rounded-2xl overflow-hidden">
                <div className="sm:hidden divide-y divide-[var(--border)]">
                  {bySymbolCarried.map(([, rows]) =>
                    rows.map((p) => (
                      <PositionRow
                        key={p.id}
                        pos={p}
                        liveSpot={liveSpotMap.get(p.symbol)}
                        onEdit={() => { setEditing(p); setShowForm(false); }}
                        onDelete={() => deleteMut.mutate(p.id)}
                      />
                    ))
                  )}
                </div>
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-amber-50/60 dark:bg-amber-900/10">
                        {["Symbol", "Cts", "Strike", "P/C", "Sold", "Expiry", "DTE", "Prem In", "/$1K", "ROI"].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bySymbolCarried.map(([, rows]) =>
                        rows.map((p) => (
                          <PositionRow
                            key={p.id}
                            pos={p}
                            liveSpot={liveSpotMap.get(p.symbol)}
                            onEdit={() => { setEditing(p); setShowForm(false); }}
                            onDelete={() => deleteMut.mutate(p.id)}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
