"use client";
/**
 * SwingCharts — two charts for one symbol over a chosen range (1M … All):
 *   Drawdown      how far the close sits below the highest close so far in the range (the "underwater" curve)
 *   Upside spike  how far the close sits above its rolling low (the lookback grows with the range)
 * Each has its current reading and the extreme of the range. Used on the stock page and under each dashboard sector.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchSwings, SwingPeriod, Swings } from "@/lib/api";
import { useChartStyle, ChartTooltip } from "@/components/chart/kit";

const RANGES: { id: SwingPeriod; label: string }[] = [
  { id: "1mo", label: "1M" }, { id: "3mo", label: "3M" }, { id: "6mo", label: "6M" },
  { id: "1y", label: "1Y" }, { id: "5y", label: "5Y" }, { id: "max", label: "All" },
];

const pct = (v?: number | null, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const day = (iso?: string | null, withYear = true) => {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
};

type Point = Swings["points"][number];

function Chart({ points, k, color, id, long, height }: { points: Point[]; k: "drawdown" | "spike"; color: string; id: string; long: boolean; height: number }) {
  const s = useChartStyle();
  const tick = (iso: string) => {
    const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
    return long ? String(d.getFullYear()) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1={k === "drawdown" ? "1" : "0"} x2="0" y2={k === "drawdown" ? "0" : "1"}>
              <stop offset="0%" stopColor={color} stopOpacity={0.38} />
              <stop offset="100%" stopColor={color} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid {...s.grid} />
          <XAxis dataKey="date" {...s.xAxis} tickFormatter={tick} minTickGap={48} />
          <YAxis {...s.yAxis} width={44} domain={k === "drawdown" ? ["dataMin", 0] : [0, "dataMax"]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
          <ReferenceLine y={0} stroke={s.c.border} />
          <Tooltip cursor={s.cursor} content={<ChartTooltip title={(l) => day(String(l))} format={(pl) => [
            { label: k === "drawdown" ? "Below the high" : "Above the low", value: pct(pl[0].payload[k]), color },
            { label: "Close", value: `$${Number(pl[0].payload.close).toLocaleString("en-US", { maximumFractionDigits: 2 })}` },
          ]} />} />
          <Area type="linear" dataKey={k} stroke={color} strokeWidth={1.5} fill={`url(#${id})`} baseValue={0} dot={false}
            activeDot={{ r: 3.5, fill: color, stroke: s.c.surface, strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Head({ title, now, tone, sub, hint }: { title: string; now: string; tone: string; sub: string; hint: string }) {
  return (
    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45" title={hint}>{title}</p>
      <p className="font-mono text-[11.5px] tabular-nums text-foreground/50">
        <span className={clsx("mr-2 text-[15px] font-medium", tone)}>{now}</span>{sub}
      </p>
    </div>
  );
}

export function SwingCharts({ symbol, title, initial = "1y", height = 170, className }: {
  symbol: string; title?: string; initial?: SwingPeriod; height?: number; className?: string;
}) {
  const [period, setPeriod] = useState<SwingPeriod>(initial);
  const s = useChartStyle();
  const { data, isLoading, isError } = useQuery<Swings>({
    queryKey: ["swings", symbol, period], queryFn: () => fetchSwings(symbol, period), staleTime: 10 * 60_000,
    placeholderData: (prev) => (prev?.symbol === symbol.toUpperCase() ? prev : undefined),
  });
  const st = data?.stats;
  const pts = data?.points ?? [];
  const long = period === "5y" || period === "max";
  const uid = `${symbol.replace(/[^A-Za-z0-9]/g, "")}-${period}`;
  return (
    <div className={clsx("min-w-0", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-[13px] text-foreground/70">
          {title ?? `${symbol} drawdown and upside spikes`}
          {st && <span className="ml-2 font-mono text-[11px] text-foreground/40">{day(st.first_date)} – {day(st.last_date)}</span>}
        </p>
        <div role="radiogroup" aria-label="Range" className="flex">
          {RANGES.map((r) => (
            <button key={r.id} role="radio" aria-checked={period === r.id} onClick={() => setPeriod(r.id)}
              className={clsx("px-2 py-1 font-mono text-[12px] transition", period === r.id ? "text-foreground underline decoration-2 underline-offset-[6px]" : "text-foreground/45 hover:text-foreground")}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? <div className="grid gap-4 md:grid-cols-2"><div className="skeleton" style={{ height }} /><div className="skeleton" style={{ height }} /></div>
        : isError || data?.error || !st ? <p className="py-6 text-[13px] text-foreground/50">{data?.error ?? `No price history for ${symbol} right now.`}</p>
        : (
          <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
            <div className="min-w-0">
              <Head title="Drawdown" tone={st.current_drawdown < -0.0005 ? "text-loss" : "text-foreground"}
                now={st.current_drawdown < -0.0005 ? pct(st.current_drawdown) : "at the high"}
                sub={`worst ${pct(st.max_drawdown)} · ${day(st.max_drawdown_date, long)}`}
                hint="How far the close is below the highest close so far in this range" />
              <Chart points={pts} k="drawdown" color={s.c.loss} id={`dd-${uid}`} long={long} height={height} />
              <p className="mt-1 text-[11.5px] leading-snug text-foreground/50">
                {st.sessions_since_peak === 0 ? "New high for this range today." : `${st.sessions_since_peak} sessions since the high on ${day(st.peak_date, long)}.`}{" "}
                Average when under water {pct(st.avg_drawdown)}; within 5% of the high {Math.round(st.near_high_share * 100)}% of the time.
              </p>
            </div>
            <div className="min-w-0">
              <Head title="Upside spike" tone={st.current_spike > 0.0005 ? "text-gain" : "text-foreground"}
                now={st.current_spike > 0.0005 ? pct(st.current_spike) : "at the low"}
                sub={`biggest ${pct(st.max_spike)} · ${day(st.max_spike_date, long)}`}
                hint={`How far the close is above its lowest close of the last ${data.lookback} sessions`} />
              <Chart points={pts} k="spike" color={s.c.gain} id={`sp-${uid}`} long={long} height={height} />
              <p className="mt-1 text-[11.5px] leading-snug text-foreground/50">
                Measured from the lowest close of the last {data.lookback} sessions. Today&apos;s reading is higher than {Math.round(st.spike_percentile * 100)}% of this range.
              </p>
            </div>
          </div>
        )}
    </div>
  );
}
