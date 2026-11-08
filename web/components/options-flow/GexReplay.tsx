"use client";
/**
 * GexReplay — scrub through the day's stored GEX snapshots: how spot moved
 * against the flip, walls and king node, and what the strike profile looked
 * like at each moment.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play, History } from "lucide-react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";
import { Panel, Pill, Segmented } from "@/components/ui";
import { useChartStyle, ChartTooltip, Legend } from "@/components/chart/kit";

interface Snap {
  ts: string; spot: number; net_gex: number | null; zero_gamma: number | null;
  call_wall: number | null; put_wall: number | null; king: number | null; profile: [number, number][];
}
interface Day { symbol: string; date: string | null; snapshots: Snap[]; days: string[] }

const time = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const usd = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);
const big = (v: number | null) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "+";
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : `${s}$${(a / 1e6).toFixed(0)}M`;
};

export function GexReplay({ symbol }: { symbol: string }) {
  const { c, grid, xAxis, yAxis, cursor } = useChartStyle();
  const [on, setOn] = useState<string | undefined>(undefined);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);

  const { data, isLoading } = useQuery<Day>({
    queryKey: ["gexHistory", symbol, on],
    queryFn: () => api.get<Day>(`/flow/${encodeURIComponent(symbol)}/replay${on ? `?on=${on}` : ""}`),
    staleTime: 60_000,
  });
  const snaps = data?.snapshots ?? [];

  useEffect(() => { setI(Math.max(0, snaps.length - 1)); setPlaying(false); }, [snaps.length, data?.date]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((x) => { if (x >= snaps.length - 1) { setPlaying(false); return x; } return x + 1; }), 450);
    return () => clearInterval(t);
  }, [playing, snaps.length]);

  const cur = snaps[i];
  const maxAbs = useMemo(() => Math.max(1, ...(cur?.profile ?? []).map(([, v]) => Math.abs(v))), [cur]);
  const chart = snaps.map((s) => ({ ts: s.ts, spot: s.spot, flip: s.zero_gamma, call: s.call_wall, put: s.put_wall, king: s.king }));

  return (
    <Panel
      title="GEX replay"
      sub={data?.date ? `${snaps.length} snapshots · ${new Date(data.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : undefined}
      actions={data && data.days.length > 1 ? (
        <Segmented label="Day" value={data.date ?? ""} onChange={(v) => setOn(v)}
          options={data.days.slice(0, 5).reverse().map((d) => ({ value: d, label: new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) }))} />
      ) : null}
    >
      {isLoading ? <div className="skeleton h-64" /> : snaps.length < 2 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <History size={22} className="text-foreground/35" />
          <p className="text-[14px] text-foreground/75">No replay for {symbol} yet.</p>
          <p className="max-w-md text-[13px] text-foreground/55">
            Snapshots are saved every 5 minutes while {symbol} is open on the Flow board during market hours. Come back after a session to scrub through how the levels moved.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <button onClick={() => { if (i >= snaps.length - 1) setI(0); setPlaying((p) => !p); }} aria-label={playing ? "Pause" : "Play"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:bg-foreground/85">
              {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
            </button>
            <input type="range" min={0} max={snaps.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }}
              aria-label="Snapshot time" className="h-1.5 w-full cursor-pointer accent-[rgb(var(--accent-rgb))]" />
            <span className="w-16 shrink-0 text-right font-mono text-[13px] tabular-nums text-foreground">{cur && time(cur.ts)}</span>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={chart} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid {...grid} />
                  <XAxis dataKey="ts" {...xAxis} tickFormatter={time} minTickGap={40} />
                  <YAxis {...yAxis} domain={["auto", "auto"]} tickFormatter={(v) => `$${Number(v).toFixed(0)}`} />
                  <Tooltip cursor={cursor} content={
                    <ChartTooltip title={(l) => time(String(l))} format={(p) => p.map((e) => ({
                      label: ({ spot: "Spot", flip: "Flip", call: "Call wall", put: "Put wall", king: "King" } as Record<string, string>)[e.dataKey] ?? e.dataKey,
                      value: usd(Number(e.value)), color: e.color,
                    }))} />
                  } />
                  {cur && <ReferenceLine x={cur.ts} stroke={c.muted} strokeDasharray="3 3" />}
                  <Line dataKey="call" stroke={c.gain} strokeWidth={1.25} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                  <Line dataKey="put" stroke={c.loss} strokeWidth={1.25} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                  <Line dataKey="flip" stroke={c.accent} strokeWidth={1.25} dot={false} isAnimationActive={false} />
                  <Line dataKey="king" stroke="#d4a017" strokeWidth={1.5} dot={false} isAnimationActive={false} type="stepAfter" />
                  <Line dataKey="spot" stroke={c.ink} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="mt-2">
                <Legend items={[{ label: "Spot", color: c.ink }, { label: "Flip", color: c.accent }, { label: "Call wall", color: c.gain, dashed: true }, { label: "Put wall", color: c.loss, dashed: true }, { label: "King", color: "#d4a017" }]} />
              </div>
            </div>

            {cur && (
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-2xl font-medium tabular-nums text-foreground">{usd(cur.spot)}</span>
                  <Pill tone={(cur.net_gex ?? 0) >= 0 ? "good" : "warn"} className="normal-case tracking-normal">Net {big(cur.net_gex)}</Pill>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px]">
                  <span className="text-foreground/55">Flip</span><span className="text-right text-accent">{usd(cur.zero_gamma)}</span>
                  <span className="text-foreground/55">Call wall</span><span className="text-right text-gain">{usd(cur.call_wall)}</span>
                  <span className="text-foreground/55">Put wall</span><span className="text-right text-loss">{usd(cur.put_wall)}</span>
                  <span className="text-foreground/55">King</span><span className="text-right text-foreground">{usd(cur.king)}</span>
                </div>
                <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Net GEX by strike</p>
                <div className="grid max-h-56 gap-[2px] overflow-y-auto pr-1">
                  {[...cur.profile].reverse().map(([k, v]) => {
                    const near = Math.abs(k - cur.spot) === Math.min(...cur.profile.map(([s]) => Math.abs(s - cur.spot)));
                    return (
                      <div key={k} className="grid grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1 font-mono text-[11px]">
                        <span className={near ? "font-medium text-accent" : "text-foreground/55"}>{k}</span>
                        <span className="flex justify-end">{v < 0 && <span className="h-2 rounded-l-sm bg-loss" style={{ width: `${(Math.abs(v) / maxAbs) * 100}%` }} />}</span>
                        <span className="flex">{v > 0 && <span className="h-2 rounded-r-sm bg-gain" style={{ width: `${(v / maxAbs) * 100}%` }} />}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
