"use client";
/**
 * TickerLink — every ticker shown anywhere in the app opens its stock page (/stocks/<SYM>).
 *
 * - Keeps the text styling of wherever it sits (inherits colour and font); adds only a hover underline.
 * - Index quotes like "^SPX" / "^VIX" go to /stocks/SPX, which is how the rest of the app names them.
 * - Inside a clickable row or tile (a button that expands it, a card that opens something else) the click
 *   stops there: it opens the stock page and doesn't also toggle the row. Nest it in a <button>/<div>, never
 *   inside another <a>; for a row that is itself a link, use `stockHref` on a sibling instead.
 */
import Link from "next/link";
import { clsx } from "clsx";

export const stockHref = (symbol: string) => `/stocks/${encodeURIComponent(symbol.replace(/^\^/, "").trim().toUpperCase())}`;

export function TickerLink({ symbol, children, className, title }: {
  symbol: string; children?: React.ReactNode; className?: string; title?: string;
}) {
  if (!symbol) return <>{children}</>;
  return (
    <Link href={stockHref(symbol)} title={title ?? `Open ${symbol.replace(/^\^/, "")}`}
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
      className={clsx("cursor-pointer decoration-1 underline-offset-[3px] hover:underline", className)}>
      {children ?? symbol}
    </Link>
  );
}
