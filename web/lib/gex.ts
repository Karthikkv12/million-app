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

export function shortExpiry(exp: string): string {
  // "2026-02-23" → "Feb 23"
  try {
    const d = new Date(exp + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return exp; }
}
