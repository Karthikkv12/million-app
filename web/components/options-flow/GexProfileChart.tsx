"use client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { BarChart2 } from "lucide-react";
import { GexResult } from "@/lib/api";

interface Props {
  data: GexResult;
  accentColor?: string;
}

export function GexProfileChart({ data, accentColor = "var(--foreground)" }: Props) {
  const strikes = data.strikes ?? [];
  const rows = strikes
    .map((s) => ({
      strike: s,
      call:  (data.call_gex_by_strike?.[String(s)] ?? 0) / 1e9,
      put:  -(data.put_gex_by_strike?.[String(s)]  ?? 0) / 1e9,
      net:   (data.gex_by_strike?.[String(s)]       ?? 0) / 1e9,
    }))
    .filter((r) => Math.abs(r.net) > 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 20)
    .sort((a, b) => a.strike - b.strike);

  if (!rows.length) return null;

  return (
    <div className="px-4 py-3 border-b border-[var(--border)]">
      {/* header */}
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 size={10} className="text-foreground/60" />
        <span className="text-[9px] text-foreground uppercase tracking-widest font-black">
          GEX Profile
        </span>
        <span className="text-[8px] text-foreground/50 ml-auto">
          Call (green) · Put (red) — top 20 strikes
        </span>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} layout="vertical" margin={{ top: 2, right: 16, left: 44, bottom: 2 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 9, fill: "#9ca3af" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v.toFixed(1)}B`}
          />
          <YAxis
            dataKey="strike"
            type="category"
            width={44}
            tick={{ fontSize: 9, fill: "#9ca3af" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            formatter={(v: number, name: string) => [
              `${Math.abs(v).toFixed(3)}B`,
              name === "call" ? "Call GEX" : "Put GEX",
            ]}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              fontSize: 11,
            }}
          />
          <ReferenceLine x={0} stroke="var(--border)" strokeWidth={2} />
          {data.spot != null && (
            <ReferenceLine
              y={data.spot}
              stroke={accentColor}
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{ value: "SPOT", position: "insideTopRight", fontSize: 9, fill: accentColor }}
            />
          )}
          <Bar dataKey="call" fill="#22c55e" radius={[0, 3, 3, 0]} maxBarSize={12} />
          <Bar dataKey="put"  fill="#ef4444" radius={[3, 0, 0, 3]} maxBarSize={12} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
