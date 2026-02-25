"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { Zap, Clock } from "lucide-react";
import { fetchNetFlowHistory, FlowSnapshot } from "@/lib/api";

interface Props {
  symbol: string;
  accentColor?: string;
}

const DAYS = [1, 3, 7, 14] as const;
type Day = (typeof DAYS)[number];

export function FlowMomentumChart({ symbol, accentColor = "var(--foreground)" }: Props) {
  const [days, setDays] = useState<Day>(1);

  const { data: snapshots = [], isLoading } = useQuery<FlowSnapshot[]>({
    queryKey: ["netFlowHistory", symbol, days],
    queryFn: () => fetchNetFlowHistory(symbol, days),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const chartData = snapshots.map((s) => ({
    ts:   s.ts,
    net:  s.net_flow / 1e6,
    call: s.call_prem / 1e6,
    put:  -(s.put_prem / 1e6),
  }));

  const hasData = chartData.length > 1;

  return (
    <div className="px-4 py-3 border-b border-[var(--border)]">
      {/* header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Zap size={10} className="text-foreground/60" />
          <span className="text-[9px] text-foreground uppercase tracking-widest font-black">
            Flow Momentum
          </span>
        </div>
        {/* day selector */}
        <div className="flex items-center gap-1">
          {DAYS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition ${
                d === days
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "bg-[var(--surface-2)] text-foreground/60 hover:text-foreground"
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-36 rounded-xl bg-[var(--surface-2)] animate-pulse" />
      ) : !hasData ? (
        <div className="h-36 flex flex-col items-center justify-center gap-2 text-foreground/50">
          <Clock size={22} className="opacity-30" />
          <p className="text-[11px]">Flow data accumulates as the market is open</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={chartData} margin={{ top: 2, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="ts"
              tick={{ fontSize: 8, fill: "#9ca3af" }}
              tickLine={false}
              interval={Math.max(1, Math.floor(chartData.length / 6))}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tickFormatter={(v: any) => String(v).slice(11, 16)}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(v) => `${v.toFixed(0)}M`}
            />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any, name: any) => [
                `$${Math.abs(Number(v)).toFixed(1)}M`,
                name === "net" ? "Net Flow" : name === "call" ? "Calls" : "Puts",
              ]}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                fontSize: 11,
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              labelFormatter={(v: any) => String(v).slice(0, 19).replace("T", " ")}
            />
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
            <Bar dataKey="call" fill="#22c55e60" maxBarSize={6} name="call" />
            <Bar dataKey="put"  fill="#ef444460" maxBarSize={6} name="put" />
            <Line
              type="monotone"
              dataKey="net"
              stroke={accentColor}
              strokeWidth={2}
              dot={false}
              name="net"
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
