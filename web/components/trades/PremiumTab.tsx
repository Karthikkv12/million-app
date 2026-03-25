"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPremiumDashboard, fetchHoldings, syncPremiumLedger,
  PremiumSymbolRow, PremiumWeekRow,
} from "@/lib/api";
import { EmptyState, SkeletonCard } from "@/components/ui";
import { ChevronDown, ChevronUp, BarChart2, DollarSign } from "lucide-react";

export function PremiumTab() {
  const qc = useQueryClient();
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["premiumDashboard"],
    queryFn: fetchPremiumDashboard,
    staleTime: 30_000,
  });
  const { data: holdings = [] } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
    staleTime: 60_000,
  });

  const toggleWeek = (weekId: number) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekId)) {
        next.delete(weekId);
      } else {
        next.add(weekId);
      }
      return next;
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncPremiumLedger();
      await refetch();
      qc.invalidateQueries({ queryKey: ["holdings"] });
    } finally {
      setSyncing(false);
    }
  };

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonCard key={i} rows={3} />)}</div>;
  if (!data) return <EmptyState icon={DollarSign} title="No premium data" body="Add holdings and positions to track collected premium." />;

  const { by_symbol, by_week, grand_total } = data;
  const pctRealized = grand_total.total_premium_sold > 0
    ? (grand_total.realized_premium / grand_total.total_premium_sold) * 100
    : 0;

  return (
    <div className="space-y-6">

      {/* ── 3 stat cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Total Collected</p>
          <p className="text-2xl font-black text-green-500">${grand_total.total_premium_sold.toFixed(2)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">gross premium ever sold</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Realized (Locked In)</p>
          <p className="text-2xl font-black text-green-500">${grand_total.realized_premium.toFixed(2)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">{pctRealized.toFixed(1)}% of total collected</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">In-Flight (Active)</p>
          <p className="text-2xl font-black text-green-500">${grand_total.unrealized_premium.toFixed(2)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">locks in when options close/expire</p>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-3 text-[11px] text-foreground/60">
        <span><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />Realized = closed/expired, permanently reduces cost basis</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-green-500/60 mr-1" />In-Flight = active positions, reduces live adj basis until settled</span>
      </div>

      {/* ── By-symbol table (active holdings only) ── */}
      {(() => {
        const activeRows = by_symbol.filter((r: PremiumSymbolRow) => r.shares > 0);
        const exitedRows = by_symbol.filter((r: PremiumSymbolRow) => r.shares === 0);
        return (
          <>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <h3 className="text-sm font-bold text-foreground">By Symbol</h3>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-blue-500 text-white font-semibold hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {syncing ? "Syncing…" : "Sync Ledger"}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                      {(["Symbol", "Avg Cost", "Adj Basis", "Live Adj"] as const).map((h) => (
                        <th key={h} className="px-4 py-2.5 text-right first:text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                      <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          Sold $
                          <span title="Gross premium collected when positions were opened. Difference vs Realized = in-flight unrealized premium (active positions) + any buyback debits paid to close early." className="cursor-help text-foreground/40 hover:text-foreground/70 text-[10px] leading-none">ⓘ</span>
                        </span>
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          Realized $
                          <span title="Net premium locked in from closed/expired positions only. Lower than Sold$ when: (1) positions are still active (in-flight), or (2) a position was bought back early at a loss." className="cursor-help text-foreground/40 hover:text-foreground/70 text-[10px] leading-none">ⓘ</span>
                        </span>
                      </th>
                      {(["In-Flight $", "# Pos"] as const).map((h) => (
                        <th key={h} className="px-4 py-2.5 text-right font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.map((row: PremiumSymbolRow) => {
                      const hasRealized    = row.realized_premium > 0;
                      const hasUnrealized  = row.unrealized_premium > 0;
                      return (
                      <tr key={row.holding_id} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                        <td className="px-4 py-3 font-bold text-foreground">{row.symbol}</td>
                        <td className="px-4 py-3 text-right text-foreground/70">${row.cost_basis.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right">
                          {hasRealized
                            ? <span className="text-green-500 font-semibold">${row.adj_basis_stored.toFixed(2)}</span>
                            : <span className="text-foreground/40">${row.adj_basis_stored.toFixed(2)}</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right">
                          {hasUnrealized || hasRealized ? (
                            <span className={hasRealized ? "text-green-500 font-semibold" : "text-green-500 font-semibold"}>
                              ${row.live_adj_basis.toFixed(2)}
                              {!hasRealized && <span className="ml-1 text-[9px] font-normal opacity-60">in-flight</span>}
                            </span>
                          ) : (
                            <span className="text-foreground/30">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-green-500">${row.total_premium_sold.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right">
                          {row.realized_premium > 0
                            ? <span className="text-green-500 font-semibold">${row.realized_premium.toFixed(2)}</span>
                            : <span className="text-foreground/30">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.unrealized_premium > 0
                            ? <span className="text-green-500 font-semibold">${row.unrealized_premium.toFixed(2)}</span>
                            : <span className="text-foreground/30">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground/60">{row.positions}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2)] font-bold">
                      <td className="px-4 py-3 text-foreground text-[11px] uppercase tracking-wide">Total</td>
                      <td colSpan={3} />
                      <td className="px-4 py-3 text-right text-green-500">${grand_total.total_premium_sold.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-green-500">
                        {grand_total.realized_premium > 0 ? `$${grand_total.realized_premium.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-green-500">
                        {grand_total.unrealized_premium > 0 ? `$${grand_total.unrealized_premium.toFixed(2)}` : "—"}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ── Exited positions card ── */}
            {exitedRows.length > 0 && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border)]">
                  <h3 className="text-sm font-bold text-foreground">Exited Positions</h3>
                  <p className="text-[10px] text-foreground/40 mt-0.5">No shares held — shows adj basis at time of exit</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                        {["Symbol", "Orig Cost", "Adj at Exit", "Total Sold $", "Realized $", "# Pos"].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-right first:text-left font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {exitedRows.map((row: PremiumSymbolRow) => {
                        const basisReduction = row.cost_basis - row.adj_basis_stored;
                        return (
                          <tr key={row.holding_id} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                            <td className="px-4 py-3 font-bold text-foreground">{row.symbol}</td>
                            <td className="px-4 py-3 text-right text-foreground/50">${row.cost_basis.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={basisReduction > 0 ? "text-green-500 font-semibold" : "text-foreground/70"}>
                                ${row.adj_basis_stored.toFixed(2)}
                              </span>
                              {basisReduction > 0 && (
                                <span className="ml-1 text-[10px] text-green-500/50">(−${basisReduction.toFixed(2)})</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-green-500">${row.total_premium_sold.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right">
                              {row.realized_premium > 0
                                ? <span className="text-green-500 font-semibold">${row.realized_premium.toFixed(2)}</span>
                                : <span className="text-foreground/30">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right text-foreground/60">{row.positions}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* ── By-week breakdown ── */}
      {by_week.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-foreground px-1">By Week</h3>
          {by_week.map((week: PremiumWeekRow) => (
            <div key={week.week_id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-2)] transition-colors"
                onClick={() => toggleWeek(week.week_id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-foreground">Week {week.week_id}</span>
                  <span className="text-xs text-foreground/50">{week.week_label}</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="text-sm font-bold text-green-500">${week.total_premium_sold.toFixed(2)}</span>
                    <span className="text-[10px] text-foreground/40 ml-1">sold</span>
                  </div>
                  {week.realized_premium > 0 && (
                    <div className="text-right">
                      <span className="text-xs text-green-500 font-semibold">${week.realized_premium.toFixed(2)}</span>
                      <span className="text-[10px] text-foreground/40 ml-1">realized</span>
                    </div>
                  )}
                  {week.unrealized_premium > 0 && (
                    <div className="text-right">
                      <span className="text-xs text-green-500 font-semibold">${week.unrealized_premium.toFixed(2)}</span>
                      <span className="text-[10px] text-foreground/40 ml-1">in-flight</span>
                    </div>
                  )}
                  {expandedWeeks.has(week.week_id)
                    ? <ChevronUp size={14} className="text-foreground/40" />
                    : <ChevronDown size={14} className="text-foreground/40" />}
                </div>
              </button>
              {expandedWeeks.has(week.week_id) && (
                <div className="border-t border-[var(--border)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] text-foreground/50 uppercase tracking-wide bg-[var(--surface-2)]">
                        {["Symbol", "Sold $", "Realized $", "In-Flight $"].map((h) => (
                          <th key={h} className="px-4 py-2 text-right first:text-left font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {week.symbols.map((sym) => (
                        <tr key={sym.symbol} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]">
                          <td className="px-4 py-2 font-semibold text-foreground">{sym.symbol}</td>
                          <td className="px-4 py-2 text-right text-green-500 font-semibold">${sym.sold.toFixed(2)}</td>
                          <td className="px-4 py-2 text-right">
                            {sym.realized > 0
                              ? <span className="text-green-500 font-semibold">${sym.realized.toFixed(2)}</span>
                              : <span className="text-foreground/30">—</span>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {sym.unrealized > 0
                              ? <span className="text-green-500 font-semibold">${sym.unrealized.toFixed(2)}</span>
                              : <span className="text-foreground/30">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Premium per share ── */}
      {(() => {
        const rows = by_symbol
          .map((r) => {
            const h = holdings.find((h) => h.symbol === r.symbol);
            const shares = h?.shares ?? 0;
            return { symbol: r.symbol, shares, sold: r.total_premium_sold, perShare: shares > 0 ? r.total_premium_sold / shares : 0 };
          })
          .filter((r) => r.perShare > 0)
          .sort((a, b) => b.perShare - a.perShare);
        const maxPs = Math.max(...rows.map((r) => r.perShare), 1);
        if (rows.length === 0) return null;
        return (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 size={14} className="text-green-500" />
              <h3 className="text-sm font-bold text-foreground">Premium per Share</h3>
              <span className="ml-auto text-[10px] text-foreground/40">how hard each holding is working</span>
            </div>
            <div className="space-y-2.5">
              {rows.map((r) => {
                const barPct = Math.max(4, (r.perShare / maxPs) * 100);
                return (
                  <div key={r.symbol} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-foreground w-12 shrink-0">{r.symbol}</span>
                    <div className="flex-1 h-5 bg-[var(--surface-2)] rounded-lg overflow-hidden">
                      <div className="h-full bg-green-500/70 rounded-lg flex items-center px-2 transition-all" style={{ width: `${barPct}%` }}>
                        {barPct > 25 && <span className="text-[10px] font-bold text-white">${r.perShare.toFixed(2)}/sh</span>}
                      </div>
                    </div>
                    {barPct <= 25 && <span className="text-[10px] font-semibold text-green-500 shrink-0">${r.perShare.toFixed(2)}/sh</span>}
                    <span className="text-[10px] text-foreground/40 w-16 text-right shrink-0">{r.shares} shares</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Notation key ── */}
      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 text-[11px] text-foreground/60 space-y-2">
        <p className="text-[11px] font-bold text-foreground/80 uppercase tracking-wide mb-2">Notation</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
          <div><span className="font-semibold text-foreground/80">Avg Cost</span> — original purchase price per share (never changes)</div>
          <div><span className="font-semibold text-foreground/80">Adj Basis</span> — cost basis after <span className="text-green-500">closed/expired</span> premium locks in. Shown dimmed when no options have closed yet (equals original cost until then)</div>
          <div><span className="font-semibold text-foreground/80">Live Adj</span> — true current breakeven = Adj Basis − in-flight premium/share</div>
          <div><span className="font-semibold text-foreground/80">BE (Breakeven)</span> — same as Live Adj; price below which you start losing money today</div>
          <div><span className="font-semibold text-foreground/80">CC (Covered Call)</span> — sell a call against shares you own</div>
          <div><span className="font-semibold text-foreground/80">CSP (Cash-Secured Put)</span> — sell a put holding cash</div>
          <div><span className="font-semibold text-green-500">Realized $</span> — premium permanently locked in from <span className="font-semibold">closed or expired</span> positions</div>
          <div><span className="font-semibold text-green-500">In-Flight $</span> — premium from <span className="font-semibold">still-active</span> positions</div>
          <div><span className="font-semibold text-foreground/80"># Pos</span> — number of original option positions logged against this holding</div>
          <div><span className="font-semibold text-foreground/80">Sold $</span> — gross premium ever collected (realized + in-flight combined)</div>
        </div>
      </div>

    </div>
  );
}
