"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { PageHeader, RefreshButton, Panel, Pill, Change, SectionHeader } from "@/components/ui";
import { SectorCard, SECTORS, SectorKey } from "@/components/markets/SectorHeatmap";
import VixPanel from "@/components/dashboard/VixPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Quote {
  price:     number | null;
  change:    number | null;
  changePct: number | null;
}
type QuoteMap = Record<string, Quote>;

// ── Market movers ─────────────────────────────────────────────────────────────

const MOVERS_WATCHLIST = [
  // Mag7
  "AAPL","MSFT","NVDA","GOOGL","AMZN","META","TSLA",
  // High beta / popular
  "AMD","NFLX","CRM","SHOP","COIN","PLTR","SNOW","RBLX","UBER","LYFT",
  // Indices
  "SPY","QQQ","IWM","DIA",
  // Sector ETFs
  "XLK","XLF","XLV","XLE","XLC","XLY","XLI","XLB","XLRE","XLU",
];

async function fetchQuotes(symbols: string[]): Promise<QuoteMap> {
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += 20) batches.push(symbols.slice(i, i + 20));
  const all: QuoteMap = {};
  await Promise.all(batches.map(async (batch) => {
    const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(batch.join(","))}`, { cache: "no-store" });
    if (!res.ok) return;
    const rows: { symbol: string; price: number | null; change: number | null; change_pct: number | null }[] = await res.json();
    for (const r of rows) all[r.symbol] = { price: r.price, change: r.change, changePct: r.change_pct };
  }));
  return all;
}

// ── Breadth ───────────────────────────────────────────────────────────────────

function Breadth({ quotes }: { quotes: QuoteMap }) {
  const vals = Object.values(quotes).map((q) => q.changePct).filter((v): v is number => v != null);
  const adv = vals.filter((v) => v > 0).length;
  const dec = vals.filter((v) => v < 0).length;
  const unc = vals.length - adv - dec;
  const total = vals.length || 1;
  return (
    <Panel title="Breadth" sub={`${vals.length} tracked symbols`}>
      {vals.length === 0 ? <div className="skeleton h-20" /> : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[["Up", adv, "text-emerald-600 dark:text-emerald-400"], ["Flat", unc, "text-foreground/70"], ["Down", dec, "text-red-600 dark:text-red-400"]].map(([l, v, c]) => (
              <div key={l as string}>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">{l}</p>
                <p className={`font-mono text-2xl font-medium tabular-nums ${c}`}>{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden>
            <div style={{ width: `${(adv / total) * 100}%` }} className="bg-emerald-500 transition-all duration-700" />
            <div style={{ width: `${(unc / total) * 100}%` }} className="bg-foreground/20 transition-all duration-700" />
            <div style={{ width: `${(dec / total) * 100}%` }} className="bg-red-500 transition-all duration-700" />
          </div>
          <p className="mt-2 text-[13px] text-foreground/60">{Math.round((adv / total) * 100)}% advancing</p>
        </>
      )}
    </Panel>
  );
}

// ── Sentiment (proxy) ─────────────────────────────────────────────────────────

function Sentiment({ quotes }: { quotes: QuoteMap }) {
  const spy = quotes["SPY"]?.changePct;
  const vals = Object.values(quotes).filter((q) => q.changePct != null);
  const adv = vals.filter((q) => (q.changePct ?? 0) > 0).length;
  const breadthScore = vals.length ? (adv / vals.length) * 100 : 50;
  const spyBonus = spy != null ? Math.max(-20, Math.min(20, spy * 5)) : 0;
  const score = Math.round(Math.max(0, Math.min(100, breadthScore + spyBonus)));
  const label = score >= 75 ? "Extreme greed" : score >= 60 ? "Greed" : score >= 45 ? "Neutral" : score >= 30 ? "Fear" : "Extreme fear";
  const tone = score >= 60 ? "good" : score >= 45 ? "neutral" : score >= 30 ? "warn" : "bad";
  const angle = -90 + (score / 100) * 180;
  return (
    <Panel title="Sentiment" sub="Proxy: breadth + SPY move" actions={vals.length ? <Pill tone={tone}>{label}</Pill> : null}>
      {vals.length === 0 ? <div className="skeleton h-20" /> : (
        <div className="flex items-center gap-5">
          <svg viewBox="0 0 100 56" className="h-16 w-28 shrink-0 text-foreground" aria-hidden>
            <defs>
              <linearGradient id="sentGrad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#dc2626" />
                <stop offset="50%" stopColor="#a3a3a3" />
                <stop offset="100%" stopColor="#16a34a" />
              </linearGradient>
            </defs>
            <path d="M 8 50 A 42 42 0 0 1 92 50" fill="none" stroke="url(#sentGrad)" strokeWidth="7" strokeLinecap="round" opacity="0.85" />
            <g transform={`rotate(${angle} 50 50)`}>
              <line x1="50" y1="50" x2="50" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </g>
            <circle cx="50" cy="50" r="4" fill="currentColor" />
          </svg>
          <div>
            <p className="font-mono text-3xl font-medium tabular-nums text-foreground">{score}<span className="text-base text-foreground/40">/100</span></p>
            {spy != null && <p className="mt-1 flex items-center gap-1.5 text-[13px] text-foreground/60">SPY <Change pct={spy} /></p>}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Sector ETFs, ranked ───────────────────────────────────────────────────────

const SECTOR_ETFS = [
  { symbol: "XLK",  label: "Technology" },
  { symbol: "XLF",  label: "Financials" },
  { symbol: "XLV",  label: "Health care" },
  { symbol: "XLE",  label: "Energy" },
  { symbol: "XLC",  label: "Communication" },
  { symbol: "XLY",  label: "Consumer discretionary" },
  { symbol: "XLI",  label: "Industrials" },
  { symbol: "XLRE", label: "Real estate" },
  { symbol: "XLU",  label: "Utilities" },
  { symbol: "XLB",  label: "Materials" },
];

function SectorETFs({ quotes }: { quotes: QuoteMap }) {
  const rows = SECTOR_ETFS
    .map((e) => ({ ...e, pct: quotes[e.symbol]?.changePct ?? null }))
    .sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
  const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.pct ?? 0)));
  return (
    <Panel title="Sector ETFs" sub="SPDR, ranked by today's move" padded={false}>
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((r) => {
          const w = r.pct == null ? 0 : (Math.abs(r.pct) / max) * 50;
          return (
            <li key={r.symbol} className="grid grid-cols-[52px_minmax(0,1fr)_minmax(0,0.9fr)_72px] items-center gap-3 px-4 py-2">
              <span className="font-mono text-[12px] font-medium text-foreground">{r.symbol}</span>
              <span className="truncate text-[13px] text-foreground/65">{r.label}</span>
              <span className="relative h-2" aria-hidden>
                <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />
                {r.pct != null && (
                  <span
                    className={`absolute inset-y-0 rounded-full ${r.pct >= 0 ? "bg-emerald-500" : "bg-red-500"}`}
                    style={r.pct >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                  />
                )}
              </span>
              <span className="text-right">{r.pct != null ? <Change pct={r.pct} /> : <span className="font-mono text-[12px] text-foreground/40">—</span>}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ── Top movers ────────────────────────────────────────────────────────────────

function Movers({ quotes, side }: { quotes: QuoteMap; side: "gain" | "loss" }) {
  const rows = Object.entries(quotes)
    .filter(([, q]) => q.changePct != null && q.price != null && (side === "gain" ? q.changePct! > 0 : q.changePct! < 0))
    .sort(([, a], [, b]) => (side === "gain" ? b.changePct! - a.changePct! : a.changePct! - b.changePct!))
    .slice(0, 6);
  return (
    <Panel title={side === "gain" ? "Top gainers" : "Top losers"} padded={false}>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-foreground/50">{Object.keys(quotes).length ? "None right now." : "Loading…"}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map(([sym, q]) => (
            <li key={sym}>
              <Link href={`/stocks/${encodeURIComponent(sym)}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-2.5 transition hover:bg-[var(--surface-2)]">
                <span className="font-mono text-[13px] font-medium text-foreground">{sym}</span>
                <span className="font-mono text-[12px] tabular-nums text-foreground/60">${q.price!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <Change pct={q.changePct} className="w-20 justify-end" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const SECTOR_ETF_SYMS = SECTOR_ETFS.map((s) => s.symbol);
const ALL_SECTOR_STOCKS = Array.from(
  new Set(Object.values(SECTORS).flatMap((s) => s.stocks.map((x) => x.symbol)))
);
const ALL_SYMBOLS = Array.from(new Set([...MOVERS_WATCHLIST, ...SECTOR_ETF_SYMS, ...ALL_SECTOR_STOCKS]));

export default function MarketsPage() {
  const [quotes,   setQuotes]   = useState<QuoteMap>({});
  const [loading,  setLoading]  = useState(true);
  const [lastUp,   setLastUp]   = useState<Date | null>(null);
  const [error,    setError]    = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const map = await fetchQuotes(ALL_SYMBOLS);
      setQuotes(map);
      setLastUp(new Date());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const isRefreshing = loading && Object.keys(quotes).length > 0;

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 pb-16 pt-8 sm:px-6">
      <PageHeader
        eyebrow="Market"
        title="Markets"
        sub="Breadth, sectors and volatility. Quotes refresh every minute."
        action={
          <div className="flex items-center gap-3">
            {lastUp && (
              <span className="hidden font-mono text-[12px] text-foreground/55 sm:inline">
                Updated {lastUp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <RefreshButton onRefresh={load} isRefreshing={isRefreshing} />
          </div>
        }
      />

      {error && (
        <p className="mb-6 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3 text-[13px] text-red-700 dark:text-red-300">
          Couldn't load quotes. Retrying every minute.
        </p>
      )}

      <SectionHeader label="Today" />
      <div className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Breadth quotes={quotes} />
        <Sentiment quotes={quotes} />
        <VixPanel />
        <VixPanel symbol="%5EINDIAVIX" title="India VIX" sublabel="NSE India Volatility Index" gradId="mktsIndiaVix" />
      </div>

      <SectionHeader label="Sectors and movers" />
      <div className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <SectorETFs quotes={quotes} />
        <Movers quotes={quotes} side="gain" />
        <Movers quotes={quotes} side="loss" />
      </div>

      <SectionHeader
        label="Sector heatmaps"
        meta={
          <span className="flex items-center gap-2 font-mono text-[11px]">
            <span className="h-2.5 w-6 rounded-sm bg-gradient-to-r from-red-600 via-neutral-400/40 to-green-600" />
            −3% to +3%, sized by market cap
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(SECTORS) as SectorKey[]).map((key) => (
          <SectorCard key={key} sector={key} quotes={quotes} loading={loading && Object.keys(quotes).length === 0} />
        ))}
      </div>
    </div>
  );
}
