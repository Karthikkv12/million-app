"use client";
/**
 * VixPanel — CBOE VIX sparkline + level badge with day-range pills.
 */

import { useEffect, useState, useCallback } from "react";
import {
  AreaChart, Area, ResponsiveContainer, Tooltip, ReferenceLine, YAxis,
} from "recharts";
import { api } from "@/lib/api";

interface Bar { date: string; close: number; }

interface Props {
  symbol?:   string;  // yfinance symbol, URL-encoded. Default: %5EVIX
  title?:    string;  // Card heading. Default: "VIX"
  sublabel?: string;  // Sub-heading. Default: "CBOE Volatility Index"
  gradId?:   string;  // Unique gradient id to avoid SVG conflicts. Default: "vixGrad"
}

type DayRange = 1 | 2 | 3 | 7 | 14 | 30;
const DAY_RANGES: DayRange[] = [1, 2, 3, 7, 14, 30];

// Map day range → yfinance period string + intraday interval
const PERIOD_MAP: Record<DayRange, { period: string; interval: string }> = {
  1:  { period: "1d",  interval: "5m"  },
  2:  { period: "2d",  interval: "15m" },
  3:  { period: "5d",  interval: "30m" },
  7:  { period: "5d",  interval: "1d"  },
  14: { period: "1mo", interval: "1d"  },
  30: { period: "1mo", interval: "1d"  },
};

function vixRegime(v: number): { label: string; color: string; bg: string } {
  if (v < 15) return { label: "Low",      color: "text-green-500",  bg: "bg-green-50 dark:bg-green-900/30"   };
  if (v < 20) return { label: "Normal",   color: "text-blue-500",   bg: "bg-blue-50 dark:bg-blue-900/30"    };
  if (v < 30) return { label: "Elevated", color: "text-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-900/30" };
  if (v < 40) return { label: "High",     color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-900/30" };
  return               { label: "Extreme", color: "text-red-500",    bg: "bg-red-50 dark:bg-red-900/30"      };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs shadow-lg">
      <p className="text-gray-400 mb-0.5">{label}</p>
      <p className="font-bold text-gray-900 dark:text-white">VIX {Number(payload[0].value).toFixed(2)}</p>
    </div>
  );
}

export default function VixPanel({
  symbol   = "%5EVIX",
  title    = "VIX",
  sublabel = "CBOE Volatility Index",
  gradId   = "vixGrad",
}: Props) {
  const [bars, setBars]       = useState<Bar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [days, setDays]       = useState<DayRange>(30);

  const load = useCallback(async (d: DayRange) => {
    try {
      setLoading(true);
      setError(false);
      const { period } = PERIOD_MAP[d];
      const data = await api.get<{ symbol: string; bars: Bar[] }>(`/stocks/${symbol}/history?period=${period}`);
      // For day ranges < 7 slice to approximate the right number of bars
      let result = data.bars ?? [];
      if (d <= 3 && result.length > d * 78) {
        result = result.slice(-(d * 78));
      } else if (d === 7 && result.length > 7) {
        result = result.slice(-7);
      } else if (d === 14 && result.length > 14) {
        result = result.slice(-14);
      }
      setBars(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  const current   = bars.length ? bars[bars.length - 1].close : null;
  const prev      = bars.length > 1 ? bars[bars.length - 2].close : null;
  const change    = current != null && prev != null ? current - prev : null;
  const changePct = change != null && prev ? (change / prev) * 100 : null;
  const up        = (change ?? 0) >= 0;
  const regime    = current != null ? vixRegime(current) : null;

  const strokeColor = current == null ? "#6b7280"
    : current < 15 ? "#22c55e"
    : current < 20 ? "#3b82f6"
    : current < 30 ? "#eab308"
    : current < 40 ? "#f97316"
    : "#ef4444";

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{title}</p>
          <p className="text-[10px] text-gray-400/70 mt-0.5">{sublabel}</p>
        </div>
        {regime && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${regime.bg} ${regime.color}`}>
            {regime.label}
          </span>
        )}
      </div>

      {/* Current value */}
      {loading ? (
        <div className="space-y-2 mb-3">
          <div className="skeleton h-8 w-24 rounded-lg" />
          <div className="skeleton h-4 w-16 rounded-lg" />
        </div>
      ) : error || current == null ? (
        <p className="text-2xl font-black text-gray-400 mb-3">—</p>
      ) : (
        <div className="mb-3">
          <p className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white leading-none">
            {current.toFixed(2)}
          </p>
          {change != null && changePct != null && (
            <p className={`text-xs font-bold mt-1 ${up ? "text-green-500" : "text-red-500"}`}>
              {up ? "▲" : "▼"} {Math.abs(change).toFixed(2)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
            </p>
          )}
        </div>
      )}

      {/* Sparkline */}
      {!loading && bars.length > 1 && (
        <ResponsiveContainer width="100%" height={90}>
          <AreaChart data={bars} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={strokeColor} stopOpacity={0.25} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0}    />
              </linearGradient>
            </defs>
            <YAxis domain={["auto", "auto"]} hide />
            <ReferenceLine y={20} stroke="#eab30844" strokeDasharray="3 3" />
            <ReferenceLine y={30} stroke="#f9731644" strokeDasharray="3 3" />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="close"
              stroke={strokeColor}
              strokeWidth={2}
              fill={`url(#${gradId})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Day-range pills + reference legend */}
      <div className="flex items-center justify-between mt-3">
        {/* Pills */}
        <div className="flex items-center gap-1">
          {DAY_RANGES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition ${
                days === d
                  ? "bg-white/15 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/10"
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
        {/* Reference lines legend */}
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[9px] text-yellow-500/80">
            <span className="inline-block w-4 border-t border-dashed border-yellow-400" />20
          </span>
          <span className="flex items-center gap-1 text-[9px] text-orange-500/80">
            <span className="inline-block w-4 border-t border-dashed border-orange-400" />30
          </span>
        </div>
      </div>
    </div>
  );
}
