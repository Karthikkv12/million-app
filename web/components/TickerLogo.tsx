"use client";
/**
 * TickerLogo — the company / fund logo as a small rounded square, next to a ticker.
 *
 * Served by our own API (/logos/<SYM>: fetched once server-side, normalised to a 64×64 tile that reads in light and
 * dark mode, cached). Where there's no logo (indexes like SPX / VIX, new listings) it shows the ticker's first
 * letter on a neutral tile of the same size, so rows stay aligned. Misses are remembered for the page's life,
 * so a re-render doesn't ask again.
 *
 * Use it where the ticker is the identity of a row or page (tables, lists, headers), not inside sentences,
 * heatmap labels or dense chips.
 */
import { useState } from "react";
import { clsx } from "clsx";
import { BASE } from "@/lib/api";

const missing = new Set<string>();
const INDEX = new Set(["SPX", "XSP", "VIX", "RUT", "NDX", "DJI", "DJX", "OEX"]);

export function TickerLogo({ symbol, size = 20, className }: { symbol: string; size?: number; className?: string }) {
  const sym = symbol.replace(/^\^/, "").trim().toUpperCase();
  const [failed, setFailed] = useState(() => !sym || missing.has(sym) || INDEX.has(sym) || symbol.startsWith("^"));
  const box = { width: size, height: size };
  const radius = Math.max(4, Math.round(size * 0.24));
  if (failed) {
    return (
      <span aria-hidden style={{ ...box, borderRadius: radius, fontSize: Math.round(size * 0.48) }}
        className={clsx("inline-flex shrink-0 select-none items-center justify-center bg-foreground/[0.08] font-sans font-semibold text-foreground/55", className)}>
        {sym.slice(0, 1)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny cached tile from our own API; next/image adds nothing here
    <img src={`${BASE}/logos/${encodeURIComponent(sym)}`} alt="" aria-hidden loading="lazy" decoding="async"
      width={size} height={size} style={{ ...box, borderRadius: radius }}
      onError={() => { missing.add(sym); setFailed(true); }}
      className={clsx("inline-block shrink-0 bg-white object-cover ring-1 ring-black/5 dark:ring-white/10", className)} />
  );
}
