"use client";
import { useQuery } from "@tanstack/react-query";

export interface Quote {
  symbol: string; price: number | null; prev_close: number | null; change: number | null; change_pct: number | null;
  /** Outside the regular session: change / change_pct = the last session's move; ext_* = the move since its close. */
  session?: "pre" | "regular" | "post" | "overnight" | "closed" | null;
  regular_close?: number | null; ext_change?: number | null; ext_change_pct?: number | null;
}

/** Short label for an extended-hours move, or null during the regular session / without data. */
export const EXT_SHORT: Record<string, string> = { pre: "pre", post: "AH", overnight: "night", closed: "AH" };
export function extMove(session?: string | null, pctValue?: number | null): { label: string; pct: number } | null {
  if (!session || session === "regular" || pctValue == null) return null;
  return { label: EXT_SHORT[session] ?? session, pct: pctValue };
}

async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += 20) batches.push(symbols.slice(i, i + 20));
  const results = await Promise.allSettled(batches.map(async (b) => {
    const res = await fetch(`/api/v1/market/quotes?symbols=${encodeURIComponent(b.join(","))}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Quote fetch failed");
    return (await res.json()) as Quote[];
  }));
  for (const r of results) if (r.status === "fulfilled") for (const q of r.value) out[q.symbol] = q;
  if (!Object.keys(out).length) throw new Error("Quote fetch failed");
  return out;
}

/** Quotes for a fixed symbol list, refreshed every 5 s while the page is visible (Public prices are real-time). */
export function useQuotes(symbols: string[], every = 5_000) {
  return useQuery({ queryKey: ["quotes", symbols.join(",")], queryFn: () => fetchQuotes(symbols), refetchInterval: every, staleTime: every / 2 });
}
