"use client";
/**
 * Sector weights, measured against SPY.
 *
 * - A 360° donut of the stock book by sector, with a list beside it: your % next to SPY's %
 *   and the gap in points.
 * - "Missing vs SPY": sectors SPY holds that you have none of, or are well under.
 * - "Beta vs SPY": the dollar-weighted beta of the stock book on a 0–2 meter with SPY at
 *   1.00, and which under-weight sectors would pull it back toward 1.0.
 *
 * Sectors and betas come from /market/watchlist-quotes (cached 5 min server-side); the live
 * hedge books' beta wins where it exists, so the number matches the Holdings column.
 * S&P 500 trackers (SPY, VOO, IVV, …) are looked through: spread over SPY's own sector mix,
 * beta 1.00. Other funds have no sector, so they sit in "ETFs & funds".
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartTooltip, useChartStyle } from "@/components/chart/kit";
import { Panel } from "@/components/ui";
import { fetchWatchlistQuotes, WatchlistQuote, BrokerHolding } from "@/lib/api";
import { okBooks, useLiveBooks } from "@/lib/live";
import { useTheme } from "@/lib/theme";
import { usd } from "./broker";

// Fixed categorical order (validated light/dark pairs); never cycled.
const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
const DARK  = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];
const MAX_SLICES = LIGHT.length;
const FUNDS = "ETFs & funds";

/**
 * SPY's sector mix, approximate (S&P 500 GICS weights, Yahoo's sector names). It drifts a
 * point or two a quarter; refresh these numbers when it does. Normalised to 100% below.
 */
const SPY_ASOF = "Q4 2026, approx.";
const SPY_RAW: Record<string, number> = {
  "Technology": 34.0, "Financial Services": 13.0, "Consumer Cyclical": 10.5, "Communication Services": 10.0,
  "Healthcare": 9.0, "Industrials": 8.0, "Consumer Defensive": 5.0, "Energy": 3.0,
  "Utilities": 2.5, "Real Estate": 2.0, "Basic Materials": 1.8,
};
const SPY_SUM = Object.values(SPY_RAW).reduce((a, b) => a + b, 0);
const SPY: Record<string, number> = Object.fromEntries(Object.entries(SPY_RAW).map(([k, v]) => [k, v / SPY_SUM]));
/** Typical sector beta to the S&P 500 — only used to choose which gaps to suggest. */
const SECTOR_BETA: Record<string, number> = {
  "Technology": 1.2, "Financial Services": 1.05, "Consumer Cyclical": 1.2, "Communication Services": 1.05,
  "Healthcare": 0.75, "Industrials": 1.05, "Consumer Defensive": 0.6, "Energy": 0.95,
  "Utilities": 0.5, "Real Estate": 0.9, "Basic Materials": 1.0,
};
/** Funds that are the S&P 500: look through them. */
const SP500_FUNDS = new Set(["SPY", "VOO", "IVV", "SPLG", "SPYM", "RSP"]);
/** GICS / other spellings → Yahoo's names, so a holding lines up with SPY's row. */
const ALIAS: Record<string, string> = {
  "information technology": "Technology", "technology": "Technology",
  "financials": "Financial Services", "financial": "Financial Services", "financial services": "Financial Services",
  "consumer discretionary": "Consumer Cyclical", "consumer cyclical": "Consumer Cyclical",
  "communication services": "Communication Services", "communications": "Communication Services", "telecommunication services": "Communication Services",
  "health care": "Healthcare", "healthcare": "Healthcare",
  "industrials": "Industrials", "consumer staples": "Consumer Defensive", "consumer defensive": "Consumer Defensive",
  "energy": "Energy", "utilities": "Utilities", "real estate": "Real Estate",
  "materials": "Basic Materials", "basic materials": "Basic Materials",
};
const norm = (s?: string | null) => (s ? ALIAS[s.trim().toLowerCase()] ?? s.trim() : FUNDS);
const BAND = 0.1;               // beta within 1.00 ± 0.10 counts as "close to SPY"
const GAP = 0.02;               // under SPY by 2+ points = worth listing

interface Slice { sector: string; value: number; weight: number; spy: number; beta: number | null; symbols: string[]; color: string }

export function useSectors(symbols: string[]) {
  const key = [...symbols].sort().join(",");
  return useQuery<WatchlistQuote[]>({
    queryKey: ["sectors", key],
    queryFn: () => fetchWatchlistQuotes(symbols.slice(0, 150)),
    enabled: symbols.length > 0,
    staleTime: 10 * 60_000,
  });
}

const pts = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(1)}`;

export function SectorDonut({ holdings }: { holdings: BrokerHolding[] }) {
  const s = useChartStyle();
  const dark = useTheme().theme === "dark";
  const [hover, setHover] = useState<string | null>(null);
  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const { data: quotes, isLoading } = useSectors(symbols);
  const live = useLiveBooks().data;
  const books = useMemo(() => okBooks(live), [live]);

  const model = useMemo(() => {
    const q = new Map((quotes ?? []).map((r) => [r.symbol, r]));
    const liveBeta = new Map(books.map((b) => [b.symbol, b.beta]));
    // sector → $ and the $-weighted beta inside it
    const agg = new Map<string, { value: number; betaV: number; betaW: number; symbols: Set<string> }>();
    const put = (sector: string, v: number, beta: number | null | undefined, sym: string) => {
      const a = agg.get(sector) ?? { value: 0, betaV: 0, betaW: 0, symbols: new Set<string>() };
      a.value += v; a.symbols.add(sym);
      if (beta != null && Number.isFinite(beta)) { a.betaV += beta * v; a.betaW += v; }
      agg.set(sector, a);
    };
    let total = 0, betaV = 0, betaW = 0;
    for (const h of holdings) {
      const v = h.market_value ?? 0;
      if (v <= 0) continue;
      total += v;
      if (SP500_FUNDS.has(h.symbol)) {
        for (const [sec, w] of Object.entries(SPY)) put(sec, v * w, SECTOR_BETA[sec], h.symbol);
        betaV += v; betaW += v;          // an S&P 500 fund is beta 1.00 by definition
        continue;
      }
      const beta = liveBeta.get(h.symbol) ?? q.get(h.symbol)?.beta ?? null;
      put(norm(q.get(h.symbol)?.sector), v, beta, h.symbol);
      if (beta != null && Number.isFinite(beta)) { betaV += beta * v; betaW += v; }
    }
    const T = total || 1;
    const sorted = [...agg.entries()].sort((a, b) => b[1].value - a[1].value);
    const head = sorted.length > MAX_SLICES ? sorted.slice(0, MAX_SLICES - 1) : sorted;
    const tail = sorted.slice(head.length);
    const pal = dark ? DARK : LIGHT;
    const mk = (sector: string, rows: typeof sorted, color: string): Slice => {
      const value = rows.reduce((t, [, a]) => t + a.value, 0);
      const bw = rows.reduce((t, [, a]) => t + a.betaW, 0);
      return {
        sector, value, weight: value / T, color,
        spy: rows.reduce((t, [k]) => t + (SPY[k] ?? 0), 0),
        beta: bw ? rows.reduce((t, [, a]) => t + a.betaV, 0) / bw : null,
        symbols: [...new Set(rows.flatMap(([, a]) => [...a.symbols]))],
      };
    };
    const slices = head.map((r, i) => mk(r[0], [r], pal[i]));
    if (tail.length) slices.push(mk("Other", tail, s.c.muted));
    // The list never folds: every sector you hold gets its own row (folded ones keep the grey).
    const rows = [...head.map((r, i) => mk(r[0], [r], pal[i])), ...tail.map((r) => mk(r[0], [r], s.c.muted))];

    const mine = (sec: string) => (agg.get(sec)?.value ?? 0) / T;
    const gaps = Object.keys(SPY)
      .map((sec) => ({ sector: sec, mine: mine(sec), spy: SPY[sec], gap: mine(sec) - SPY[sec], beta: SECTOR_BETA[sec] }))
      .filter((g) => g.gap <= -GAP || (g.mine === 0 && g.spy > 0))
      .sort((a, b) => a.gap - b.gap);
    const beta = betaW ? betaV / betaW : null;
    return { slices, rows, total, gaps, beta, coverage: total ? betaW / total : 0, funds: (agg.get(FUNDS)?.value ?? 0) / T };
  }, [holdings, quotes, books, dark, s.c.muted]);

  const { slices, rows, total, gaps, beta, coverage, funds } = model;
  const focus = slices.find((x) => x.sector === hover) ?? null;
  const missing = gaps.filter((g) => g.mine === 0);
  const under = gaps.filter((g) => g.mine > 0);

  // Which gaps would move beta toward 1.00: low-beta sectors when high, high-beta when low.
  const dir = beta == null ? 0 : beta > 1 + BAND ? -1 : beta < 1 - BAND ? 1 : 0;
  const helpers = dir === 0 ? [] : Object.keys(SPY)
    .map((sec) => {
      const mine = rows.find((r) => r.sector === sec)?.weight ?? 0;
      return { sector: sec, gap: mine - SPY[sec], beta: SECTOR_BETA[sec] };
    })
    .filter((g) => (dir < 0 ? g.beta < 0.95 : g.beta > 1.05) && g.gap < GAP)
    .sort((a, b) => (dir < 0 ? a.beta - b.beta : b.beta - a.beta))
    .slice(0, 4);

  return (
    <Panel title="Sector weights" sub={rows.length ? `${rows.filter((r) => r.sector !== FUNDS).length} sectors · stocks only · vs SPY (${SPY_ASOF})` : undefined}>
      {isLoading ? (
        <p className="py-10 text-center text-[13px] text-foreground/55">Loading sectors…</p>
      ) : !slices.length ? (
        <p className="py-10 text-center text-[13px] text-foreground/55">No stock positions to break down.</p>
      ) : (
        <div className="space-y-5">
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
                  <Tooltip content={<ChartTooltip format={(pl) => {
                    const x = pl[0].payload as Slice;
                    return [
                      { label: x.sector, value: `${(x.weight * 100).toFixed(1)}%`, color: x.color },
                      { label: "SPY", value: x.spy ? `${(x.spy * 100).toFixed(1)}%` : "—" },
                      { label: "Beta", value: x.beta != null ? x.beta.toFixed(2) : "—" },
                      { label: "Value", value: usd(x.value, 0) },
                    ];
                  }} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground/50">{focus ? focus.sector : "Stocks"}</p>
                <p className="sensitive font-mono text-[17px] font-medium tabular-nums text-foreground">
                  {focus ? `${(focus.weight * 100).toFixed(1)}%` : usd(total, 0)}
                </p>
                {focus && focus.spy > 0 && <p className="font-mono text-[11px] text-foreground/50">SPY {(focus.spy * 100).toFixed(1)}%</p>}
              </div>
            </div>
            <div className="w-full min-w-0 flex-1 lg:max-w-3xl">
              <div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground/45">
                <span>Sector</span><span className="text-right">You · SPY · gap</span>
              </div>
              <ul className="space-y-1.5">
                {rows.map((x) => {
                  const gap = x.sector === FUNDS ? null : x.weight - x.spy;
                  return (
                    <li key={x.sector} onMouseEnter={() => setHover(slices.some((z) => z.sector === x.sector) ? x.sector : "Other")} onMouseLeave={() => setHover(null)}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-1.5 py-1 hover:bg-[var(--surface-2)]">
                      <span className="flex min-w-0 items-center gap-2 text-[13px] text-foreground">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: x.color }} />
                        <span className="truncate">{x.sector}</span>
                        <span className="hidden truncate font-mono text-[11px] text-foreground/40 sm:inline">{x.symbols.slice(0, 3).join(" ")}{x.symbols.length > 3 ? ` +${x.symbols.length - 3}` : ""}</span>
                      </span>
                      <span className="text-right font-mono text-[12px] tabular-nums text-foreground">
                        {(x.weight * 100).toFixed(1)}%
                        <span className="ml-2 text-foreground/45">{x.spy ? `${(x.spy * 100).toFixed(1)}%` : "—"}</span>
                        <span className={clsx("ml-2 inline-block w-12", gap == null ? "text-foreground/35" : Math.abs(gap) < GAP ? "text-foreground/50" : "text-foreground")}>
                          {gap == null ? "—" : pts(gap)}
                        </span>
                      </span>
                      {/* Your bar, with SPY's weight as a tick on the same track. */}
                      <span className="relative col-span-2 block h-1 rounded-full bg-[var(--surface-2)]">
                        <span className="block h-full rounded-full" style={{ width: `${Math.max(x.weight * 100, 1)}%`, background: x.color }} />
                        {x.spy > 0 && <span className="absolute -top-0.5 h-2 w-0.5 rounded-full bg-foreground/55" style={{ left: `${Math.min(x.spy * 100, 99.5)}%` }} title={`SPY ${(x.spy * 100).toFixed(1)}%`} />}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 flex items-center gap-1.5 px-1.5 font-mono text-[11px] text-foreground/45">
                <span className="inline-block h-2 w-0.5 rounded-full bg-foreground/55" /> SPY weight · gap in points
              </p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <BetaCard beta={beta} coverage={coverage} dir={dir} helpers={helpers} />
            <div className="rounded-xl border border-[var(--border)] p-4">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/50">Missing vs SPY</p>
              {!gaps.length ? (
                <p className="mt-2 text-[13px] text-foreground/70">Every SPY sector is covered within {GAP * 100} points.</p>
              ) : (
                <div className="mt-2 space-y-2.5">
                  {missing.length > 0 && (
                    <div>
                      <p className="mb-1 text-[12px] text-foreground/55">None held · {(missing.reduce((t, g) => t + g.spy, 0) * 100).toFixed(1)}% of SPY</p>
                      <div className="flex flex-wrap gap-1.5">
                        {missing.map((g) => (
                          <span key={g.sector} className="rounded-full border border-[var(--border-strong)] px-2.5 py-0.5 text-[12px] text-foreground">
                            {g.sector} <span className="font-mono text-foreground/50">{(g.spy * 100).toFixed(1)}%</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {under.length > 0 && (
                    <div>
                      <p className="mb-1 text-[12px] text-foreground/55">Under SPY by {GAP * 100}+ points</p>
                      <div className="flex flex-wrap gap-1.5">
                        {under.map((g) => (
                          <span key={g.sector} className="rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-[12px] text-foreground">
                            {g.sector} <span className="font-mono text-foreground/50">{pts(g.gap)}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {funds > 0.005 && (
                <p className="mt-2.5 text-[11.5px] text-foreground/45">{(funds * 100).toFixed(1)}% sits in non-S&P funds with no sector, so real gaps may be smaller.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Beta on a 0–2 track: SPY at 1.00, a shaded ±0.10 band, your marker. */
function BetaCard({ beta, coverage, dir, helpers }: {
  beta: number | null; coverage: number; dir: number;
  helpers: { sector: string; gap: number; beta: number }[];
}) {
  const at = (b: number) => `${Math.min(100, Math.max(0, (b / 2) * 100))}%`;
  const verdict = beta == null ? "No beta data yet" : dir === 0 ? "Close to SPY" : dir < 0 ? "More volatile than SPY" : "Less volatile than SPY";
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/50">Beta vs SPY</p>
        <p className="font-mono text-[11px] text-foreground/45">{coverage > 0 && coverage < 0.995 ? `${(coverage * 100).toFixed(0)}% of $ has a beta` : "stocks, $-weighted"}</p>
      </div>
      <p className="mt-1 font-mono text-[22px] font-medium tabular-nums text-foreground">
        {beta != null ? beta.toFixed(2) : "—"}
        <span className="ml-2 text-[13px] font-normal text-foreground/50">SPY 1.00 · {beta != null ? `${beta >= 1 ? "+" : "−"}${Math.abs(beta - 1).toFixed(2)}` : ""}</span>
      </p>
      <p className={clsx("text-[12.5px]", dir === 0 ? "text-gain" : "text-warn")}>{verdict}</p>
      <div className="relative mt-3 h-1.5 rounded-full bg-[var(--surface-2)]">
        <span className="absolute inset-y-0 rounded-full bg-gain/25" style={{ left: at(1 - BAND), width: `${(BAND / 2) * 200}%` }} />
        <span className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/60" style={{ left: at(1) }} />
        {beta != null && (
          <span className={clsx("absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)]", dir === 0 ? "bg-gain" : "bg-warn")}
            style={{ left: at(beta) }} />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10.5px] text-foreground/40"><span>0</span><span>SPY 1.0</span><span>2.0</span></div>
      {dir !== 0 && (
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-foreground/70">
          {helpers.length ? (
            <>To bring it toward 1.00, add {dir < 0 ? "lower" : "higher"}-beta sectors where you&apos;re at or under SPY:{" "}
              {helpers.map((h, i) => (
                <span key={h.sector}>{i ? ", " : ""}<span className="text-foreground">{h.sector}</span> <span className="font-mono text-foreground/50">({pts(h.gap)} pts, β≈{h.beta.toFixed(2)})</span></span>
              ))}.</>
          ) : (
            <>No sector you&apos;re light in would pull it {dir < 0 ? "down" : "up"}; trim your {dir < 0 ? "highest" : "lowest"}-beta names or hedge on the Hedge page.</>
          )}
        </p>
      )}
    </div>
  );
}
