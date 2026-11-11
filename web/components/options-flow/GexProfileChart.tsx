"use client";
/**
 * GexProfileChart — call vs put gamma by strike, mirrored around zero
 * (puts left, calls right), for the strikes nearest spot. Spot is marked on
 * the closest strike row.
 */
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";
import { GexResult } from "@/lib/api";
import { useChartStyle, ChartTooltip, Legend } from "@/components/chart/kit";

interface Props { data: GexResult; accentColor?: string }

const N = 24; // strikes shown, centred on spot

const fmtUsd = (v: number) => {
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
};

export function GexProfileChart({ data }: Props) {
  const { c, grid, xAxis, yAxis, barCursor } = useChartStyle();
  const spot = data.spot;
  // strikes and the *_by_strike arrays share an index
  const all = (data.strikes ?? []).map((s, i) => ({
    strike: s,
    call: Math.abs(data.call_gex_by_strike?.[i] ?? 0),
    put: -Math.abs(data.put_gex_by_strike?.[i] ?? 0),
  })).sort((a, b) => a.strike - b.strike);
  const strikes = all.map((r) => r.strike);
  if (!strikes.length) return null;

  // window of N strikes around spot
  const idx = strikes.reduce((best, s, i) => (Math.abs(s - spot) < Math.abs(strikes[best] - spot) ? i : best), 0);
  const lo = Math.max(0, Math.min(idx - N / 2, strikes.length - N));
  const spotStrike = strikes[idx];
  const rows = all.slice(lo, lo + N).reverse(); // highest strike at top, like a price ladder

  return (
    <div className="border-b border-[var(--border)] px-5 py-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-foreground">Gamma by strike</h3>
        <Legend items={[{ label: "Puts", color: c.loss }, { label: "Calls", color: c.gain }, { label: "Spot", color: c.accent, dashed: true }]} />
      </div>
      <ResponsiveContainer width="100%" height={Math.max(260, rows.length * 16)}>
        <BarChart data={rows} layout="vertical" stackOffset="sign" barCategoryGap={2} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...grid} horizontal={false} vertical />
          <XAxis type="number" {...xAxis} tickFormatter={fmtUsd} />
          <YAxis
            dataKey="strike"
            type="category"
            {...yAxis}
            width={56}
            interval={0}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tick={(p: any) => {
              const isSpot = Number(p.payload.value) === spotStrike;
              return (
                <text x={Number(p.x) - 4} y={Number(p.y)} dy={4} textAnchor="end" fontSize={11} fontFamily="var(--font-mono)"
                  fill={isSpot ? c.accent : c.muted} fontWeight={isSpot ? 600 : 400}>
                  {p.payload.value}
                </text>
              );
            }}
          />
          <Tooltip
            cursor={barCursor}
            content={
              <ChartTooltip
                title={(l) => `Strike $${l}`}
                format={(p) => p.map((e) => ({
                  label: e.dataKey === "call" ? "Call GEX" : "Put GEX",
                  value: fmtUsd(Number(e.value)),
                  color: e.dataKey === "call" ? c.gain : c.loss,
                }))}
              />
            }
          />
          <ReferenceLine x={0} stroke={c.border} />
          <ReferenceLine y={spotStrike} stroke={c.accent} strokeDasharray="4 3" ifOverflow="extendDomain" />
          <Bar dataKey="put" stackId="g" fill={c.loss} radius={[3, 0, 0, 3]} maxBarSize={11}>
            {rows.map((r) => <Cell key={r.strike} fillOpacity={r.strike === spotStrike ? 1 : 0.85} />)}
          </Bar>
          <Bar dataKey="call" stackId="g" fill={c.gain} radius={[0, 3, 3, 0]} maxBarSize={11}>
            {rows.map((r) => <Cell key={r.strike} fillOpacity={r.strike === spotStrike ? 1 : 0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[12px] text-foreground/50">{rows.length} strikes around spot (${spot.toFixed(2)}). Dollar gamma per 1% move.</p>
    </div>
  );
}
