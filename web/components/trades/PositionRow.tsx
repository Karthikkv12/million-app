"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketQuotes, OptionPosition } from "@/lib/api";
import { ChevronDown, ChevronUp } from "lucide-react";
import { fmt$, fmtDate } from "./TradesHelpers";
import { StatusSelect } from "./StatusSelect";
import { AssignmentPanel } from "./AssignmentPanel";

export function PositionRow({ pos, onEdit, onDelete, liveSpot }: { pos: OptionPosition; onEdit: () => void; onDelete: () => void; liveSpot?: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const isCarriedForward = pos.carried === true;

  const liveMoneyness = useMemo(() => {
    if (liveSpot == null || liveSpot <= 0 || !pos.strike) return null;
    const atmBand = pos.strike * 0.005;
    if (Math.abs(liveSpot - pos.strike) <= atmBand) return "ATM";
    if (pos.option_type === "CALL") return liveSpot > pos.strike ? "ITM" : "OTM";
    return liveSpot < pos.strike ? "ITM" : "OTM";
  }, [liveSpot, pos.strike, pos.option_type]);
  const displayMoneyness = liveMoneyness ?? pos.moneyness;
  const isLive = liveMoneyness != null;

  const premOutCell = (() => {
    const isClosed = ["CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"].includes(pos.status);
    const showPremOut = pos.premium_out != null && (isClosed || pos.is_roll);
    if (!showPremOut) return null;
    const premIn  = pos.premium_in  ?? 0;
    const premOut = pos.premium_out!;
    const isLoss  = Math.abs(premOut) > premIn;
    const netPL   = (premIn + premOut) * pos.contracts * 100;
    return { premOut, isLoss, netPL, isClosed };
  })();

  const capitalAtRisk = pos.strike * pos.contracts * 100;
  const premIn = pos.premium_in ?? 0;
  const premPerK = pos.strike > 0 ? (premIn / pos.strike) * 1000 : null;
  const netForRoi = premOutCell?.isClosed
    ? premOutCell.netPL
    : premIn * pos.contracts * 100;
  const roi = capitalAtRisk > 0 ? (netForRoi / capitalAtRisk) * 100 : null;
  const dte = pos.expiry_date
    ? (() => {
        // Slice first 10 chars to handle both "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm:ss".
        // Parse as LOCAL midnight to avoid UTC offset shifting the date (e.g.
        // "2026-03-07T00:00:00Z" would be March 6 evening in US timezones).
        const dateStr = pos.expiry_date.slice(0, 10);
        const [y, m, d] = dateStr.split("-").map(Number);
        const expiryLocal = new Date(y, m - 1, d); // local midnight
        const todayLocal = new Date();
        todayLocal.setHours(0, 0, 0, 0);
        return Math.round((expiryLocal.getTime() - todayLocal.getTime()) / 86_400_000);
      })()
    : null;
  const dteColor = dte == null ? "" : dte <= 0 ? "text-red-500" : dte <= 3 ? "text-orange-500" : dte <= 7 ? "text-yellow-500" : "text-foreground/60";

  return (
    <>
      {/* ── Mobile/Tablet card (< lg) ── */}
      <div className={`lg:hidden border-b border-[var(--border)] px-3 py-3 ${isCarriedForward ? "opacity-90" : ""}`}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-foreground text-base">{pos.symbol}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${pos.option_type === "PUT" ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-green-100 dark:bg-green-900/30 text-green-600"}`}>
                {pos.option_type}
              </span>
              {displayMoneyness && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border flex items-center gap-0.5 ${
                  displayMoneyness === "ITM" ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 border-orange-300 dark:border-orange-700"
                  : displayMoneyness === "ATM" ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700"
                  : "bg-green-100 dark:bg-green-900/30 text-green-700 border-green-300 dark:border-green-700"
                }`}>
                  {isLive && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                  {displayMoneyness}
                </span>
              )}
              {isCarriedForward && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 font-semibold">↳ {pos.origin_week_label ?? "prior wk"}</span>
              )}
            </div>
            <div className="text-sm text-foreground/70">
              ${pos.strike.toFixed(2)} · {pos.contracts} ct{pos.contracts !== 1 ? "s" : ""}
            </div>
          </div>
          {!isCarriedForward && <StatusSelect pos={pos} />}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-foreground/50 mb-2">
          {pos.sold_date && <span>Sold {fmtDate(pos.sold_date)}</span>}
          {pos.expiry_date && <span>Exp {fmtDate(pos.expiry_date)}</span>}
          {dte != null && (
            <span className={`font-semibold ${dteColor}`}>
              {dte === 0 ? `0d` : dte < 0 ? `Expired` : `${dte}d left`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 mb-2">
          <div>
            <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Prem In</span>
            <span className="text-sm font-semibold text-green-600">{pos.premium_in != null ? `$${pos.premium_in.toFixed(2)}` : "—"}</span>
            {pos.extrinsic_value != null && pos.intrinsic_value != null && pos.intrinsic_value > 0 && (
              <span className="text-[10px] text-orange-500 block">θ ${pos.extrinsic_value.toFixed(2)}</span>
            )}
          </div>
          {premOutCell && !isCarriedForward && (
            <div>
              <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Prem Out</span>
              <div className="flex flex-col gap-0.5">
                <span className={premOutCell.isLoss ? "text-red-500 font-semibold text-sm" : "text-orange-400 text-sm"}>
                  {premOutCell.premOut >= 0 ? "+" : ""}${premOutCell.premOut.toFixed(2)}
                  {pos.is_roll && <span className="ml-1 text-[9px] text-purple-400">roll</span>}
                </span>
                {premOutCell.isClosed && (
                  <span className={`text-[10px] font-semibold ${premOutCell.isLoss ? "text-red-500" : "text-green-500"}`}>
                    net {premOutCell.netPL >= 0 ? "+" : ""}${premOutCell.netPL.toFixed(0)}
                    {premOutCell.isLoss && <span className="ml-1 px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-[9px]">LOSS</span>}
                  </span>
                )}
              </div>
            </div>
          )}
          {premPerK != null && (
            <div>
              <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">/$1K</span>
              <span className="text-sm font-semibold text-blue-500">${premPerK.toFixed(2)}</span>
            </div>
          )}
          {roi != null && (
            <div>
              <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">ROI</span>
              <span className={`text-sm font-semibold ${roi >= 0 ? "text-green-500" : "text-red-500"}`}>{roi.toFixed(2)}%</span>
            </div>
          )}
        </div>

        {!isCarriedForward && (
          <div className="flex items-center gap-2 flex-wrap">
            {pos.status === "ASSIGNED" && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[10px] px-2.5 py-1.5 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 font-semibold hover:bg-yellow-200 transition flex items-center gap-1"
              >
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />} Stock
              </button>
            )}
            {!isCarriedForward && (
              <>
                <button onClick={onEdit} className="text-xs px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-semibold hover:bg-blue-100 active:bg-blue-200 transition min-h-[36px]">Edit</button>
                <button
                  onClick={() => { if (window.confirm(`Delete ${pos.symbol} $${pos.strike} ${pos.option_type}?\n\nThis will permanently remove this trade from all weeks.`)) onDelete(); }}
                  className="text-xs px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 active:bg-red-200 transition min-h-[36px]"
                >Delete</button>
              </>
            )}

          </div>
        )}

        {expanded && pos.status === "ASSIGNED" && (
          <div className="mt-2">
            <AssignmentPanel pos={pos} />
          </div>
        )}


      </div>

      {/* ── Desktop table row (≥ lg) ── */}
      <tr className={`hidden lg:table-row border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors ${isCarriedForward ? "opacity-90" : ""}`}>
        <td className="px-3 py-2.5 font-bold text-foreground">
          {pos.symbol}
          {isCarriedForward && (
            <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 font-semibold">↳ {pos.origin_week_label ?? "prior wk"}</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-foreground/80 text-sm text-center">{pos.contracts}</td>
        <td className="px-3 py-2.5 text-foreground text-sm">${pos.strike.toFixed(2)}</td>
        <td className="px-3 py-2.5 min-w-[7rem]">
          <div className="flex items-center gap-1 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${pos.option_type === "PUT" ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-green-100 dark:bg-green-900/30 text-green-600"}`}>
              {pos.option_type}
            </span>
            {displayMoneyness && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border flex items-center gap-0.5 ${
                displayMoneyness === "ITM" ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 border-orange-300 dark:border-orange-700"
                : displayMoneyness === "ATM" ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700"
                : "bg-green-100 dark:bg-green-900/30 text-green-700 border-green-300 dark:border-green-700"
              }`}>
                {isLive && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                {displayMoneyness}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 text-foreground/70 text-xs whitespace-nowrap">{fmtDate(pos.sold_date)}</td>
        <td className="px-3 py-2.5 text-foreground/70 text-xs whitespace-nowrap">{fmtDate(pos.expiry_date)}</td>
        <td className="px-3 py-2.5 text-xs font-semibold whitespace-nowrap">
          {dte != null
            ? <span className={dteColor}>{dte === 0 ? `0d` : dte < 0 ? `Expired` : `${dte}d`}</span>
            : <span className="text-foreground/30">—</span>}
        </td>
        <td className="px-3 py-2.5 text-green-600 font-semibold text-sm">
          {pos.premium_in != null ? `$${pos.premium_in.toFixed(2)}` : "—"}
          {pos.extrinsic_value != null && pos.intrinsic_value != null && pos.intrinsic_value > 0 && (
            <div className="text-[10px] text-orange-500 font-normal">θ ${pos.extrinsic_value.toFixed(2)}</div>
          )}
        </td>
        {!isCarriedForward && (
          <td className="px-3 py-2.5 text-sm">
            {(() => {
              const isClosed = ["CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"].includes(pos.status);
              const showPremOut = pos.premium_out != null && (isClosed || pos.is_roll);
              if (!showPremOut) return <span className="text-foreground/30">—</span>;
              const pIn  = pos.premium_in  ?? 0;
              const pOut = pos.premium_out!;
              const loss = Math.abs(pOut) > pIn;
              const net  = (pIn + pOut) * pos.contracts * 100;
              return (
                <div className="flex flex-col gap-0.5">
                  <span className={loss ? "text-red-500 font-semibold" : "text-orange-400"}>
                    {pOut >= 0 ? "+" : ""}${pOut.toFixed(2)}
                    {pos.is_roll && <span className="ml-1 text-[9px] text-purple-400">roll</span>}
                  </span>
                  {isClosed && (
                    <span className={`text-[10px] font-semibold ${loss ? "text-red-500" : "text-green-500"}`}>
                      net {net >= 0 ? "+" : ""}${net.toFixed(0)}
                      {loss && <span className="ml-1 px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-[9px]">LOSS</span>}
                    </span>
                  )}
                </div>
              );
            })()}
          </td>
        )}
        <td className="px-3 py-2.5 text-sm">
          {premPerK != null
            ? <span className="font-semibold text-blue-500">${premPerK.toFixed(2)}</span>
            : <span className="text-foreground/30">—</span>}
        </td>
        <td className="px-3 py-2.5 text-sm">
          {roi != null
            ? <span className={`font-semibold ${roi >= 0 ? "text-green-500" : "text-red-500"}`}>{roi.toFixed(2)}%</span>
            : <span className="text-foreground/30">—</span>}
        </td>
        {!isCarriedForward && (
          <td className="px-3 py-2.5">
            <StatusSelect pos={pos} />
          </td>
        )}
        {!isCarriedForward && (
          <td className="px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              {pos.status === "ASSIGNED" && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="text-[10px] px-2 py-1 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 font-semibold hover:bg-yellow-200 transition flex items-center gap-1"
                >
                  {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />} Stock
                </button>
              )}

              {!isCarriedForward && (
                <>
                  <button onClick={onEdit} className="text-[10px] px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-semibold hover:bg-blue-100 transition">Edit</button>
                  <button
                    onClick={() => { if (window.confirm(`Delete ${pos.symbol} $${pos.strike} ${pos.option_type}?\n\nThis will permanently remove this trade from all weeks.`)) onDelete(); }}
                    className="text-[10px] px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition"
                  >Del</button>
                </>
              )}
            </div>
          </td>
        )}
      </tr>
      {expanded && pos.status === "ASSIGNED" && (
        <tr className="hidden lg:table-row border-b border-[var(--border)] bg-yellow-50/30 dark:bg-yellow-900/5">
          <td colSpan={10} className="px-4 pb-3">
            <AssignmentPanel pos={pos} />
          </td>
        </tr>
      )}

    </>
  );
}
