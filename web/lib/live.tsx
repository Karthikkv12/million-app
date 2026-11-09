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
    const rc = b?.regular_close ?? h.regular_close;
    const ext = b?.session && b.session !== "regular" && px != null && rc ? (px / rc - 1) * 100 : null;
    return {
      ...h, price: px, prev_close: prev, market_value: mv, unrealized: u,
      unrealized_pct: px != null && h.avg_cost ? px / h.avg_cost - 1 : h.unrealized_pct,
      // outside the regular session the API's day change is the last session's move (Robinhood's "Today"); the rest is ext_*
      day_change_pct: b?.day_change ?? (b?.session && b.session !== "regular" ? h.day_change_pct : px != null && prev ? px / prev - 1 : h.day_change_pct),
      session: b?.session ?? h.session, regular_close: rc, ext_change_pct: b ? ext : h.ext_change_pct,
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

export type Session = NonNullable<HedgeBook["session"]>;
export const SESSION_LABEL: Record<Session, string> = { pre: "Pre-market", regular: "Today", post: "After hours", overnight: "Overnight", closed: "Closed" };

/** The equity session the books are priced in (null when unknown, e.g. Yahoo-only). */
export function bookSession(books: HedgeBook[]): Session | null {
  return (books.find((b) => b.session)?.session as Session | undefined) ?? null;
}

type Pnl = { total: number; stocks: number; options: number };
const legPnl = (b: HedgeBook, dS: number, acc: Pnl) => {
  for (const l of b.legs) {
    if (l.kind === "stock") acc.stocks += l.quantity * dS;
    else acc.options += (l.position_delta * dS + 0.5 * l.position_gamma * dS * dS) * 100;
  }
  acc.total = acc.stocks + acc.options;
};

/**
 * P&L from the live books, like Robinhood's account header.
 * - `today`: the last regular session's move (prev_close → that session's close; during the session → live spot).
 * - `ext`: outside the regular session, the move since that close (pre-market / after hours / overnight), else null.
 * Stocks exact; options Δ·dS + ½Γ·dS² per leg at today's Greeks (an estimate; no theta / IV change).
 */
export function dayPnl(books: HedgeBook[]): (Pnl & { ext: Pnl | null; session: Session | null; closeDate: string | null }) | null {
  const today: Pnl = { total: 0, stocks: 0, options: 0 };
  const ext: Pnl = { total: 0, stocks: 0, options: 0 };
  let any = false, anyExt = false;
  const session = bookSession(books);
  for (const b of books) {
    if (b.spot == null || b.prev_close == null) continue;
    const outside = b.session != null && b.session !== "regular" && b.regular_close != null;
    any = true;
    legPnl(b, (outside ? b.regular_close! : b.spot) - b.prev_close, today);
    if (outside) { anyExt = true; legPnl(b, b.spot - b.regular_close!, ext); }
  }
  if (!any) return null;
  return { ...today, ext: anyExt ? ext : null, session, closeDate: books.find((b) => b.regular_close_date)?.regular_close_date ?? null };
}

/**
 * Live account value: cash + crypto (as synced) + stocks and options at live prices. Options are valued at each leg's live
 * mid (`mark` × contracts × 100, short = negative). Null when an option has no mark (then show the synced value).
 * Also the options' unrealized P&L vs the price they were opened at.
 */
export function liveAccount(p: BrokerPortfolio | undefined, books: HedgeBook[]): { value: number; options: number; optionsUnrealized: number } | null {
  if (!p || p.account_filter || p.cash == null) return null;
  let options = 0, optU = 0;
  for (const b of books) for (const l of b.legs) {
    if (l.kind !== "option") continue;
    if (l.mark == null) return null;
    options += l.mark * l.quantity * 100;
    if (l.avg_price != null) optU += (l.mark - l.avg_price) * l.quantity * 100;
  }
  const crypto = p.accounts.reduce((a, x) => a + (x.crypto_value ?? 0), 0);
  return { value: p.cash + crypto + (p.stock_value ?? 0) + options, options, optionsUnrealized: optU };
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
