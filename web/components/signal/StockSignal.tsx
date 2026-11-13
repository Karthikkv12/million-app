"use client";
/** The desk's signal on the stock page, for any ticker: Enter / Wait / Don't enter, or Add / Hold / Roll when held. */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchStockSignal, StockSignal as StockSignalT } from "@/lib/api";
import { SignalBadge } from "./SignalBadge";

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
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2" data-testid="stock-signal">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/45">Signal</span>
      <SignalBadge signal={g} label={data.label} reasons={data.reasons} />
      <span className="min-w-0 truncate text-[12.5px] text-foreground/65">{g.headline}</span>
      {data.held === "long_options" && <Link href="/hedge" className="text-[12px] text-accent hover:underline">On your Hedge desk</Link>}
    </span>
  );
}
