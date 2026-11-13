"use client";
/**
 * PulseChart — the drop-down chart under a Market pulse row: price over a chosen timeline
 * (1D … 5Y), coloured by the move across the window, with a dashed line at the window's start.
 */
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchStockHistory } from "@/lib/api";
import { Segmented } from "@/components/ui";
import { ChartTooltip, useChartStyle } from "@/components/chart/kit";
import { stockHref } from "@/components/TickerLink";

type Range = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "5Y";
const RANGES: Record<Range, { period: string; interval: string; intraday: boolean }> = {
  "1D": { period: "1d", interval: "5m", intraday: true },
  "5D": { period: "5d", interval: "15m", intraday: true },
  "1M": { period: "1mo", interval: "1h", intraday: true },
  "6M": { period: "6mo", interval: "1d", intraday: false },
  YTD: { period: "ytd", interval: "1d", intraday: false },
  "1Y": { period: "1y", interval: "1d", intraday: false },
  "5Y": { period: "5y", interval: "1wk", intraday: false },
};
const KEY = "pulse_chart_range";

function initialRange(): Range {
  try {
    const v = localStorage.getItem(KEY);
    if (v && v in RANGES) return v as Range;
  } catch { /* storage blocked */ }
  return "1D";
}

export function PulseChart({ symbol, label, fmt }: { symbol: string; label: string; fmt: (p: number) => string }) {
  const [range, setRangeRaw] = useState<Range>(initialRange);
  const setRange = (r: Range) => {
    setRangeRaw(r);
    try { localStorage.setItem(KEY, r); } catch { /* storage blocked */ }
  };
  const cfg = RANGES[range];
  const { c, grid, xAxis, yAxis, cursor } = useChartStyle();
  const hist = useQuery({
    queryKey: ["pulse-history", symbol, range],
    queryFn: () => fetchStockHistory(symbol, cfg.period, cfg.interval),
    refetchInterval: cfg.intraday ? 60_000 : false,
    staleTime: 30_000,
  });

  const bars = (hist.data?.bars ?? []).filter((b) => b.close != null);
  const first = bars[0]?.close;
  const last = bars.at(-1)?.close;
  const move = first != null && last != null && first !== 0 ? (last - first) / first : null;
  const color = (move ?? 0) >= 0 ? c.gain : c.loss;
  const gradId = `pulse-${symbol.replace(/[^a-zA-Z0-9]/g, "")}`;

  const when = (v: unknown, long = false) => {
    const d = new Date(String(v));
    if (isNaN(d.getTime())) return String(v);
    if (cfg.intraday) {
      const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return range === "1D" && !long ? t : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}${long || range !== "1M" ? ` ${t}` : ""}`;
    }
    return d.toLocaleDateString(undefined, long || range === "5Y" ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
  };

  return (
    <div className="pb-3 pt-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Segmented label={`${label} timeline`} value={range} onChange={setRange}
          options={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: r }))} />
        <span className="font-mono text-[11.5px] tabular-nums">
          {move != null && <span className={move >= 0 ? "text-gain" : "text-loss"}>{move > 0 ? "+" : ""}{(move * 100).toFixed(2)}%</span>}
          <span className="text-foreground/45"> over {range}</span>
        </span>
      </div>
      <div className="h-[180px]">
        {hist.isLoading ? (
          <div className="skeleton h-full w-full rounded-lg" />
        ) : bars.length < 2 ? (
          <p className="pt-16 text-center text-[12.5px] text-foreground/50">{hist.isError || hist.data?.error ? "History unavailable right now." : "No bars for this range yet."}</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={bars} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...grid} />
              <XAxis dataKey="date" {...xAxis} tickFormatter={(v) => when(v)} interval="preserveStartEnd" minTickGap={56} />
              <YAxis {...yAxis} width={56} domain={["auto", "auto"]} orientation="right" tickFormatter={(v: number) => fmt(v)} />
              {first != null && <ReferenceLine y={first} stroke={c.muted} strokeDasharray="3 3" />}
              <Tooltip cursor={cursor} content={<ChartTooltip title={(l) => when(l, true)}
                format={(p) => [{ label, value: fmt(Number(p[0].value)) }]} />} />
              <Area type="monotone" dataKey="close" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <Link href={stockHref(symbol)} className="mt-1.5 inline-block font-mono text-[11px] text-accent hover:underline">Full chart →</Link>
    </div>
  );
}
