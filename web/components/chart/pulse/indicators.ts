/**
 * Pulse chart indicators: pure maths over OHLCV bars. Each returns one value per bar (null while warming up),
 * so the chart can zip them with bar times.
 */

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

export type IndicatorType = "ema" | "sma" | "vwap" | "bb" | "rsi" | "macd";

export interface IndicatorDef {
  type: IndicatorType;
  label: string;
  /** Drawn on the price pane (overlay) or in its own pane below. */
  pane: "price" | "sub";
  params: { key: string; label: string; min: number; max: number; def: number }[];
  colors: string[];
  blurb: string;
}

export const INDICATORS: Record<IndicatorType, IndicatorDef> = {
  ema:  { type: "ema",  label: "EMA",  pane: "price", params: [{ key: "length", label: "Length", min: 2, max: 400, def: 21 }], colors: ["#f59e0b"], blurb: "Exponential moving average" },
  sma:  { type: "sma",  label: "SMA",  pane: "price", params: [{ key: "length", label: "Length", min: 2, max: 400, def: 50 }], colors: ["#7aa2ff"], blurb: "Simple moving average" },
  vwap: { type: "vwap", label: "VWAP", pane: "price", params: [], colors: ["#c084fc"], blurb: "Volume-weighted average price, reset each session (intraday) or over the range (daily)" },
  bb:   { type: "bb",   label: "Bollinger", pane: "price", params: [{ key: "length", label: "Length", min: 2, max: 200, def: 20 }, { key: "mult", label: "Std dev", min: 1, max: 4, def: 2 }], colors: ["#14b8a6"], blurb: "Bollinger bands: SMA ± k standard deviations" },
  rsi:  { type: "rsi",  label: "RSI",  pane: "sub",   params: [{ key: "length", label: "Length", min: 2, max: 100, def: 14 }], colors: ["#e879f9"], blurb: "Relative strength index (Wilder), 70 / 30 bands" },
  macd: { type: "macd", label: "MACD", pane: "sub",   params: [{ key: "fast", label: "Fast", min: 2, max: 100, def: 12 }, { key: "slow", label: "Slow", min: 3, max: 200, def: 26 }, { key: "signal", label: "Signal", min: 2, max: 50, def: 9 }], colors: ["#38bdf8", "#f97316"], blurb: "MACD line, signal and histogram" },
};

export interface IndicatorInstance {
  id: string;
  type: IndicatorType;
  params: Record<string, number>;
  color: string;
  visible: boolean;
}

export function newIndicator(type: IndicatorType, extra?: Partial<IndicatorInstance>): IndicatorInstance {
  const def = INDICATORS[type];
  return {
    id: `${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    params: Object.fromEntries(def.params.map((p) => [p.key, p.def])),
    color: def.colors[0],
    visible: true,
    ...extra,
  };
}

export function indicatorName(i: IndicatorInstance): string {
  const def = INDICATORS[i.type];
  const ps = def.params.map((p) => i.params[p.key] ?? p.def);
  return ps.length ? `${def.label} ${ps.join(" ")}` : def.label;
}

type Num = number | null;

export function sma(v: number[], n: number): Num[] {
  const out: Num[] = new Array(v.length).fill(null);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(v: number[], n: number): Num[] {
  const out: Num[] = new Array(v.length).fill(null);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let prev = v.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

/** Session-anchored VWAP for intraday bars (resets when the New York date changes); cumulative otherwise. */
export function vwap(bars: Bar[], intraday: boolean): Num[] {
  let pv = 0, vol = 0, day = "";
  const nyDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  return bars.map((b) => {
    if (intraday) {
      const d = nyDay.format(new Date(b.time * 1000));
      if (d !== day) { day = d; pv = 0; vol = 0; }
    }
    const tp = (b.high + b.low + b.close) / 3;
    const v = b.volume || 0;
    pv += tp * v; vol += v;
    return vol > 0 ? pv / vol : tp;
  });
}

export function bollinger(v: number[], n: number, mult: number): { mid: Num[]; up: Num[]; lo: Num[] } {
  const mid = sma(v, n);
  const up: Num[] = [], lo: Num[] = [];
  for (let i = 0; i < v.length; i++) {
    const m = mid[i];
    if (m == null) { up.push(null); lo.push(null); continue; }
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - m) ** 2;
    const sd = Math.sqrt(s / n);
    up.push(m + mult * sd); lo.push(m - mult * sd);
  }
  return { mid, up, lo };
}

/** Wilder's RSI. */
export function rsi(v: number[], n: number): Num[] {
  const out: Num[] = new Array(v.length).fill(null);
  if (v.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = v[i] - v[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(v: number[], fast: number, slow: number, signal: number): { line: Num[]; sig: Num[]; hist: Num[] } {
  const f = ema(v, fast), s = ema(v, slow);
  const line: Num[] = v.map((_, i) => (f[i] != null && s[i] != null ? (f[i] as number) - (s[i] as number) : null));
  const first = line.findIndex((x) => x != null);
  const sig: Num[] = new Array(v.length).fill(null);
  if (first >= 0) {
    const tail = ema(line.slice(first) as number[], signal);
    tail.forEach((x, i) => { sig[first + i] = x; });
  }
  const hist: Num[] = line.map((x, i) => (x != null && sig[i] != null ? x - (sig[i] as number) : null));
  return { line, sig, hist };
}

/** Heikin-Ashi candles from regular ones. */
export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  bars.forEach((b, i) => {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i === 0 ? (b.open + b.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ ...b, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close) });
  });
  return out;
}

/** Merge bars into buckets of `seconds` (e.g. 1H → 4H), aligned to the New York session open for intraday. */
export function resample(bars: Bar[], seconds: number): Bar[] {
  const out: Bar[] = [];
  const nyDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  let key = "";
  let dayStart = 0;
  let day = "";
  for (const b of bars) {
    const d = nyDay.format(new Date(b.time * 1000));
    if (d !== day) { day = d; dayStart = b.time; }
    const k = `${d}:${Math.floor((b.time - dayStart) / seconds)}`;
    if (k !== key) { key = k; out.push({ ...b }); continue; }
    const last = out[out.length - 1];
    last.high = Math.max(last.high, b.high);
    last.low = Math.min(last.low, b.low);
    last.close = b.close;
    last.volume += b.volume;
  }
  return out;
}
