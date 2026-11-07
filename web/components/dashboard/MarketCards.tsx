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
import { Change, Pill, SectionHeader } from "@/components/ui";

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
  { symbol: "SPY",     label: "S&P 500",     sublabel: "SPY",     accent: "bg-blue-50 dark:bg-blue-900/30",    iconColor: "text-blue-500"   },
  { symbol: "QQQ",     label: "Nasdaq 100",  sublabel: "QQQ",     accent: "bg-slate-50 dark:bg-slate-800/40",    iconColor: "text-slate-400"  },
  { symbol: "IWM",     label: "Russell 2000",sublabel: "IWM",     accent: "bg-orange-50 dark:bg-orange-900/30",iconColor: "text-orange-500" },
  { symbol: "BTC-USD", label: "Bitcoin",     sublabel: "BTC/USD", accent: "bg-amber-50 dark:bg-amber-900/30",  iconColor: "text-amber-500"  },
];

const FUTURES: Instrument[] = [
  { symbol: "ES=F",    label: "S&P 500",     sublabel: "ES Futures",  accent: "bg-blue-50 dark:bg-blue-900/30",    iconColor: "text-blue-500"   },
  { symbol: "NQ=F",    label: "Nasdaq 100",  sublabel: "NQ Futures",  accent: "bg-slate-50 dark:bg-slate-800/40",    iconColor: "text-slate-400"  },
  { symbol: "RTY=F",   label: "Russell 2000",sublabel: "RTY Futures", accent: "bg-orange-50 dark:bg-orange-900/30",iconColor: "text-orange-500" },
  { symbol: "BTC-USD", label: "Bitcoin",     sublabel: "BTC/USD",     accent: "bg-amber-50 dark:bg-amber-900/30",  iconColor: "text-amber-500"  },
];

const COMMODITIES: Instrument[] = [
  { symbol: "GC=F",  label: "Gold",        sublabel: "USD / oz",  accent: "bg-yellow-50 dark:bg-yellow-900/30",  iconColor: "text-yellow-500"  },
  { symbol: "SI=F",  label: "Silver",      sublabel: "USD / oz",  accent: "bg-slate-50 dark:bg-slate-800/40",    iconColor: "text-slate-400"   },
  { symbol: "CL=F",  label: "Crude Oil",   sublabel: "WTI USD/bbl",accent: "bg-[var(--surface-2)]",     iconColor: "text-foreground/70"    },
  { symbol: "NG=F",  label: "Nat Gas",     sublabel: "USD / MMBtu",accent: "bg-sky-50 dark:bg-sky-900/30",       iconColor: "text-sky-500"     },
  { symbol: "HG=F",  label: "Copper",      sublabel: "USD / lb",  accent: "bg-orange-50 dark:bg-orange-900/30", iconColor: "text-orange-400"  },
];

const INDIA: Instrument[] = [
  { symbol: "^NSEI",    label: "Nifty 50",    sublabel: "NSE India",    accent: "bg-blue-50 dark:bg-blue-900/30",     iconColor: "text-blue-500"    },
  { symbol: "^BSESN",   label: "Sensex",      sublabel: "BSE India",    accent: "bg-orange-50 dark:bg-orange-900/30", iconColor: "text-orange-500"  },
  { symbol: "^NSEBANK", label: "Bank Nifty",  sublabel: "NSE Banking",  accent: "bg-slate-50 dark:bg-slate-800/40", iconColor: "text-slate-400"  },
  { symbol: "INR=X",    label: "INR / USD",   sublabel: "Spot Rate",    accent: "bg-emerald-50 dark:bg-emerald-900/30",iconColor: "text-gain" },
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
  const pct = quote?.changePct ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--border-strong)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-foreground">{inst.label}</p>
          <p className="truncate font-mono text-[11px] uppercase tracking-[0.1em] text-foreground/50">{inst.sublabel}</p>
        </div>
        {/* tiny direction bar: how big today's move is, capped at 3% */}
        {pct != null && (
          <span className="mt-1 flex h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden>
            <span
              className={pct >= 0 ? "bg-gain" : "bg-loss"}
              style={{ width: `${Math.min(Math.abs(pct) / 3, 1) * 100}%`, marginLeft: pct >= 0 ? 0 : "auto" }}
            />
          </span>
        )}
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="skeleton h-7 w-28 rounded-lg" />
          <div className="skeleton h-4 w-20 rounded-lg" />
        </div>
      ) : quote?.price == null ? (
        <p className="font-mono text-2xl text-foreground/40">—</p>
      ) : (
        <div className="grid gap-1">
          <p className="font-mono text-[22px] font-medium leading-none tracking-tight tabular-nums text-foreground">
            {fmtPrice(inst.symbol, quote.price)}
          </p>
          <Change value={quote.change} pct={quote.changePct} />
        </div>
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
      const allSymbols = [...instruments.map((i) => i.symbol), ...INDIA.map((i) => i.symbol), ...COMMODITIES.map((i) => i.symbol)];
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

  const updated = lastUpdated?.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mb-10 grid gap-8">
      {error && (
        <p className="rounded-xl border border-loss/25 bg-loss/[0.06] px-4 py-3 text-[13px] text-loss">
          Couldn't load market data. Retrying every 30 seconds.
        </p>
      )}
      <section>
        <SectionHeader
          label={futures ? "US index futures" : "US indexes"}
          meta={<>
            <Pill tone={futures ? "warn" : "good"} dot>{futures ? "Futures session" : "Regular session"}</Pill>
            {updated && <span className="hidden font-mono text-[11px] sm:inline">{updated}</span>}
          </>}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {instruments.map((inst) => <QuoteCard key={inst.symbol} inst={inst} quote={quotes[inst.symbol]} />)}
        </div>
      </section>
      <section>
        <SectionHeader label="India" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {INDIA.map((inst) => <QuoteCard key={inst.symbol} inst={inst} quote={quotes[inst.symbol]} />)}
        </div>
      </section>
      <section>
        <SectionHeader label="Commodities" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {COMMODITIES.map((inst) => <QuoteCard key={inst.symbol} inst={inst} quote={quotes[inst.symbol]} />)}
        </div>
      </section>
    </div>
  );
}
