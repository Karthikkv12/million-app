"use client";
/**
 * Flow → Premium: one ticker's option premium at full size. Its own ticker search (any symbol, not tied to the
 * board's columns): how call and put premium moved through the day, then where it sits by strike and expiry.
 * The ticker lives in ?s= (shareable) and is remembered for the next visit.
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import TickerSearchInput from "@/components/TickerSearchInput";
import { fetchGex, GexResult, watchSymbols } from "@/lib/api";
import { useGexStream } from "@/lib/useGexStream";
import { DeskPage, DeskSection } from "@/components/desk";
import { FlowMomentumChart } from "@/components/options-flow";
import { PremiumBreakdown } from "@/components/options-flow/PremiumBreakdown";
import { anchorOf } from "@/lib/gex";
import { useTheme } from "@/lib/theme";
import { SourceBadge } from "@/components/options-flow/SourceBadge";

const KEY = "flow_premium_ticker";
const clean = (s?: string | null) => (s ?? "").trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "").slice(0, 12);

function PremiumPage() {
  const router = useRouter();
  const fromUrl = clean(useSearchParams().get("s"));
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => { try { setRemembered(clean(localStorage.getItem(KEY)) || "SPY"); } catch { setRemembered("SPY"); } }, []);
  const symbol = fromUrl || remembered;
  const [input, setInput] = useState("");               // stays empty: the ticker on show is the heading

  const open = (s: string) => {
    const t = clean(s);
    if (!t) return;
    try { localStorage.setItem(KEY, t); } catch { /* storage off */ }
    setRemembered(t);
    setInput("");
    router.replace(`/options-flow/premium?s=${encodeURIComponent(t)}`);
  };

  // ask the backend to keep recording this ticker's flow while the page is open
  useEffect(() => {
    if (!symbol) return;
    watchSymbols([symbol]).catch(() => {});
    const id = setInterval(() => watchSymbols([symbol]).catch(() => {}), 60_000);
    return () => clearInterval(id);
  }, [symbol]);

  const gexLive = useGexStream(symbol ?? undefined);
  const gex = useQuery<GexResult>({ queryKey: ["gex", symbol], queryFn: () => fetchGex(symbol!), enabled: !!symbol, refetchInterval: gexLive ? false : 30_000 });
  const d = gex.data && !gex.data.error ? gex.data : null;
  const anchor = anchorOf(d);
  const { theme } = useTheme();
  const dark = theme === "dark";
  const failed = gex.error ? (gex.error as Error).message : gex.data?.error;

  return (
    <DeskPage>
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50">Flow · option premium</p>
          <h1 className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[28px] font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">
            {symbol ?? "…"}
            {d && <span className="font-mono text-[18px] font-normal tabular-nums text-foreground/55">{d.spot.toFixed(2)}</span>}
            {d && <SourceBadge data={d} />}
          </h1>
        </div>
        <TickerSearchInput value={input} onChange={setInput} onSelect={open} placeholder="Any ticker or company" actionLabel="Open" className="w-full sm:w-80" />
      </div>

      <DeskSection label="Through the day" meta={<>Premium traded in calls and puts,<br />and the stock price.</>}>
        {symbol && <FlowMomentumChart key={symbol} symbol={symbol} variant="page" levels={[
          { label: "⚓ Anchor", price: anchor?.price, color: dark ? "#67e8f9" : "#0e7490" },
          { label: "Flip", price: d?.zero_gamma, color: dark ? "#90bff9" : "#2f5bea" },
        ]} />}
      </DeskSection>

      <DeskSection label="How to read it">
        <ul className="grid max-w-3xl gap-2 text-[14px] leading-relaxed text-foreground/75">
          <li><b className="font-medium text-gain">Calls</b> and <b className="font-medium text-loss">puts</b>: premium traded in calls and puts since the 9:30 ET open (&ldquo;Traded today&rdquo;; longer views add the days up), or the money sitting in open contracts (&ldquo;Totals&rdquo;).</li>
          <li><b className="font-medium text-accent">Net</b> = calls − puts. Rising means call money is growing faster than put money (bullish tilt); falling means the opposite.</li>
          <li><b className="font-medium text-foreground">Price</b> is the stock, on the right-hand scale, with the ⚓ Anchor and the GEX Flip dashed on the same scale. Net rising while price falls (or the reverse) is the disagreement worth noticing.</li>
          <li className="text-foreground/55">Traded is each contract&apos;s new volume × its mid price at every refresh (nearest 12 expiries), so repricing doesn&apos;t count; it is measured from 2026-11-13 on. Totals are open contracts × the option&apos;s current price, so they also move when option prices move. Hover for exact values; click to pin a moment and measure from there.</li>
        </ul>
      </DeskSection>

      {gex.isLoading && <div className="h-40 animate-pulse border-t border-[var(--border-strong)] bg-foreground/[0.03]" />}
      {failed && !d && <p className="border-t border-[var(--border-strong)] py-6 text-[14px] text-loss">{symbol}: {failed || "no options data for this ticker."}</p>}
      {d && (
        <PremiumBreakdown d={d} />
      )}
    </DeskPage>
  );
}

export default function Page() {
  return <Suspense fallback={null}><PremiumPage /></Suspense>;
}
