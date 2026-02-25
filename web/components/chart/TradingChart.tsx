"use client";
/**
 * TradingChart — a TradingView Lightweight Charts powered OHLCV chart.
 *
 * Features:
 *  - Candlestick or Line mode toggle
 *  - Volume histogram (separate pane)
 *  - SMA overlays: 20 / 50 / 200
 *  - Period selector: 1D · 5D · 1M · 3M · 6M · 1Y · 5Y
 *  - Earnings date vertical line (optional)
 *  - Key GEX levels overlay (optional: call wall, put wall, zero-gamma)
 *  - Crosshair OHLCV legend bar
 *  - Auto dark-mode theme matching CSS vars
 *  - Responsive via ResizeObserver
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchStockHistory } from "@/lib/api";
import { RefreshCw, CandlestickChart, LineChart, Eye, EyeOff } from "lucide-react";

// ── Period config ──────────────────────────────────────────────────────────────
export const PERIODS = [
  { label: "1D",  period: "1d",  interval: "5m"  },
  { label: "5D",  period: "5d",  interval: "15m" },
  { label: "1M",  period: "1mo", interval: "1h"  },
  { label: "3M",  period: "3mo", interval: "1d"  },
  { label: "6M",  period: "6mo", interval: "1d"  },
  { label: "1Y",  period: "1y",  interval: "1d"  },
  { label: "5Y",  period: "5y",  interval: "1wk" },
] as const;

export type PeriodLabel = (typeof PERIODS)[number]["label"];

// ── SMA helper ─────────────────────────────────────────────────────────────────
function calcSMA(closes: number[], n: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < n - 1) return null;
    const sum = closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0);
    return sum / n;
  });
}

// ── Legend state ───────────────────────────────────────────────────────────────
interface LegendData {
  time?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
}

function fmt$(v?: number | null, dp = 2) {
  if (v == null) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtVol(v?: number | null) {
  if (v == null) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}

// ── Props ──────────────────────────────────────────────────────────────────────
interface GexLevels {
  spot?: number;
  callWall?: number;
  putWall?: number;
  zeroGamma?: number;
}

interface Props {
  symbol: string;
  earningsDate?: number | null; // unix timestamp
  gexLevels?: GexLevels;
  initialPeriod?: PeriodLabel;
}

export default function TradingChart({ symbol, earningsDate, gexLevels, initialPeriod = "1D" }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef    = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef   = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeRef   = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sma20Ref    = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sma50Ref    = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sma200Ref   = useRef<any>(null);

  const [periodIdx, setPeriodIdx]   = useState(() => PERIODS.findIndex(p => p.label === initialPeriod) ?? 0);
  const [chartType, setChartType]   = useState<"candle" | "line">("candle");
  const [showSMA, setShowSMA]       = useState({ s20: true, s50: true, s200: false });
  const [legend, setLegend]         = useState<LegendData>({});

  const cfg = PERIODS[periodIdx];
  const isIntraday = cfg.period === "1d" || cfg.period === "5d";

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["tradingChart", symbol, cfg.period, cfg.interval],
    queryFn: () => fetchStockHistory(symbol, cfg.period, cfg.interval),
    staleTime: isIntraday ? 15_000 : 60_000,
    refetchInterval: isIntraday ? 15_000 : undefined,
  });

  const bars = data?.bars ?? [];

  // ── Build + update chart ──────────────────────────────────────────────────
  const buildChart = useCallback(async () => {
    if (!chartContainerRef.current || !bars.length) return;

    // Dynamically import to avoid SSR issues
    const { createChart, CandlestickSeries, LineSeries, HistogramSeries, PriceScaleMode } =
      await import("lightweight-charts");

    const el = chartContainerRef.current;
    const isDark = document.documentElement.classList.contains("dark");
    const bg   = isDark ? "#0d0d0d" : "#ffffff";
    const grid = isDark ? "#1e1e1e" : "#f0f0f0";
    const text = isDark ? "#9ca3af" : "#6b7280";
    const border = isDark ? "#2a2a2a" : "#e5e7eb";

    // Destroy old chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(el, {
      width:  el.clientWidth,
      height: 420,
      layout: { background: { color: bg }, textColor: text, fontFamily: "monospace" },
      grid:   { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: border, scaleMargins: { top: 0.1, bottom: 0.3 } },
      timeScale: {
        borderColor: border,
        timeVisible: isIntraday,
        secondsVisible: false,
        rightOffset: 3,
      },
      handleScroll: true,
      handleScale:  true,
    });
    chartRef.current = chart;

    // ── Price series ──────────────────────────────────────────────────────
    const closes = bars.map(b => b.close);
    const first = closes[0];
    const last  = closes[closes.length - 1];
    const up    = last >= first;
    const upCol = "#22c55e";
    const dnCol = "#ef4444";

    if (chartType === "candle") {
      const cs = chart.addSeries(CandlestickSeries, {
        upColor:      upCol,
        downColor:    dnCol,
        borderVisible: false,
        wickUpColor:   upCol,
        wickDownColor: dnCol,
      });
      const candleData = bars
        .filter(b => b.open != null && b.high != null && b.low != null)
        .map(b => ({
          time: toChartTime(b.date),
          open:  b.open!,
          high:  b.high!,
          low:   b.low!,
          close: b.close,
        }));
      cs.setData(candleData);
      seriesRef.current = cs;
    } else {
      const ls = chart.addSeries(LineSeries, {
        color: up ? upCol : dnCol,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        priceLineVisible: true,
      });
      ls.setData(bars.map(b => ({ time: toChartTime(b.date), value: b.close })));
      seriesRef.current = ls;
    }

    // ── Volume histogram (separate pane) ──────────────────────────────────
    const volSeries = chart.addSeries(HistogramSeries, {
      color: "#6b7280",
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      mode: PriceScaleMode.Normal,
    });
    volSeries.setData(
      bars
        .filter(b => b.volume != null)
        .map((b, i) => {
          const prev = i > 0 ? bars[i - 1].close : b.close;
          return {
            time:  toChartTime(b.date),
            value: b.volume!,
            color: b.close >= prev ? "#22c55e40" : "#ef444440",
          };
        })
    );
    volumeRef.current = volSeries;

    // ── SMA overlays ──────────────────────────────────────────────────────
    const addSMA = (n: number, color: string) => {
      const sma = calcSMA(closes, n);
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: 2, // dashed
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      s.setData(
        bars
          .map((b, i) => ({ time: toChartTime(b.date), value: sma[i] }))
          .filter((d): d is { time: ReturnType<typeof toChartTime>; value: number } => d.value != null)
      );
      return s;
    };

    sma20Ref.current  = addSMA(20,  "#3b82f6");  // blue
    sma50Ref.current  = addSMA(50,  "#f59e0b");  // amber
    sma200Ref.current = addSMA(200, "#a855f7");  // purple

    // Apply visibility
    sma20Ref.current?.applyOptions({ visible: showSMA.s20 });
    sma50Ref.current?.applyOptions({ visible: showSMA.s50 });
    sma200Ref.current?.applyOptions({ visible: showSMA.s200 });

    // ── Earnings line ─────────────────────────────────────────────────────
    if (earningsDate && seriesRef.current) {
      const earningsTime = Math.floor(earningsDate) as unknown as ReturnType<typeof toChartTime>;
      try {
        seriesRef.current.createPriceLine({
          price:     last,
          color:     "#f59e0b",
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: false,
          title: "Earnings",
        });
        // Add as a vertical marker via a marker on the series
        chart.timeScale().setVisibleRange({
          from: toChartTime(bars[0].date),
          to:   toChartTime(bars[bars.length - 1].date),
        });
        // Earnings vertical marker
        seriesRef.current.setMarkers?.([{
          time:     earningsTime,
          position: "belowBar",
          color:    "#f59e0b",
          shape:    "arrowUp",
          text:     "Earnings",
        }]);
      } catch {
        // ignore if out of range
      }
    }

    // ── GEX levels as price lines ─────────────────────────────────────────
    if (gexLevels && seriesRef.current) {
      const levels = [
        { price: gexLevels.callWall,   color: "#22c55e", title: "Call Wall" },
        { price: gexLevels.putWall,    color: "#ef4444", title: "Put Wall" },
        { price: gexLevels.zeroGamma,  color: "#f59e0b", title: "Zero γ" },
      ];
      for (const lv of levels) {
        if (lv.price != null) {
          try {
            seriesRef.current.createPriceLine({
              price:     lv.price,
              color:     lv.color,
              lineWidth: 1,
              lineStyle: 1,
              axisLabelVisible: true,
              title:     lv.title,
            });
          } catch { /* ignore */ }
        }
      }
    }

    // ── Crosshair legend ──────────────────────────────────────────────────
    const sma20vals  = calcSMA(closes, 20);
    const sma50vals  = calcSMA(closes, 50);
    const sma200vals = calcSMA(closes, 200);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setLegend({});
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = param.seriesData.get(seriesRef.current) as any;
      if (!d) return;
      const idx = bars.findIndex(b => toChartTime(b.date) === param.time);
      const bar = bars[idx];
      setLegend({
        time:   bar?.date?.slice(0, 19).replace("T", " "),
        open:   d.open  ?? d.value,
        high:   d.high  ?? d.value,
        low:    d.low   ?? d.value,
        close:  d.close ?? d.value,
        volume: bar?.volume,
        sma20:  idx >= 0 ? sma20vals[idx]  : null,
        sma50:  idx >= 0 ? sma50vals[idx]  : null,
        sma200: idx >= 0 ? sma200vals[idx] : null,
      });
    });

    // ── Resize observer ───────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (chartRef.current && el) {
        chartRef.current.applyOptions({ width: el.clientWidth });
      }
    });
    ro.observe(el);

    chart.timeScale().fitContent();

    return () => { ro.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, chartType, isIntraday, earningsDate, gexLevels]);

  useEffect(() => {
    buildChart();
    return () => {
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    };
  }, [buildChart]);

  // SMA visibility toggles (no rebuild needed)
  useEffect(() => { sma20Ref.current?.applyOptions({ visible: showSMA.s20 }); }, [showSMA.s20]);
  useEffect(() => { sma50Ref.current?.applyOptions({ visible: showSMA.s50 }); }, [showSMA.s50]);
  useEffect(() => { sma200Ref.current?.applyOptions({ visible: showSMA.s200 }); }, [showSMA.s200]);

  // ── Derived legend defaults ────────────────────────────────────────────────
  const last    = bars[bars.length - 1];
  const first   = bars[0];
  const liveUp  = last && first ? last.close >= first.close : true;
  const change  = last && first ? last.close - first.close : null;
  const changePct = change != null && first ? (change / first.close) * 100 : null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
        {/* Symbol + live price */}
        <div className="flex items-baseline gap-2 mr-2">
          <span className="text-sm font-black text-foreground">{symbol}</span>
          {last && (
            <>
              <span className={`text-sm font-black tabular-nums ${liveUp ? "text-emerald-500" : "text-red-500"}`}>
                {fmt$(last.close)}
              </span>
              {changePct != null && (
                <span className={`text-[11px] font-bold tabular-nums ${liveUp ? "text-emerald-500" : "text-red-500"}`}>
                  {liveUp ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
                </span>
              )}
            </>
          )}
        </div>

        {/* Period pills */}
        <div className="flex items-center gap-1">
          {PERIODS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPeriodIdx(i)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${
                i === periodIdx
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "bg-transparent text-foreground/50 hover:text-foreground hover:bg-[var(--border)]"
              }`}
            >{p.label}</button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {/* Chart type toggle */}
          <button
            onClick={() => setChartType(t => t === "candle" ? "line" : "candle")}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-foreground/60 hover:text-foreground hover:bg-[var(--border)] transition"
            title={chartType === "candle" ? "Switch to Line" : "Switch to Candles"}
          >
            {chartType === "candle" ? <CandlestickChart size={13} /> : <LineChart size={13} />}
            {chartType === "candle" ? "Candles" : "Line"}
          </button>

          {/* SMA toggles */}
          {[
            { key: "s20" as const,  label: "SMA20",  color: "text-blue-400" },
            { key: "s50" as const,  label: "SMA50",  color: "text-amber-400" },
            { key: "s200" as const, label: "SMA200", color: "text-purple-400" },
          ].map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => setShowSMA(s => ({ ...s, [key]: !s[key] }))}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition ${
                showSMA[key] ? color : "text-foreground/30"
              } hover:bg-[var(--border)]`}
            >
              {showSMA[key] ? <Eye size={10} className="inline mr-0.5" /> : <EyeOff size={10} className="inline mr-0.5" />}
              {label}
            </button>
          ))}

          {/* Refresh */}
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg text-foreground/50 hover:text-foreground hover:bg-[var(--border)] transition"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── OHLCV legend bar ── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-1.5 bg-[var(--surface)] border-b border-[var(--border)]/50 text-[10px] font-mono">
        {legend.time && <span className="text-foreground/50">{legend.time}</span>}
        {legend.open  != null && <span className="text-foreground/70">O <span className="text-foreground font-bold">{fmt$(legend.open)}</span></span>}
        {legend.high  != null && <span className="text-emerald-400">H <span className="font-bold">{fmt$(legend.high)}</span></span>}
        {legend.low   != null && <span className="text-red-400">L <span className="font-bold">{fmt$(legend.low)}</span></span>}
        {legend.close != null && <span className="text-foreground">C <span className="font-bold">{fmt$(legend.close)}</span></span>}
        {legend.volume != null && <span className="text-foreground/50">Vol <span className="text-foreground font-bold">{fmtVol(legend.volume)}</span></span>}
        {showSMA.s20  && legend.sma20  != null && <span className="text-blue-400">SMA20 <span className="font-bold">{fmt$(legend.sma20)}</span></span>}
        {showSMA.s50  && legend.sma50  != null && <span className="text-amber-400">SMA50 <span className="font-bold">{fmt$(legend.sma50)}</span></span>}
        {showSMA.s200 && legend.sma200 != null && <span className="text-purple-400">SMA200 <span className="font-bold">{fmt$(legend.sma200)}</span></span>}
      </div>

      {/* ── Chart canvas ── */}
      {isLoading ? (
        <div className="h-[420px] flex items-center justify-center bg-[var(--surface)]">
          <RefreshCw size={24} className="text-foreground/30 animate-spin" />
        </div>
      ) : bars.length === 0 ? (
        <div className="h-[420px] flex items-center justify-center text-foreground/50 text-sm">
          No chart data available
        </div>
      ) : (
        <div ref={chartContainerRef} className="w-full" style={{ height: 420 }} />
      )}

      {/* ── GEX levels legend ── */}
      {gexLevels && (gexLevels.callWall || gexLevels.putWall || gexLevels.zeroGamma) && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-t border-[var(--border)] bg-[var(--surface-2)] text-[10px]">
          {gexLevels.callWall  && <span className="text-emerald-400 font-bold">── Call Wall {fmt$(gexLevels.callWall)}</span>}
          {gexLevels.putWall   && <span className="text-red-400 font-bold">── Put Wall {fmt$(gexLevels.putWall)}</span>}
          {gexLevels.zeroGamma && <span className="text-amber-400 font-bold">── Zero γ {fmt$(gexLevels.zeroGamma)}</span>}
          {earningsDate && (
            <span className="text-amber-400 font-bold">
              ▲ Earnings {new Date(earningsDate * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Time conversion helper ─────────────────────────────────────────────────────
import type { UTCTimestamp } from "lightweight-charts";
function toChartTime(dateStr: string): UTCTimestamp {
  return Math.floor(new Date(dateStr).getTime() / 1000) as unknown as UTCTimestamp;
}
