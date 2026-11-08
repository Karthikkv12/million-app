"use client";
import { useQuery } from "@tanstack/react-query";

export interface Quote { symbol: string; price: number | null; prev_close: number | null; change: number | null; change_pct: number | null }

async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  for (let i = 0; i < symbols.length; i += 20) {
    const res = await fetch(`/api/v1/market/quotes?symbols=${encodeURIComponent(symbols.slice(i, i + 20).join(","))}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Quote fetch failed");
    for (const r of (await res.json()) as Quote[]) out[r.symbol] = r;
  }
  return out;
}

/** Quotes for a fixed symbol list, refreshed every 30 s. */
export function useQuotes(symbols: string[]) {
  return useQuery({ queryKey: ["quotes", symbols.join(",")], queryFn: () => fetchQuotes(symbols), refetchInterval: 30_000, staleTime: 15_000 });
}
