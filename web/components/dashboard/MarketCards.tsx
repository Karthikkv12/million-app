"use client";
/**
 * MarketCards — live quote cards for the 4 key indices.
 *
 * Session logic (all times US/Eastern):
 *   Regular session  : Mon–Fri 09:30–16:00  → show equities  (SPY / QQQ / IWM / BTC-USD)
 *   Futures session  : Mon–Fri 18:00–09:30  → show futures   (ES=F / NQ=F / RTY=F / BTC-USD)
 *                      Sat / Sun all day     → show futures
 *
 * Prices are fetched from Yahoo Finance's public JSON endpoint (no key needed).
 * Refreshes every 30 s while the tab is visible.
 */

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// ── Session helpers ────────────────────────────────────────────────────────────

function nowET(): Date {
  // Returns a Date object whose getHours/getMinutes reflect US Eastern time
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function isFuturesSession(): boolean {
  const et = nowET();
  const day = et.getDay(); // 0=Sun 1=Mon … 6=Sat
  const h = et.getHours();
  const m = et.getMinutes();
  const mins = h * 60 + m; // minutes since midnight ET

  const REGULAR_OPEN  = 9 * 60 + 30;   // 09:30
  const REGULAR_CLOSE = 16 * 60;        // 16:00
  const FUTURES_OPEN  = 18 * 60;        // 18:00

  if (day === 0 || day === 6) return true;                      // weekend → futures
  if (mins >= REGULAR_OPEN && mins < REGULAR_CLOSE) return false; // regular hours
  if (mins >= FUTURES_OPEN) return true;                         // evening futures
  return true;                                                   // pre-market → futures
}

// ── Instrument definitions ─────────────────────────────────────────────────────

interface Instrument {
  symbol: string;
  label: string;
  sublabel: string;
  accent: string; // tailwind bg class for the icon bubble
  iconColor: string;
}

const EQUITY: Instrument[] = [
  { symbol: "SPY",     label: "S&P 500",     sublabel: "SPY",       accent: "bg-blue-50 dark:bg-blue-900/30",    iconColor: "text-blue-500"   },
  { symbol: "QQQ",     label: "Nasdaq 100",  sublabel: "QQQ",       accent: "bg-violet-50 dark:bg-violet-900/30",iconColor: "text-violet-500" },
  { symbol: "IWM",     label: "Russell 2000",sublabel: "IWM",       accent: "bg-orange-50 dark:bg-orange-900/30",iconColor: "text-orange-500" },
  { symbol: "BTC-USD", label: "Bitcoin",     sublabel: "BTC/USD",   accent: "bg-amber-50 dark:bg-amber-900/30",  iconColor: "text-amber-500"  },
  { symbol: "GC=F",    label: "Gold",        sublabel: "Spot USD/oz",accent: "bg-yellow-50 dark:bg-yellow-900/30",iconColor: "text-yellow-500" },
];

const FUTURES: Instrument[] = [
  { symbol: "ES=F",    label: "S&P 500",     sublabel: "ES Futures",  accent: "bg-blue-50 dark:bg-blue-900/30",    iconColor: "text-blue-500"   },
  { symbol: "NQ=F",    label: "Nasdaq 100",  sublabel: "NQ Futures",  accent: "bg-violet-50 dark:bg-violet-900/30",iconColor: "text-violet-500" },
  { symbol: "RTY=F",   label: "Russell 2000",sublabel: "RTY Futures", accent: "bg-orange-50 dark:bg-orange-900/30",iconColor: "text-orange-500" },
  { symbol: "BTC-USD", label: "Bitcoin",     sublabel: "BTC/USD",     accent: "bg-amber-50 dark:bg-amber-900/30",  iconColor: "text-amber-500"  },
  { symbol: "GC=F",    label: "Gold",        sublabel: "Spot USD/oz",  accent: "bg-yellow-50 dark:bg-yellow-900/30",iconColor: "text-yellow-500" },
];

const INDIA: Instrument[] = [
  { symbol: "^NSEI",    label: "Nifty 50",    sublabel: "NSE India",    accent: "bg-blue-50 dark:bg-blue-900/30",     iconColor: "text-blue-500"    },
  { symbol: "^BSESN",   label: "Sensex",      sublabel: "BSE India",    accent: "bg-orange-50 dark:bg-orange-900/30", iconColor: "text-orange-500"  },
  { symbol: "^NSEBANK", label: "Bank Nifty",  sublabel: "NSE Banking",  accent: "bg-violet-50 dark:bg-violet-900/30", iconColor: "text-violet-500"  },
  { symbol: "INR=X",    label: "INR / USD",   sublabel: "Spot Rate",    accent: "bg-emerald-50 dark:bg-emerald-900/30",iconColor: "text-emerald-500" },
];

// ── Quote fetching ─────────────────────────────────────────────────────────────

interface Quote {
  price: number | null;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
}

type QuoteMap = Record<string, Quote>;

async function fetchQuotes(symbols: string[]): Promise<QuoteMap> {
  const joined = symbols.join(",");
  const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(joined)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Quote fetch failed");
  const rows: { symbol: string; price: number | null; prev_close: number | null; change: number | null; change_pct: number | null }[] = await res.json();
  const results: QuoteMap = {};
  for (const r of rows) {
    results[r.symbol] = {
      price:     r.price,
      change:    r.change,
      changePct: r.change_pct,
      prevClose: r.prev_close,
    };
  }
  return results;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function fmtPrice(sym: string, price: number): string {
  if (sym.includes("BTC")) {
    return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  // Indian indices (points, no currency prefix)
  if (sym === "^NSEI" || sym === "^BSESN") {
    return price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // INR/USD rate
  if (sym === "INR=X") {
    return "₹" + price.toLocaleString("en-IN", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
  // Gold futures
  if (sym === "GC=F") {
    return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtChange(v: number): string {
  return (v >= 0 ? "+" : "") + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

// ── Single card ────────────────────────────────────────────────────────────────

function QuoteCard({ inst, quote }: { inst: Instrument; quote: Quote | undefined }) {
  const loading = !quote;
  const up   = (quote?.change ?? 0) >= 0;
  const zero = quote?.change === 0;

  const ChangeIcon = zero ? Minus : up ? TrendingUp : TrendingDown;
  const colorCls   = zero
    ? "text-gray-400"
    : up
    ? "text-green-500"
    : "text-red-500";
  const bgCls = zero
    ? "bg-gray-50 dark:bg-gray-800/30"
    : up
    ? "bg-green-50 dark:bg-green-900/20"
    : "bg-red-50 dark:bg-red-900/20";

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 card-hover flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide leading-none">
            {inst.label}
          </p>
          <p className="text-[10px] text-gray-400/70 mt-0.5">{inst.sublabel}</p>
        </div>
        <span className={`p-2 rounded-xl ${inst.accent}`}>
          <ChangeIcon size={15} className={inst.iconColor} />
        </span>
      </div>

      {/* Price */}
      {loading ? (
        <div className="space-y-2">
          <div className="skeleton h-7 w-28 rounded-lg" />
          <div className="skeleton h-4 w-20 rounded-lg" />
        </div>
      ) : quote?.price == null ? (
        <p className="text-xl font-black text-gray-400">—</p>
      ) : (
        <>
          <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white leading-none">
            {fmtPrice(inst.symbol, quote.price)}
          </p>
          <div className={`inline-flex items-center gap-1.5 self-start px-2 py-1 rounded-lg ${bgCls}`}>
            <ChangeIcon size={11} className={colorCls} />
            <span className={`text-xs font-bold ${colorCls}`}>
              {fmtChange(quote.change!)} ({fmtPct(quote.changePct!)})
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function MarketCards() {
  const [futures, setFutures]   = useState(isFuturesSession());
  const [quotes, setQuotes]     = useState<QuoteMap>({});
  const [lastUpdated, setLast]  = useState<Date | null>(null);
  const [error, setError]       = useState(false);

  const instruments = futures ? FUTURES : EQUITY;

  const load = useCallback(async () => {
    try {
      setError(false);
      const allSymbols = [...instruments.map((i) => i.symbol), ...INDIA.map((i) => i.symbol)];
      const map = await fetchQuotes(allSymbols);
      setQuotes(map);
      setLast(new Date());
    } catch {
      setError(true);
    }
  }, [instruments]);

  // Re-evaluate session every minute + refresh quotes every 30s
  useEffect(() => {
    load();
    const quoteTimer   = setInterval(load, 30_000);
    const sessionTimer = setInterval(() => setFutures(isFuturesSession()), 60_000);
    return () => { clearInterval(quoteTimer); clearInterval(sessionTimer); };
  }, [load]);

  const sessionLabel = futures ? "Futures" : "Regular Session";
  const sessionColor = futures ? "text-amber-500" : "text-green-500";
  const sessionDot   = futures ? "bg-amber-400" : "bg-green-400";

  return (
    <div className="mb-6 sm:mb-8">
      {/* Row label + session badge */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Markets</p>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${sessionDot}`} />
          <span className={`text-[11px] font-semibold ${sessionColor}`}>{sessionLabel}</span>
          {lastUpdated && (
            <span className="text-[10px] text-gray-400 hidden sm:inline">
              · {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-2">Could not load market data — will retry automatically.</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {instruments.map((inst) => (
          <QuoteCard key={inst.symbol} inst={inst} quote={quotes[inst.symbol]} />
        ))}
      </div>

      {/* ── India markets row ─────────────────────────────────────────── */}
      <div className="mt-4">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">India Markets</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {INDIA.map((inst) => (
            <QuoteCard key={inst.symbol} inst={inst} quote={quotes[inst.symbol]} />
          ))}
        </div>
      </div>
    </div>
  );
}
