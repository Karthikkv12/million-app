"use client";
/**
 * DealerLadder — the price scale from the dashboard's "SPY dealers", for any ticker on the Flow board:
 * call wall, king, flip and put wall around spot, plus four ideas placed at their strikes
 * (buy call, sell call, buy put, sell put) with their expiry.
 * TradeIdeas — the same four in full: mid, delta, break-even, how each fits the gamma regime, and why that strike.
 */
import { clsx } from "clsx";
import type { GexResult } from "@/lib/api";
import { Ladder } from "@/components/desk";

type Idea = NonNullable<GexResult["ideas"]>[number];

const KIND: Record<Idea["action"], { label: string; short: string; tone: string }> = {
  BUY_CALL: { label: "Buy call", short: "BUY C", tone: "text-gain" },
  SELL_CALL: { label: "Sell call", short: "SELL C", tone: "text-loss" },
  BUY_PUT: { label: "Buy put", short: "BUY P", tone: "text-loss" },
  SELL_PUT: { label: "Sell put", short: "SELL P", tone: "text-gain" },
};
const FIT: Record<Idea["fit"], { label: string; cls: string }> = {
  favored: { label: "fits regime", cls: "text-gain" },
  neutral: { label: "other side", cls: "text-foreground/45" },
  against: { label: "against regime", cls: "text-warn" },
};

/** "Dec 19", or "Jan 15 '27" when it isn't this year. */
function expLabel(exp: string): string {
  const d = new Date(`${exp}T12:00:00`);
  if (Number.isNaN(d.getTime())) return exp;
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.getFullYear() === new Date().getFullYear() ? md : `${md} '${String(d.getFullYear()).slice(2)}`;
}
const strike = (k: number) => (k % 1 === 0 ? k.toFixed(0) : String(k));

/** The price scale: dealer levels and the four ideas, placed by price around spot. */
export function DealerLadder({ data, height = 230, className }: { data: GexResult; height?: number; className?: string }) {
  const ideas = data.ideas ?? [];
  return (
    <div className={clsx("min-w-0 px-4 py-3", className)} role="group" aria-label={`${data.symbol} dealer ladder`}>
      <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">{data.symbol} dealers</p>
      <Ladder spot={data.spot} height={height} levels={[
        { label: "call wall", price: data.max_call_wall, tone: "text-gain" },
        { label: "★ king", price: data.max_gex_strike, tone: "text-[#b45309] dark:text-[#fde725]" },
        { label: "flip", price: data.zero_gamma, tone: "text-accent" },
        { label: "put wall", price: data.max_put_wall, tone: "text-loss" },
        ...ideas.map((i) => ({
          label: `${KIND[i.action].short} ${expLabel(i.expiry)}`, price: i.strike, strong: i.fit === "favored",
          tone: KIND[i.action].tone,
        })),
      ]} />
    </div>
  );
}

/** The four ideas in full: contract, expiry, mid, delta, break-even, fit with the regime, and why that strike. */
export function TradeIdeas({ data, className }: { data: GexResult; className?: string }) {
  const ideas = data.ideas ?? [];
  const longGamma = (data.net_gex ?? 0) >= 0;
  return (
    <div className={clsx("min-w-0 px-4 py-3", className)} role="group" aria-label={`${data.symbol} trade ideas`}>
      <p className="mb-1 flex items-baseline justify-between gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">
        <span>Ideas off the levels</span>
        <span className={longGamma ? "text-gain" : "text-warn"}>{longGamma ? "moves fade" : "moves run"}</span>
      </p>
      <p className="mb-1 text-[11.5px] leading-snug text-foreground/55">
        {longGamma ? "Long gamma: dealers fade moves, which favours selling premium at the walls."
          : "Short gamma: dealers chase moves, which favours buying on the price's side of the flip."}
      </p>
      {ideas.length === 0 ? (
        <p className="py-2 text-[12.5px] text-foreground/50">No contract with a live quote to suggest right now.</p>
      ) : (
        <ul>
          {ideas.map((i) => {
            const k = KIND[i.action];
            return (
              <li key={i.action} className={clsx("border-b border-[var(--border)] py-2 last:border-0", i.fit === "against" && "opacity-60")}>
                <div className="flex items-baseline gap-2 font-mono text-[12.5px] tabular-nums">
                  <span className={clsx("w-[76px] shrink-0 whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.1em]", k.tone)}>{k.label}</span>
                  <span className="font-medium text-foreground">{strike(i.strike)}{i.otype === "call" ? "C" : "P"}</span>
                  <span className="truncate text-foreground/70">{expLabel(i.expiry)} <span className="text-foreground/40">{i.dte}d</span></span>
                  <span className="ml-auto shrink-0 text-foreground">${i.premium.toFixed(2)}</span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-2 pl-[84px] font-mono text-[10.5px] tabular-nums text-foreground/45">
                  <span>Δ {i.delta.toFixed(2)}</span>
                  <span>b/e {i.breakeven.toFixed(2)}</span>
                  <span className={clsx("ml-auto shrink-0 uppercase tracking-[0.1em]", FIT[i.fit].cls)}>{FIT[i.fit].label}</span>
                </div>
                <p className="mt-1 pl-[84px] text-[11.5px] leading-snug text-foreground/55">{i.reason}</p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[10.5px] leading-snug text-foreground/40">Mid prices, one contract each. Read off dealer levels, not your book: the Delta desk&apos;s actions follow your strategy. Not advice.</p>
    </div>
  );
}
