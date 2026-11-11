"use client";
/**
 * Sector weights: a 360° donut of the stock book by sector, with a meter list
 * beside it (name, bar, % and $) so every slice can be read without the colour.
 * Sectors come from the watchlist-quotes endpoint (cached 5 min server-side).
 * Up to 7 sectors get their own colour; the rest fold into "Other".
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltip, useChartStyle } from "@/components/chart/kit";
import { Panel } from "@/components/ui";
import { fetchWatchlistQuotes, WatchlistQuote, BrokerHolding } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { usd } from "./broker";

// Fixed categorical order (validated light/dark pairs); never cycled.
const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
const DARK  = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];
const MAX_SLICES = LIGHT.length;
const FUNDS = "ETFs & funds";

interface Slice { sector: string; value: number; weight: number; symbols: string[]; color: string }

export function useSectors(symbols: string[]) {
  const key = [...symbols].sort().join(",");
  return useQuery<WatchlistQuote[]>({
    queryKey: ["sectors", key],
    queryFn: () => fetchWatchlistQuotes(symbols.slice(0, 150)),
    enabled: symbols.length > 0,
    staleTime: 10 * 60_000,
  });
}

export function SectorDonut({ holdings }: { holdings: BrokerHolding[] }) {
  const s = useChartStyle();
  const dark = useTheme().theme === "dark";
  const [hover, setHover] = useState<string | null>(null);
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { data: quotes, isLoading } = useSectors(symbols);

  const slices = useMemo<Slice[]>(() => {
    const sectorOf = new Map((quotes ?? []).map((q) => [q.symbol, q.sector || FUNDS]));
    const agg = new Map<string, { value: number; symbols: string[] }>();
    for (const h of holdings) {
      const v = h.market_value ?? 0;
      if (v <= 0) continue;
      const k = sectorOf.get(h.symbol) ?? FUNDS;
      const a = agg.get(k) ?? { value: 0, symbols: [] };
      a.value += v; a.symbols.push(h.symbol);
      agg.set(k, a);
    }
    const total = [...agg.values()].reduce((t, a) => t + a.value, 0) || 1;
    const sorted = [...agg.entries()].sort((a, b) => b[1].value - a[1].value);
    const head = sorted.length > MAX_SLICES ? sorted.slice(0, MAX_SLICES - 1) : sorted;
    const tail = sorted.slice(head.length);
    const pal = dark ? DARK : LIGHT;
    const out: Slice[] = head.map(([sector, a], i) => ({ sector, value: a.value, weight: a.value / total, symbols: a.symbols, color: pal[i] }));
    if (tail.length) {
      const v = tail.reduce((t, [, a]) => t + a.value, 0);
      out.push({ sector: "Other", value: v, weight: v / total, symbols: tail.flatMap(([, a]) => a.symbols), color: s.c.muted });
    }
    return out;
  }, [holdings, quotes, dark, s.c.muted]);

  const total = slices.reduce((t, x) => t + x.value, 0);
  const focus = slices.find((x) => x.sector === hover) ?? null;

  return (
    <Panel title="Sector weights" sub={slices.length ? `${slices.length} sectors · stocks only` : undefined}>
      {isLoading ? (
        <p className="py-10 text-center text-[13px] text-foreground/55">Loading sectors…</p>
      ) : !slices.length ? (
        <p className="py-10 text-center text-[13px] text-foreground/55">No stock positions to break down.</p>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <div className="relative h-[200px] w-[200px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="sector" innerRadius="64%" outerRadius="100%"
                  startAngle={90} endAngle={-270} paddingAngle={slices.length > 1 ? 1.2 : 0}
                  stroke={s.c.surface} strokeWidth={2} isAnimationActive={false}
                  onMouseEnter={(_, i) => setHover(slices[i]?.sector ?? null)} onMouseLeave={() => setHover(null)}>
                  {slices.map((x) => (
                    <Cell key={x.sector} fill={x.color} opacity={hover && hover !== x.sector ? 0.35 : 1} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip format={(pl) => [
                  { label: pl[0].payload.sector, value: `${(pl[0].payload.weight * 100).toFixed(1)}%`, color: pl[0].payload.color },
                  { label: "Value", value: usd(pl[0].payload.value, 0) },
                  { label: "Symbols", value: pl[0].payload.symbols.slice(0, 4).join(", ") + (pl[0].payload.symbols.length > 4 ? "…" : "") },
                ]} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground/50">{focus ? focus.sector : "Stocks"}</p>
              <p className="sensitive font-mono text-[17px] font-medium tabular-nums text-foreground">
                {focus ? `${(focus.weight * 100).toFixed(1)}%` : usd(total, 0)}
              </p>
            </div>
          </div>
          <ul className="w-full min-w-0 flex-1 space-y-1.5 lg:max-w-3xl">
            {slices.map((x) => (
              <li key={x.sector} onMouseEnter={() => setHover(x.sector)} onMouseLeave={() => setHover(null)}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-1.5 py-1 hover:bg-[var(--surface-2)]">
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-foreground">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: x.color }} />
                  <span className="truncate">{x.sector}</span>
                  <span className="hidden truncate font-mono text-[11px] text-foreground/40 sm:inline">{x.symbols.slice(0, 3).join(" ")}{x.symbols.length > 3 ? ` +${x.symbols.length - 3}` : ""}</span>
                </span>
                <span className="text-right font-mono text-[12px] tabular-nums text-foreground">
                  {(x.weight * 100).toFixed(1)}%<span className="sensitive ml-2 text-foreground/50">{usd(x.value, 0)}</span>
                </span>
                <span className="col-span-2 block h-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(x.weight * 100, 1)}%`, background: x.color }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
