"use client";
/**
 * DealerLadder — the price scale from the dashboard's "SPY dealers", for any ticker on the Flow board:
 * call wall, king, flip and put wall around spot, plus four ideas placed at their strikes
 * (buy call, sell call, buy put, sell put) with their expiry.
 * TradeIdeas — the same four in full: mid, delta, break-even, how each fits the gamma regime, and why that strike.
 */
import { useState } from "react";
import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";
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

const DIR = {
  up: { label: "Up", arrow: "↗", cls: "text-gain" },
  down: { label: "Down", arrow: "↘", cls: "text-loss" },
  sideways: { label: "Sideways", arrow: "→", cls: "text-accent" },
} as const;

/** Likely direction from the dealer map: the call, three shares of 100, and the reasons behind it. */
function DirectionRead({ o }: { o: NonNullable<GexResult["outlook"]> }) {
  const d = DIR[o.direction];
  const top = Math.max(o.up, o.down, o.sideways);
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Likely direction</p>
        <p className={clsx("font-mono text-[13px] font-medium uppercase tracking-[0.1em]", d.cls)}>{d.arrow} {d.label} <span className="text-[11px] font-normal text-foreground/45">{top}%</span></p>
      </div>
      <div className="mt-1.5 flex h-1.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`Up ${o.up}%, sideways ${o.sideways}%, down ${o.down}%`}>
        <span className="bg-gain" style={{ width: `${o.up}%` }} />
        <span className="bg-accent/70" style={{ width: `${o.sideways}%` }} />
        <span className="bg-loss" style={{ width: `${o.down}%` }} />
      </div>
      <p className="mt-1 flex justify-between font-mono text-[10.5px] tabular-nums text-foreground/50">
        <span className="text-gain">up {o.up}%</span><span className="text-accent">sideways {o.sideways}%</span><span className="text-loss">down {o.down}%</span>
      </p>
      <ul className="mt-1.5 space-y-0.5 text-[11.5px] leading-snug text-foreground/55">
        {o.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}
      </ul>
    </div>
  );
}

/** The price scale: likely direction, then dealer levels, the battleground strike, the ±1σ range and the four ideas by price. */
export function DealerLadder({ data, height = 250, className }: { data: GexResult; height?: number; className?: string }) {
  const ideas = data.ideas ?? [];
  const o = data.outlook;
  return (
    <div className={clsx("min-w-0 px-4 py-3", className)} role="group" aria-label={`${data.symbol} dealer ladder`}>
      {o && <DirectionRead o={o} />}
      <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">{data.symbol} dealers</p>
      <Ladder spot={data.spot} height={height} levels={[
        { label: "call wall", price: data.max_call_wall, tone: "text-gain" },
        { label: "★ king", price: data.max_gex_strike, tone: "text-[#b45309] dark:text-[#fde725]" },
        { label: "flip", price: data.zero_gamma, tone: "text-accent" },
        { label: "put wall", price: data.max_put_wall, tone: "text-loss" },
        { label: "⚔ battle", price: o?.battleground, tone: "text-warn", strong: true },
        { label: `+1σ ${o?.expected_dte ?? ""}d`, price: o?.expected_high, tone: "text-foreground/45" },
        { label: `−1σ ${o?.expected_dte ?? ""}d`, price: o?.expected_low, tone: "text-foreground/45" },
        ...ideas.map((i) => ({
          label: `${KIND[i.action].short} ${expLabel(i.expiry)}`, price: i.strike, strong: i.fit === "favored",
          tone: KIND[i.action].tone,
        })),
      ]} />
      {o && (o.battleground != null || o.expected_low != null) && (
        <p className="mt-2 text-[10.5px] leading-snug text-foreground/40">
          {o.battleground != null && <>⚔ Battleground {o.battleground}: calls and puts both carry heavy gamma there, so the side that wins it sets the next move. </>}
          {o.expected_low != null && o.expected_high != null && <>±1σ is the range options price in for the next {o.expected_dte} days ({o.expected_low.toFixed(2)} – {o.expected_high.toFixed(2)}).</>}
        </p>
      )}
    </div>
  );
}

/** The four ideas in full: contract, expiry, mid, delta, break-even, fit with the regime, and why that strike. */
export function TradeIdeas({ data, className, collapsible = false }: {
  data: GexResult; className?: string;
  /** Start closed behind a "4 ideas" toggle (pages where the list would make the panel long). */
  collapsible?: boolean;
}) {
  const ideas = data.ideas ?? [];
  const longGamma = (data.net_gex ?? 0) >= 0;
  const [open, setOpen] = useState(!collapsible);
  const head = (
    <>
      <span>Ideas off the levels{collapsible && ideas.length > 0 && <span className="ml-2 text-foreground/35">{ideas.length}</span>}</span>
      <span className="inline-flex items-center gap-1.5">
        <span className={longGamma ? "text-gain" : "text-warn"}>{longGamma ? "moves fade" : "moves run"}</span>
        {collapsible && <ChevronDown size={12} className={clsx("text-foreground/45 transition", open && "rotate-180")} />}
      </span>
    </>
  );
  const headCls = "mb-1 flex w-full items-baseline justify-between gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45";
  if (!open) {
    return (
      <div className={clsx("min-w-0 px-4 py-3", className)} role="group" aria-label={`${data.symbol} trade ideas`}>
        <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className={clsx(headCls, "!mb-0 hover:text-foreground")}>{head}</button>
      </div>
    );
  }
  return (
    <div className={clsx("min-w-0 px-4 py-3", className)} role="group" aria-label={`${data.symbol} trade ideas`}>
      {collapsible
        ? <button type="button" onClick={() => setOpen(false)} aria-expanded className={clsx(headCls, "hover:text-foreground")}>{head}</button>
        : <p className={headCls}>{head}</p>}
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
