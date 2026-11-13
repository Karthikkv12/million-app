"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronLeft, Zap } from "lucide-react";
import { fetchGex, GexResult } from "@/lib/api";
import { useGexStream } from "@/lib/useGexStream";
import TradingChart from "@/components/chart/TradingChart";
import TickerSearchInput from "@/components/TickerSearchInput";
import { Panel, Pill } from "@/components/ui";
import { GexReplay } from "@/components/options-flow/GexReplay";
import { DealerLadder, TradeIdeas } from "@/components/options-flow/DealerLadder";
import { SwingCharts } from "@/components/insight/SwingCharts";
import { LeapsScore } from "@/components/insight/LeapsScore";
import { PoliticalCard } from "@/components/insight/PoliticalCard";
import { VolumeCard } from "@/components/insight/VolumeCard";
import { SourceBadge, sourceName } from "@/components/options-flow/SourceBadge";
import { TickerLogo } from "@/components/TickerLogo";
import { SwipeDeck } from "@/components/SwipeDeck";

const usd = (v?: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const bigUsd = (v?: number | null) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "+";
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : `${s}$${(a / 1e6).toFixed(0)}M`;
};

export default function StockPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = decodeURIComponent(symbol).toUpperCase();
  const router = useRouter();
  const [q, setQ] = useState("");

  const gexLive = useGexStream(sym);
  const { data: gex, isLoading: gexLoading } = useQuery<GexResult>({
    queryKey: ["gex", sym],
    queryFn: () => fetchGex(sym),
    staleTime: 30_000,
    refetchInterval: gexLive ? false : 30_000,
  });

  const longGamma = (gex?.net_gex ?? 0) >= 0;
  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 pb-16 pt-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground"><ChevronLeft size={16} /> Back</button>
        <TickerSearchInput value={q} onChange={setQ} onSelect={(s) => router.push(`/stocks/${encodeURIComponent(s.trim().toUpperCase())}`)} placeholder="Open another ticker" actionLabel="Open" className="w-full sm:w-80" />
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />Stock</p>
          <h1 className="flex items-center gap-3 font-mono text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-[40px]"><TickerLogo symbol={sym} size={40} />{sym}</h1>
          {gex && !gex.error && <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[15px] text-foreground/60">{usd(gex.spot)} <SourceBadge data={gex} />{gex.stale && (
            <span className="text-[12px] text-foreground/40">{sourceName(gex)} is rate-limiting; levels from {gex.as_of ? new Date(gex.as_of).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "earlier"}</span>
          )}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/options-flow?ticker=${sym}`} className="btn-ghost h-10"><Zap size={15} /> Flow board</Link>
          <Link href={`/catalyst/${sym}`} className="btn-ghost h-10"><CalendarClock size={15} /> Catalysts</Link>
        </div>
      </div>

      {/* Pulse chart across the full width: dealer levels are layers inside it (Layers menu). */}
      <section aria-label={`${sym} chart`} className="mb-4">
        <TradingChart symbol={sym} gex={gex} initialPeriod="5D" height={520}
          onSymbol={(s) => router.push(`/stocks/${encodeURIComponent(s)}`)} />
      </section>

      {/* Left: drawdown and GEX replay stacked. Right (wide screens): LEAPS score and dealer levels share one
          slot you swipe between; it stays in view, and each card scrolls on its own if it is taller than the screen. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-4">
        <Panel title="Drawdown and upside spikes">
          <SwingCharts symbol={sym} title={`How far ${sym} falls from its highs and jumps off its lows`} height={190} />
        </Panel>

        <Panel title="Volume" sub={<span className="normal-case tracking-normal">Is today unusual for {sym}?</span>}>
          <VolumeCard symbol={sym} optionsVolume={gex && !gex.error ? gex.total_volume : null} />
        </Panel>

        <GexReplay symbol={sym} />

        <section id="political" className="scroll-mt-24">
          <Panel title="Political influence" sub={<span className="normal-case tracking-normal">Congress trades · lobbying · federal contracts</span>}>
            <PoliticalCard symbol={sym} />
          </Panel>
        </section>
        </div>
        <aside className="min-w-0 xl:sticky xl:top-20">
          <SwipeDeck label={`${sym} LEAPS score and dealer levels`}
            slideClassName="xl:max-h-[calc(100dvh-8.5rem)] xl:overflow-y-auto xl:overscroll-contain xl:rounded-2xl [scrollbar-width:thin]"
            slides={[
              { key: "leaps", label: "LEAPS", node: (
                <Panel title="LEAPS score">
                  <LeapsScore symbol={sym} compact label={false} />
                </Panel>
              ) },
              { key: "dealer", label: "Dealers", node: (
                <Panel title="Dealer levels" actions={gex && !gex.error ? <Pill tone={longGamma ? "good" : "warn"} className="normal-case tracking-normal">{longGamma ? "+GEX · pinned" : "−GEX · volatile"}</Pill> : null}>
                  {gexLoading ? <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div>
                    : !gex || gex.error ? <p className="text-[13px] text-foreground/60">No options data for {sym}.</p> : (
                      <>
                        <DealerLadder data={gex} className="!px-0 !pt-0" />
                        <TradeIdeas data={gex} collapsible className="!px-0 border-t border-[var(--border)]" />
                        <div className="mt-3 flex items-baseline justify-between border-t border-[var(--border)] pt-3">
                          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Net GEX</span>
                          <span className={`font-mono text-[15px] tabular-nums ${longGamma ? "text-gain" : "text-loss"}`}>{bigUsd(gex.net_gex)}</span>
                        </div>
                        <p className="mt-3 text-[12px] leading-relaxed text-foreground/55">
                          {gex.zero_gamma != null && (gex.spot >= gex.zero_gamma
                            ? "Above the flip: dealers tend to sell rallies and buy dips, which dampens moves."
                            : "Below the flip: dealers tend to sell into drops and buy into rallies, which stretches moves.")}
                        </p>
                      </>
                    )}
                </Panel>
              ) },
            ]} />
        </aside>
      </div>
    </div>
  );
}
