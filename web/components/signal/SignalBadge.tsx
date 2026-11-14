"use client";
/**
 * The desk's backtested signal as a tag, with a hover / focus / tap window: why it was derived and how confident
 * the backtest is (hedge.signal). Used on the stock page (any ticker) and on the Hedge desk rows, so both read
 * the same verdict, words and odds.
 */
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { clsx } from "clsx";
import { Tag } from "@/components/desk";
import type { HedgeBook } from "@/lib/api";

export type SignalData = NonNullable<HedgeBook["signal"]>;
type Tone = "gain" | "loss" | "warn" | "neutral";

const TONE: Record<SignalData["verdict"], Tone> = { ADD: "gain", HOLD: "neutral", CAUTION: "warn", TRIM: "loss", ROLL: "warn", EXIT: "loss" };
const DEFAULT_LABEL: Record<SignalData["verdict"], string> = { ADD: "Add", HOLD: "Hold", CAUTION: "Don't add", TRIM: "Take profit", ROLL: "Roll", EXIT: "Exit" };
/** Every verdict is a timing call for the next 20–60 trading days, measured against simply holding (hedge.signal). */
export const SIGNAL_HORIZON = "1–3 mo";
export const SIGNAL_HORIZON_LINE = "Horizon: the next 1–3 months (20–60 trading days), measured against simply holding. Not a day trade, and not a call on the company for years.";
export const SIGNAL_TONE = TONE;
const pct = (v?: number | null, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const sgn = (v?: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)}%`);

/** Confidence in words from the bootstrap: is the setup's average edge reliably above (or below) zero? */
export function confidenceOf(g: SignalData): { word: string; tone: Tone; line: string } {
  const p = g.probability;
  if (g.verdict === "ROLL") {
    const near = [...g.legs].sort((a, b) => a.dte - b.dte)[0];
    return { word: "Expiry", tone: "warn", line: `${near ? `The ${near.label} has ${near.dte} days left` : "A leg is close to expiry"}: roll or close. Not an edge: early rolls lost ~4% to costs. `
      + (p ? `The stock's own setup: ${pct(p.p_edge_positive)} chance its average edge is above zero.` : "") };
  }
  if (g.verdict === "EXIT") return { word: "Weak (negative)", tone: "loss", line: "Tested exit: such days ran −1.5% vs holding over the next 60 trading days (t −2.5). A reason to cut, not a crash call." };
  if (!p) return { word: "Untested", tone: "neutral", line: "No VIX or price history: the backtest doesn't cover this read." };
  const pe = p.p_edge_positive;
  if (pe >= 0.95) return { word: "High", tone: "gain", line: `${pct(pe)} chance the average edge is above zero.` };
  if (pe <= 0.05) return { word: "High (negative)", tone: "loss", line: `${pct(1 - pe)} chance the average edge is below zero.` };
  if (pe >= 0.8 || pe <= 0.2) return { word: "Moderate", tone: "warn", line: `${pct(pe)} chance the average edge is above zero.` };
  return { word: "No edge", tone: "neutral", line: `${pct(pe)} chance the average edge is above zero: a coin flip.` };
}

export function SignalBadge({ signal: g, label, reasons = [], symbol, className }: {
  signal: SignalData; label?: string | null; reasons?: string[]; symbol?: string; align?: "left" | "right"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const c = confidenceOf(g);
  const p = g.probability;
  // A side drawer like the heat maps' Details (full screen on phones): Escape closes, the page behind doesn't scroll.
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [open]);
  const tested = g.reads.filter((r) => r.tested);
  // why: the read notes, the IV line, then roll lines; the odds and evidence have their own blocks
  const why = [...tested.map((r) => r.note), ...(g.fear_score != null ? [`Fear score ${g.fear_score.toFixed(2)} (Add at ≥ 0.28): VIX percentile × how oversold.`] : []),
    ...reasons.filter((r) => /^Stock IV|→ roll|→ expiry/.test(r))].slice(0, 7);
  const plan = g.plan?.lines ?? [];
  const body = (
        <>
          <span className="flex items-center justify-between gap-3">
            <Tag tone={TONE[g.verdict]}>{label ?? DEFAULT_LABEL[g.verdict]}</Tag>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/45">Confidence · <span className={clsx(
              c.tone === "gain" ? "text-gain" : c.tone === "loss" ? "text-loss" : c.tone === "warn" ? "text-warn" : "text-foreground/70")}>{c.word}</span></span>
          </span>
          <span className="mt-2 block text-[13.5px] font-medium leading-snug text-foreground">{g.headline}</span>
          <span className="mt-1 block text-[12px] text-foreground/60">{c.line}</span>
          <span className="mt-1 block text-[12px] text-foreground/60">{SIGNAL_HORIZON_LINE}</span>
          {p && (
            <span className="mt-3 grid grid-cols-3 gap-2 font-mono">
              {[["Stock up 60d", p.p_up_60], ...(g.side === "long" ? [["Beats holding", p.p_beat_60], ["365d call profits", p.p_option_profit_60]] : [])]
                .filter(([, v]) => v != null).map(([k, v]) => (
                  <span key={k as string} className="block rounded-md bg-[var(--surface-2)] px-2 py-1.5">
                    <span className="block text-[9.5px] uppercase tracking-[0.1em] text-foreground/45">{k}</span>
                    <span className="block text-[15px] tabular-nums text-foreground">{pct(v as number)}</span>
                  </span>
                ))}
            </span>
          )}
          {p && (
            <span className="mt-2 block font-mono text-[11px] text-foreground/50">
              Avg 60-day edge vs holding {sgn(p.edge_60)} (90% range {sgn(p.edge_lo)} to {sgn(p.edge_hi)}) · {p.cases.toLocaleString("en-US")} cases, 2015–2026, unseen
            </span>
          )}
          {g.pnl && (
            <span className="mt-3 block rounded-md border border-[var(--border)] px-2.5 py-2">
              <span className="flex items-baseline justify-between gap-2 font-mono">
                <span className="text-[9.5px] uppercase tracking-[0.1em] text-foreground/45">Your P&amp;L {g.pnl.kind === "options" ? "on the options" : "on the shares"}</span>
                <span className={clsx("sensitive text-[13px] tabular-nums", g.pnl.pct >= 0 ? "text-gain" : "text-loss")}>
                  {g.pnl.pct >= 0 ? "+" : "−"}{Math.abs(g.pnl.pct * 100).toFixed(0)}% · {g.pnl.dollars >= 0 ? "+" : "−"}${Math.abs(g.pnl.dollars).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </span>
              {g.pnl.p_lose_25_paid != null && (
                <span className="mt-1 block font-mono text-[11px] text-foreground/55">
                  Next 60d at this P&amp;L: {pct(g.pnl.p_gain_25_paid)} gained, {pct(g.pnl.p_lose_25_paid)} lost &gt;25% of what was paid · worst 1 in 20 {pct(g.pnl.p5_paid)}
                </span>
              )}
              <span className="mt-1 block text-[11.5px] leading-snug text-foreground/65">{g.pnl.note}</span>
            </span>
          )}
          {plan.length > 0 && (
            <>
              <span className="mt-3 block font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45">Plan</span>
              <span className="mt-1 block space-y-1" data-testid="signal-plan">
                {plan.map((r) => <span key={r} className="block text-[12px] leading-snug text-foreground/80">{r}</span>)}
              </span>
            </>
          )}
          {why.length > 0 && (
            <>
              <span className="mt-3 block font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45">Why</span>
              <span className="mt-1 block space-y-1">
                {why.map((r) => <span key={r} className="block text-[12px] leading-snug text-foreground/70">{r}</span>)}
              </span>
            </>
          )}
          {g.evidence && <span className="mt-3 block border-l-2 border-[var(--border-strong)] pl-2 text-[11.5px] leading-snug text-foreground/55">{g.evidence}</span>}
          <span className="mt-2 block text-[10.5px] text-foreground/40">Averages for this setup, not a forecast for one trade. Not financial advice.</span>
        </>
  );
  const name = label ?? DEFAULT_LABEL[g.verdict];
  return (
    <span className={clsx("inline-flex", className)}>
      <button type="button" data-testid="signal-badge" aria-haspopup="dialog" aria-controls={open ? id : undefined} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center rounded-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <Tag tone={TONE[g.verdict]}>{name}</Tag>
        <span className="ml-1.5 whitespace-nowrap font-mono text-[10px] text-foreground/45" title={SIGNAL_HORIZON_LINE}>{SIGNAL_HORIZON}</span>
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div id={id} className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true" data-testid="signal-pop"
          aria-label={`${symbol ? `${symbol} ` : ""}signal: ${name}`} onClick={(e) => e.stopPropagation()}>
          <button className="absolute inset-0 hidden bg-black/50 backdrop-blur-[2px] sm:block" onClick={() => setOpen(false)} aria-label="Close signal" tabIndex={-1} />
          <aside className="relative flex h-[100dvh] w-full flex-col bg-[var(--background)] text-left sm:max-w-[480px] sm:border-l sm:border-[var(--border-strong)]">
            <header className="flex items-center gap-3 border-b border-[var(--border-strong)] px-5 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
              <div className="min-w-0">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/45">Signal · {SIGNAL_HORIZON}</p>
                {symbol && <h2 className="font-mono text-[22px] font-semibold tracking-tight text-foreground">{symbol}</h2>}
              </div>
              <button type="button" autoFocus onClick={() => setOpen(false)} aria-label="Close"
                className="ml-auto grid h-9 w-9 place-items-center rounded-full border border-[var(--border)] text-foreground/70 hover:text-foreground"><X size={16} /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-4">{body}</div>
          </aside>
        </div>, document.body)}
    </span>
  );
}
