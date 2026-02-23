"use client";
/**
 * SectorHeatmap — shows a grid of tiles for a sector's key stocks.
 * Each tile is colored green/red by daily % change.
 * Size is proportional to market cap weight (relative within the sector).
 */

import { useEffect, useState, useCallback } from "react";

interface StockTile {
  symbol: string;
  name:   string;
  weight: number; // approx market cap in $B — drives tile sizing
}

interface Quote {
  price:     number | null;
  change:    number | null;
  changePct: number | null;
}

type QuoteMap = Record<string, Quote>;

// ── Sector definitions ─────────────────────────────────────────────────────────

export type SectorKey =
  | "mag7" | "technology" | "finance" | "consumer"
  | "media" | "healthcare" | "telecom" | "energy";

export const SECTORS: Record<SectorKey, { label: string; stocks: StockTile[] }> = {
  mag7: {
    label: "Magnificent 7",
    stocks: [
      { symbol: "AAPL",  name: "Apple",     weight: 3700 },
      { symbol: "MSFT",  name: "Microsoft", weight: 3100 },
      { symbol: "NVDA",  name: "Nvidia",    weight: 2900 },
      { symbol: "AMZN",  name: "Amazon",    weight: 2300 },
      { symbol: "GOOGL", name: "Alphabet",  weight: 2200 },
      { symbol: "META",  name: "Meta",      weight: 1700 },
      { symbol: "TSLA",  name: "Tesla",     weight:  900 },
    ],
  },
  technology: {
    label: "Technology",
    stocks: [
      { symbol: "AAPL",  name: "Apple",      weight: 3700 },
      { symbol: "MSFT",  name: "Microsoft",  weight: 3100 },
      { symbol: "NVDA",  name: "Nvidia",     weight: 2900 },
      { symbol: "TSM",   name: "TSMC",       weight: 1050 },
      { symbol: "AVGO",  name: "Broadcom",   weight:  900 },
      { symbol: "ORCL",  name: "Oracle",     weight:  550 },
      { symbol: "AMD",   name: "AMD",        weight:  320 },
      { symbol: "CRM",   name: "Salesforce", weight:  300 },
      { symbol: "QCOM",  name: "Qualcomm",   weight:  190 },
      { symbol: "INTC",  name: "Intel",      weight:   90 },
    ],
  },
  finance: {
    label: "Financials",
    stocks: [
      { symbol: "BRK-B", name: "Berkshire",   weight: 1000 },
      { symbol: "JPM",   name: "JPMorgan",    weight:  720 },
      { symbol: "V",     name: "Visa",        weight:  570 },
      { symbol: "MA",    name: "Mastercard",  weight:  480 },
      { symbol: "BAC",   name: "Bank of Am.", weight:  370 },
      { symbol: "GS",    name: "Goldman",     weight:  220 },
      { symbol: "MS",    name: "Morgan St.",  weight:  210 },
      { symbol: "WFC",   name: "Wells Fargo", weight:  230 },
      { symbol: "BLK",   name: "BlackRock",   weight:  160 },
      { symbol: "PYPL",  name: "PayPal",      weight:   70 },
    ],
  },
  consumer: {
    label: "Consumer",
    stocks: [
      { symbol: "AMZN", name: "Amazon",     weight: 2300 },
      { symbol: "WMT",  name: "Walmart",    weight:  750 },
      { symbol: "COST", name: "Costco",     weight:  430 },
      { symbol: "PG",   name: "P&G",        weight:  390 },
      { symbol: "KO",   name: "Coca-Cola",  weight:  270 },
      { symbol: "PEP",  name: "PepsiCo",    weight:  200 },
      { symbol: "MCD",  name: "McDonald's", weight:  215 },
      { symbol: "NKE",  name: "Nike",       weight:  110 },
      { symbol: "SBUX", name: "Starbucks",  weight:  100 },
      { symbol: "TGT",  name: "Target",     weight:   55 },
    ],
  },
  media: {
    label: "Media & Entertainment",
    stocks: [
      { symbol: "GOOGL", name: "Alphabet",  weight: 2200 },
      { symbol: "META",  name: "Meta",      weight: 1700 },
      { symbol: "NFLX",  name: "Netflix",   weight:  430 },
      { symbol: "DIS",   name: "Disney",    weight:  200 },
      { symbol: "SPOT",  name: "Spotify",   weight:  100 },
      { symbol: "EA",    name: "EA Sports", weight:   35 },
      { symbol: "TTWO",  name: "Take-Two",  weight:   30 },
      { symbol: "WBD",   name: "WBDiscov.", weight:   25 },
      { symbol: "PARA",  name: "Paramount", weight:   10 },
    ],
  },
  healthcare: {
    label: "Healthcare",
    stocks: [
      { symbol: "LLY",  name: "Eli Lilly",  weight: 750 },
      { symbol: "UNH",  name: "UnitedHlth", weight: 450 },
      { symbol: "JNJ",  name: "J&J",        weight: 380 },
      { symbol: "ABBV", name: "AbbVie",     weight: 320 },
      { symbol: "MRK",  name: "Merck",      weight: 240 },
      { symbol: "TMO",  name: "Thermo F.",  weight: 180 },
      { symbol: "ABT",  name: "Abbott",     weight: 175 },
      { symbol: "AMGN", name: "Amgen",      weight: 165 },
      { symbol: "PFE",  name: "Pfizer",     weight: 155 },
      { symbol: "CVS",  name: "CVS",        weight:  75 },
    ],
  },
  telecom: {
    label: "Telecom",
    stocks: [
      { symbol: "TMUS",  name: "T-Mobile",  weight: 280 },
      { symbol: "VZ",    name: "Verizon",   weight: 170 },
      { symbol: "CMCSA", name: "Comcast",   weight: 155 },
      { symbol: "T",     name: "AT&T",      weight: 145 },
      { symbol: "CHTR",  name: "Charter",   weight:  50 },
    ],
  },
  energy: {
    label: "Energy",
    stocks: [
      { symbol: "XOM",  name: "ExxonMobil", weight: 520 },
      { symbol: "CVX",  name: "Chevron",    weight: 280 },
      { symbol: "COP",  name: "ConocoPhil", weight: 145 },
      { symbol: "EOG",  name: "EOG Res.",   weight:  65 },
      { symbol: "SLB",  name: "SLB",        weight:  60 },
      { symbol: "MPC",  name: "Marathon",   weight:  50 },
      { symbol: "PSX",  name: "Phillips66", weight:  45 },
      { symbol: "OXY",  name: "Occidental", weight:  45 },
    ],
  },
};

// ── Color helpers ──────────────────────────────────────────────────────────────

function pctColor(pct: number | null): string {
  if (pct == null) return "bg-gray-800/60 text-gray-400";
  if (pct >  4)  return "bg-green-700 text-white";
  if (pct >  2)  return "bg-green-600 text-white";
  if (pct >  0.5)return "bg-green-500/80 text-white";
  if (pct > -0.5)return "bg-gray-700/60 text-gray-300";
  if (pct > -2)  return "bg-red-500/80 text-white";
  if (pct > -4)  return "bg-red-600 text-white";
  return              "bg-red-700 text-white";
}

function borderColor(pct: number | null): string {
  if (pct == null) return "border-gray-700/30";
  if (pct > 0.5)  return "border-green-500/30";
  if (pct < -0.5) return "border-red-500/30";
  return "border-gray-600/30";
}

// ── Quote fetching ─────────────────────────────────────────────────────────────

async function fetchQuotes(symbols: string[]): Promise<QuoteMap> {
  // fetch in batches of 20 to stay within backend limit
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

// ── Single sector heatmap card ────────────────────────────────────────────────

interface Props {
  sector:   SectorKey;
  quotes:   QuoteMap;
  loading?: boolean;
}

/**
 * Split stocks into N balanced rows by weight, then assign each stock
 * a percentage width = its share of that row's total weight.
 * This guarantees multi-row layout with proportional tiles per row.
 */
function toBalancedRows(
  stocks: StockTile[],
  targetRows = 3,
): { stock: StockTile; widthPct: number }[][] {
  const total = stocks.reduce((s, x) => s + x.weight, 0);
  const targetPer = total / targetRows;

  const rows: StockTile[][] = [];
  let cur: StockTile[] = [];
  let curSum = 0;

  for (let i = 0; i < stocks.length; i++) {
    const s = stocks[i];
    cur.push(s);
    curSum += s.weight;
    const remaining = stocks.length - i - 1;
    const rowsLeft = targetRows - rows.length - 1;
    // Flush row when we've hit target weight OR must flush to have enough rows
    if (
      (curSum >= targetPer * 0.85 && remaining >= rowsLeft) ||
      rowsLeft === 0
    ) {
      rows.push(cur);
      cur = [];
      curSum = 0;
    }
  }
  if (cur.length) {
    if (rows.length > 0) rows[rows.length - 1].push(...cur);
    else rows.push(cur);
  }

  return rows.map((row) => {
    const rowTotal = row.reduce((s, x) => s + x.weight, 0);
    return row.map((stock) => ({
      stock,
      widthPct: (stock.weight / rowTotal) * 100,
    }));
  });
}

export function SectorCard({ sector, quotes, loading }: Props) {
  const { label, stocks } = SECTORS[sector];
  const totalWeight = stocks.reduce((s, x) => s + x.weight, 0);

  const changes = stocks
    .map((s) => quotes[s.symbol]?.changePct)
    .filter((v): v is number => v != null);
  const avgChange = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null;

  // Use 3 rows for sectors with ≥7 stocks, 2 rows for smaller sectors
  const targetRows = stocks.length >= 7 ? 3 : 2;
  const rows = toBalancedRows(stocks, targetRows);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-3 sm:p-4 flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
        {avgChange != null && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pctColor(avgChange)}`}>
            {avgChange >= 0 ? "+" : ""}{avgChange.toFixed(2)}%
          </span>
        )}
      </div>

      {/* Heatmap rows — each row fills 100% width, tiles sized by weight share */}
      <div className="flex flex-col gap-[2px]">
        {rows.map((row, ri) => {
          // Row height proportional to this row's weight vs total
          const rowWeight = row.reduce((s, x) => s + x.stock.weight, 0);
          const rowH = Math.max(32, Math.round((rowWeight / totalWeight) * 160));
          return (
            <div key={ri} className="flex gap-[2px]" style={{ height: `${rowH}px` }}>
              {row.map(({ stock, widthPct }) => {
                const q   = quotes[stock.symbol];
                const pct = q?.changePct ?? null;
                const big = widthPct >= 28;
                const med = widthPct >= 14;
                return (
                  <div
                    key={stock.symbol}
                    title={`${stock.name} (${stock.symbol})\n${pct != null ? (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%" : "—"}\n${q?.price != null ? "$" + q.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}`}
                    style={{ width: `${widthPct}%` }}
                    className={`flex-shrink-0 rounded-md border flex flex-col justify-center items-center overflow-hidden cursor-default transition-all hover:brightness-110 hover:scale-[1.02] ${
                      pctColor(pct)} ${borderColor(pct)} ${loading ? "animate-pulse" : ""}`}
                  >
                    <p className={`font-bold leading-none truncate w-full text-center px-0.5 ${
                      big ? "text-[10px]" : med ? "text-[9px]" : "text-[8px]"
                    }`}>{stock.symbol}</p>
                    {pct != null ? (
                      <p className={`font-semibold leading-none mt-0.5 ${
                        big ? "text-[9px]" : med ? "text-[8px]" : "text-[7px]"
                      }`}>
                        {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                      </p>
                    ) : (
                      <p className="text-[7px] opacity-40">—</p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Full heatmap grid (all sectors) ───────────────────────────────────────────

export default function SectorHeatmaps() {
  const [quotes, setQuotes]   = useState<QuoteMap>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLast]= useState<Date | null>(null);
  const [error, setError]     = useState(false);

  const allSymbols = Array.from(
    new Set(Object.values(SECTORS).flatMap((s) => s.stocks.map((x) => x.symbol)))
  );

  const load = useCallback(async () => {
    try {
      setError(false);
      const map = await fetchQuotes(allSymbols);
      setQuotes(map);
      setLast(new Date());
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

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Sector Heatmaps</p>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] text-gray-400">
              {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button onClick={load} className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold transition">↻ Refresh</button>
        </div>
      </div>
      {error && <p className="text-xs text-red-400 mb-2">Could not load quote data — will retry automatically.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        {(Object.keys(SECTORS) as SectorKey[]).map((key) => (
          <SectorCard key={key} sector={key} quotes={quotes} loading={loading && Object.keys(quotes).length === 0} />
        ))}
      </div>
    </div>
  );
}
