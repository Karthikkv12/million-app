"use client";
/**
 * VixPanel — CBOE VIX sparkline + level badge.
 * • 1D  → 1-minute bars (~390 pts), live-polls every second for latest value
 * • 2-3D → 5-minute bars
 * • 7-14D → 30-minute bars
 * • 30D → daily bars
 * Persists selected range in localStorage.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, ReferenceLine, YAxis, XAxis, CartesianGrid,
} from "recharts";
import { api } from "@/lib/api";
import { Panel, Pill, Change, Segmented, useChartColors } from "@/components/ui";
import { ChartTooltip } from "@/components/chart/kit";

interface Bar { date: string; close: number; }

interface Props {
  symbol?:     string;
  title?:      string;
  sublabel?:   string;
  gradId?:     string;
  storageKey?: string;
}

type DayRange = 1 | 2 | 3 | 7 | 14 | 30;
const DAY_RANGES: DayRange[] = [1, 2, 3, 7, 14, 30];

const RANGE_CFG: Record<DayRange, { period: string; interval: string; intraday: boolean }> = {
  1:  { period: "1d",  interval: "1m",  intraday: true  },
  2:  { period: "5d",  interval: "5m",  intraday: true  },
  3:  { period: "5d",  interval: "5m",  intraday: true  },
  7:  { period: "1mo", interval: "30m", intraday: true  },
  14: { period: "1mo", interval: "30m", intraday: true  },
  30: { period: "1mo", interval: "1d",  intraday: false },
};

function vixRegime(v: number): { label: string; tone: "good" | "neutral" | "warn" | "bad" } {
  if (v < 15) return { label: "Low",      tone: "good" };
  if (v < 20) return { label: "Normal",   tone: "neutral" };
  if (v < 30) return { label: "Elevated", tone: "warn" };
  if (v < 40) return { label: "High",     tone: "bad" };
  return               { label: "Extreme", tone: "bad" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label, intraday }: any) {
  if (!active || !payload?.length) return null;
  let display = label as string;
  if (intraday && label) {
    try { display = new Date(label).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { /* keep raw */ }
  }
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs shadow-lg">
      <p className="text-foreground/70 mb-0.5">{display}</p>
      <p className="font-bold text-foreground">{Number(payload[0].value).toFixed(2)}</p>
    </div>
  );
}

export default function VixPanel({
  symbol     = "%5EVIX",
  title      = "VIX",
  sublabel   = "CBOE Volatility Index",
  gradId     = "vixGrad",
  storageKey = "vix_panel_range",
}: Props) {
  const [bars, setBars]       = useState<Bar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [days, setDaysRaw]    = useState<DayRange>(() => {
    if (typeof window === "undefined") return 1;
    const saved = localStorage.getItem(storageKey);
    return (saved && ([1,2,3,7,14,30] as number[]).includes(Number(saved)))
      ? (Number(saved) as DayRange)
      : 1;
  });

  const setDays = (d: DayRange) => {
    setDaysRaw(d);
    try { localStorage.setItem(storageKey, String(d)); } catch { /* ignore */ }
  };

  const cfg = RANGE_CFG[days];

  const load = useCallback(async (d: DayRange) => {
    const c = RANGE_CFG[d];
    try {
      setLoading(true);
      setError(false);
      const data = await api.get<{ symbol: string; bars: Bar[] }>(
        `/stocks/${symbol}/history?period=${c.period}&interval=${c.interval}`
      );
      let result = data.bars ?? [];
      // For multi-day intraday, trim to exactly N trading days
      if (c.intraday && d > 1 && result.length > 0) {
        const dayMap = new Map<string, Bar[]>();
        for (const b of result) {
          const key = b.date.slice(0, 10);
          if (!dayMap.has(key)) dayMap.set(key, []);
          dayMap.get(key)!.push(b);
        }
        const sortedDays = Array.from(dayMap.keys()).sort().slice(-d);
        result = sortedDays.flatMap((k) => dayMap.get(k)!);
      }
      setBars(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => { load(days); }, [load, days]);

  // 1-second live poll for latest bar on 1D intraday view
  useEffect(() => {
    if (days !== 1) return;
    const tick = async () => {
      try {
        const data = await api.get<{ symbol: string; bars: Bar[] }>(
          `/stocks/${symbol}/history?period=1d&interval=1m`
        );
        const fresh = data.bars ?? [];
        if (!fresh.length) return;
        const last = fresh[fresh.length - 1];
        setBars((prev) => {
          if (!prev.length) return fresh;
          const existing = prev[prev.length - 1];
          if (existing.date === last.date) return [...prev.slice(0, -1), last];
          return [...prev, last];
        });
      } catch { /* silent on tick errors */ }
    };
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [symbol, days]);

  const chart = useChartColors();
  const current   = bars.length ? bars[bars.length - 1].close : null;
  const prev      = bars.length > 1 ? bars[bars.length - 2].close : null;
  const change    = current != null && prev != null ? current - prev : null;
  const changePct = change != null && prev ? (change / prev) * 100 : null;
  const up        = (change ?? 0) >= 0;
  const regime    = current != null ? vixRegime(current) : null;

  const tick = { fontSize: 11, fill: chart.muted };

  return (
    <Panel
      title={title}
      sub={sublabel}
      actions={
        <>
          {days === 1 && !loading && !error && <Pill tone="good" dot>Live</Pill>}
          {regime && <Pill tone={regime.tone}>{regime.label}</Pill>}
        </>
      }
    >
      {loading ? (
        <div className="mb-3 space-y-2">
          <div className="skeleton h-8 w-24 rounded-lg" />
          <div className="skeleton h-4 w-16 rounded-lg" />
        </div>
      ) : error || current == null ? (
        <p className="mb-3 font-mono text-2xl text-foreground/50">—</p>
      ) : (
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-mono text-3xl font-medium leading-none tracking-tight tabular-nums text-foreground">{current.toFixed(2)}</p>
          {change != null && changePct != null && <Change value={change} pct={changePct} />}
        </div>
      )}

      {!loading && bars.length > 1 && (
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={bars} margin={{ top: 6, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chart.accent} stopOpacity={0.22} />
                <stop offset="100%" stopColor={chart.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={tick}
              tickFormatter={(v: string) => {
                if (!cfg.intraday) { const d = new Date(v); return `${d.getMonth() + 1}/${d.getDate()}`; }
                try { return new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return v; }
              }}
              interval="preserveStartEnd"
              minTickGap={48}
            />
            <YAxis domain={["auto", "auto"]} tickLine={false} axisLine={false} tick={tick} tickFormatter={(v: number) => v.toFixed(0)} width={32} />
            <ReferenceLine y={20} stroke={chart.warn} strokeOpacity={0.55} strokeDasharray="3 3" />
            <ReferenceLine y={30} stroke={chart.loss} strokeOpacity={0.55} strokeDasharray="3 3" />
            <Tooltip
              cursor={{ stroke: chart.border, strokeDasharray: "3 3" }}
              content={
                <ChartTooltip
                  title={(l) => { try { return cfg.intraday ? new Date(String(l)).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : new Date(String(l)).toLocaleDateString([], { month: "short", day: "numeric" }); } catch { return String(l); } }}
                  format={(p) => [{ label: title, value: Number(p[0].value).toFixed(2), color: chart.accent }]}
                />
              }
            />
            <Area type="monotone" dataKey="close" stroke={chart.accent} strokeWidth={1.75} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label={`${title} range`}
          value={String(days)}
          onChange={(v) => setDays(Number(v) as DayRange)}
          options={DAY_RANGES.map((d) => ({ value: String(d), label: `${d}D` }))}
        />
        <div className="flex items-center gap-3 font-mono text-[11px] text-foreground/50">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t border-dashed border-warn" />20 elevated</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t border-dashed border-loss" />30 high</span>
        </div>
      </div>
    </Panel>
  );
}
