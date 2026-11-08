"use client";
/**
 * GexHeatmap — the Flow board: strike × expiry gamma (GEX) or vanna (VEX)
 * exposure. `metric` picks which grid the backend sent is shown.
 *
 * Rows are strikes (descending), columns are expiries, plus a leading "All"
 * column summing the displayed expiries. Every expiry cell shares one colour
 * scale so expiries compare directly. The largest |GEX| cell is the King node.
 * The board scrolls inside its own frame (sticky header + strike axis) and
 * exposes centerOnSpot / centerOnKing through a ref.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { GexResult } from "@/lib/api";

// ── Palettes ─────────────────────────────────────────────────────────────────
type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// Signed scales: [zero → max] for each side
const SIGNED: Record<string, { zero: RGB; pos: RGB[]; neg: RGB[] }> = {
  heat: {
    zero: hex("#34488f"),
    pos: ["#2c6f93", "#22968a", "#35b779", "#8fd744", "#fde725"].map(hex),
    neg: ["#433f98", "#53318f", "#5a1f80", "#46085c"].map(hex),
  },
  diverging: {
    zero: hex("#11151f"),
    pos: ["#0e4048", "#18966e", "#78c850", "#fad646"].map(hex),
    neg: ["#2c2260", "#6834aa", "#b03ec4", "#f05caa"].map(hex),
  },
};
// Magnitude scales (sign shown only by the "-" in the label)
const MAGNITUDE: Record<string, RGB[]> = {
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"].map(hex),
  cividis: ["#00224e", "#35456c", "#666970", "#948e77", "#c8b866", "#fee838"].map(hex),
  inferno: ["#1b0c41", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"].map(hex),
};

export type Palette = "heat" | "diverging" | "viridis" | "cividis" | "inferno";
export const PALETTES: { id: Palette; label: string }[] = [
  { id: "heat", label: "Heat" },
  { id: "diverging", label: "Diverging" },
  { id: "cividis", label: "Cividis" },
  { id: "viridis", label: "Viridis" },
  { id: "inferno", label: "Inferno" },
];

export interface HeatOpts {
  palette: Palette;
  /** Show each node as % of the King instead of a $ value */
  showPct: boolean;
  /** Fade nodes smaller than 10% of the King */
  dimSmall: boolean;
}
export const DEFAULT_HEAT_OPTS: HeatOpts = { palette: "heat", showPct: false, dimSmall: false };

/** Which exposure a board shows. */
export type Metric = "gex" | "vex";
export const METRIC_UNIT: Record<Metric, string> = { gex: "per 1% move", vex: "per 1 vol pt" };

const ramp = (stops: RGB[], t: number): RGB => {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  const [a, b] = [stops[i], stops[i + 1]];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
};

export function cellColor(v: number, vmax: number, palette: Palette): { bg: string; fg: string } {
  const t = vmax ? Math.sqrt(Math.min(Math.abs(v) / vmax, 1)) : 0; // sqrt keeps mid nodes visible
  let c: RGB;
  if (palette in SIGNED) {
    const p = SIGNED[palette];
    c = !v ? p.zero : ramp([p.zero, ...(v > 0 ? p.pos : p.neg)], t);
  } else {
    c = ramp(MAGNITUDE[palette], t);
  }
  const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  return {
    bg: `rgb(${c.map(Math.round).join(",")})`,
    fg: lum > 0.6 ? "#0b0c10" : !v ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.94)",
  };
}

export function legendGradient(palette: Palette): string {
  const css = (c: RGB) => `rgb(${c.map(Math.round).join(",")})`;
  if (palette in SIGNED) {
    const p = SIGNED[palette];
    return `linear-gradient(90deg, ${[...p.neg].reverse().map(css).join(",")}, ${css(p.zero)}, ${p.pos.map(css).join(",")})`;
  }
  return `linear-gradient(90deg, ${MAGNITUDE[palette].map(css).join(",")})`;
}

// ── Formatting ───────────────────────────────────────────────────────────────
export function fmtMoney(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
const fmtStrike = (s: number) => s.toFixed(1);
const dte = (exp: string) => {
  const d = Math.round((new Date(exp + "T16:00:00").getTime() - Date.now()) / 86_400_000);
  return d <= 0 ? "0d" : `${d}d`;
};
function nearest(values: number[], target: number | null | undefined): number | null {
  if (target == null || !values.length) return null;
  return values.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), values[0]);
}

// ── Board ────────────────────────────────────────────────────────────────────
export interface BoardHandle {
  centerOnSpot: () => void;
  centerOnKing: () => void;
}

interface Props {
  data: GexResult;
  /** "gex" (default): gamma exposure. "vex": vanna exposure. */
  metric?: Metric;
  nStrikes: number;
  opts: HeatOpts;
  /** CSS max-height of the scrolling board */
  maxHeight: string;
}

export const GexHeatmap = forwardRef<BoardHandle, Props>(function GexHeatmap({ data, metric = "gex", nStrikes, opts, maxHeight }, ref) {
  const { spot, heatmap_strikes, heatmap_expiries } = data;
  const heatmap_values = metric === "vex" ? data.heatmap_vex_values : data.heatmap_values;
  const isGex = metric === "gex";
  const boxRef = useRef<HTMLDivElement>(null);

  const model = useMemo(() => {
    const allStrikes = heatmap_strikes ?? [];
    const expiries = heatmap_expiries ?? [];
    if (!allStrikes.length || !expiries.length || !heatmap_values?.length) return null;

    const byStrike = new Map<number, number[]>();
    allStrikes.forEach((s, si) => byStrike.set(s, expiries.map((_, ei) => heatmap_values?.[ei]?.[si] ?? 0)));

    const sorted = [...allStrikes].sort((a, b) => a - b);
    const spotIdx = sorted.indexOf(nearest(sorted, spot) ?? sorted[0]);
    const half = Math.max(1, Math.floor(nStrikes / 2));
    let lo = Math.max(0, spotIdx - half);
    const hi = Math.min(sorted.length, lo + nStrikes);
    lo = Math.max(0, hi - nStrikes);
    const strikes = sorted.slice(lo, hi).reverse();

    const rows = strikes.map((strike) => {
      const vals = byStrike.get(strike) ?? [];
      return { strike, vals, total: vals.reduce((a, b) => a + b, 0) };
    });

    let vmax = 0, vmaxTotal = 0;
    let king: { strike: number; col: number } | null = null;
    for (const r of rows) {
      r.vals.forEach((v, ci) => { if (Math.abs(v) > vmax) { vmax = Math.abs(v); king = { strike: r.strike, col: ci }; } });
      vmaxTotal = Math.max(vmaxTotal, Math.abs(r.total));
    }
    const colTotals = expiries.map((_, ci) => rows.reduce((a, r) => a + (r.vals[ci] ?? 0), 0));
    return { strikes, rows, expiries, vmax, vmaxTotal, king: king as { strike: number; col: number } | null, colTotals };
  }, [heatmap_strikes, heatmap_expiries, heatmap_values, spot, nStrikes]);

  const centerOn = useCallback((strike: number | null | undefined, col?: number, smooth = true) => {
    const box = boxRef.current;
    if (!box || strike == null) return;
    const row = box.querySelector<HTMLElement>(`tr[data-strike="${strike}"]`);
    if (!row) return;
    const cell = col != null ? (row.children[col + 2] as HTMLElement | undefined) : undefined;
    box.scrollTo({
      top: Math.max(0, row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2),
      left: cell ? Math.max(0, cell.offsetLeft - box.clientWidth / 2 + cell.offsetWidth / 2) : 0,
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  const spotStrike = model ? nearest(model.strikes, spot) : null;
  useImperativeHandle(ref, () => ({
    centerOnSpot: () => centerOn(spotStrike),
    centerOnKing: () => centerOn(model?.king?.strike, model?.king?.col),
  }), [centerOn, spotStrike, model]);

  // Centre on spot whenever the ticker or window changes
  const centeredFor = useRef("");
  useEffect(() => {
    const key = `${data.symbol}:${metric}:${nStrikes}`;
    if (model && centeredFor.current !== key) {
      centeredFor.current = key;
      requestAnimationFrame(() => centerOn(spotStrike, undefined, false));
    }
  }, [data.symbol, metric, nStrikes, model, spotStrike, centerOn]);

  if (!model) {
    return (
      <p className="px-4 py-16 text-center text-sm text-foreground/55">
        {!isGex && !data.heatmap_vex_values ? "VEX isn't available from the server yet." : "No options data for this ticker."}
      </p>
    );
  }

  const { strikes, rows, expiries, vmax, vmaxTotal, king, colTotals } = model;
  const step = strikes.length > 1 ? Math.abs(strikes[0] - strikes[1]) : 0;
  const zg = data.zero_gamma;
  const flip = isGex && zg != null && zg <= strikes[0] + step / 2 && zg >= strikes[strikes.length - 1] - step / 2 ? nearest(strikes, zg) : null;

  const label = (v: number, max: number) =>
    opts.showPct && max ? (v ? `${Math.round((v / max) * 100)}%` : "0%") : fmtMoney(v);
  const faded = (v: number) => opts.dimSmall && vmax > 0 && Math.abs(v) < 0.1 * vmax;

  return (
    <div ref={boxRef} className="relative overflow-auto bg-[#0b0c10]" style={{ maxHeight }}>
      <table className="w-full border-separate border-spacing-0 font-mono text-[11px] tabular-nums">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-[132px] border-b border-white/10 bg-[#0b0c10] py-2 pl-3 pr-2 text-left text-[10px] font-medium text-white/50">
              Strike
            </th>
            <th className="sticky top-0 z-20 min-w-[84px] border-b border-l border-white/10 bg-[#0b0c10] px-2 py-1.5 text-right">
              <div className="text-[10px] font-medium text-white/80">All</div>
              <div className="text-[9px] text-white/40">{expiries.length} exp</div>
            </th>
            {expiries.map((exp, ci) => (
              <th key={exp} className="sticky top-0 z-20 min-w-[84px] border-b border-l border-white/10 bg-[#0b0c10] px-2 py-1.5 text-right">
                <div className="whitespace-nowrap text-[10px] font-medium text-white/80">{exp}</div>
                <div className="flex justify-end gap-1.5 text-[9px]">
                  <span className="text-white/40">{dte(exp)}</span>
                  <span className={colTotals[ci] >= 0 ? "text-gain/80" : "text-violet-300/80"}>{fmtMoney(colTotals[ci])}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ strike, vals, total }) => {
            const isSpot = strike === spotStrike;
            const isKingRow = king?.strike === strike;
            const all = cellColor(total, vmaxTotal, opts.palette);
            const spotLine = isSpot ? "inset 0 -2px 0 rgba(255,255,255,0.9)" : undefined;
            return (
              <tr key={strike} data-strike={strike}>
                <td className={`sticky left-0 z-10 border-b border-white/[0.06] py-[5px] pl-3 pr-2 ${isSpot ? "bg-[#16181f]" : "bg-[#0b0c10]"}`}>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className={isSpot ? "font-medium text-white" : "text-white/70"}>{fmtStrike(strike)}</span>
                    {isSpot && (
                      <span className="rounded-[5px] bg-white px-1.5 text-[9.5px] font-medium leading-[16px] text-black">▸ {spot.toFixed(2)}</span>
                    )}
                    {isKingRow && (
                      <span className="rounded-full border border-amber-300/60 bg-amber-300/15 px-1.5 text-[8.5px] font-medium uppercase leading-[15px] tracking-[0.14em] text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.35)]">
                        ★ King
                      </span>
                    )}
                    {isGex && strike === data.max_call_wall && <span className="text-[8.5px] uppercase tracking-wider text-gain/90">CW</span>}
                    {isGex && strike === data.max_put_wall && <span className="text-[8.5px] uppercase tracking-wider text-violet-300/90">PW</span>}
                    {strike === flip && <span className="text-[8.5px] uppercase tracking-wider text-sky-300/90">Flip</span>}
                  </div>
                </td>
                <td
                  className="border-b border-l border-white/[0.06] px-2 py-[5px] text-right font-medium"
                  style={{ background: all.bg, color: all.fg, boxShadow: spotLine }}
                >
                  {label(total, vmaxTotal)}
                </td>
                {vals.map((v, ci) => {
                  const isKing = isKingRow && king?.col === ci;
                  const c = isKing ? { bg: "#fde725", fg: "#0b0c10" } : cellColor(v, vmax, opts.palette);
                  return (
                    <td
                      key={ci}
                      title={`${fmtStrike(strike)} · ${expiries[ci]} · ${metric.toUpperCase()} ${fmtMoney(v)} ${METRIC_UNIT[metric]}`}
                      className={`border-b border-l border-white/[0.06] px-2 py-[5px] text-right ${isKing ? "relative z-[5] font-medium" : ""}`}
                      style={{
                        background: c.bg,
                        color: c.fg,
                        opacity: faded(v) && !isKing ? 0.35 : 1,
                        boxShadow: isKing
                          ? "0 0 0 2px #f59e0b, 0 0 22px 4px rgba(245,158,11,0.55)"
                          : spotLine,
                      }}
                    >
                      {isKing && <span className="mr-1">★</span>}
                      {label(v, vmax)}
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
});
