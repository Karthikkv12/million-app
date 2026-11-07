"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { Clock } from "lucide-react";
import { fetchNetFlowHistory, FlowSnapshot } from "@/lib/api";
import { Segmented } from "@/components/ui";
import { useChartStyle, ChartTooltip, Legend } from "@/components/chart/kit";

interface Props {
  symbol: string;
  accentColor?: string;
}

const DAYS = [1, 3, 7, 14] as const;
type Day = (typeof DAYS)[number];

export function FlowMomentumChart({ symbol, accentColor = "var(--foreground)" }: Props) {
  const [days, setDays] = useState<Day>(1);
  const { c, grid, xAxis, yAxis, cursor } = useChartStyle();

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
    <div className="border-b border-[var(--border)] px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-foreground/70">Flow momentum</h3>
        <Segmented
          label="Flow momentum range"
          value={String(days)}
          onChange={(v) => setDays(Number(v) as Day)}
          options={DAYS.map((d) => ({ value: String(d), label: `${d}D` }))}
        />
      </div>

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : !hasData ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-foreground/50">
          <Clock size={20} className="opacity-40" />
          <p className="text-[13px]">Flow history builds up while the market is open.</p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={0}>
              <CartesianGrid {...grid} />
              <XAxis
                dataKey="ts"
                {...xAxis}
                interval={Math.max(1, Math.floor(chartData.length / 6))}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tickFormatter={(v: any) => String(v).slice(11, 16)}
              />
              <YAxis {...yAxis} tickFormatter={(v) => `${v.toFixed(0)}M`} />
              <Tooltip
                cursor={cursor}
                content={
                  <ChartTooltip
                    title={(l) => String(l).slice(0, 16).replace("T", " ")}
                    format={(p) => p.map((e) => ({
                      label: e.dataKey === "net" ? "Net flow" : e.dataKey === "call" ? "Call premium" : "Put premium",
                      value: `$${Math.abs(Number(e.value)).toFixed(1)}M`,
                      color: e.dataKey === "net" ? c.accent : e.dataKey === "call" ? c.gain : c.loss,
                    }))}
                  />
                }
              />
              <ReferenceLine y={0} stroke={c.border} />
              <Bar dataKey="call" fill={c.gainSoft} maxBarSize={6} />
              <Bar dataKey="put" fill={c.lossSoft} maxBarSize={6} />
              <Line type="monotone" dataKey="net" stroke={c.accent} strokeWidth={1.75} dot={false} activeDot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-2">
            <Legend items={[{ label: "Call premium", color: c.gainSoft }, { label: "Put premium", color: c.lossSoft }, { label: "Net flow", color: c.accent }]} />
          </div>
        </>
      )}
    </div>
  );
}
