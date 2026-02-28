"use client";
import { useEffect, useState, useCallback } from "react";
import { PageHeader, RefreshButton } from "@/components/ui";
import SectorHeatmaps, { SectorCard, SECTORS, SectorKey } from "@/components/markets/SectorHeatmap";
import VixPanel from "@/components/dashboard/VixPanel";
import { TrendingUp, TrendingDown, Activity, BarChart2, Minus } from "lucide-react";

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

// ── Breadth indicator ─────────────────────────────────────────────────────────

function BreadthBar({ quotes }: { quotes: QuoteMap }) {
  const vals = Object.values(quotes).map((q) => q.changePct).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const adv = vals.filter((v) => v > 0).length;
  const dec = vals.filter((v) => v < 0).length;
  const unc = vals.length - adv - dec;
  const total = vals.length;
  const advPct = (adv / total) * 100;
  const decPct = (dec / total) * 100;
  const uncPct = (unc / total) * 100;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 flex flex-col gap-3 overflow-hidden">
      <p className="text-[11px] font-bold text-foreground uppercase tracking-widest">Market Breadth</p>
      {/* Counts row — wraps on small sizes */}
      <div className="grid grid-cols-3 gap-1 text-center">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-base font-black text-green-500 leading-none">{adv}</span>
          <span className="text-[9px] font-semibold text-green-500/80 uppercase tracking-wide">Up</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-base font-black text-foreground leading-none">{unc}</span>
          <span className="text-[9px] font-semibold text-foreground/70 uppercase tracking-wide">Flat</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-base font-black text-red-500 leading-none">{dec}</span>
          <span className="text-[9px] font-semibold text-red-500/80 uppercase tracking-wide">Down</span>
        </div>
      </div>
      {/* Bar */}
      <div className="h-2.5 rounded-full overflow-hidden flex">
        <div style={{ width: `${advPct}%` }} className="bg-green-500 transition-all duration-700" />
        <div style={{ width: `${uncPct}%` }} className="bg-gray-600 transition-all duration-700" />
        <div style={{ width: `${decPct}%` }} className="bg-red-500 transition-all duration-700" />
      </div>
      <p className="text-[10px] text-foreground/70 leading-snug">
        {advPct.toFixed(0)}% advancing · {total} symbols
      </p>
    </div>
  );
}

// ── Sector ETF overview ───────────────────────────────────────────────────────

const SECTOR_ETFS = [
  { symbol: "XLK",  label: "Tech",        color: "text-violet-400" },
  { symbol: "XLF",  label: "Financials",  color: "text-blue-400"   },
  { symbol: "XLV",  label: "Healthcare",  color: "text-green-400"  },
  { symbol: "XLE",  label: "Energy",      color: "text-yellow-400" },
  { symbol: "XLC",  label: "Comm Svcs",   color: "text-pink-400"   },
  { symbol: "XLY",  label: "Consumer D.", color: "text-orange-400" },
  { symbol: "XLI",  label: "Industrials", color: "text-cyan-400"   },
  { symbol: "XLRE", label: "Real Estate", color: "text-rose-400"   },
  { symbol: "XLU",  label: "Utilities",   color: "text-teal-400"   },
  { symbol: "XLB",  label: "Materials",   color: "text-amber-400"  },
];

function SectorETFRow({ quotes }: { quotes: QuoteMap }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
      <p className="text-[11px] font-bold text-foreground uppercase tracking-widest mb-3">Sector ETFs (SPDR)</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {SECTOR_ETFS.map(({ symbol, label, color }) => {
          const q   = quotes[symbol];
          const pct = q?.changePct ?? null;
          const up  = (pct ?? 0) >= 0;
          return (
            <div key={symbol} className="flex flex-col gap-0.5 p-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              <span className={`text-[10px] font-bold ${color}`}>{symbol}</span>
              <span className="text-[9px] text-foreground/70 truncate">{label}</span>
              {pct != null ? (
                <span className={`text-xs font-bold ${up ? "text-green-500" : "text-red-500"}`}>
                  {up ? "+" : ""}{pct.toFixed(2)}%
                </span>
              ) : (
                <span className="text-xs text-foreground/50">—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Top movers table ──────────────────────────────────────────────────────────

function TopMovers({ quotes }: { quotes: QuoteMap }) {
  const sorted = Object.entries(quotes)
    .filter(([, q]) => q.changePct != null && q.price != null)
    .sort(([, a], [, b]) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
    .slice(0, 10);

  const gainers = sorted.filter(([, q]) => (q.changePct ?? 0) > 0).slice(0, 5);
  const losers  = sorted.filter(([, q]) => (q.changePct ?? 0) < 0).slice(0, 5);

  const Row = ({ sym, q, variant }: { sym: string; q: Quote; variant: "gain"|"loss" }) => (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
      <div className="flex items-center gap-2">
        <span className={`p-1 rounded-lg ${variant === "gain" ? "bg-green-500/10" : "bg-red-500/10"}`}>
          {variant === "gain"
            ? <TrendingUp size={11} className="text-green-500" />
            : <TrendingDown size={11} className="text-red-500" />}
        </span>
        <span className="text-xs font-bold text-foreground">{sym}</span>
      </div>
      <div className="text-right">
        <p className="text-xs text-foreground/70">${q.price!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        <p className={`text-xs font-bold ${variant === "gain" ? "text-green-500" : "text-red-500"}`}>
          {q.changePct! >= 0 ? "+" : ""}{q.changePct!.toFixed(2)}%
        </p>
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={13} className="text-green-500" />
          <p className="text-[11px] font-bold text-foreground uppercase tracking-widest">Top Gainers</p>
        </div>
        {gainers.length === 0
          ? <p className="text-xs text-foreground/60">No data yet</p>
          : gainers.map(([sym, q]) => <Row key={sym} sym={sym} q={q} variant="gain" />)
        }
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown size={13} className="text-red-500" />
          <p className="text-[11px] font-bold text-foreground uppercase tracking-widest">Top Losers</p>
        </div>
        {losers.length === 0
          ? <p className="text-xs text-foreground/60">No data yet</p>
          : losers.map(([sym, q]) => <Row key={sym} sym={sym} q={q} variant="loss" />)
        }
      </div>
    </div>
  );
}

// ── Fear & Greed proxy (VIX-based) ────────────────────────────────────────────

function FearGreedProxy({ quotes }: { quotes: QuoteMap }) {
  // Simple proxy: use SPY change as sentiment signal
  const spy  = quotes["SPY"]?.changePct;
  const qqq  = quotes["QQQ"]?.changePct;
  const vix  = null; // VIX fetched separately via VixPanel

  const advCount = Object.values(quotes).filter((q) => (q.changePct ?? 0) > 0).length;
  const total    = Object.values(quotes).filter((q) => q.changePct != null).length;
  const breadthScore = total > 0 ? (advCount / total) * 100 : 50;

  // Composite score 0-100 based on breadth + SPY performance
  const spyBonus = spy != null ? Math.max(-20, Math.min(20, spy * 5)) : 0;
  const score    = Math.round(Math.max(0, Math.min(100, breadthScore + spyBonus)));

  const label  = score >= 75 ? "Extreme Greed" : score >= 60 ? "Greed" : score >= 45 ? "Neutral" : score >= 30 ? "Fear" : "Extreme Fear";
  const color  = score >= 75 ? "text-green-500" : score >= 60 ? "text-green-400" : score >= 45 ? "text-yellow-400" : score >= 30 ? "text-orange-400" : "text-red-500";
  const arcPct = score;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
      <p className="text-[11px] font-bold text-foreground uppercase tracking-widest mb-1">Sentiment (Proxy)</p>
      <p className="text-[9px] text-foreground/60 mb-3">Based on breadth + SPY performance</p>
      <div className="flex items-center gap-5">
        {/* Gauge */}
        <div className="relative w-20 h-10 flex-shrink-0">
          <svg viewBox="0 0 100 50" className="w-full h-full">
            {/* Track */}
            <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#374151" strokeWidth="10" strokeLinecap="round" />
            {/* Fill */}
            <path
              d={`M 10 50 A 40 40 0 0 1 90 50`}
              fill="none"
              stroke={score >= 60 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444"}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(arcPct / 100) * 125.6} 125.6`}
              className="transition-all duration-700"
            />
          </svg>
        </div>
        <div>
          <p className={`text-2xl font-black leading-none ${color}`}>{score}</p>
          <p className={`text-xs font-bold mt-0.5 ${color}`}>{label}</p>
          {spy != null && <p className="text-[10px] text-foreground/70 mt-1">SPY {spy >= 0 ? "+" : ""}{spy.toFixed(2)}%</p>}
        </div>
      </div>
    </div>
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
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto w-full overflow-x-hidden">
      <PageHeader
        title="Markets"
        sub="Live quotes, sector heatmaps & volatility."
        action={
          <div className="flex items-center gap-2">
            <RefreshButton onRefresh={load} isRefreshing={isRefreshing} />
            {lastUp && (
              <span className="text-[10px] text-foreground/70 hidden sm:inline">
                Updated {lastUp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        }
      />

      {error && <p className="text-xs text-red-400 mb-4">Could not load market data — retrying automatically.</p>}

      {/* ── Volatility + Sentiment row ─────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <VixPanel />
        <VixPanel
          symbol="%5EINDIAVIX"
          title="India VIX"
          sublabel="NSE India Volatility Index"
          gradId="mktsIndiaVix"
        />
        <FearGreedProxy quotes={quotes} />
        <BreadthBar quotes={quotes} />
      </div>

      {/* ── Sector ETFs ────────────────────────────────────────── */}
      <div className="mb-6 sm:mb-8">
        <SectorETFRow quotes={quotes} />
      </div>

      {/* ── Top movers ─────────────────────────────────────────── */}
      <div className="mb-6 sm:mb-8">
        <p className="text-[11px] font-bold text-foreground uppercase tracking-widest mb-3">Top Movers</p>
        <TopMovers quotes={quotes} />
      </div>

      {/* ── Sector heatmaps ────────────────────────────────────── */}
      <div className="mb-6 sm:mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
          {(Object.keys(SECTORS) as SectorKey[]).map((key) => (
            <SectorCard
              key={key}
              sector={key}
              quotes={quotes}
              loading={loading && Object.keys(quotes).length === 0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
