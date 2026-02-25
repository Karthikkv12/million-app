"use client";
import React, { useMemo } from "react";
import { GexResult } from "@/lib/api";
import { heatBg, fgColor, fmtGex, shortExpiry } from "@/lib/gex";
import { clsx } from "clsx";

interface Props {
  data: GexResult;
  nStrikes: number;
  expiryFilter: string[] | null; // null = all
  accentColor?: string; // optional per-ticker accent (for comparison mode)
}

export default function GexStrikeTable({ data, nStrikes, expiryFilter, accentColor }: Props) {
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
        gexMap[s] = (heatmap_values?.[ei]?.[si]) ?? 0;
      });
      const vmax = Math.max(...Object.values(gexMap).map(Math.abs), 1);
      const kingStrike = Object.entries(gexMap).reduce(
        (best, [k, v]) => (Math.abs(v) > Math.abs(best[1]) ? [k, v] : best),
        ["0", 0],
      )[0];
      const netGex = Object.values(gexMap).reduce((sum, v) => sum + v, 0);
      return { exp, short: shortExpiry(exp), gexMap, vmax, kingStrike: Number(kingStrike), netGex };
    });
  }, [expiries, heatmap_strikes, heatmap_values]);

  // All expiry columns (never filtered) — used to lock column widths
  const allCols = useMemo(() => {
    const allExpiries = heatmap_expiries ?? [];
    return allExpiries.map((exp) => ({
      exp,
      short: shortExpiry(exp),
    }));
  }, [heatmap_expiries]);

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
    <div
      className="overflow-x-auto overflow-y-auto max-h-[640px] rounded-md border font-mono text-[11px]"
      style={{
        borderColor: accentColor ? accentColor : "rgba(255,255,255,0.1)",
        borderTopWidth: accentColor ? 3 : undefined,
        background: "#0a0c14",
      }}
    >
      {/* Hidden sizing row — always renders ALL expiry columns at fixed width to anchor table layout */}
      <table className="border-collapse" style={{ tableLayout: "fixed", width: "max-content", visibility: "hidden", height: 0, overflow: "hidden", position: "absolute" }} aria-hidden="true">
        <colgroup>
          <col style={{ width: 160 }} />
          {allCols.map(({ exp }) => <col key={exp} style={{ width: 110 }} />)}
        </colgroup>
        <tbody><tr><td />{allCols.map(({ exp }) => <td key={exp} />)}</tr></tbody>
      </table>
      <table className="border-collapse" style={{ tableLayout: "fixed", width: `${160 + allCols.length * 110}px`, minWidth: "100%" }}>
        <colgroup>
          <col style={{ width: 160 }} />
          {allCols.map(({ exp }) => <col key={exp} style={{ width: 110 }} />)}
        </colgroup>
        <thead>
          {/* ── Row A: summary header ── */}
          <tr>
            <th
              colSpan={1 + allCols.length}
              className="sticky top-0 z-10 text-left px-3 py-2 border-b-2 whitespace-nowrap"
              style={{ background: "#13151f", borderBottomColor: "rgba(255,255,255,0.1)" }}
            >
              {accentColor && (
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                  style={{ background: accentColor }}
                />
              )}
              <span className="text-[17px] font-black text-white mr-2">
                {data.symbol}
              </span>
              <span className="text-[15px] font-bold text-white mr-4">
                ${spot.toFixed(2)}
              </span>
              <span className="text-xs font-semibold text-gray-300 mr-1">Net GEX</span>
              <span className="text-[13px] font-extrabold mr-4" style={{ color: netC }}>
                {fmtGex(net_gex)}
              </span>
              <span className="text-xs font-semibold text-gray-300 mr-1">Regime</span>
              <span className="text-[13px] font-extrabold mr-4" style={{ color: regimeColor }}>
                {regimeLabel}
              </span>
              <span className="text-xs font-semibold text-gray-300 mr-1">Zero γ</span>
              <span className="text-[13px] font-extrabold text-gray-100">
                {zgStr}
              </span>
            </th>
          </tr>
          {/* ── Row B: column labels — always renders ALL expiry columns ── */}
          <tr>
            <th className="sticky top-[37px] z-10 text-left px-2 py-1 text-[9px] font-bold text-gray-300 uppercase tracking-wide border-b border-t"
              style={{ background: "#13151f", borderColor: "rgba(255,255,255,0.08)" }}>
              STRIKE
            </th>
            {allCols.map(({ exp, short }) => {
              const colData = cols.find((c) => c.exp === exp);
              const isVisible = !!colData;
              const gexColor = colData ? (colData.netGex >= 0 ? "#00cc44" : "#ff4444") : "transparent";
              return (
                <th
                  key={exp}
                  className="sticky top-[37px] z-10 text-right px-2 py-1 text-[9px] font-bold uppercase border-b border-t border-l"
                  style={{
                    background: "#13151f",
                    borderColor: "rgba(255,255,255,0.08)",
                    opacity: isVisible ? 1 : 0.18,
                  }}
                >
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={isVisible ? "text-gray-200" : "text-gray-500"}>{short}</span>
                    {isVisible && colData && (
                      <span className="text-[8px] font-extrabold tracking-tight" style={{ color: gexColor }}>
                        {colData.netGex >= 0 ? "+" : ""}{fmtGex(colData.netGex)}
                      </span>
                    )}
                  </div>
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
                style={isSpot ? { background: "rgba(234,179,8,0.15)" } : undefined}
              >
                {/* Strike cell */}
                <td
                  className={clsx(
                    "px-2 py-[3px] text-left border-b",
                    isSpot ? "font-extrabold text-white" : "text-gray-300",
                  )}
                  style={{ borderColor: "rgba(255,255,255,0.06)" }}
                >
                  {isSpot && (
                    <div className="inline-flex items-center gap-1 bg-yellow-400 text-black text-[8px] font-extrabold rounded px-1 mb-0.5 leading-tight">
                      <span>▶ SPOT</span>
                      <span>${spot.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="tabular-nums">{strike.toFixed(1)}</div>
                </td>

                {/* GEX cells — always rendered for ALL expiry columns */}
                {allCols.map(({ exp }) => {
                  const colData = cols.find((c) => c.exp === exp);
                  if (!colData) {
                    // filtered-out column: render dimmed empty cell to preserve width
                    return (
                      <td
                        key={exp}
                        className="px-2 py-[1px] text-right border-b border-l"
                        style={{ opacity: 0.18, borderColor: "rgba(255,255,255,0.06)" }}
                      />
                    );
                  }
                  const { gexMap, vmax, kingStrike } = colData;
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
                      className="px-2 py-[1px] text-right border-b border-l"
                      style={{ background: bg, color: fg, borderColor: "rgba(255,255,255,0.05)" }}
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
                        <span
                          className="ml-1 align-middle text-[15px]"
                          style={{ color: "#111111" }}
                          title="King Node"
                        >
                          ★
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
