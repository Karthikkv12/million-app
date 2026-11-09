"use client";
/**
 * Live layer (owner, 2026-11-08: "it must update just like Robinhood").
 *
 * One SSE connection for the whole app (mounted in the (app) shell) writes the hedge books into
 * react-query every second. Every page reads prices from those books:
 * - `useLiveBooks()`      the books (spot, day change, net delta, beta …), 1 s while connected
 * - `useLivePortfolio()`  the broker portfolio with each holding re-priced from the live spot
 * - `dayPnl(books)`       today's P&L: stocks exact, options delta + gamma estimate
 * - `<Tick>`              flashes green / red when its value moves, like a broker app
 *
 * The stream pauses while the tab is hidden and resumes when it's visible again.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { fetchHedgeBooks, HedgeBook, HedgeBooks, BrokerPortfolio } from "@/lib/api";
import { useHedgeStream } from "@/lib/useHedgeStream";
import { useAuth } from "@/lib/auth";

const LiveCtx = createContext(false);

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const live = useHedgeStream();
  return <LiveCtx.Provider value={live}>{children}</LiveCtx.Provider>;
}

/** Is the 1-second stream connected? */
export const useLive = () => useContext(LiveCtx);

export function useLiveBooks(enabled = true) {
  const live = useLive();
  return useQuery<HedgeBooks>({ queryKey: ["hedge-books"], queryFn: fetchHedgeBooks, refetchInterval: live ? false : 15_000, enabled });
}

export const okBooks = (d?: HedgeBooks | null): HedgeBook[] => (d?.books ?? []).filter((b) => !b.error);

/** Holdings re-priced from the live books; totals re-summed. Anything without a live spot is left as is. */
export function overlayPortfolio(p: BrokerPortfolio | undefined, books: HedgeBook[]): BrokerPortfolio | undefined {
  if (!p) return p;
  const spot = new Map(books.filter((b) => b.spot != null).map((b) => [b.symbol, b]));
  if (!spot.size) return p;
  let stock = 0, unreal = 0, anyStock = false, anyUnreal = false;
  const holdings = p.holdings.map((h) => {
    const b = spot.get(h.symbol);
    const px = b?.spot ?? h.price;
    const prev = b?.prev_close ?? h.prev_close;
    const mv = px != null ? px * h.shares : h.market_value;
    const u = px != null && h.avg_cost != null ? (px - h.avg_cost) * h.shares : h.unrealized;
    if (mv != null) { stock += mv; anyStock = true; }
    if (u != null) { unreal += u; anyUnreal = true; }
    return {
      ...h, price: px, prev_close: prev, market_value: mv, unrealized: u,
      unrealized_pct: px != null && h.avg_cost ? px / h.avg_cost - 1 : h.unrealized_pct,
      day_change_pct: px != null && prev ? px / prev - 1 : h.day_change_pct,
    };
  });
  const total = stock || 0;
  const withWeights = holdings.map((h) => ({ ...h, weight: total && h.market_value != null ? h.market_value / total : h.weight }));
  const options = p.options.map((o) => {
    const px = spot.get(o.symbol)?.spot;
    if (px == null) return o;
    const dist = px / o.strike - 1;
    const itm = o.option_type === "call" ? px > o.strike : px < o.strike;
    return { ...o, spot: px, distance_pct: dist, moneyness: Math.abs(dist) < 0.005 ? "ATM" as const : itm ? "ITM" as const : "OTM" as const };
  });
  return { ...p, holdings: withWeights, options, stock_value: anyStock ? stock : p.stock_value, unrealized: anyUnreal ? unreal : p.unrealized };
}

/** The broker portfolio query, re-priced every second from the live books. */
export function useLivePortfolio(data: BrokerPortfolio | undefined): BrokerPortfolio | undefined {
  const { data: books } = useLiveBooks();
  return useMemo(() => overlayPortfolio(data, okBooks(books)), [data, books]);
}

/**
 * Today's P&L from the live books, vs the previous close.
 * Stocks: shares × (spot − prev close), exact. Options: Δ·dS + ½Γ·dS² per leg at today's Greeks (an estimate;
 * theta and IV changes are not in it).
 */
export function dayPnl(books: HedgeBook[]): { total: number; stocks: number; options: number } | null {
  let stocks = 0, options = 0, any = false;
  for (const b of books) {
    if (b.spot == null || b.prev_close == null) continue;
    const dS = b.spot - b.prev_close;
    any = true;
    for (const l of b.legs) {
      if (l.kind === "stock") stocks += l.quantity * dS;
      else options += (l.position_delta * dS + 0.5 * l.position_gamma * dS * dS) * 100;
    }
  }
  return any ? { total: stocks + options, stocks, options } : null;
}

/**
 * Beta-weighted book: Σ βᵢ × delta-dollarsᵢ, and the portfolio beta = that ÷ Σ |delta-dollars|.
 * Delta-dollars = net Δ (lots) × 100 × spot, so short calls lower a stock's weight.
 */
export function bookBeta(books: HedgeBook[]): { beta: number | null; betaDollars: number; deltaDollars: number } {
  let bd = 0, dd = 0;
  for (const b of books) {
    if (b.beta == null || b.spot == null || b.net_delta == null) continue;
    const d = b.net_delta * 100 * b.spot;
    bd += b.beta * d;
    dd += d;
  }
  return { beta: dd ? bd / dd : null, betaDollars: bd, deltaDollars: dd };
}

/** Wraps a live number: flashes green when it goes up, red when it goes down. */
export function Tick({ value, children, className }: { value: number | null | undefined; children: React.ReactNode; className?: string }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p == null || value == null || p === value) return;
    setDir(value > p ? "up" : "down");
    const t = setTimeout(() => setDir(null), 700);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span className={clsx("rounded-[3px] transition-colors duration-700", dir === "up" && "bg-gain/15", dir === "down" && "bg-loss/15", className)}>
      {children}
    </span>
  );
}

/** How many short options are worth buying back right now (for the nav badge). */
export function useBuybackCount(): number {
  const { user } = useAuth();                      // the landing page shares the top bar: no book when signed out
  const { data } = useLiveBooks(!!user);
  return okBooks(data).reduce((a, b) => a + (b.closes?.length ?? 0), 0);
}

/** Small red count badge. */
export function CountBadge({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span aria-label={`${n} to buy back`} title={`${n} option${n > 1 ? "s" : ""} to buy back`}
      className={clsx("inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-loss px-1 font-mono text-[9.5px] font-semibold leading-none text-white", className)}>
      {n}
    </span>
  );
}
