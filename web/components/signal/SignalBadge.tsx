"use client";
/**
 * The desk's backtested signal as a tag, with a hover / focus / tap window: why it was derived and how confident
 * the backtest is (hedge.signal). Used on the stock page (any ticker) and on the Hedge desk rows, so both read
 * the same verdict, words and odds.
 */
import { useEffect, useId, useRef, useState } from "react";
import { clsx } from "clsx";
import { Tag } from "@/components/desk";
import type { HedgeBook } from "@/lib/api";

export type SignalData = NonNullable<HedgeBook["signal"]>;
type Tone = "gain" | "loss" | "warn" | "neutral";

const TONE: Record<SignalData["verdict"], Tone> = { ADD: "gain", HOLD: "neutral", CAUTION: "warn", TRIM: "loss", ROLL: "warn" };
const DEFAULT_LABEL: Record<SignalData["verdict"], string> = { ADD: "Add", HOLD: "Hold", CAUTION: "Don't add", TRIM: "Take profit", ROLL: "Roll" };
const pct = (v?: number | null, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const sgn = (v?: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)}%`);

/** Confidence in words from the bootstrap: is the setup's average edge reliably above (or below) zero? */
export function confidenceOf(g: SignalData): { word: string; tone: Tone; line: string } {
  const p = g.probability;
  if (g.verdict === "ROLL") {
    const worst = [...g.legs].sort((a, b) => b.decay_20d - a.decay_20d)[0];
    return { word: "High", tone: "gain", line: `Time decay is arithmetic: ${worst ? `the ${worst.label} loses ${pct(worst.decay_20d, 1)} of its value per 20 trading days` : "the leg is decaying fast"}. `
      + (p ? `The stock's own setup: ${pct(p.p_edge_positive)} chance its average edge is above zero.` : "") };
  }
  if (!p) return { word: "Untested", tone: "neutral", line: "No VIX or price history: the backtest doesn't cover this read." };
  const pe = p.p_edge_positive;
  if (pe >= 0.95) return { word: "High", tone: "gain", line: `${pct(pe)} chance the average edge is above zero.` };
  if (pe <= 0.05) return { word: "High (negative)", tone: "loss", line: `${pct(1 - pe)} chance the average edge is below zero.` };
  if (pe >= 0.8 || pe <= 0.2) return { word: "Moderate", tone: "warn", line: `${pct(pe)} chance the average edge is above zero.` };
  return { word: "No edge", tone: "neutral", line: `${pct(pe)} chance the average edge is above zero: a coin flip.` };
}

export function SignalBadge({ signal: g, label, reasons = [], align = "left", className }: {
  signal: SignalData; label?: string | null; reasons?: string[]; align?: "left" | "right"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();
  const c = confidenceOf(g);
  const p = g.probability;
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const tested = g.reads.filter((r) => r.tested);
  // why: the read notes, the IV line, then roll lines; the odds and evidence have their own blocks
  const why = [...tested.map((r) => r.note), ...reasons.filter((r) => /^Stock IV|→ roll|^No stop|^Risk line/.test(r))].slice(0, 6);
  return (
    <span ref={box} className={clsx("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" data-testid="signal-badge" aria-describedby={open ? id : undefined} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="rounded-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <Tag tone={TONE[g.verdict]}>{label ?? DEFAULT_LABEL[g.verdict]}</Tag>
      </button>
      {open && (
        <span id={id} role="tooltip" onClick={(e) => e.stopPropagation()}
          className={clsx("absolute top-full z-50 mt-2 block w-[min(380px,calc(100vw-32px))] cursor-default rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-4 text-left shadow-xl",
            align === "right" ? "right-0" : "left-0")}>
          <span className="flex items-center justify-between gap-3">
            <Tag tone={TONE[g.verdict]}>{label ?? DEFAULT_LABEL[g.verdict]}</Tag>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/45">Confidence · <span className={clsx(
              c.tone === "gain" ? "text-gain" : c.tone === "loss" ? "text-loss" : c.tone === "warn" ? "text-warn" : "text-foreground/70")}>{c.word}</span></span>
          </span>
          <span className="mt-2 block text-[13.5px] font-medium leading-snug text-foreground">{g.headline}</span>
          <span className="mt-1 block text-[12px] text-foreground/60">{c.line}</span>
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
        </span>
      )}
    </span>
  );
}
