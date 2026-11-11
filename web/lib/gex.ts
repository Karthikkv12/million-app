/** Port of Python _heat_bg / _fg / _fmt_gex from gamma_exposure.py */

export function heatBg(v: number, vmax: number): string {
  if (vmax === 0 || v === 0) return "transparent";
  const t = Math.min(Math.abs(v) / vmax, 1); // 0–1 intensity
  const positive = v > 0;

  // pastel at t=0.05, saturated at t=1
  if (positive) {
    // green: hsl(120, 40%–100%, 88%–35%)
    const s = Math.round(40 + t * 60);
    const l = Math.round(88 - t * 53);
    return `hsl(120,${s}%,${l}%)`;
  } else {
    // red: hsl(0, 40%–100%, 88%–35%)
    const s = Math.round(40 + t * 60);
    const l = Math.round(88 - t * 53);
    return `hsl(0,${s}%,${l}%)`;
  }
}

export function fgColor(bg: string): string {
  if (bg === "transparent") return "inherit";
  // parse hsl lightness
  const m = bg.match(/hsl\(\d+,\d+%,(\d+)%\)/);
  if (!m) return "#111111";
  return parseInt(m[1]) < 50 ? "#ffffff" : "#111111";
}

export function fmtGex(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Returns true if exp (YYYY-MM-DD) is today in local time. */
export function isToday(exp: string): boolean {
  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return exp === today;
  } catch { return false; }
}

export function shortExpiry(exp: string): string {
  // "2026-02-23" → "Feb 23", today → "0DTE"
  if (isToday(exp)) return "0DTE";
  try {
    const d = new Date(exp + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return exp; }
}


// ── Anchor ───────────────────────────────────────────────────────────────────
/** Within this share of the price either way. */
export const ANCHOR_BAND = 0.10;
/** Positive GEX must be at least this share of all |GEX| in the band, or there is nothing to pin to. */
export const ANCHOR_MIN_SHARE = 0.5;
export const ANCHOR_TONE = "text-[#0e7490] dark:text-[#67e8f9]";

export interface Anchor {
  price: number;        // gamma-weighted average strike
  expiry: string;
  share: number;        // positive GEX ÷ all |GEX| in the band (how dominant the pin is)
}

/**
 * The Anchor: the gamma-weighted average strike of POSITIVE GEX within ±ANCHOR_BAND of the price, for one expiry
 * (default: the nearest). Long-gamma dealers sell rallies into those strikes and buy dips toward them, so the
 * weighted centre is a steadier pin estimate than the single largest strike (the King). Null when positive GEX
 * doesn't dominate near the price (short gamma or thin: moves run, there is no pin) or the data is missing.
 */
export function anchorOf(
  d: { spot: number; heatmap_expiries?: string[] | null; heatmap_strikes?: number[] | null; heatmap_values?: number[][] | null } | null | undefined,
  expiry?: string | null,
): Anchor | null {
  const exps = d?.heatmap_expiries ?? [];
  const strikes = d?.heatmap_strikes ?? [];
  if (!d || !d.spot || !exps.length || !strikes.length) return null;
  const exp = expiry && exps.includes(expiry) ? expiry : exps[0];
  const row = d.heatmap_values?.[exps.indexOf(exp)] ?? [];
  let pos = 0, abs = 0, weighted = 0;
  strikes.forEach((k, i) => {
    if (Math.abs(k / d.spot - 1) > ANCHOR_BAND + 1e-9) return;   // tolerance: 110/100 - 1 is 0.10000000000000009
    const g = row[i] ?? 0;
    abs += Math.abs(g);
    if (g > 0) { pos += g; weighted += k * g; }
  });
  if (pos <= 0 || abs <= 0 || pos / abs < ANCHOR_MIN_SHARE) return null;
  return { price: Math.round((weighted / pos) * 100) / 100, expiry: exp, share: pos / abs };
}
