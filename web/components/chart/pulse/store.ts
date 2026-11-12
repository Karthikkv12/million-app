/**
 * Pulse chart persistence: browser storage only (per viewer, per device). Every read and write is guarded, so a
 * private window or blocked storage just means nothing is remembered. Drawings, alerts and plans are per symbol.
 */
import type { IndicatorInstance } from "./indicators";
import type { Drawing } from "./drawings";

const PREFIX = "pulse:";

export function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

export function save(key: string, value: unknown): void {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

// ── Chart setup (what a "layout" saves) ──────────────────────────────────────
export type ChartStyle = "candles" | "hollow" | "bars" | "heikin" | "line" | "area";
export type ScaleMode = "normal" | "log" | "percent";
export type LayerId = "flip" | "anchor" | "king" | "callWall" | "putWall" | "defense" | "battle" | "range";

export interface ChartColors { up: string; down: string; grid: boolean }

export interface ChartSetup {
  interval: string;
  range: string;
  ext: boolean;
  style: ChartStyle;
  scale: ScaleMode;
  autoScale: boolean;
  volume: boolean;
  indicators: IndicatorInstance[];
  layers: Record<LayerId, boolean>;
  colors: ChartColors;
  tz: string;
}

export const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  flip: true, anchor: true, king: true, callWall: true, putWall: true, defense: false, battle: false, range: false,
};

export const DEFAULT_SETUP: ChartSetup = {
  interval: "15m",
  range: "5D",
  ext: false,
  style: "candles",
  scale: "normal",
  autoScale: true,
  volume: true,
  indicators: [],
  layers: DEFAULT_LAYERS,
  colors: { up: "", down: "", grid: true },
  tz: "America/New_York",
};

/** Fill anything missing from an older saved setup with defaults. */
export function normalizeSetup(s: Partial<ChartSetup> | null | undefined): ChartSetup {
  const v = s ?? {};
  return {
    ...DEFAULT_SETUP,
    ...v,
    indicators: Array.isArray(v.indicators) ? v.indicators : [],
    layers: { ...DEFAULT_LAYERS, ...(v.layers ?? {}) },
    colors: { ...DEFAULT_SETUP.colors, ...(v.colors ?? {}) },
  };
}

export interface Layout { id: string; name: string; setup: ChartSetup }

export const loadSetup = () => normalizeSetup(load<Partial<ChartSetup>>("setup", DEFAULT_SETUP));
export const saveSetup = (s: ChartSetup) => save("setup", s);
export const loadLayouts = () => load<Layout[]>("layouts", []);
export const saveLayouts = (l: Layout[]) => save("layouts", l);

// ── Per-symbol objects ───────────────────────────────────────────────────────
export const loadDrawings = (sym: string) => load<Drawing[]>(`drawings:${sym}`, []);
export const saveDrawings = (sym: string, d: Drawing[]) => save(`drawings:${sym}`, d);

export interface PriceAlert {
  id: string;
  price: number;
  /** Fires when the price crosses the level in this direction. */
  dir: "above" | "below";
  note?: string;
  created: number;
  triggered?: number;
}
export const loadAlerts = (sym: string) => load<PriceAlert[]>(`alerts:${sym}`, []);
export const saveAlerts = (sym: string, a: PriceAlert[]) => save(`alerts:${sym}`, a);

/** A paper trade plan: entry, stop and target drawn on the chart. Nothing is sent to a broker. */
export interface TradePlan {
  id: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  qty: number;
  note?: string;
  created: number;
  status: "planned" | "open" | "stopped" | "target" | "closed";
}
export const loadPlans = (sym: string) => load<TradePlan[]>(`plans:${sym}`, []);
export const savePlans = (sym: string, p: TradePlan[]) => save(`plans:${sym}`, p);

export const uid = () => Math.random().toString(36).slice(2, 10);
