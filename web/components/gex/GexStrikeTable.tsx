"use client";
import React, { useMemo } from "react";
import { GexResult } from "@/lib/api";
import { heatBg, fgColor, fmtGex, shortExpiry } from "@/lib/gex";
import { clsx } from "clsx";

interface Props {
  data: GexResult;
  nStrikes: number;
  expiryFilter: string[] | null; // null = all
}

export default function GexStrikeTable({ data, nStrikes, expiryFilter }: Props) {
  const { spot, heatmap_strikes, heatmap_expiries, heatmap_values, net_gex, zero_gamma } = data;

  // ── select expiries ──────────────────────────────────────────────────────
  const expiries = useMemo(() => {
    const all = heatmap_expiries ?? [];
    return expiryFilter ? all.filter((e) => expiryFilter.includes(e)) : all;
  }, [heatmap_expiries, expiryFilter]);

  // ── select strikes (±nStrikes/2 around spot) ─────────────────────────────
  const strikes = useMemo(() => {
    const all = [...(heatmap_strikes ?? [])].sort((a, b) => a - b);
    if (!all.length) return [];
    const half = Math.max(1, Math.floor(nStrikes / 2));
    const spotIdx = all.reduce(
      (best, s, i) => (Math.abs(s - spot) < Math.abs(all[best] - spot) ? i : best),
      0,
    );
    const lo = Math.max(0, spotIdx - half);
    const hi = Math.min(all.length, spotIdx + half);
    return all.slice(lo, hi).reverse(); // descending
  }, [heatmap_strikes, spot, nStrikes]);

  // ── per-expiry column metadata ────────────────────────────────────────────
  const cols = useMemo(() => {
    return expiries.map((exp, ei) => {
      const gexMap: Record<number, number> = {};
      (heatmap_strikes ?? []).forEach((s, si) => {
        gexMap[s] = (heatmap_values?.[si]?.[ei]) ?? 0;
      });
      const vmax = Math.max(...Object.values(gexMap).map(Math.abs), 1);
      const kingStrike = Object.entries(gexMap).reduce(
        (best, [k, v]) => (Math.abs(v) > Math.abs(best[1]) ? [k, v] : best),
        ["0", 0],
      )[0];
      return { exp, short: shortExpiry(exp), gexMap, vmax, kingStrike: Number(kingStrike) };
    });
  }, [expiries, heatmap_strikes, heatmap_values]);

  const nearestSpot = strikes.reduce(
    (best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best),
    strikes[0] ?? spot,
  );

  const netC = (net_gex ?? 0) >= 0 ? "#00cc44" : "#ff4444";
  const regimeLabel = (net_gex ?? 0) >= 0 ? "Long γ" : "Short γ";
  const regimeColor = (net_gex ?? 0) >= 0 ? "#00cc44" : "#ff4444";
  const zgStr = zero_gamma ? `$${zero_gamma.toFixed(2)}` : "—";

  if (!strikes.length || !cols.length) {
    return <p className="text-sm text-gray-400 p-4">No data available.</p>;
  }

  return (
    <div className="overflow-x-auto overflow-y-auto max-h-[640px] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-black font-mono text-[11px]">
      <table className="border-collapse w-full">
        <thead>
          {/* ── Row A: summary header ── */}
          <tr>
            <th
              colSpan={1 + cols.length}
              className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 text-left px-3 py-2 border-b-2 border-gray-200 dark:border-gray-700 whitespace-nowrap"
            >
              <span className="text-[17px] font-black text-gray-900 dark:text-gray-100 mr-2">
                {data.symbol}
              </span>
              <span className="text-[15px] font-bold text-gray-900 dark:text-gray-100 mr-4">
                ${spot.toFixed(2)}
              </span>
              <span className="text-xs font-semibold text-gray-400 mr-1">Net GEX</span>
              <span className="text-[13px] font-extrabold mr-4" style={{ color: netC }}>
                {fmtGex(net_gex)}
              </span>
              <span className="text-xs font-semibold text-gray-400 mr-1">Regime</span>
              <span className="text-[13px] font-extrabold mr-4" style={{ color: regimeColor }}>
                {regimeLabel}
              </span>
              <span className="text-xs font-semibold text-gray-400 mr-1">Zero γ</span>
              <span className="text-[13px] font-extrabold text-gray-600 dark:text-gray-300">
                {zgStr}
              </span>
            </th>
          </tr>
          {/* ── Row B: column labels ── */}
          <tr>
            <th className="sticky top-[37px] z-10 bg-gray-50 dark:bg-gray-900 text-left px-2 py-1 text-[9px] font-bold text-gray-400 uppercase tracking-wide border-b border-t border-gray-200 dark:border-gray-700 min-w-[90px]">
              STRIKE
            </th>
            {cols.map(({ exp, short, kingStrike }) => {
              const allStrikes = heatmap_strikes ?? [];
              const hasKing = allStrikes.some((s) => s === kingStrike && strikes.includes(s));
              return (
                <th
                  key={exp}
                  className="sticky top-[37px] z-10 bg-gray-50 dark:bg-gray-900 text-right px-2 py-1 text-[9px] font-bold text-gray-500 uppercase border-b border-t border-l border-gray-200 dark:border-gray-700 min-w-[100px]"
                >
                  {short}
                  {hasKing && (
                    <span className="inline-block ml-1 bg-amber-700 text-white text-[7px] font-bold rounded px-1 align-middle">
                      ★
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {strikes.map((strike) => {
            const isSpot = strike === nearestSpot;
            return (
              <tr
                key={strike}
                className={clsx(
                  "hover:brightness-95",
                  isSpot && "border-t-2 border-b-2 border-l-4 border-yellow-400",
                )}
                style={isSpot ? { background: "#fffbe6" } : undefined}
              >
                {/* Strike cell */}
                <td
                  className={clsx(
                    "px-2 py-[1px] text-left border-b border-gray-100 dark:border-gray-800 whitespace-nowrap",
                    isSpot ? "font-extrabold text-gray-900" : "text-gray-500 dark:text-gray-400",
                  )}
                >
                  {isSpot && (
                    <span className="inline-block bg-yellow-400 text-black text-[8px] font-extrabold rounded px-1 mr-1 align-middle">
                      ▶ SPOT ${spot.toFixed(2)}
                    </span>
                  )}
                  {strike.toFixed(1)}
                </td>

                {/* GEX cells per expiry */}
                {cols.map(({ exp, gexMap, vmax, kingStrike }) => {
                  const v = gexMap[strike] ?? 0;
                  const isKing = strike === kingStrike;
                  const bg = heatBg(v, vmax);
                  const fg = fgColor(bg);
                  const pct = vmax > 0 ? Math.round((v / vmax) * 100) : 0;
                  const showBadge = vmax > 0 && Math.abs(v) >= 0.1 * vmax;
                  const badgeColor = pct > 0 ? "#00cc44" : "#ff4444";

                  return (
                    <td
                      key={exp}
                      className="px-2 py-[1px] text-right border-b border-l border-gray-100 dark:border-gray-800"
                      style={{ background: bg, color: fg }}
                    >
                      {showBadge && (
                        <span
                          className="inline-block text-[7px] font-bold rounded px-[3px] mr-[2px] align-middle text-black"
                          style={{ background: badgeColor }}
                        >
                          {pct > 0 ? "+" : ""}{pct}%
                        </span>
                      )}
                      {fmtGex(v)}
                      {isKing && (
                        <span className="inline-block ml-1 bg-amber-700 text-white text-[9px] font-extrabold rounded px-1 align-middle">
                          ★ KING
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
