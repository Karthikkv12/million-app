/** Drawing objects on the Pulse chart. Points are (time in UTC seconds, price), so they survive interval changes. */

export type DrawTool = "trend" | "ray" | "hline" | "vline" | "fib" | "rect" | "text" | "measure";

export interface Pt { t: number; p: number }

export interface Drawing {
  id: string;
  tool: DrawTool;
  pts: Pt[];
  color: string;
  text?: string;
  locked?: boolean;
  hidden?: boolean;
}

export const TOOLS: { id: DrawTool; label: string; points: number; key: string }[] = [
  { id: "trend",   label: "Trend line",      points: 2, key: "T" },
  { id: "ray",     label: "Ray",             points: 2, key: "R" },
  { id: "hline",   label: "Horizontal line", points: 1, key: "H" },
  { id: "vline",   label: "Vertical line",   points: 1, key: "V" },
  { id: "fib",     label: "Fib retracement", points: 2, key: "B" },
  { id: "rect",    label: "Rectangle",       points: 2, key: "G" },
  { id: "text",    label: "Text",            points: 1, key: "X" },
  { id: "measure", label: "Measure",         points: 2, key: "M" },
];

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export const DRAW_COLORS = ["#7aa2ff", "#f59e0b", "#34d399", "#fb7185", "#c084fc", "#e5e7eb"];

export function toolLabel(d: Drawing): string {
  const t = TOOLS.find((x) => x.id === d.tool)?.label ?? d.tool;
  if (d.tool === "text") return `Text “${(d.text ?? "").slice(0, 18)}”`;
  if (d.tool === "hline") return `${t} ${d.pts[0]?.p.toFixed(2)}`;
  return t;
}

/**
 * Time ↔ x for points that may sit between bars or past the last one: interpolate a fractional bar index from the
 * bar times and extrapolate with the average bar spacing, then let the chart turn the logical index into pixels.
 */
export function timeToLogical(times: number[], t: number): number {
  const n = times.length;
  if (!n) return 0;
  if (n === 1) return 0;
  const step = (times[n - 1] - times[0]) / (n - 1) || 1;
  if (t <= times[0]) return (t - times[0]) / step;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / step;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  const span = times[hi] - times[lo] || 1;
  return lo + (t - times[lo]) / span;
}

export function logicalToTime(times: number[], l: number): number {
  const n = times.length;
  if (!n) return 0;
  if (n === 1) return times[0];
  const step = (times[n - 1] - times[0]) / (n - 1) || 1;
  if (l <= 0) return Math.round(times[0] + l * step);
  if (l >= n - 1) return Math.round(times[n - 1] + (l - (n - 1)) * step);
  const i = Math.floor(l);
  return Math.round(times[i] + (l - i) * (times[i + 1] - times[i]));
}
