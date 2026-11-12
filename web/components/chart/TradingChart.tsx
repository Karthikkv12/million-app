"use client";
/**
 * Pulse — the stock chart (TradingView Lightweight Charts v5).
 *
 *  Toolbar   interval (1m … M) separate from range (1D … Max), RTH / Ext, chart style, indicators, GEX layers,
 *            % / log / auto scale, My layouts, chart settings, go to date, copy / save image, fullscreen, side panel,
 *            live market clock in the chosen time zone.
 *  Chart     price pane with volume and overlay indicators (EMA, SMA, VWAP, Bollinger); RSI and MACD in their own
 *            panes; dealer levels from the GEX result as price lines (flip, anchor, king, walls, defense nodes,
 *            battleground, ±1σ range); legend rows with show / settings / remove.
 *  Drawing   trend, ray, horizontal, vertical, Fibonacci, rectangle, text, measure; magnet, hide all, delete,
 *            undo / redo; saved per symbol in this browser.
 *  Side      watchlist, ticker details with Dealer Edge, flow, price alerts, paper trade plans, chart objects.
 *
 * Everything persists in browser storage (per viewer). Alerts are checked while the chart is open; paper plans are
 * never sent anywhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  BarChart3, Bell, Calendar, Camera, CandlestickChart, ChevronDown, Copy, Download, Eye, EyeOff, Hash, Layers,
  LayoutTemplate, LineChart, Lock, Magnet, Maximize2, Minimize2, MousePointer2, MoveDiagonal, MoveHorizontal,
  MoveVertical, PanelRight, Plus, Redo2, RefreshCw, Ruler, Settings2, Slash, Square, Trash2, Type, Undo2, X,
} from "lucide-react";
import type { IChartApi, IPriceLine, ISeriesApi, Logical, SeriesType, Time, UTCTimestamp } from "lightweight-charts";
import { fetchStockHistory, type GexResult } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { anchorOf } from "@/lib/gex";
import {
  INDICATORS, bollinger, ema, heikinAshi, indicatorName, macd, newIndicator, resample, rsi, sma, vwap,
  type Bar, type IndicatorInstance, type IndicatorType,
} from "./pulse/indicators";
import { DRAW_COLORS, TOOLS, type DrawTool, type Drawing } from "./pulse/drawings";
import { DrawingLayer, compositeScreenshot } from "./pulse/DrawingLayer";
import { Menu, MenuItem, MenuLabel } from "./pulse/Menu";
import { SidePanel, type PanelId } from "./pulse/SidePanels";
import {
  DEFAULT_SETUP, loadAlerts, loadDrawings, loadLayouts, loadPlans, loadSetup, normalizeSetup, saveAlerts, saveDrawings,
  saveLayouts, savePlans, saveSetup, uid, load, save,
  type ChartSetup, type ChartStyle, type LayerId, type Layout, type PriceAlert, type TradePlan,
} from "./pulse/store";

// ── Intervals and ranges ─────────────────────────────────────────────────────
interface IntervalCfg { id: string; label: string; api: string; resampleSec?: number; intraday: boolean; ranges: string[]; def: string }
export const INTERVALS: IntervalCfg[] = [
  { id: "1m",  label: "1 minute",   api: "1m",  intraday: true,  ranges: ["1D", "5D"], def: "1D" },
  { id: "5m",  label: "5 minutes",  api: "5m",  intraday: true,  ranges: ["1D", "5D", "1M"], def: "5D" },
  { id: "15m", label: "15 minutes", api: "15m", intraday: true,  ranges: ["1D", "5D", "1M"], def: "5D" },
  { id: "30m", label: "30 minutes", api: "30m", intraday: true,  ranges: ["5D", "1M"], def: "1M" },
  { id: "1H",  label: "1 hour",     api: "1h",  intraday: true,  ranges: ["5D", "1M", "3M", "6M", "1Y"], def: "1M" },
  { id: "4H",  label: "4 hours",    api: "1h",  resampleSec: 4 * 3600, intraday: true, ranges: ["1M", "3M", "6M", "1Y"], def: "3M" },
  { id: "D",   label: "1 day",      api: "1d",  intraday: false, ranges: ["1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "Max"], def: "1Y" },
  { id: "W",   label: "1 week",     api: "1wk", intraday: false, ranges: ["6M", "1Y", "2Y", "5Y", "Max"], def: "2Y" },
  { id: "M",   label: "1 month",    api: "1mo", intraday: false, ranges: ["2Y", "5Y", "Max"], def: "5Y" },
];
const RANGES: { id: string; api: string; interval: string }[] = [
  { id: "1D", api: "1d", interval: "5m" }, { id: "5D", api: "5d", interval: "15m" }, { id: "1M", api: "1mo", interval: "1H" },
  { id: "3M", api: "3mo", interval: "D" }, { id: "6M", api: "6mo", interval: "D" }, { id: "YTD", api: "ytd", interval: "D" },
  { id: "1Y", api: "1y", interval: "D" }, { id: "2Y", api: "2y", interval: "W" }, { id: "5Y", api: "5y", interval: "W" },
  { id: "Max", api: "max", interval: "M" },
];
/** Old callers pass a period label; it maps straight onto a range. */
export type PeriodLabel = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y";

const STYLES: { id: ChartStyle; label: string; icon: typeof CandlestickChart }[] = [
  { id: "candles", label: "Candles", icon: CandlestickChart },
  { id: "hollow", label: "Hollow candles", icon: CandlestickChart },
  { id: "heikin", label: "Heikin-Ashi", icon: CandlestickChart },
  { id: "bars", label: "OHLC bars", icon: BarChart3 },
  { id: "line", label: "Line", icon: LineChart },
  { id: "area", label: "Area", icon: LineChart },
];

const LAYERS: { id: LayerId; label: string; blurb: string }[] = [
  { id: "flip", label: "GEX flip", blurb: "Where net dealer gamma turns from negative to positive" },
  { id: "anchor", label: "⚓ Anchor", blurb: "Gamma-weighted centre of positive GEX near the price (nearest expiry)" },
  { id: "king", label: "★ King", blurb: "The strike with the largest gamma" },
  { id: "callWall", label: "Call wall", blurb: "Largest call gamma: resistance" },
  { id: "putWall", label: "Put wall", blurb: "Largest put gamma: support" },
  { id: "defense", label: "Defense levels", blurb: "The next three largest positive-GEX strikes within 10% of the price" },
  { id: "battle", label: "⚔ Battleground", blurb: "Heavy call and put gamma at the same strike" },
  { id: "range", label: "±1σ range", blurb: "The move options price in to the nearest monthly expiry" },
];

const TZS = [
  { id: "America/New_York", label: "New York (ET)" }, { id: "America/Chicago", label: "Chicago (CT)" },
  { id: "America/Los_Angeles", label: "Los Angeles (PT)" }, { id: "Europe/London", label: "London" },
  { id: "Asia/Kolkata", label: "India (IST)" }, { id: "UTC", label: "UTC" },
];

const TOOL_ICON: Record<DrawTool, typeof Slash> = {
  trend: Slash, ray: MoveDiagonal, hline: MoveHorizontal, vline: MoveVertical, fib: Hash, rect: Square, text: Type, measure: Ruler,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt$ = (v?: number | null, dp = 2) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const fmtVol = (v?: number | null) => {
  if (v == null) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
};
const toSec = (d: string) => Math.floor(new Date(d.length === 10 ? `${d}T00:00:00Z` : d).getTime() / 1000);
const nyParts = (sec: number) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(sec * 1000));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { mins: Number(g("hour")) * 60 + Number(g("minute")), wd: g("weekday") };
};
const isRth = (sec: number) => { const { mins } = nyParts(sec); return mins >= 570 && mins < 960; };

/** Market session in New York right now (weekends only; exchange holidays aren't known here). */
function session(now: Date): { label: string; tone: string } {
  const { mins, wd } = nyParts(Math.floor(now.getTime() / 1000));
  if (wd === "Sat" || wd === "Sun") return { label: "Closed", tone: "text-foreground/50" };
  if (mins >= 570 && mins < 960) return { label: "Open", tone: "text-gain" };
  if (mins >= 240 && mins < 570) return { label: "Pre-market", tone: "text-warn" };
  if (mins >= 960 && mins < 1200) return { label: "After hours", tone: "text-warn" };
  return { label: "Closed", tone: "text-foreground/50" };
}

interface Props {
  symbol: string;
  /** Dealer data for the GEX layers (optional). */
  gex?: GexResult | null;
  /** Opening range (from the period pills of the old chart). */
  initialPeriod?: PeriodLabel;
  /** Open another symbol (watchlist panel). */
  onSymbol?: (s: string) => void;
  height?: number;
}

type LineRef = ISeriesApi<SeriesType>;

export default function TradingChart({ symbol, gex, initialPeriod, onSymbol, height = 480 }: Props) {
  const sym = symbol.toUpperCase();
  const { theme } = useTheme();
  const dark = theme === "dark";

  // ── Persistent setup ───────────────────────────────────────────────────────
  const [setup, setSetupState] = useState<ChartSetup>(DEFAULT_SETUP);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const s = loadSetup();
    if (initialPeriod && !load<boolean>("setup-touched", false)) {
      const r = RANGES.find((x) => x.id === initialPeriod);
      if (r) { s.range = r.id; s.interval = r.interval; }
    }
    setSetupState(s);
    setReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setSetup = useCallback((patch: Partial<ChartSetup>) => {
    setSetupState((prev) => {
      const next = { ...prev, ...patch };
      saveSetup(next);
      save("setup-touched", true);
      return next;
    });
  }, []);
  const iv = INTERVALS.find((i) => i.id === setup.interval) ?? INTERVALS[2];
  const rangeCfg = RANGES.find((r) => r.id === setup.range) ?? RANGES[1];

  const pickInterval = (id: string) => {
    const cfg = INTERVALS.find((i) => i.id === id)!;
    setSetup({ interval: id, range: cfg.ranges.includes(setup.range) ? setup.range : cfg.def });
  };
  const pickRange = (id: string) => {
    const r = RANGES.find((x) => x.id === id)!;
    setSetup({ range: id, interval: iv.ranges.includes(id) ? iv.id : r.interval });
  };

  // ── Per-symbol objects ─────────────────────────────────────────────────────
  const [drawings, setDrawingsState] = useState<Drawing[]>([]);
  const [alerts, setAlertsState] = useState<PriceAlert[]>([]);
  const [plans, setPlansState] = useState<TradePlan[]>([]);
  const past = useRef<Drawing[][]>([]);
  const future = useRef<Drawing[][]>([]);
  const lastPush = useRef(0);
  const [, setHist] = useState(0);
  useEffect(() => {
    setDrawingsState(loadDrawings(sym)); setAlertsState(loadAlerts(sym)); setPlansState(loadPlans(sym));
    past.current = []; future.current = []; setHist((h) => h + 1);
  }, [sym]);
  const setDrawings = useCallback((next: Drawing[]) => {
    setDrawingsState((prev) => {
      const now = Date.now();
      if (now - lastPush.current > 400) { past.current = [...past.current.slice(-49), prev]; future.current = []; }
      lastPush.current = now;
      saveDrawings(sym, next);
      return next;
    });
    setHist((h) => h + 1);
  }, [sym]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    setDrawingsState((cur) => { future.current.push(cur); saveDrawings(sym, prev); return prev; });
    lastPush.current = 0; setHist((h) => h + 1);
  }, [sym]);
  const redo = useCallback(() => {
    const nxt = future.current.pop();
    if (!nxt) return;
    setDrawingsState((cur) => { past.current.push(cur); saveDrawings(sym, nxt); return nxt; });
    lastPush.current = 0; setHist((h) => h + 1);
  }, [sym]);
  const setAlerts = useCallback((a: PriceAlert[]) => { setAlertsState(a); saveAlerts(sym, a); }, [sym]);
  const setPlans = useCallback((p: TradePlan[]) => { setPlansState(p); savePlans(sym, p); }, [sym]);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [menu, setMenu] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawTool | null>(null);
  const [magnet, setMagnet] = useState(true);
  const [hideAll, setHideAll] = useState(false);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [full, setFull] = useState(false);
  const [editInd, setEditInd] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; price: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [goDate, setGoDate] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { setPanel(load<PanelId | null>("panel", null)); }, []);
  const openPanel = (p: PanelId | null) => { setPanel(p); save("panel", p); };
  const flash = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2600); }, []);

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["pulse", sym, rangeCfg.api, iv.api, setup.ext],
    queryFn: () => fetchStockHistory(sym, rangeCfg.api, iv.api, setup.ext),
    enabled: ready,
    staleTime: iv.intraday ? 15_000 : 60_000,
    refetchInterval: iv.intraday ? 15_000 : 120_000,
  });

  const { bars, extMissing } = useMemo(() => {
    let out: Bar[] = (data?.bars ?? [])
      .filter((b) => b.close != null)
      .map((b) => ({ time: toSec(b.date), open: b.open ?? b.close, high: b.high ?? b.close, low: b.low ?? b.close, close: b.close, volume: b.volume ?? 0 }));
    out.sort((a, b) => a.time - b.time);
    out = out.filter((b, i) => i === 0 || b.time !== out[i - 1].time);
    let extMissing = false;
    if (iv.intraday) {
      if (!setup.ext) out = out.filter((b) => isRth(b.time));
      else extMissing = out.length > 0 && out.every((b) => isRth(b.time));
    }
    if (iv.resampleSec) out = resample(out, iv.resampleSec);
    return { bars: out, extMissing };
  }, [data, iv, setup.ext]);
  const shown = useMemo(() => (setup.style === "heikin" ? heikinAshi(bars) : bars), [bars, setup.style]);
  const closes = useMemo(() => bars.map((b) => b.close), [bars]);

  /** Indicator series values, one entry per output line. */
  const calc = useMemo(() => {
    const m = new Map<string, { name: string; color: string; values: (number | null)[]; hist?: boolean }[]>();
    for (const ind of setup.indicators) {
      const p = ind.params;
      switch (ind.type) {
        case "ema": m.set(ind.id, [{ name: "", color: ind.color, values: ema(closes, p.length) }]); break;
        case "sma": m.set(ind.id, [{ name: "", color: ind.color, values: sma(closes, p.length) }]); break;
        case "vwap": m.set(ind.id, [{ name: "", color: ind.color, values: vwap(bars, iv.intraday) }]); break;
        case "bb": { const b = bollinger(closes, p.length, p.mult); m.set(ind.id, [
          { name: "upper", color: ind.color, values: b.up }, { name: "basis", color: ind.color, values: b.mid }, { name: "lower", color: ind.color, values: b.lo }]); break; }
        case "rsi": m.set(ind.id, [{ name: "", color: ind.color, values: rsi(closes, p.length) }]); break;
        case "macd": { const r = macd(closes, p.fast, p.slow, p.signal); m.set(ind.id, [
          { name: "hist", color: ind.color, values: r.hist, hist: true }, { name: "macd", color: ind.color, values: r.line }, { name: "signal", color: INDICATORS.macd.colors[1], values: r.sig }]); break; }
      }
    }
    return m;
  }, [setup.indicators, closes, bars, iv.intraday]);

  // ── Chart instance ─────────────────────────────────────────────────────────
  const wrap = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [main, setMain] = useState<LineRef | null>(null);
  const extra = useRef<{ vol: LineRef | null; ind: Map<string, LineRef[]> }>({ vol: null, ind: new Map() });
  const priceLines = useRef<IPriceLine[]>([]);
  const [version, setVersion] = useState(0);
  const lib = useRef<typeof import("lightweight-charts") | null>(null);

  const upCol = setup.colors.up || (dark ? "#34d399" : "#00875a");
  const dnCol = setup.colors.down || (dark ? "#fb7185" : "#e11d48");
  const accent = dark ? "#7aa2ff" : "#2f5bea";
  const gridC = dark ? "rgba(148,163,184,0.08)" : "rgba(14,15,18,0.05)";
  const textC = dark ? "rgba(203,213,225,0.65)" : "rgba(14,15,18,0.55)";
  const borderC = dark ? "rgba(148,163,184,0.16)" : "rgba(14,15,18,0.1)";

  useEffect(() => {
    let dead = false;
    let made: IChartApi | null = null;
    (async () => {
      const L = await import("lightweight-charts");
      if (dead || !host.current) return;
      lib.current = L;
      made = L.createChart(host.current, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: textC, fontFamily: "DM Mono, ui-monospace, monospace", fontSize: 11, panes: { separatorColor: borderC } },
        grid: { vertLines: { color: gridC }, horzLines: { color: gridC } },
        crosshair: { mode: L.CrosshairMode.Normal },
        rightPriceScale: { borderColor: borderC },
        timeScale: { borderColor: borderC, rightOffset: 6, secondsVisible: false },
      });
      made.subscribeCrosshairMove((p) => {
        if (p.logical == null || p.point == null) { setHoverIdx(null); return; }
        setHoverIdx(Math.round(p.logical));
      });
      setChart(made);
    })();
    return () => { dead = true; made?.remove(); setChart(null); setMain(null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme, grid, time zone and time axis format.
  useEffect(() => {
    if (!chart) return;
    const tz = iv.intraday ? setup.tz : "UTC";
    const dt = (t: Time, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(new Date((t as number) * 1000));
    chart.applyOptions({
      layout: { textColor: textC, panes: { separatorColor: borderC } },
      grid: { vertLines: { color: setup.colors.grid ? gridC : "transparent" }, horzLines: { color: setup.colors.grid ? gridC : "transparent" } },
      rightPriceScale: { borderColor: borderC },
      localization: {
        timeFormatter: (t: Time) => iv.intraday
          ? dt(t, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : dt(t, { weekday: "short", month: "short", day: "numeric", year: "2-digit" }),
      },
      timeScale: {
        borderColor: borderC, timeVisible: iv.intraday,
        tickMarkFormatter: (t: Time, type: number) => {
          // 0 year · 1 month · 2 day of month · 3 time · 4 time with seconds
          if (type === 0) return dt(t, { year: "numeric" });
          if (type === 1) return dt(t, { month: "short" });
          if (type === 2) return dt(t, { month: "short", day: "numeric" });
          return dt(t, { hour: "numeric", minute: "2-digit" });
        },
      },
    });
  }, [chart, dark, setup.tz, setup.colors.grid, iv.intraday, textC, borderC, gridC]);

  // Series structure: rebuilt when style, indicators, volume or colours change (not on every data refresh).
  const structKey = JSON.stringify([setup.style, setup.volume, upCol, dnCol, dark, setup.indicators.map((i) => [i.id, i.type, i.color])]);
  useEffect(() => {
    const L = lib.current;
    if (!chart || !L) return;
    // Tear down.
    const all: LineRef[] = [];
    chart.panes().forEach((p) => all.push(...p.getSeries()));
    priceLines.current = [];
    all.forEach((s) => { try { chart.removeSeries(s); } catch { /* gone */ } });
    for (let i = chart.panes().length - 1; i > 0; i--) { try { chart.removePane(i); } catch { /* gone */ } }
    extra.current = { vol: null, ind: new Map() };

    // Price series.
    let m: LineRef;
    const s = setup.style;
    if (s === "line") m = chart.addSeries(L.LineSeries, { color: accent, lineWidth: 2, priceLineVisible: true });
    else if (s === "area") m = chart.addSeries(L.AreaSeries, { lineColor: accent, topColor: accent + "55", bottomColor: accent + "05", lineWidth: 2 });
    else if (s === "bars") m = chart.addSeries(L.BarSeries, { upColor: upCol, downColor: dnCol, thinBars: false });
    else m = chart.addSeries(L.CandlestickSeries, {
      upColor: s === "hollow" ? "rgba(0,0,0,0)" : upCol, downColor: dnCol, borderVisible: s === "hollow",
      borderUpColor: upCol, borderDownColor: dnCol, wickUpColor: upCol, wickDownColor: dnCol,
    });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: setup.volume ? 0.22 : 0.06 } });

    if (setup.volume) {
      const v = chart.addSeries(L.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      extra.current.vol = v;
    }

    let pane = 1;
    for (const ind of setup.indicators) {
      const def = INDICATORS[ind.type];
      const idx = def.pane === "sub" ? pane++ : 0;
      const refs: LineRef[] = [];
      const common = { priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false };
      if (ind.type === "bb") {
        refs.push(chart.addSeries(L.LineSeries, { ...common, color: ind.color, lineWidth: 1 }, idx));
        refs.push(chart.addSeries(L.LineSeries, { ...common, color: ind.color, lineWidth: 1, lineStyle: L.LineStyle.Dashed, lastValueVisible: false }, idx));
        refs.push(chart.addSeries(L.LineSeries, { ...common, color: ind.color, lineWidth: 1 }, idx));
      } else if (ind.type === "macd") {
        refs.push(chart.addSeries(L.HistogramSeries, { ...common, lastValueVisible: false }, idx));
        refs.push(chart.addSeries(L.LineSeries, { ...common, color: ind.color, lineWidth: 1.5 as 1 }, idx));
        refs.push(chart.addSeries(L.LineSeries, { ...common, color: INDICATORS.macd.colors[1], lineWidth: 1 }, idx));
      } else {
        const ln = chart.addSeries(L.LineSeries, { ...common, color: ind.color, lineWidth: ind.type === "rsi" ? 1.5 as 1 : 2 }, idx);
        if (ind.type === "rsi") {
          for (const [lv, c] of [[70, dnCol], [30, upCol], [50, borderC]] as const) {
            ln.createPriceLine({ price: lv, color: c, lineWidth: 1, lineStyle: L.LineStyle.Dashed, axisLabelVisible: lv !== 50, title: "" });
          }
        }
        refs.push(ln);
      }
      extra.current.ind.set(ind.id, refs);
    }
    // Price pane gets most of the height; each indicator pane about a fifth of it.
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 1 : 0.22));
    setMain(m);
    setVersion((v) => v + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, structKey]);

  // Data into the series.
  useEffect(() => {
    if (!chart || !main) return;
    const t = (s: number) => s as UTCTimestamp;
    const st = setup.style;
    if (st === "line" || st === "area") main.setData(shown.map((b) => ({ time: t(b.time), value: b.close })));
    else main.setData(shown.map((b) => ({ time: t(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
    extra.current.vol?.setData(bars.map((b, i) => ({
      time: t(b.time), value: b.volume, color: (b.close >= (i ? bars[i - 1].close : b.open) ? upCol : dnCol) + "4d",
    })));
    for (const ind of setup.indicators) {
      const refs = extra.current.ind.get(ind.id) ?? [];
      (calc.get(ind.id) ?? []).forEach((line, li) => {
        const s = refs[li];
        if (!s) return;
        s.setData(bars.map((b, i) => {
          const v = line.values[i];
          if (v == null) return { time: t(b.time) };
          return line.hist ? { time: t(b.time), value: v, color: (v >= 0 ? upCol : dnCol) + "99" } : { time: t(b.time), value: v };
        }));
        s.applyOptions({ visible: ind.visible });
      });
    }
    setVersion((v) => v + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, main, shown, calc, setup.indicators]);

  // Fit the view when the symbol, interval or range changes (not on refreshes).
  const fitKey = `${sym}|${iv.id}|${rangeCfg.id}|${setup.ext}`;
  const fitted = useRef("");
  useEffect(() => {
    if (!chart || !main || !bars.length || fitted.current === fitKey) return;
    fitted.current = fitKey;
    chart.timeScale().fitContent();
  }, [chart, main, bars.length, fitKey]);

  // Scale mode.
  useEffect(() => {
    const L = lib.current;
    if (!chart || !L || !main) return;
    const mode = setup.scale === "log" ? L.PriceScaleMode.Logarithmic : setup.scale === "percent" ? L.PriceScaleMode.Percentage : L.PriceScaleMode.Normal;
    chart.priceScale("right").applyOptions({ mode, autoScale: setup.autoScale });
  }, [chart, main, setup.scale, setup.autoScale]);

  // ── GEX layers as price lines ──────────────────────────────────────────────
  const layerLevels = useMemo(() => {
    const out: { id: LayerId; price: number; title: string; color: string; style: number; width: 1 | 2 }[] = [];
    if (!gex || gex.error) return out;
    const L = setup.layers;
    const king = gex.max_gex_strike;
    if (L.flip && gex.zero_gamma != null) out.push({ id: "flip", price: gex.zero_gamma, title: "Flip", color: accent, style: 2, width: 1 });
    const a = anchorOf(gex);
    if (L.anchor && a) out.push({ id: "anchor", price: a.price, title: "⚓ Anchor", color: dark ? "#67e8f9" : "#0e7490", style: 2, width: 1 });
    if (L.king && king != null) out.push({ id: "king", price: king, title: "★ King", color: dark ? "#fde725" : "#b45309", style: 0, width: 2 });
    if (L.callWall && gex.max_call_wall != null) out.push({ id: "callWall", price: gex.max_call_wall, title: "Call wall", color: upCol, style: 1, width: 1 });
    if (L.putWall && gex.max_put_wall != null) out.push({ id: "putWall", price: gex.max_put_wall, title: "Put wall", color: dnCol, style: 1, width: 1 });
    if (L.defense) {
      const ks = gex.strikes ?? [], gs = gex.gex_by_strike ?? [];
      ks.map((k, i) => ({ k, g: gs[i] ?? 0 }))
        .filter((x) => x.g > 0 && x.k !== king && Math.abs(x.k / gex.spot - 1) <= 0.1)
        .sort((p, q) => q.g - p.g).slice(0, 3)
        .forEach((x, i) => out.push({ id: "defense", price: x.k, title: `Defense ${i + 1}`, color: dark ? "#a3e635" : "#4d7c0f", style: 3, width: 1 }));
    }
    const o = gex.outlook;
    if (L.battle && o?.battleground != null) out.push({ id: "battle", price: o.battleground, title: "⚔ Battle", color: "#f59e0b", style: 2, width: 1 });
    if (L.range && o?.expected_high != null) out.push({ id: "range", price: o.expected_high, title: `+1σ ${o.expected_dte ?? ""}d`, color: textC, style: 3, width: 1 });
    if (L.range && o?.expected_low != null) out.push({ id: "range", price: o.expected_low, title: `−1σ ${o.expected_dte ?? ""}d`, color: textC, style: 3, width: 1 });
    return out;
  }, [gex, setup.layers, dark, accent, upCol, dnCol, textC]);

  useEffect(() => {
    if (!main) return;
    priceLines.current.forEach((pl) => { try { main.removePriceLine(pl); } catch { /* gone */ } });
    priceLines.current = layerLevels.map((lv) => main.createPriceLine({
      price: lv.price, color: lv.color, lineWidth: lv.width, lineStyle: lv.style, axisLabelVisible: true, title: lv.title,
    }));
  }, [main, layerLevels, version]);

  // ── Alerts and paper plans follow the last price ───────────────────────────
  const last = bars.length ? bars[bars.length - 1].close : null;
  useEffect(() => {
    if (last == null) return;
    const hit = alerts.filter((a) => !a.triggered && (a.dir === "above" ? last >= a.price : last <= a.price));
    if (hit.length) {
      setAlerts(alerts.map((a) => (hit.includes(a) ? { ...a, triggered: Date.now() } : a)));
      for (const a of hit) {
        const msg = `${sym} ${a.dir === "above" ? "rose to" : "fell to"} ${a.price.toFixed(2)}${a.note ? ` · ${a.note}` : ""}`;
        flash(`🔔 ${msg}`);
        try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Price alert", { body: msg }); } catch { /* not allowed here */ }
      }
    }
    let changed = false;
    const next = plans.map((p) => {
      const long = p.side === "long";
      if (p.status === "planned" && (long ? last <= p.entry * 1.0005 : last >= p.entry * 0.9995)) { changed = true; return { ...p, status: "open" as const }; }
      if (p.status === "open") {
        if (long ? last >= p.target : last <= p.target) { changed = true; flash(`${sym} paper ${p.side} hit its target`); return { ...p, status: "target" as const }; }
        if (long ? last <= p.stop : last >= p.stop) { changed = true; flash(`${sym} paper ${p.side} stopped out`); return { ...p, status: "stopped" as const }; }
      }
      return p;
    });
    if (changed) setPlans(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last]);

  // ── Fullscreen ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else wrap.current?.requestFullscreen?.().catch(() => flash("Fullscreen isn't available here"));
  };

  // ── Share ──────────────────────────────────────────────────────────────────
  const shot = async (mode: "copy" | "save") => {
    if (!chart) return;
    setMenu(null);
    const canvas = await compositeScreenshot(chart);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return;
    if (mode === "copy" && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); flash("Chart image copied"); return; } catch { /* fall through to save */ }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${sym}-${iv.id}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    flash(mode === "copy" ? "Copy isn't allowed here; image saved instead" : "Chart image saved");
  };

  // ── Go to date ─────────────────────────────────────────────────────────────
  const goTo = () => {
    if (!chart || !goDate || !bars.length) return;
    const ts = toSec(goDate);
    const i = bars.findIndex((b) => b.time >= ts);
    if (i < 0 || ts < bars[0].time - 86400) { flash("That date isn't in the loaded range; pick a longer range"); return; }
    const r = chart.timeScale().getVisibleLogicalRange();
    const span = r ? r.to - r.from : 60;
    chart.timeScale().setVisibleLogicalRange({ from: (i - span / 2) as Logical, to: (i + span / 2) as Logical });
    setMenu(null);
  };

  // ── Layouts ────────────────────────────────────────────────────────────────
  const [layouts, setLayouts] = useState<Layout[]>([]);
  useEffect(() => { setLayouts(loadLayouts()); }, []);
  const saveLayout = () => {
    const name = window.prompt("Name this layout", `Layout ${layouts.length + 1}`)?.trim();
    if (!name) return;
    const next = [...layouts.filter((l) => l.name !== name), { id: uid(), name, setup }];
    setLayouts(next); saveLayouts(next); flash(`Saved “${name}”`);
  };
  const applyLayout = (l: Layout) => { const s = normalizeSetup(l.setup); setSetupState(s); saveSetup(s); setMenu(null); flash(`Layout “${l.name}”`); };
  const deleteLayout = (id: string) => { const next = layouts.filter((l) => l.id !== id); setLayouts(next); saveLayouts(next); };

  // ── Indicators ─────────────────────────────────────────────────────────────
  const addInd = (type: IndicatorType) => {
    const used = new Set(setup.indicators.map((i) => i.color));
    const palette = ["#f59e0b", "#7aa2ff", "#c084fc", "#14b8a6", "#e879f9", "#f97316", "#38bdf8", "#a3e635"];
    const color = INDICATORS[type].colors.find((c) => !used.has(c)) ?? palette.find((c) => !used.has(c)) ?? palette[0];
    setSetup({ indicators: [...setup.indicators, newIndicator(type, { color })] });
    setMenu(null);
  };
  const patchInd = (id: string, p: Partial<IndicatorInstance>) => setSetup({ indicators: setup.indicators.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  const removeInd = (id: string) => { setSetup({ indicators: setup.indicators.filter((i) => i.id !== id) }); if (editInd === id) setEditInd(null); };

  // ── Keyboard ───────────────────────────────────────────────────────────────
  const hovering = useRef(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (!hovering.current && !wrap.current?.contains(document.activeElement)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") { setTool(null); setSelected(null); setCtx(null); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); setDrawings(drawings.filter((d) => d.id !== selected)); setSelected(null); return; }
      if (e.altKey && !mod) {
        const t = TOOLS.find((x) => x.key === e.key.toUpperCase() || `Key${x.key}` === e.code);
        if (t) { e.preventDefault(); setTool(t.id); }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [undo, redo, selected, drawings, setDrawings]);

  // ── Context menu (right-click on the chart) ────────────────────────────────
  const onContext = (e: React.MouseEvent) => {
    if (!main || !host.current) return;
    const r = host.current.getBoundingClientRect();
    const y = e.clientY - r.top;
    const paneH = chart?.panes()[0]?.getHeight() ?? r.height;
    if (y > paneH) return;
    const p = main.coordinateToPrice(y);
    if (p == null) return;
    e.preventDefault();
    setCtx({ x: e.clientX - r.left, y, price: Math.round((p as number) * 100) / 100 });
  };
  const ctxAlert = (price: number) => {
    setAlerts([...alerts, { id: uid(), price, dir: last != null && price < last ? "below" : "above", created: Date.now() }]);
    flash(`Alert at ${price.toFixed(2)}`); setCtx(null);
    if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  };
  const ctxPlan = (side: "long" | "short", entry: number) => {
    const risk = entry * 0.02;
    setPlans([...plans, { id: uid(), side, entry, stop: +(side === "long" ? entry - risk : entry + risk).toFixed(2), target: +(side === "long" ? entry + 2 * risk : entry - 2 * risk).toFixed(2), qty: 100, created: Date.now(), status: "planned" }]);
    openPanel("plans"); setCtx(null); flash(`Paper ${side} planned at ${entry.toFixed(2)} (2% stop, 2R target; edit in Plans)`);
  };

  // ── Legend values ──────────────────────────────────────────────────────────
  const li = hoverIdx != null && hoverIdx >= 0 && hoverIdx < bars.length ? hoverIdx : bars.length - 1;
  const lb = bars[li];
  const lbShown = shown[li];
  const prevClose = li > 0 ? bars[li - 1].close : lb?.open;
  const chg = lb && prevClose ? lb.close - prevClose : null;
  const first = bars[0];
  const dayChg = last != null && first ? ((last - first.close) / first.close) * 100 : null;
  const sess = now ? session(now) : null;
  const clock = now ? new Intl.DateTimeFormat("en-US", { timeZone: setup.tz, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(now) : "";
  const tzShort = TZS.find((t) => t.id === setup.tz)?.label.replace(/^.*\((.*)\)$/, "$1") ?? setup.tz;
  const canUndo = past.current.length > 0, canRedo = future.current.length > 0;
  const chartH = full ? undefined : height;
  const anyLayer = Object.values(setup.layers).some(Boolean);

  const iconBtn = (on: boolean) => clsx("grid h-8 w-8 place-items-center rounded-md transition", on ? "bg-foreground text-[var(--background)]" : "text-foreground/60 hover:bg-foreground/[0.07] hover:text-foreground");
  const pill = (on: boolean) => clsx("h-7 rounded-md px-2 text-[11.5px] font-medium tabular-nums transition", on ? "bg-foreground text-[var(--background)]" : "text-foreground/55 hover:bg-foreground/[0.07] hover:text-foreground");

  return (
    <div ref={wrap} tabIndex={-1}
      onPointerEnter={() => { hovering.current = true; }} onPointerLeave={() => { hovering.current = false; }}
      className={clsx("relative flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] outline-none", full && "h-screen rounded-none")}>
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5">
        <div className="mr-1 flex items-baseline gap-2 px-1">
          <span className="font-mono text-[13px] font-semibold text-foreground">{sym}</span>
          {last != null && <span className="font-mono text-[13px] font-semibold tabular-nums text-foreground">{fmt$(last)}</span>}
          {dayChg != null && <span className={clsx("font-mono text-[11px] tabular-nums", dayChg >= 0 ? "text-gain" : "text-loss")}>{dayChg >= 0 ? "+" : ""}{dayChg.toFixed(2)}% <span className="text-foreground/40">{rangeCfg.id}</span></span>}
        </div>

        <Menu id="interval" open={menu} onOpen={setMenu} title="Interval" width={170}
          button={<><span className="font-mono">{iv.id}</span><ChevronDown size={12} /></>}>
          <MenuLabel>Interval</MenuLabel>
          {INTERVALS.map((i) => <MenuItem key={i.id} active={i.id === iv.id} onClick={() => { pickInterval(i.id); setMenu(null); }} hint={i.id}>{i.label}</MenuItem>)}
        </Menu>

        <div role="radiogroup" aria-label="Range" className="flex flex-wrap items-center">
          {RANGES.map((r) => (
            <button key={r.id} role="radio" aria-checked={r.id === rangeCfg.id} onClick={() => pickRange(r.id)} className={pill(r.id === rangeCfg.id)}>{r.id}</button>
          ))}
        </div>

        {iv.intraday && (
          <div role="radiogroup" aria-label="Session" className="flex rounded-md border border-[var(--border)]">
            {([[false, "RTH"], [true, "Ext"]] as const).map(([v, l]) => (
              <button key={l} role="radio" aria-checked={setup.ext === v} onClick={() => setSetup({ ext: v })}
                title={v ? "Include pre- and after-market bars" : "Regular trading hours, 9:30–16:00 ET"}
                className={clsx("h-6 px-1.5 text-[11px] font-medium", setup.ext === v ? "bg-foreground/[0.1] text-foreground" : "text-foreground/50 hover:text-foreground")}>{l}</button>
            ))}
          </div>
        )}

        <span className="mx-0.5 h-5 w-px bg-[var(--border)]" />

        <Menu id="style" open={menu} onOpen={setMenu} title="Chart style" width={180}
          button={(() => { const S = STYLES.find((x) => x.id === setup.style) ?? STYLES[0]; return <><S.icon size={14} /><ChevronDown size={12} /></>; })()}>
          <MenuLabel>Style</MenuLabel>
          {STYLES.map((s) => <MenuItem key={s.id} active={s.id === setup.style} onClick={() => { setSetup({ style: s.id }); setMenu(null); }}><s.icon size={13} />{s.label}</MenuItem>)}
          <MenuLabel>Panes</MenuLabel>
          <MenuItem onClick={() => setSetup({ volume: !setup.volume })} hint={setup.volume ? "on" : "off"}>Volume</MenuItem>
        </Menu>

        <Menu id="ind" open={menu} onOpen={setMenu} title="Indicators" width={260}
          button={<><span className="font-serif italic">fx</span> Indicators{setup.indicators.length ? <span className="text-foreground/45">{setup.indicators.length}</span> : null}</>}>
          <MenuLabel>Add</MenuLabel>
          {(Object.keys(INDICATORS) as IndicatorType[]).map((t) => (
            <MenuItem key={t} onClick={() => addInd(t)} hint={INDICATORS[t].pane === "sub" ? "pane" : "overlay"}>
              <Plus size={12} /><span><span className="font-medium text-foreground">{INDICATORS[t].label}</span> <span className="text-foreground/50">{INDICATORS[t].blurb.split(",")[0]}</span></span>
            </MenuItem>
          ))}
        </Menu>

        <Menu id="layers" open={menu} onOpen={setMenu} title="Dealer levels on the chart" width={270}
          button={<><Layers size={13} /> Layers</>}>
          <MenuLabel>Dealer levels (from the options chain)</MenuLabel>
          {!gex || gex.error ? <p className="px-2 py-1 text-[12px] text-foreground/55">No options data for {sym}.</p> : LAYERS.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-foreground/[0.06]" title={l.blurb}>
              <input type="checkbox" className="mt-0.5 accent-[rgb(var(--accent-rgb))]" checked={setup.layers[l.id]} onChange={(e) => setSetup({ layers: { ...setup.layers, [l.id]: e.target.checked } })} />
              <span className="text-[12px]"><span className="text-foreground">{l.label}</span><span className="block text-[11px] leading-snug text-foreground/50">{l.blurb}</span></span>
            </label>
          ))}
          {gex && !gex.error && (
            <div className="flex gap-2 px-2 pb-1 pt-1.5 text-[11.5px]">
              <button className="text-accent hover:underline" onClick={() => setSetup({ layers: Object.fromEntries(LAYERS.map((l) => [l.id, true])) as Record<LayerId, boolean> })}>All</button>
              <button className="text-foreground/60 hover:underline" onClick={() => setSetup({ layers: Object.fromEntries(LAYERS.map((l) => [l.id, false])) as Record<LayerId, boolean> })}>None</button>
            </div>
          )}
        </Menu>

        <span className="mx-0.5 h-5 w-px bg-[var(--border)]" />

        <div className="flex items-center" role="group" aria-label="Price scale">
          <button className={pill(setup.autoScale)} aria-pressed={setup.autoScale} onClick={() => setSetup({ autoScale: !setup.autoScale })} title="Fit the price axis to the visible bars">auto</button>
          <button className={pill(setup.scale === "percent")} aria-pressed={setup.scale === "percent"} onClick={() => setSetup({ scale: setup.scale === "percent" ? "normal" : "percent" })} title="Percent from the first visible bar">%</button>
          <button className={pill(setup.scale === "log")} aria-pressed={setup.scale === "log"} onClick={() => setSetup({ scale: setup.scale === "log" ? "normal" : "log" })} title="Logarithmic price axis">log</button>
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          {sess && (
            <span className="mr-1 hidden items-center gap-1.5 font-mono text-[11px] tabular-nums text-foreground/60 md:inline-flex" title="Market session (exchange holidays not shown)">
              <span className={clsx("h-1.5 w-1.5 rounded-full", sess.label === "Open" ? "bg-gain" : sess.label === "Closed" ? "bg-foreground/30" : "bg-warn")} />
              <span className={sess.tone}>{sess.label}</span> {clock} {tzShort}
            </span>
          )}
          <Menu id="layout" open={menu} onOpen={setMenu} title="My layouts" align="right" width={230} button={<LayoutTemplate size={14} />}>
            <MenuLabel>My layouts</MenuLabel>
            {!layouts.length && <p className="px-2 py-1 text-[11.5px] text-foreground/55">Save the interval, range, style, indicators and layers you use, then switch in one click.</p>}
            {layouts.map((l) => (
              <div key={l.id} className="flex items-center">
                <MenuItem onClick={() => applyLayout(l)} hint={`${l.setup.interval} · ${l.setup.indicators.length} ind`}>{l.name}</MenuItem>
                <button onClick={() => deleteLayout(l.id)} aria-label={`Delete ${l.name}`} className="p-1 text-foreground/40 hover:text-loss"><Trash2 size={12} /></button>
              </div>
            ))}
            <div className="mt-1 border-t border-[var(--border)] pt-1">
              <MenuItem onClick={saveLayout}><Plus size={12} /> Save current layout…</MenuItem>
              <MenuItem onClick={() => { setSetupState(DEFAULT_SETUP); saveSetup(DEFAULT_SETUP); setMenu(null); }}>Reset to default</MenuItem>
            </div>
          </Menu>
          <Menu id="settings" open={menu} onOpen={setMenu} title="Chart settings" align="right" width={240} button={<Settings2 size={14} />}>
            <MenuLabel>Colours</MenuLabel>
            <div className="flex items-center justify-between px-2 py-1 text-[12px] text-foreground/75">Up
              <input type="color" aria-label="Up colour" value={upCol} onChange={(e) => setSetup({ colors: { ...setup.colors, up: e.target.value } })} className="h-6 w-10 cursor-pointer bg-transparent" /></div>
            <div className="flex items-center justify-between px-2 py-1 text-[12px] text-foreground/75">Down
              <input type="color" aria-label="Down colour" value={dnCol} onChange={(e) => setSetup({ colors: { ...setup.colors, down: e.target.value } })} className="h-6 w-10 cursor-pointer bg-transparent" /></div>
            <MenuItem onClick={() => setSetup({ colors: { ...setup.colors, grid: !setup.colors.grid } })} hint={setup.colors.grid ? "on" : "off"}>Grid lines</MenuItem>
            <MenuItem onClick={() => setSetup({ colors: { up: "", down: "", grid: true } })}>Theme colours</MenuItem>
            <MenuLabel>Time zone</MenuLabel>
            <select value={setup.tz} onChange={(e) => setSetup({ tz: e.target.value })} aria-label="Time zone"
              className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 text-[12px] text-foreground">
              {TZS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <p className="px-2 pb-1 text-[10.5px] text-foreground/45">Daily and longer bars are labelled by trading date.</p>
          </Menu>
          <Menu id="goto" open={menu} onOpen={setMenu} title="Go to date" align="right" width={220} button={<Calendar size={14} />}>
            <MenuLabel>Go to date</MenuLabel>
            <form className="flex gap-1.5 px-2 pb-1.5" onSubmit={(e) => { e.preventDefault(); goTo(); }}>
              <input type="date" value={goDate} onChange={(e) => setGoDate(e.target.value)} aria-label="Date"
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 text-[12px] text-foreground" />
              <button type="submit" className="rounded-md bg-foreground px-2 text-[12px] font-medium text-[var(--background)]">Go</button>
            </form>
            <MenuItem onClick={() => { chart?.timeScale().scrollToRealTime(); setMenu(null); }}>Back to latest</MenuItem>
          </Menu>
          <Menu id="share" open={menu} onOpen={setMenu} title="Share" align="right" width={180} button={<Camera size={14} />}>
            <MenuItem onClick={() => shot("copy")}><Copy size={13} /> Copy image</MenuItem>
            <MenuItem onClick={() => shot("save")}><Download size={13} /> Save image</MenuItem>
          </Menu>
          <button onClick={() => refetch()} title="Refresh" className="grid h-7 w-7 place-items-center rounded-md text-foreground/60 hover:bg-foreground/[0.07] hover:text-foreground">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
          <button onClick={toggleFull} title={full ? "Exit fullscreen" : "Fullscreen"} className="grid h-7 w-7 place-items-center rounded-md text-foreground/60 hover:bg-foreground/[0.07] hover:text-foreground">
            {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button onClick={() => openPanel(panel ? null : "watchlist")} aria-pressed={!!panel} title="Side panel: watchlist, details, flow, alerts, plans, objects"
            className={clsx("grid h-7 w-7 place-items-center rounded-md hover:bg-foreground/[0.07]", panel ? "text-foreground" : "text-foreground/60")}>
            <PanelRight size={14} />
          </button>
        </div>
      </div>

      {/* ── Body: tool rail · chart · side panel ──────────────────────────── */}
      <div className={clsx("flex min-h-0", full ? "flex-1" : "flex-none", panel && "max-md:flex-col max-md:!h-auto")} style={{ height: chartH }}>
        <div role="toolbar" aria-label="Drawing tools" aria-orientation="vertical"
          className="flex w-10 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-[var(--border)] py-1.5 [scrollbar-width:none] max-md:hidden">
          <button className={iconBtn(tool == null)} onClick={() => setTool(null)} title="Pointer (Esc)" aria-pressed={tool == null}><MousePointer2 size={15} /></button>
          {TOOLS.map((t) => { const I = TOOL_ICON[t.id]; return (
            <button key={t.id} className={iconBtn(tool === t.id)} onClick={() => setTool(tool === t.id ? null : t.id)} title={`${t.label} (Alt+${t.key})`} aria-pressed={tool === t.id}><I size={15} /></button>
          ); })}
          <span className="my-1 h-px w-6 bg-[var(--border)]" />
          <Menu id="dcolor" open={menu} onOpen={setMenu} title="Drawing colour" width={150}
            button={<span className="h-3.5 w-3.5 rounded-full border border-foreground/30" style={{ background: drawColor }} />}>
            <div className="flex flex-wrap gap-1.5 p-1.5">
              {DRAW_COLORS.map((c) => (
                <button key={c} aria-label={`Colour ${c}`} onClick={() => {
                  setDrawColor(c);
                  if (selected) setDrawings(drawings.map((d) => (d.id === selected ? { ...d, color: c } : d)));
                  setMenu(null);
                }} className={clsx("h-6 w-6 rounded-full border", c === drawColor ? "border-foreground" : "border-transparent")} style={{ background: c }} />
              ))}
            </div>
          </Menu>
          <button className={iconBtn(magnet)} onClick={() => setMagnet((m) => !m)} title="Magnet: snap to open / high / low / close" aria-pressed={magnet}><Magnet size={15} /></button>
          <button className={iconBtn(false)} disabled={!selected} onClick={() => selected && setDrawings(drawings.map((d) => (d.id === selected ? { ...d, locked: !d.locked } : d)))}
            title="Lock / unlock the selected drawing"><Lock size={15} className={selected ? "" : "opacity-40"} /></button>
          <button className={iconBtn(hideAll)} onClick={() => setHideAll((h) => !h)} title={hideAll ? "Show drawings" : "Hide drawings"} aria-pressed={hideAll}>{hideAll ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          <button className={iconBtn(false)} disabled={!selected} onClick={() => { if (selected) { setDrawings(drawings.filter((d) => d.id !== selected)); setSelected(null); } }}
            title="Delete the selected drawing (Del)"><Trash2 size={15} className={selected ? "" : "opacity-40"} /></button>
          <button className={iconBtn(false)} disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)"><Undo2 size={15} className={canUndo ? "" : "opacity-40"} /></button>
          <button className={iconBtn(false)} disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} className={canRedo ? "" : "opacity-40"} /></button>
          <button className={iconBtn(panel === "objects")} onClick={() => openPanel(panel === "objects" ? null : "objects")} title="Chart objects"><Layers size={15} /></button>
        </div>

        <div className={clsx("relative min-w-0 flex-1", panel && "max-md:min-h-[360px] max-md:flex-none")} style={{ height: panel ? undefined : "100%" }} onContextMenu={onContext}>
          {/* Legend */}
          <div className="pointer-events-none absolute left-2 top-1.5 z-20 max-w-[calc(100%-5rem)] font-mono text-[11px] tabular-nums">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-foreground/60">
              {lb && <>
                <span className="text-foreground/45">{new Intl.DateTimeFormat("en-US", iv.intraday
                  ? { timeZone: setup.tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
                  : { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(lb.time * 1000))}</span>
                <span>O <b className="font-medium text-foreground">{fmt$(lbShown?.open)}</b></span>
                <span>H <b className="font-medium text-foreground">{fmt$(lbShown?.high)}</b></span>
                <span>L <b className="font-medium text-foreground">{fmt$(lbShown?.low)}</b></span>
                <span>C <b className="font-medium text-foreground">{fmt$(lbShown?.close)}</b></span>
                {chg != null && prevClose ? <span className={chg >= 0 ? "text-gain" : "text-loss"}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)} ({chg >= 0 ? "+" : ""}{((chg / prevClose) * 100).toFixed(2)}%)</span> : null}
                {setup.volume && <span>Vol <b className="font-medium text-foreground">{fmtVol(lb.volume)}</b></span>}
              </>}
            </div>
            {setup.indicators.map((ind) => {
              const vals = (calc.get(ind.id) ?? []).map((l) => l.values[li]).filter((v): v is number => v != null);
              return (
                <div key={ind.id} className="group pointer-events-auto mt-0.5 flex w-fit items-center gap-1.5 rounded px-1 hover:bg-[var(--surface)]/90">
                  <span className={clsx(!ind.visible && "opacity-40")} style={{ color: ind.color }}>{indicatorName(ind)}</span>
                  <span className={clsx("text-foreground/70", !ind.visible && "opacity-40")}>{vals.map((v) => fmt$(v)).join(" · ")}</span>
                  <span className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100">
                    <button onClick={() => patchInd(ind.id, { visible: !ind.visible })} aria-label={ind.visible ? `Hide ${indicatorName(ind)}` : `Show ${indicatorName(ind)}`} className="p-0.5 text-foreground/60 hover:text-foreground">{ind.visible ? <Eye size={11} /> : <EyeOff size={11} />}</button>
                    <button onClick={() => setEditInd(editInd === ind.id ? null : ind.id)} aria-label={`${indicatorName(ind)} settings`} className="p-0.5 text-foreground/60 hover:text-foreground"><Settings2 size={11} /></button>
                    <button onClick={() => removeInd(ind.id)} aria-label={`Remove ${indicatorName(ind)}`} className="p-0.5 text-foreground/60 hover:text-loss"><X size={11} /></button>
                  </span>
                </div>
              );
            })}
            {(() => {
              const ind = setup.indicators.find((i) => i.id === editInd);
              if (!ind) return null;
              const def = INDICATORS[ind.type];
              return (
                <div className="pointer-events-auto mt-1 w-56 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-2 font-sans shadow-[var(--shadow-float)]">
                  <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-foreground">{def.label} settings
                    <button onClick={() => setEditInd(null)} aria-label="Close" className="text-foreground/50 hover:text-foreground"><X size={13} /></button></div>
                  {def.params.map((p) => (
                    <label key={p.key} className="mb-1 flex items-center justify-between gap-2 text-[12px] text-foreground/70">{p.label}
                      <input type="number" min={p.min} max={p.max} step={p.key === "mult" ? 0.5 : 1} value={ind.params[p.key] ?? p.def}
                        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= p.min && v <= p.max) patchInd(ind.id, { params: { ...ind.params, [p.key]: v } }); }}
                        className="w-20 rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-right font-mono text-[12px] text-foreground" />
                    </label>
                  ))}
                  <label className="flex items-center justify-between gap-2 text-[12px] text-foreground/70">Colour
                    <input type="color" value={ind.color} onChange={(e) => patchInd(ind.id, { color: e.target.value })} className="h-6 w-10 cursor-pointer bg-transparent" />
                  </label>
                  <p className="mt-1.5 text-[10.5px] leading-snug text-foreground/45">{def.blurb}</p>
                </div>
              );
            })()}
          </div>

          {/* Status notes */}
          <div className="pointer-events-none absolute bottom-8 left-2 z-20 flex flex-col items-start gap-1">
            {tool && <span className="rounded-md bg-foreground px-2 py-0.5 text-[11px] text-[var(--background)]">{TOOLS.find((t) => t.id === tool)!.label}: click {TOOLS.find((t) => t.id === tool)!.points === 1 ? "once" : "two points"} · Esc to cancel</span>}
            {extMissing && <span className="rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-foreground/60">Extended-hours bars aren&apos;t served yet; showing the regular session.</span>}
            {!anyLayer && gex && !gex.error && null}
          </div>

          {isLoading && <div className="absolute inset-0 z-10 grid place-items-center"><RefreshCw size={22} className="animate-spin text-foreground/30" /></div>}
          {!isLoading && !bars.length && <div className="absolute inset-0 z-10 grid place-items-center text-[13px] text-foreground/55">{data?.error ? `No chart data: ${data.error}` : "No chart data for this range."}</div>}

          <div ref={host} className="absolute inset-0" />
          <DrawingLayer chart={chart} series={main} bars={bars} drawings={drawings} onChange={setDrawings}
            tool={tool} onToolDone={() => setTool(null)} magnet={magnet} hideAll={hideAll} color={drawColor}
            selected={selected} onSelect={setSelected} alerts={alerts} plans={plans} dark={dark} version={version} />

          {ctx && (
            <div className="absolute z-40 w-52 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-1 shadow-[var(--shadow-float)]"
              style={{ left: Math.min(ctx.x, (host.current?.clientWidth ?? 300) - 215), top: ctx.y }} onPointerLeave={() => setCtx(null)}>
              <MenuLabel>At {ctx.price.toFixed(2)}</MenuLabel>
              <MenuItem onClick={() => ctxAlert(ctx.price)}><Bell size={13} /> Add price alert</MenuItem>
              <MenuItem onClick={() => { setDrawings([...drawings, { id: uid(), tool: "hline", pts: [{ t: last ? bars[bars.length - 1].time : 0, p: ctx.price }], color: drawColor }]); setCtx(null); }}><MoveHorizontal size={13} /> Horizontal line</MenuItem>
              <MenuItem onClick={() => ctxPlan("long", ctx.price)}><span className="text-gain">▲</span> Paper long here</MenuItem>
              <MenuItem onClick={() => ctxPlan("short", ctx.price)}><span className="text-loss">▼</span> Paper short here</MenuItem>
              <MenuItem onClick={() => { navigator.clipboard?.writeText(ctx.price.toFixed(2)).catch(() => {}); setCtx(null); }}><Copy size={13} /> Copy price</MenuItem>
            </div>
          )}
          {toast && <div role="status" className="absolute right-3 top-3 z-40 rounded-lg bg-foreground px-3 py-1.5 text-[12px] text-[var(--background)] shadow-lg">{toast}</div>}
        </div>

        {panel && (
          <div className="flex shrink-0 flex-col border-[var(--border)] md:w-[270px] md:border-l max-md:h-[360px] max-md:border-t">
            <SidePanel panel={panel} onPanel={(p) => openPanel(p)} symbol={sym} onSymbol={(s) => onSymbol?.(s.toUpperCase())} gex={gex} last={last}
              alerts={alerts} onAlerts={setAlerts} plans={plans} onPlans={setPlans}
              drawings={drawings} onDrawings={setDrawings} selected={selected} onSelect={setSelected} />
          </div>
        )}
      </div>

      {/* Phones: drawing tools in a row under the chart. */}
      <div role="toolbar" aria-label="Drawing tools" className="flex items-center gap-0.5 overflow-x-auto border-t border-[var(--border)] px-1.5 py-1 md:hidden">
        <button className={iconBtn(tool == null)} onClick={() => setTool(null)} aria-label="Pointer"><MousePointer2 size={15} /></button>
        {TOOLS.map((t) => { const I = TOOL_ICON[t.id]; return <button key={t.id} className={iconBtn(tool === t.id)} onClick={() => setTool(tool === t.id ? null : t.id)} aria-label={t.label}><I size={15} /></button>; })}
        <button className={iconBtn(magnet)} onClick={() => setMagnet((m) => !m)} aria-label="Magnet"><Magnet size={15} /></button>
        <button className={iconBtn(false)} disabled={!canUndo} onClick={undo} aria-label="Undo"><Undo2 size={15} /></button>
        <button className={iconBtn(false)} disabled={!selected} onClick={() => { if (selected) { setDrawings(drawings.filter((d) => d.id !== selected)); setSelected(null); } }} aria-label="Delete selected"><Trash2 size={15} /></button>
      </div>
    </div>
  );
}
