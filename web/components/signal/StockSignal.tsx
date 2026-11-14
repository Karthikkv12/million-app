"use client";
/** The desk's signal on the stock page, for any ticker: Buy / Wait / Don't buy yet with the prices that would change it,
 *  or Add / Hold / Don't add with the add trigger, upside and exit line when held (any form: shares, options, mixed).
 *  Under it, the swing read (1 – 4 weeks, hedge.swing): Swing buy / Wait with its trigger and exit. */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchStockSignal, StockSignal as StockSignalT } from "@/lib/api";
import { SignalBadge } from "./SignalBadge";
import { SwingBadge } from "./SwingBadge";

export function StockSignal({ symbol }: { symbol: string }) {
  const { data, isLoading, isError } = useQuery<StockSignalT>({
    queryKey: ["stock-signal", symbol],
    queryFn: () => fetchStockSignal(symbol),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  if (isLoading) return <span className="skeleton inline-block h-6 w-48 rounded" aria-label="Loading the signal" />;
  if (isError || !data || data.error || !data.signal) {
    return <span className="text-[12px] text-foreground/45">Signal unavailable{data?.error ? `: ${data.error}` : ""}</span>;
  }
  const g = data.signal;
  const sw = data.swing;
  return (
    <span className="flex min-w-0 flex-col gap-1.5" data-testid="stock-signal">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="w-[52px] shrink-0 font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/45">Signal</span>
        <SignalBadge signal={g} label={data.label} reasons={data.reasons} symbol={data.symbol} />
        <span className="min-w-0 text-[12.5px] leading-snug text-foreground/65">{g.headline}</span>
        {data.held !== "none" && <Link href="/hedge" className="text-[12px] text-accent hover:underline">On your Hedge desk</Link>}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-2" data-testid="stock-swing">
        <span className="w-[52px] shrink-0 font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/45">Swing</span>
        {sw ? (
          <>
            <SwingBadge swing={sw} symbol={data.symbol} />
            <span className="min-w-0 text-[12.5px] leading-snug text-foreground/65">{sw.reason}</span>
          </>
        ) : <span className="text-[12px] text-foreground/45">Needs 200 days of prices.</span>}
      </span>
    </span>
  );
}
