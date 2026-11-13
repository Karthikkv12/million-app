"use client";
/**
 * Sectors — ranked sector rows (SPDR ETF move, diverging bar) that expand in place into a
 * heat strip of the sector's key stocks (tile width ∝ market cap), with the sector's drawdown and
 * upside-spike charts and a one-line LEAPS score with its entry price underneath. Replaces the old Markets page.
 * An open sector also shows a political line (congressional trades, lobbying and federal contracts summed over its
 * stocks), from /politics/summary: cached figures only, the rest fill in as the server fetches them.
 */
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { fetchPoliticsSummary, PoliticalSummary } from "@/lib/api";
import { usdShort } from "@/components/insight/PoliticalCard";
import Link from "next/link";
import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";
import { heatColor } from "@/components/ui";
import { DeskRow } from "@/components/desk";
import { SwingCharts } from "@/components/insight/SwingCharts";
import { LeapsLine } from "@/components/insight/LeapsScore";
import { useQuotes } from "./quotes";
import { SECTORS, SECTOR_ROWS, StockTile } from "./sector-baskets";

const STOCKS = Array.from(new Set(Object.values(SECTORS).flatMap((s) => s.stocks.map((x) => x.symbol))));
const ETFS = SECTOR_ROWS.map((r) => r.etf).filter((e): e is string => !!e);
const SYMBOLS = [...ETFS, ...STOCKS];

const pctTxt = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);

type Compact = PoliticalSummary["items"][number];

/** Congress buys / sells (90 days), lobbying (latest quarter) and federal contracts (12 months) over a basket. */
function SectorPolitics({ stocks, by, pending }: { stocks: StockTile[]; by: Map<string, Compact>; pending: Set<string> }) {
  const have = stocks.map((s) => by.get(s.symbol)).filter((x): x is Compact => !!x);
  const waiting = stocks.filter((s) => pending.has(s.symbol)).length;
  const sum = (f: (c: Compact) => number | null | undefined) => have.reduce((a, c) => a + (f(c) ?? 0), 0);
  const buys = sum((c) => c.congress_buys_90d), sells = sum((c) => c.congress_sells_90d);
  const tradesKnown = have.some((c) => c.congress_buys_90d != null);
  const lobby = sum((c) => c.lobbying_last_q), lobbyers = have.filter((c) => (c.lobbying_last_q ?? 0) > 0).length;
  const contracts = sum((c) => c.contracts_12m);
  const period = have.find((c) => c.lobbying_period)?.lobbying_period;
  if (!have.length && !waiting) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--border)] px-4 py-2.5 font-mono text-[11.5px] text-foreground/60">
      <span className="flex items-center gap-1.5 text-foreground/45"><Landmark size={12} />Political</span>
      {tradesKnown && <span>Congress 90d <span className="text-gain">{buys} buy{buys === 1 ? "" : "s"}</span> · <span className="text-loss">{sells} sell{sells === 1 ? "" : "s"}</span></span>}
      {have.length > 0 && <span>Lobbying {period ?? "last quarter"} <span className="text-foreground">{usdShort(lobby)}</span> <span className="text-foreground/40">({lobbyers} of {stocks.length} companies)</span></span>}
      {contracts > 0 && <span>Federal contracts 12m <span className="text-foreground">{usdShort(contracts)}</span></span>}
      {waiting > 0 && <span className="text-foreground/40">fetching {waiting} more…</span>}
    </div>
  );
}

function SectorSwings({ symbol, label }: { symbol: string; label: string }) {
  return (
    <div className="border-t border-[var(--border)] px-4 py-4">
      <LeapsLine symbol={symbol} className="mb-4" />
      <SwingCharts symbol={symbol} title={`${label}: drawdown and upside spikes`} height={150} />
    </div>
  );
}

export function Sectors() {
  const { data: q } = useQuotes(SYMBOLS);          // 5 s, like the rest of the dashboard
  const [open, setOpen] = useState<string | null>(null);
  // Political figures for every basket stock: served from the server's cache; missing ones are fetched there in
  // the background (a few seconds apart), so poll more often while anything is pending.
  const pol = useQuery<PoliticalSummary>({
    queryKey: ["politics-summary", "sectors"], queryFn: () => fetchPoliticsSummary(STOCKS), staleTime: 60_000,
    refetchInterval: (query) => (query.state.data?.pending?.length ? 30_000 : 30 * 60_000),
  });
  const polBy = useMemo(() => new Map((pol.data?.items ?? []).map((c) => [c.symbol, c])), [pol.data]);
  const polPending = useMemo(() => new Set(pol.data?.pending ?? []), [pol.data]);

  const rows = useMemo(() => {
    const basketMove = (stocks: StockTile[]) => {
      const xs = stocks.map((s) => ({ w: s.weight, p: q?.[s.symbol]?.change_pct })).filter((x): x is { w: number; p: number } => x.p != null);
      const w = xs.reduce((a, x) => a + x.w, 0);
      return w ? xs.reduce((a, x) => a + x.w * x.p, 0) / w : null;
    };
    return SECTOR_ROWS.map((r) => {
      const stocks = (r.baskets ?? []).flatMap((k) => SECTORS[k].stocks).sort((a, b) => b.weight - a.weight);
      const pct = r.etf ? q?.[r.etf]?.change_pct ?? null : basketMove(stocks);
      const breadth = stocks.length ? stocks.filter((s) => (q?.[s.symbol]?.change_pct ?? 0) > 0).length / stocks.length : null;
      return { ...r, key: r.etf ?? r.label, stocks, pct, breadth };
    }).sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
  }, [q]);

  const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.pct ?? 0)));

  return (
    <div className="border-t border-[var(--border)]">
      {rows.map((r) => {
        const isOpen = open === r.key;
        const w = r.pct == null ? 0 : (Math.abs(r.pct) / max) * 50;
        const canOpen = r.stocks.length > 0;
        return (
          <Fragment key={r.key}>
            <DeskRow onClick={canOpen ? () => setOpen(isOpen ? null : r.key) : undefined} active={isOpen}>
              <div className="grid min-h-[48px] grid-cols-[minmax(0,1.25fr)_minmax(48px,1fr)_64px_16px] items-center gap-x-3 py-2 pl-4 pr-3 sm:grid-cols-[minmax(0,1.3fr)_52px_minmax(80px,1fr)_68px_64px_18px]">
                <span className="text-[13.5px] leading-tight text-foreground/85">{r.label}</span>
                <span className="hidden font-mono text-[11.5px] text-foreground/45 sm:inline">{r.etf ?? "basket"}</span>
                <span className="relative h-[8px]" aria-hidden>
                  <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[var(--border-strong)]" />
                  {r.pct != null && (
                    <span className={clsx("absolute inset-y-0", r.pct >= 0 ? "bg-gain/75" : "bg-loss/75")}
                      style={r.pct >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
                  )}
                </span>
                <span className={clsx("text-right font-mono text-[13px] tabular-nums", r.pct == null ? "text-foreground/40" : r.pct >= 0 ? "text-gain" : "text-loss")}>{pctTxt(r.pct)}</span>
                <span className="hidden text-right font-mono text-[11px] text-foreground/45 sm:inline" title="Share of the basket's stocks that are up">
                  {r.breadth != null ? `${Math.round(r.breadth * 100)}% up` : ""}
                </span>
                {canOpen ? <ChevronDown size={14} className={clsx("text-foreground/40 transition", isOpen && "rotate-180")} /> : <span />}
              </div>
            </DeskRow>
            {isOpen && (
              <div className="border-b border-[var(--border)] bg-foreground/[0.025]">
                <div className="flex flex-wrap gap-[2px] p-3">
                  {r.stocks.map((s) => {
                    const p = q?.[s.symbol]?.change_pct ?? null;
                    const c = heatColor(p);
                    return (
                      <Link key={s.symbol} href={`/stocks/${s.symbol}`} title={`${s.name} ${pctTxt(p)}`}
                        className="flex min-h-[54px] min-w-[64px] flex-col justify-between px-2 py-1.5 transition hover:brightness-110"
                        style={{ flexGrow: Math.max(1, Math.sqrt(s.weight)), flexBasis: 0, background: c.bg, color: c.fg }}>
                        <span className="font-mono text-[12px] font-semibold">{s.symbol}</span>
                        <span className="font-mono text-[11px] tabular-nums opacity-90">{pctTxt(p)}</span>
                      </Link>
                    );
                  })}
                </div>
                <SectorPolitics stocks={r.stocks} by={polBy} pending={polPending} />
                {/* Drawdown and upside spikes of the sector's ETF (or its largest stock when there is none), 1M to all time */}
                <SectorSwings symbol={r.etf ?? r.stocks[0].symbol} label={r.etf ? `${r.label} (${r.etf})` : `${r.stocks[0].name} (${r.stocks[0].symbol}), the largest in ${r.label}`} />
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
