"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchHoldings, createHolding, updateHolding, deleteHolding,
  fetchHoldingEvents, seedHoldingsFromPositions, recalculateHoldings,
  syncPremiumLedger, fetchStockHistory, StockHolding, HoldingEvent,
} from "@/lib/api";
import { EmptyState, SkeletonCard } from "@/components/ui";
import { Plus, X, ChevronDown, ChevronUp, Search, Wallet, DollarSign, TrendingUp } from "lucide-react";
import { inp, datInp } from "./TradesHelpers";
import TickerSearchInput from "@/components/TickerSearchInput";

interface HoldingFormState {
  symbol: string; company_name: string; shares: string;
  cost_basis: string; acquired_date: string; notes: string;
}

function HoldingLivePriceMobile({ symbol, liveAdjBasis, shares, status, realizedGain }: { symbol: string; liveAdjBasis: number; shares: number; status: string; realizedGain?: number | null }) {
  const isClosed = status === "CLOSED";
  const { data } = useQuery({
    queryKey: ["stockHistory", symbol, "1d"],
    queryFn: () => fetchStockHistory(symbol, "1d", "5m"),
    staleTime: 60_000,
    refetchInterval: 120_000,
    enabled: !isClosed, // no live price needed for closed holdings
  });
  // For closed / called-away holdings, show the stored realized gain instead
  if (isClosed) {
    if (realizedGain == null) return null;
    return (
      <span className={`font-semibold ${realizedGain >= 0 ? "text-green-500" : "text-red-500"}`}>
        Realized: {realizedGain >= 0 ? "+" : ""}${realizedGain.toFixed(0)}
      </span>
    );
  }
  const price = data?.current_price;
  if (price == null) return null;
  const unrealized = (price - liveAdjBasis) * shares;
  return (
    <span className={`font-semibold ${unrealized >= 0 ? "text-green-500" : "text-red-500"}`}>
      ${price.toFixed(2)} · {unrealized >= 0 ? "+" : ""}${unrealized.toFixed(0)}
    </span>
  );
}

function HoldingLivePrice({ symbol, liveAdjBasis, shares, status, realizedGain }: { symbol: string; liveAdjBasis: number; shares: number; status: string; realizedGain?: number | null }) {
  const isClosed = status === "CLOSED";
  const { data } = useQuery({
    queryKey: ["stockHistory", symbol, "1d"],
    queryFn: () => fetchStockHistory(symbol, "1d", "5m"),
    staleTime: 60_000,
    refetchInterval: 120_000,
    enabled: !isClosed, // no live price needed for closed holdings
  });
  // For closed / called-away holdings, show stored realized gain instead of live price
  if (isClosed) {
    if (realizedGain == null) return <td className="px-3 py-2.5 text-foreground/40 text-xs">—</td>;
    return (
      <td className="px-3 py-2.5 text-sm">
        <div className="text-[10px] text-foreground/50 mb-0.5">Realized P&amp;L</div>
        <div className={`font-bold text-sm ${realizedGain >= 0 ? "text-green-500" : "text-red-500"}`}>
          {realizedGain >= 0 ? "+" : ""}${realizedGain.toFixed(0)}
        </div>
      </td>
    );
  }
  const price = data?.current_price;
  if (price == null) return <td className="px-3 py-2.5 text-foreground/40 text-xs">—</td>;
  const unrealized = (price - liveAdjBasis) * shares;
  return (
    <td className="px-3 py-2.5 text-sm">
      <div className="font-semibold text-foreground">${price.toFixed(2)}</div>
      <div className={`text-[10px] font-bold ${unrealized >= 0 ? "text-green-500" : "text-red-500"}`}>
        {unrealized >= 0 ? "+" : ""}${unrealized.toFixed(0)}
        <span className="ml-1 font-normal text-foreground/40">
          ({((price - liveAdjBasis) / liveAdjBasis * 100).toFixed(1)}%)
        </span>
      </div>
    </td>
  );
}

function HoldingRow({ h, onEdit, onClose, onDelete, onReenter, closedTable }: {
  h: StockHolding;
  onEdit: () => void;
  onClose: (closePrice: number) => void;
  onDelete: () => void;
  onReenter: () => void;
  closedTable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [closePriceStr, setClosePriceStr] = useState("");

  const liveAdj          = h.live_adj_basis       ?? h.adjusted_cost_basis;
  const storedAdj        = h.adjusted_cost_basis;
  const downsideBasis    = h.downside_basis        ?? liveAdj;
  const upsideBasis      = h.upside_basis          ?? null;
  const realizedPrem     = h.realized_premium      ?? 0;
  const unrealizedPrem   = h.unrealized_premium    ?? 0;
  const totalPremSold    = h.total_premium_sold    ?? 0;
  const basisReduction   = h.basis_reduction       ?? 0;

  const realizedPerShare   = h.shares > 0 ? realizedPrem   / h.shares : 0;
  const unrealizedPerShare = h.shares > 0 ? unrealizedPrem / h.shares : 0;

  // ── Assignment status helpers ───────────────────────────────────────────
  const assignType      = h.last_assignment_type ?? null;
  const assignDate      = h.last_assignment_date ? h.last_assignment_date.slice(0, 10) : null;
  // Reopened: ACTIVE holding that carries a prior assignment history
  const wasReopened     = h.status === "ACTIVE" && assignType !== null;

  // Hint shown on CLOSED holdings about basis continuity
  const BasisCarryHint = () => {
    if (h.status !== "CLOSED") return null;
    const savings = h.cost_basis - storedAdj;
    if (savings <= 0.005) return null;
    return (
      <div className="text-[9px] text-foreground/50 mt-0.5">
        Adj: <span className="font-bold text-blue-400">${storedAdj.toFixed(2)}</span>
        <span className="text-green-500 font-semibold"> −${savings.toFixed(2)}/sh</span> saved
      </div>
    );
  };


  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["holdingEvents", h.id],
    queryFn: () => fetchHoldingEvents(h.id),
    enabled: expanded,
    staleTime: 30_000,
  });

  const eventBg = (type: string) =>
    type === "CC_ASSIGNED"  ? "bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800"
    : type === "CC_EXPIRED"   ? "bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800"
    : type === "CSP_ASSIGNED" ? "bg-yellow-50/50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800"
    : "bg-[var(--surface)] border-[var(--border)]";
  const eventTextColor = (type: string) =>
    type === "CC_ASSIGNED"  ? "text-green-600"
    : type === "CC_EXPIRED"   ? "text-blue-500"
    : type === "CSP_ASSIGNED" ? "text-yellow-600"
    : "text-foreground/60";

  const EventList = ({ desktop }: { desktop?: boolean }) => (
    <>
      {totalPremSold > 0 && (
        <div className={`flex flex-wrap items-center gap-3 mb-2 px-3 py-2 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 text-xs`}>
          <span className="font-semibold text-foreground/70">Premium{desktop ? " history" : ""} for {h.symbol}:</span>
          <span className="text-foreground/60">Total: <span className="font-bold text-foreground">${totalPremSold.toFixed(2)}</span></span>
          <span className="text-green-600 dark:text-green-400">Realized: <span className="font-bold">${realizedPrem.toFixed(2)}</span></span>
          <span className="text-amber-600 dark:text-amber-400">In-flight: <span className="font-bold">${unrealizedPrem.toFixed(2)}</span></span>
        </div>
      )}
      {eventsLoading ? (
        <p className="text-xs text-foreground/50">Loading history…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-foreground/50">{desktop ? "No events yet — recorded automatically when linked option positions change status." : "No events yet."}</p>
      ) : (
        <div className="space-y-1.5">
          {events.map((ev: HoldingEvent) => (
            <div key={ev.id} className={`flex items-start gap-3 text-xs px-3 py-2 rounded-xl border ${eventBg(ev.event_type)}`}>
              <span className={`font-bold shrink-0 ${eventTextColor(ev.event_type)}`}>{ev.event_type.replace("_", " ")}</span>
              <span className="text-foreground/70 flex-1">{ev.description}</span>
              {ev.realized_gain != null && (
                <span className={`font-bold shrink-0 ${ev.realized_gain >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {ev.realized_gain >= 0 ? "+" : ""}{ev.realized_gain.toFixed(2)}
                </span>
              )}
              <span className="text-foreground/40 shrink-0">{ev.created_at.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <>
      {/* ── Mobile card ── */}
      <div className="sm:hidden border-b border-[var(--border)]">
        <div className="px-3 py-3">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-foreground text-base">{h.symbol}</span>
              </div>
              {h.company_name && <div className="text-[10px] text-foreground/50">{h.company_name}</div>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => setExpanded((v) => !v)} className="text-[10px] px-2 py-1 rounded-lg bg-[var(--surface-2)] text-foreground/70 font-semibold flex items-center gap-1">
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
              {closedTable ? (
                <>
                  <button
                    onClick={onReenter}
                    className="text-[10px] px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-semibold"
                    title={`Re-enter ${h.symbol} and carry adj basis forward`}
                  >↻ Re-enter</button>
                  <button
                    onClick={() => { if (window.confirm(`Delete ${h.symbol}? If it has premium history it will be soft-closed instead.`)) onDelete(); }}
                    className="text-[10px] px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold"
                  >Del</button>
                </>
              ) : (
                <>
                  <button onClick={onEdit} className="text-[10px] px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-semibold">Edit</button>
                  <button
                    onClick={() => { setShowClose((v) => !v); setClosePriceStr(""); }}
                    className="text-[10px] px-2 py-1 rounded-lg bg-orange-50 dark:bg-orange-900/20 text-orange-500 font-semibold"
                  >Close</button>
                </>
              )}
            </div>
          </div>
          {closedTable ? (
            /* Closed mobile: adj basis + realized P&L only */
            <div className="flex items-center gap-4 mb-1.5 text-sm">
              <div><span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Adj Basis</span><span className="font-semibold text-foreground">${storedAdj.toFixed(2)}</span></div>
              {basisReduction > 0 && <div><span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Saved</span><span className="text-[9px] text-green-500 font-semibold">↓ ${basisReduction.toFixed(2)}</span></div>}
              <div>
                <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Realized P&L</span>
                {h.realized_gain != null ? (
                  <span className={`font-semibold ${h.realized_gain >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {h.realized_gain >= 0 ? "+" : ""}${h.realized_gain.toFixed(2)}
                  </span>
                ) : <span className="text-foreground/30">—</span>}
              </div>
            </div>
          ) : (
            /* Active mobile: shares + avg cost + live adj */
            <>
              <div className="flex items-center gap-4 mb-1.5 text-sm">
                <div><span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Shares</span><span className="font-semibold text-foreground">{h.shares.toLocaleString()}</span></div>
                <div><span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Avg Cost</span><span className="text-foreground/70">${h.cost_basis.toFixed(2)}</span></div>
                <div><span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Live Adj</span><span className="font-bold text-blue-500">${liveAdj.toFixed(2)}</span></div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                {realizedPrem > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-semibold">✓ -${realizedPerShare.toFixed(2)}/sh realized</span>}
                {unrealizedPrem > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-semibold">⏳ -${unrealizedPerShare.toFixed(2)}/sh in-flight</span>}
                {basisReduction > 0 && <span className="text-[9px] text-green-500 font-semibold">↓ ${basisReduction.toFixed(2)} saved</span>}
              </div>
              <div className="flex items-center gap-4 text-[11px]">
                <span className="text-foreground/50">▼ BE: <span className="text-red-400 font-semibold">${downsideBasis.toFixed(2)}</span></span>
                {upsideBasis != null && <span className="text-foreground/50">▲ CC: <span className="text-green-500 font-semibold">${upsideBasis.toFixed(2)}</span></span>}
                <HoldingLivePriceMobile symbol={h.symbol} liveAdjBasis={liveAdj} shares={h.shares} status={h.status} realizedGain={h.realized_gain} />
              </div>
            </>
          )}
        </div>
        {showClose && h.status === "ACTIVE" && (
          <div className="px-3 pb-3 pt-2 bg-orange-50/60 dark:bg-orange-900/10 border-t border-orange-200 dark:border-orange-800/40">
            <p className="text-[10px] font-semibold text-orange-700 dark:text-orange-400 mb-1.5">Close {h.symbol} position at what price?</p>
            <div className="flex items-center gap-2">
              <input
                type="number" step="0.01" min="0"
                value={closePriceStr}
                onChange={(e) => setClosePriceStr(e.target.value)}
                placeholder="e.g. 155.00"
                className="w-32 text-xs px-2.5 py-1.5 rounded-lg border border-orange-300 dark:border-orange-700 bg-white dark:bg-orange-900/20 text-foreground focus:outline-none focus:ring-1 focus:ring-orange-400"
                autoFocus
              />
              <button
                onClick={() => {
                  const p = parseFloat(closePriceStr);
                  if (!closePriceStr || isNaN(p) || p <= 0) return;
                  onClose(p);
                  setShowClose(false);
                  setClosePriceStr("");
                }}
                disabled={!closePriceStr || isNaN(parseFloat(closePriceStr))}
                className="text-[10px] px-3 py-1.5 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-40 transition"
              >Confirm Close</button>
              <button onClick={() => setShowClose(false)} className="text-[10px] px-2 py-1.5 rounded-lg bg-[var(--surface-2)] text-foreground/60 font-semibold">Cancel</button>
            </div>
          </div>
        )}
        {expanded && (
          <div className="px-3 pb-3 pt-2 bg-[var(--surface-2)]/40">
            <EventList />
          </div>
        )}
      </div>

      {/* ── Desktop table row ── */}
      {closedTable ? (
        /* Closed / Called Away — slim 4-column row */
        <>
          <tr className="hidden sm:table-row border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors text-foreground/60">
            {/* Company */}
            <td className="px-3 py-2.5 w-32 max-w-[8rem]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-foreground">{h.symbol}</span>
              </div>
              {h.company_name && <div className="text-[10px] text-foreground/50 truncate max-w-[7rem]">{h.company_name}</div>}
            </td>
            {/* Realized P&L */}
            <td className="px-3 py-2.5 text-sm">
              {h.realized_gain != null ? (
                <span className={`font-semibold ${h.realized_gain >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {h.realized_gain >= 0 ? "+" : ""}${h.realized_gain.toFixed(2)}
                </span>
              ) : (
                <span className="text-foreground/30 text-xs">—</span>
              )}
            </td>
            {/* Actions */}
            <td className="px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-[10px] px-2 py-1 rounded-lg bg-[var(--surface-2)] text-foreground/70 font-semibold hover:bg-[var(--surface-3,var(--surface-2))] transition flex items-center gap-1"
                >
                  {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />} History
                </button>
                <button
                  onClick={onReenter}
                  className="text-[10px] px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-semibold hover:bg-blue-100 transition"
                  title={`Re-enter ${h.symbol} — adj basis carries forward`}
                >↻ Re-enter</button>
                <button
                  onClick={() => { if (window.confirm(`Delete ${h.symbol}? If it has premium history it will be soft-closed instead.`)) onDelete(); }}
                  className="text-[10px] px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition"
                >Del</button>
              </div>
            </td>
          </tr>
          {expanded && (
            <tr className="hidden sm:table-row border-b border-[var(--border)] bg-[var(--surface-2)]/40">
              <td colSpan={3} className="px-4 pb-3 pt-2">
                <EventList desktop />
              </td>
            </tr>
          )}
        </>
      ) : (
        /* Active — full 6-column row */
        <>
          <tr className="hidden sm:table-row border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
            <td className="px-3 py-2.5 w-32 max-w-[8rem]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-foreground">{h.symbol}</span>
              </div>
              {h.company_name && <div className="text-[10px] text-foreground/50 truncate max-w-[7rem]">{h.company_name}</div>}
              <BasisCarryHint />
            </td>
            <td className="px-3 py-2.5 text-foreground font-semibold">{h.shares.toLocaleString()}</td>
            <td className="px-3 py-2.5 text-foreground/70 text-sm">${h.cost_basis.toFixed(2)}</td>
            <td className="px-3 py-2.5 text-sm">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-blue-500">${liveAdj.toFixed(2)}</span>
                <span className="text-[9px] text-foreground/40 font-normal">live</span>
                {storedAdj !== liveAdj && (
                  <span className="text-[9px] text-foreground/40" title="Stored adj basis">(stored: ${storedAdj.toFixed(2)})</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {realizedPrem > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-semibold"
                    title={`Per share: -$${realizedPerShare.toFixed(4)}`}>
                    ✓ -${realizedPerShare.toFixed(2)}/sh realized
                  </span>
                )}
                {unrealizedPrem > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-semibold"
                    title={`Per share: -$${unrealizedPerShare.toFixed(4)}`}>
                    ⏳ -${unrealizedPerShare.toFixed(2)}/sh in-flight
                  </span>
                )}
              </div>
              {basisReduction > 0 && <div className="text-[9px] text-green-500 font-semibold mt-0.5">↓ ${basisReduction.toFixed(2)} total saved</div>}
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-[9px] text-foreground/50">▼ BE: <span className="text-red-400 font-semibold">${downsideBasis.toFixed(2)}</span></span>
                {upsideBasis != null && (
                  <span className="text-[9px] text-foreground/50">▲ CC: <span className="text-green-500 font-semibold">${upsideBasis.toFixed(2)}</span></span>
                )}
              </div>
            </td>
            <HoldingLivePrice symbol={h.symbol} liveAdjBasis={liveAdj} shares={h.shares} status={h.status} realizedGain={h.realized_gain} />
            <td className="px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-[10px] px-2 py-1 rounded-lg bg-[var(--surface-2)] text-foreground/70 font-semibold hover:bg-[var(--surface-3,var(--surface-2))] transition flex items-center gap-1"
                >
                  {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />} History
                </button>
                <button onClick={onEdit} className="text-[10px] px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-semibold hover:bg-blue-100 transition">Edit</button>
                <button
                  onClick={() => { setShowClose((v) => !v); setClosePriceStr(""); }}
                  className="text-[10px] px-2 py-1 rounded-lg bg-orange-50 dark:bg-orange-900/20 text-orange-500 font-semibold hover:bg-orange-100 transition"
                >Close</button>
              </div>
            </td>
          </tr>
          {showClose && (
            <tr className="hidden sm:table-row border-b border-orange-200 dark:border-orange-800/40 bg-orange-50/60 dark:bg-orange-900/10">
              <td colSpan={6} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <p className="text-[11px] font-semibold text-orange-700 dark:text-orange-400 shrink-0">Close {h.symbol} at price:</p>
                  <input
                    type="number" step="0.01" min="0"
                    value={closePriceStr}
                    onChange={(e) => setClosePriceStr(e.target.value)}
                    placeholder="e.g. 155.00"
                    className="w-36 text-xs px-2.5 py-1.5 rounded-lg border border-orange-300 dark:border-orange-700 bg-white dark:bg-orange-900/20 text-foreground focus:outline-none focus:ring-1 focus:ring-orange-400"
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      const p = parseFloat(closePriceStr);
                      if (!closePriceStr || isNaN(p) || p <= 0) return;
                      onClose(p);
                      setShowClose(false);
                      setClosePriceStr("");
                    }}
                    disabled={!closePriceStr || isNaN(parseFloat(closePriceStr))}
                    className="text-[10px] px-3 py-1.5 rounded-lg bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-40 transition"
                  >Confirm Close</button>
                  <button onClick={() => setShowClose(false)} className="text-[10px] px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] text-foreground/60 font-semibold hover:bg-[var(--surface-3,var(--surface-2))] transition">Cancel</button>
                </div>
              </td>
            </tr>
          )}
          {expanded && (
            <tr className="hidden sm:table-row border-b border-[var(--border)] bg-[var(--surface-2)]/40">
              <td colSpan={6} className="px-4 pb-3 pt-2">
                <EventList desktop />
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

export function HoldingsTab() {
  const qc = useQueryClient();
  const { data: holdings = [], isLoading } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
    staleTime: 0, // always fetch fresh so realized_gain and status changes appear immediately
  });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StockHolding | null>(null);
  const [search, setSearch] = useState("");

  const emptyForm = (): HoldingFormState => ({
    symbol: "", company_name: "", shares: "", cost_basis: "",
    acquired_date: new Date().toISOString().slice(0, 10), notes: "",
  });
  const [f, setF] = useState<HoldingFormState>(emptyForm());
  const [formErr, setFormErr] = useState("");

  function resetForm() { setF(emptyForm()); setFormErr(""); }
  function setField(k: keyof HoldingFormState, v: string) { setF((p) => ({ ...p, [k]: v })); }

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteHolding(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holdings"] }),
  });

  const closeMut = useMutation({
    mutationFn: ({ id, closePrice, currentNotes }: { id: number; closePrice: number; currentNotes: string | null }) =>
      updateHolding(id, {
        status: "CLOSED",
        close_price: closePrice,
        notes: [currentNotes, `Closed @ $${closePrice.toFixed(2)}`].filter(Boolean).join(" · "),
      } as Partial<StockHolding> & { close_price: number }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holdings"] });
      qc.invalidateQueries({ queryKey: ["premiumDashboard"] });
    },
  });

  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const seedMut = useMutation({
    mutationFn: seedHoldingsFromPositions,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["holdings"] });
      qc.invalidateQueries({ queryKey: ["positions"] });
      setSeedMsg(
        res.created.length > 0
          ? `✓ Created ${res.created.length} holding${res.created.length > 1 ? "s" : ""}, linked ${res.linked} position${res.linked > 1 ? "s" : ""}.`
          : `✓ ${res.linked} position${res.linked > 1 ? "s" : ""} linked to existing holdings.`,
      );
      setTimeout(() => setSeedMsg(null), 5000);
    },
  });

  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);
  // Expose recalcMut if needed; assign to prevent "unused" warning
  const recalcMut = useMutation({
    mutationFn: recalculateHoldings,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["holdings"] });
      setRecalcMsg(
        res.updated > 0
          ? `✓ Recalculated ${res.updated} holding${res.updated > 1 ? "s" : ""} — adj basis now matches cost basis.`
          : `✓ All adj bases already correct.`,
      );
      setTimeout(() => setRecalcMsg(null), 5000);
    },
  });
  void recalcMut; // used implicitly via onSuccess

  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const syncMut = useMutation({
    mutationFn: syncPremiumLedger,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["holdings"] });
      setSyncMsg(`✓ Synced ${res.synced_rows} premium rows, updated ${res.updated_holdings} holding${res.updated_holdings !== 1 ? "s" : ""}.`);
      setTimeout(() => setSyncMsg(null), 5000);
    },
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        symbol: f.symbol.toUpperCase().trim(),
        company_name: f.company_name || undefined,
        shares: parseFloat(f.shares),
        cost_basis: parseFloat(f.cost_basis),
        acquired_date: f.acquired_date || undefined,
        notes: f.notes || undefined,
      };
      if (editing) {
        return updateHolding(editing.id, {
          shares: body.shares,
          cost_basis: body.cost_basis,
          company_name: body.company_name ?? null,
          acquired_date: body.acquired_date,
          notes: body.notes,
        } as Partial<StockHolding>);
      }
      return createHolding(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holdings"] });
      setShowForm(false); setEditing(null); resetForm();
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  function startEdit(h: StockHolding) {
    setEditing(h);
    setF({
      symbol: h.symbol, company_name: h.company_name ?? "",
      shares: String(h.shares), cost_basis: String(h.cost_basis),
      acquired_date: h.acquired_date?.slice(0, 10) ?? "", notes: h.notes ?? "",
    });
    setShowForm(true);
  }

  // Re-enter a closed holding: opens the Add form pre-filled with the symbol
  // so create_holding on the backend will find the CLOSED lot and reactivate it
  // (carrying forward all accumulated adj basis / premium savings).
  function startReenter(h: StockHolding) {
    setEditing(null); // must be null so saveMut calls createHolding, not updateHolding
    setF({
      symbol: h.symbol,
      company_name: h.company_name ?? "",
      shares: "",            // user fills in the new share count
      cost_basis: "",        // user fills in their new purchase price
      acquired_date: new Date().toISOString().slice(0, 10),
      notes: "",
    });
    setShowForm(true);
  }

  const filtered = useMemo(
    () => holdings.filter((h) =>
      h.symbol.toLowerCase().includes(search.toLowerCase()) ||
      (h.company_name ?? "").toLowerCase().includes(search.toLowerCase()),
    ),
    [holdings, search],
  );

  const totalAdjCost = holdings.filter((h) => h.status === "ACTIVE").reduce((s, h) => s + h.total_adjusted_cost, 0);
  const totalSaved   = holdings.filter((h) => h.status === "ACTIVE").reduce((s, h) => s + h.basis_reduction, 0);
  const totalSavedLifetime = holdings.reduce((s, h) => s + h.basis_reduction, 0);

  const fld = (label: string, el: React.ReactNode) => (
    <div><label className="text-xs text-foreground/70 block mb-1">{label}</label>{el}</div>
  );

  return (
    <div>
      {holdings.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 mb-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Active Lots</p>
            <p className="text-base font-black text-foreground">{holdings.filter((h) => h.status === "ACTIVE").length}</p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Total Adj Cost</p>
            <p className="text-base font-black text-blue-500 truncate">${totalAdjCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Basis Saved</p>
            <p className="text-base font-black text-green-500">${totalSaved.toFixed(2)}</p>
            {totalSavedLifetime > totalSaved
              ? <p className="text-[10px] text-foreground/40 mt-0.5">${totalSavedLifetime.toFixed(2)} lifetime</p>
              : <p className="text-[10px] text-foreground/40 mt-0.5">active only</p>}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol or company…" className={`${inp} pl-8`} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-foreground/70 text-xs font-semibold hover:bg-[var(--surface-2)] disabled:opacity-50 transition"
          >
            <DollarSign size={12} /> <span className="hidden sm:inline">{syncMut.isPending ? "Syncing…" : "Sync Ledger"}</span><span className="sm:hidden">Sync</span>
          </button>
          <button
            onClick={() => seedMut.mutate()}
            disabled={seedMut.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-foreground/70 text-xs font-semibold hover:bg-[var(--surface-2)] disabled:opacity-50 transition"
          >
            <TrendingUp size={12} /> <span className="hidden sm:inline">{seedMut.isPending ? "Importing…" : "Import from Positions"}</span><span className="sm:hidden">Import</span>
          </button>
          <button
            onClick={() => { setEditing(null); resetForm(); setShowForm((v) => !v); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {seedMsg   && <div className="mb-3 px-4 py-2.5 rounded-xl bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 text-xs font-semibold">{seedMsg}</div>}
      {recalcMsg && <div className="mb-3 px-4 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 text-xs font-semibold">{recalcMsg}</div>}
      {syncMsg   && <div className="mb-3 px-4 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-600 dark:text-purple-400 text-xs font-semibold">{syncMsg}</div>}

      {showForm && (
        <div className="bg-[var(--surface)] border border-blue-200 dark:border-blue-800 rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-foreground">{editing ? `Edit ${editing.symbol}` : "Add Holding"}</h3>
            <button onClick={() => { setShowForm(false); setEditing(null); }} className="p-1.5 rounded-xl text-foreground/70 hover:bg-[var(--surface-2)] transition"><X size={15} /></button>
          </div>
          {!editing && (
            <div className="mb-4">
              <label className="text-xs text-foreground/70 block mb-1">Search Company / Ticker</label>
              <TickerSearchInput
                value={f.symbol}
                onChange={(v) => setField("symbol", v)}
                onSelect={(sym) => setField("symbol", sym)}
                placeholder="Type AAPL, Apple, MSFT…"
                actionLabel="SELECT"
                accentColor="#2563eb"
              />
              {f.symbol && <p className="mt-1.5 text-[11px] text-blue-500 font-semibold">✓ {f.symbol} selected</p>}
              {/* Prior lot continuity warning */}
              {(() => {
                const sym = f.symbol.toUpperCase().trim();
                const prior = sym
                  ? holdings.find((h) => h.symbol === sym && h.status === "CLOSED")
                  : null;
                if (!prior) return null;
                const savings = prior.cost_basis - prior.adjusted_cost_basis;
                return (
                  <div className="mt-2 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/15 border border-blue-300 dark:border-blue-700">
                    <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300">
                      ↻ Prior {prior.called_away ? "called-away" : "closed"} lot — adj basis carries forward
                    </p>
                    <p className="text-[11px] text-blue-600 dark:text-blue-400">
                      Stored adj: <span className="font-bold">${prior.adjusted_cost_basis.toFixed(2)}</span>/sh
                      {savings > 0.005 && <span className="text-green-600 dark:text-green-400 font-semibold"> · ${savings.toFixed(2)}/sh already earned</span>}
                    </p>
                  </div>
                );
              })()}
            </div>
          )}
          {editing && (
            <div className="mb-4 p-3 bg-[var(--surface-2)] rounded-xl">
              <p className="text-xs text-foreground/60">Editing</p>
              <p className="font-black text-foreground text-lg">{editing.symbol}</p>
              {editing.company_name && <p className="text-xs text-foreground/50">{editing.company_name}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            {fld("Shares", <input type="number" min="1" step="1" value={f.shares} onChange={(e) => setField("shares", e.target.value)} placeholder="100" className={inp} />)}
            {fld("Avg Cost / Share ($)", <input type="number" step="0.01" value={f.cost_basis} onChange={(e) => setField("cost_basis", e.target.value)} placeholder="150.00" className={inp} />)}
            {fld("Acquired Date", <input type="date" value={f.acquired_date} onChange={(e) => setField("acquired_date", e.target.value)} className={datInp} />)}
          </div>
          {fld("Notes", <input value={f.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="optional" className={`${inp} mb-3`} />)}
          {formErr && <p className="text-xs text-red-500 mb-3">{formErr}</p>}
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !f.symbol || !f.shares || !f.cost_basis}
            className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {saveMut.isPending ? "Saving…" : editing ? "Save Changes" : "Add Holding"}
          </button>
        </div>
      )}

      {isLoading && <div className="space-y-2">{[1, 2, 3].map((i) => <SkeletonCard key={i} rows={1} />)}</div>}

      {!isLoading && filtered.length === 0 && (
        <EmptyState icon={Wallet} title="No holdings yet" body={search ? "No holdings match your search." : `Click "Add Holding", search for a company, enter shares and average cost.`} />
      )}

      {!isLoading && filtered.length > 0 && (() => {
        const activeHoldings = filtered.filter((h) => h.status === "ACTIVE");
        const closedHoldings = filtered.filter((h) => h.status === "CLOSED");

        const ACTIVE_COLS = ["Company", "Shares", "Avg Cost", "Adj Basis", "Current Price / P&L", "Actions"];
        const CLOSED_COLS = ["Company", "Realized P&L", "Actions"];

        const HoldingsCard = ({ rows, label, sublabel, headerClass, closed }: {
          rows: typeof filtered;
          label: string;
          sublabel?: string;
          headerClass?: string;
          closed?: boolean;
        }) => (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
            {/* Card header */}
            <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] ${headerClass ?? "bg-[var(--surface-2)]"}`}>
              <span className="text-[11px] font-bold uppercase tracking-wide text-foreground/70">{label}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-foreground/50 font-semibold">{rows.length}</span>
              {sublabel && <span className="text-[10px] text-foreground/40 ml-1">{sublabel}</span>}
            </div>
            {/* Mobile */}
            <div className="sm:hidden divide-y divide-[var(--border)]">
              {rows.map((h) => (
                <HoldingRow
                  key={h.id} h={h}
                  onEdit={() => startEdit(h)}
                  onClose={(price) => closeMut.mutate({ id: h.id, closePrice: price, currentNotes: h.notes })}
                  onDelete={() => deleteMut.mutate(h.id)}
                  onReenter={() => startReenter(h)}
                  closedTable={closed}
                />
              ))}
            </div>
            {/* Desktop */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                    {(closed ? CLOSED_COLS : ACTIVE_COLS).map((col) => (
                      <th key={col} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <HoldingRow
                      key={h.id} h={h}
                      onEdit={() => startEdit(h)}
                      onClose={(price) => closeMut.mutate({ id: h.id, closePrice: price, currentNotes: h.notes })}
                      onDelete={() => deleteMut.mutate(h.id)}
                      onReenter={() => startReenter(h)}
                      closedTable={closed}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

        return (
          <div className="space-y-4">
            {activeHoldings.length > 0 && (
              <HoldingsCard
                rows={activeHoldings}
                label="Active Holdings"
                headerClass="bg-green-50/60 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40"
              />
            )}
            {closedHoldings.length > 0 && (
              <div className="md:w-1/2">
                <HoldingsCard
                  rows={closedHoldings}
                  label="Closed / Called Away"
                  sublabel="re-enter any symbol to carry adj basis forward"
                  headerClass="bg-gray-50/80 dark:bg-gray-900/20 border-gray-200/60 dark:border-gray-700/40"
                  closed
                />
              </div>
            )}
            {activeHoldings.length === 0 && closedHoldings.length === 0 && (
              <EmptyState icon={Wallet} title="No holdings match" body="Try a different search." />
            )}
          </div>
        );
      })()}
    </div>
  );
}
