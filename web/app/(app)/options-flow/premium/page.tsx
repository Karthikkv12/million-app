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
import { DeskPage, DeskSection } from "@/components/desk";
import { ExpiryTable, FlowMomentumChart, Premium, StrikesTable } from "@/components/options-flow";
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

  const gex = useQuery<GexResult>({ queryKey: ["gex", symbol], queryFn: () => fetchGex(symbol!), enabled: !!symbol, refetchInterval: 60_000 });
  const d = gex.data && !gex.data.error ? gex.data : null;
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

      <DeskSection label="Through the day" meta={<>Money in open calls and puts,<br />and the stock price.</>}>
        {symbol && <FlowMomentumChart key={symbol} symbol={symbol} variant="page" />}
      </DeskSection>

      <DeskSection label="How to read it">
        <ul className="grid max-w-3xl gap-2 text-[14px] leading-relaxed text-foreground/75">
          <li><b className="font-medium text-gain">Calls</b> and <b className="font-medium text-loss">puts</b>: how much the money sitting in open call and put contracts has changed since the 9:30 ET open on the 1-day view (&ldquo;Since open&rdquo;), since the first reading on longer views (&ldquo;Since start&rdquo;), or the full amount (&ldquo;Totals&rdquo;).</li>
          <li><b className="font-medium text-accent">Net</b> = calls − puts. Rising means call money is growing faster than put money (bullish tilt); falling means the opposite.</li>
          <li><b className="font-medium text-foreground">Price</b> is the stock, on the right-hand scale. Net rising while price falls (or the reverse) is the disagreement worth noticing.</li>
          <li className="text-foreground/55">It is contracts × the option&apos;s current price, so it also moves when option prices move with the stock, not only when new trades come in. Hover for exact values; click to pin a moment and measure from there.</li>
        </ul>
      </DeskSection>

      {gex.isLoading && <div className="h-40 animate-pulse border-t border-[var(--border-strong)] bg-foreground/[0.03]" />}
      {failed && !d && <p className="border-t border-[var(--border-strong)] py-6 text-[14px] text-loss">{symbol}: {failed || "no options data for this ticker."}</p>}
      {d && (
        <div className="grid border-t border-[var(--border-strong)] lg:grid-cols-2 lg:divide-x lg:divide-[var(--border)] [&_section]:px-0 lg:[&>div:first-child_section]:pr-8 lg:[&>div:last-child_section]:pl-8">
          <div className="min-w-0"><Premium d={d} /><ExpiryTable d={d} /></div>
          <div className="min-w-0"><StrikesTable d={d} /></div>
        </div>
      )}
    </DeskPage>
  );
}

export default function Page() {
  return <Suspense fallback={null}><PremiumPage /></Suspense>;
}
