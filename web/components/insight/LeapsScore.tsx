"use client";
/**
 * LeapsScore — the 0–100 LEAPS score on a banded scale (Avoid · Weak · Fair · Good · Excellent), how the stock
 * trades (trend, pullback state, volatility, volume, typical move), and the factors behind the number.
 * Two sides: buying a long call, and buying a long put (the same factors flipped); a Call / Put switch picks one.
 * LeapsLine — the one-line version for the heat maps: both scores and the entry price of the stronger side.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";
import { fetchLeapsScore, LeapsScore as Score } from "@/lib/api";
import { Scale } from "@/components/desk";

const ZONES = [
  { from: 0, to: 20, cls: "bg-loss/70", label: "Avoid" }, { from: 20, to: 40, cls: "bg-loss/35", label: "Weak" },
  { from: 40, to: 60, cls: "bg-warn/45", label: "Fair" }, { from: 60, to: 80, cls: "bg-gain/40", label: "Good" },
  { from: 80, to: 100, cls: "bg-gain/80", label: "Excellent" },
];
const MARKS = [{ at: 10, label: "Avoid" }, { at: 30, label: "Weak" }, { at: 50, label: "Fair" }, { at: 70, label: "Good" }, { at: 90, label: "Excellent" }];
const tone = (v: number) => (v >= 60 ? "text-gain" : v >= 40 ? "text-warn" : "text-loss");
const bar = (v: number) => (v >= 60 ? "bg-gain" : v >= 40 ? "bg-warn" : "bg-loss");
const pin = (v: number) => (v >= 60 ? "bg-gain" : v >= 40 ? "bg-warn" : "bg-loss");
const pct = (v?: number | null) => (v == null ? null : `${(v * 100).toFixed(1)}%`);

export function useLeapsScore(symbol: string, enabled = true) {
  return useQuery<Score>({ queryKey: ["leaps-score", symbol], queryFn: () => fetchLeapsScore(symbol), staleTime: 10 * 60_000, enabled });
}

function Chip({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-mono text-[11px]">
      <span className="uppercase tracking-[0.12em] text-foreground/40">{k}</span>
      <span className={clsx("text-foreground/85", cls)}>{v}</span>
    </span>
  );
}

type Side = "call" | "put";
type SideView = { score: number; band: string; summary: string; factors: Score["factors"]; entry?: Score["entry"] };

/** The call or put half of a score, in one shape (null when there is no score). */
function sideOf(d: Score | undefined, side: Side): SideView | null {
  if (!d || d.score == null) return null;
  if (side === "put") return d.put ? { ...d.put, summary: d.put.summary ?? "", factors: d.put.factors ?? [] } : null;
  return { score: d.score, band: d.band ?? "", summary: d.summary ?? "", factors: d.factors ?? [], entry: d.entry };
}
/** The side worth acting on: the higher score (the call on a tie). */
const better = (d: Score | undefined): Side => (d?.put && d.score != null && d.put.score > d.score ? "put" : "call");

const ENTER: Record<string, string> = { now: "Enter now, around ", pullback: "Enter at ", bounce: "Enter at ", reclaim: "Enter above ", break: "Enter below " };

export function LeapsScore({ symbol, compact = false, className }: { symbol: string; compact?: boolean; className?: string }) {
  const { data: raw, isLoading, isError } = useLeapsScore(symbol);
  const [open, setOpen] = useState(!compact);
  const [picked, setPicked] = useState<Side | null>(null);
  const side: Side = picked ?? better(raw);
  const view = sideOf(raw, side);
  const data = view ? { ...view, error: raw?.error } : null;
  const t = raw?.traits;
  return (
    <div className={clsx("min-w-0", className)} role="group" aria-label={`${symbol} LEAPS score`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">LEAPS score</p>
          {raw?.put && raw.score != null && (
            <div role="tablist" aria-label="Call or put" className="flex gap-2.5">
              {(["call", "put"] as const).map((sd) => (
                <button key={sd} role="tab" aria-selected={side === sd} onClick={() => setPicked(sd)}
                  title={sd === "call" ? "Buying a long-dated call" : "Buying a long-dated put (the idea flipped)"}
                  className={clsx("border-b-2 pb-0.5 font-mono text-[11px] uppercase tracking-[0.12em] tabular-nums transition",
                    side === sd ? "border-foreground text-foreground" : "border-transparent text-foreground/45 hover:text-foreground")}>
                  {sd} <span className={tone(sd === "call" ? raw.score! : raw.put!.score)}>{sd === "call" ? raw.score : raw.put!.score}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {data?.score != null && (
          <p className="font-mono tabular-nums">
            <span className={clsx("text-[26px] font-medium leading-none tracking-[-0.03em]", tone(data.score))}>{data.score}</span>
            <span className="ml-1 text-[11px] text-foreground/40">/ 100</span>
            <span className={clsx("ml-2 text-[11px] font-medium uppercase tracking-[0.12em]", tone(data.score))}>{data.band}</span>
          </p>
        )}
      </div>
      {isLoading ? <div className="skeleton mt-3 h-16" />
        : isError || !data || data.score == null ? <p className="mt-2 text-[12.5px] text-foreground/50">{raw?.error ?? "No score right now."}</p>
        : (
          <>
            <div className="mt-2">
              <Scale min={0} max={100} value={data.score} label={String(data.score)} pin={pin(data.score)} zones={ZONES} marks={MARKS}
                tips={{ value: `${data.score} of 100 for buying a long ${side}: ${data.band}. 0 is bad, 100 is extremely good.` }} />
            </div>
            <p className="text-[12.5px] leading-snug text-foreground/70">{data.summary}</p>
            {data.entry && (
              <p className="mt-1.5 border-l-[3px] border-accent pl-2 text-[12.5px] leading-snug text-foreground/80">
                <span className="font-mono font-medium tabular-nums text-foreground">
                  {ENTER[data.entry.when]}${data.entry.price.toFixed(2)}
                </span>{" "}{data.entry.note}
              </p>
            )}
            {t && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <Chip k="Trend" v={t.trend} cls={t.trend === "up" ? "text-gain" : t.trend === "down" ? "text-loss" : undefined} />
                <Chip k="Now" v={`${t.state} (${(t.off_high * 100).toFixed(0)}%)`} />
                {t.volatility && <Chip k="Swings" v={t.volatility} cls={t.volatility === "super volatile" ? "text-loss" : t.volatility === "volatile" ? "text-warn" : undefined} />}
                {t.volume && <Chip k="Volume" v={t.volume} />}
                {pct(t.daily_move) && <Chip k="Typical day" v={`±${pct(t.daily_move)}`} />}
                {pct(t.monthly_move) && <Chip k="Month" v={`±${pct(t.monthly_move)}`} />}
              </div>
            )}
            {compact && (
              <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
                className="mt-2 inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/55 hover:text-foreground">
                {data.factors.length} factors <ChevronDown size={12} className={clsx("transition", open && "rotate-180")} />
              </button>
            )}
            {open && (
              <ul className="mt-2 border-t border-[var(--border)]">
                {data.factors.map((f) => (
                  <li key={f.key} className="border-b border-[var(--border)] py-2 last:border-0">
                    <div className="flex items-center gap-2 font-mono text-[11.5px]">
                      <span className="w-[128px] shrink-0 truncate text-foreground/80">{f.label}</span>
                      <span className="relative h-1.5 min-w-[40px] flex-1 overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden>
                        <span className={clsx("absolute inset-y-0 left-0 rounded-full", bar(f.score))} style={{ width: `${f.score}%` }} />
                      </span>
                      <span className={clsx("w-7 shrink-0 text-right tabular-nums", tone(f.score))}>{f.score}</span>
                      <span className="w-8 shrink-0 text-right text-[10px] text-foreground/35" title="Weight in the total">×{f.weight}</span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-foreground/55"><span className="font-mono text-[10.5px] text-foreground/45">{f.value}.</span> {f.note}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10.5px] leading-snug text-foreground/40">From up to 5 years of daily prices{data.factors.some((f) => f.key === "dealers") ? ", option prices and dealer levels" : ""}. A score, not advice.</p>
          </>
        )}
    </div>
  );
}


const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One line for the heat maps: call and put scores, and the stock price at which to buy the stronger side. No scale, no factors. */
export function LeapsLine({ symbol, className }: { symbol: string; className?: string }) {
  const { data, isLoading } = useLeapsScore(symbol);
  if (isLoading) return <p className={clsx("font-mono text-[11.5px] text-foreground/35", className)}>LEAPS score …</p>;
  if (!data || data.score == null) return null;
  const side = better(data);
  const e = sideOf(data, side)?.entry;
  const away = e && e.when !== "now" ? ` (${e.distance > 0 ? "+" : ""}${(e.distance * 100).toFixed(1)}%)` : "";
  const price = e ? <b className="font-medium text-foreground">{usd(e.price)}</b> : null;
  return (
    <p className={clsx("flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[12px] tabular-nums", className)} title={e?.note}>
      <span className="text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">LEAPS score</span>
      <span className={clsx(side !== "call" && "opacity-60")}>
        <span className="mr-1 text-[10.5px] uppercase tracking-[0.12em] text-foreground/45">call</span>
        <span className={clsx("text-[15px] font-medium", tone(data.score))}>{data.score}</span>
      </span>
      {data.put && (
        <span className={clsx(side !== "put" && "opacity-60")}>
          <span className="mr-1 text-[10.5px] uppercase tracking-[0.12em] text-foreground/45">put</span>
          <span className={clsx("text-[15px] font-medium", tone(data.put.score))}>{data.put.score}</span>
        </span>
      )}
      {e && (
        <span className="text-foreground/75">
          Buy a LEAPS {side}{" "}
          {e.when === "now" ? <>now, around {price}</>
            : e.when === "reclaim" ? <>when {symbol} closes back above {price}</>
            : e.when === "break" ? <>when {symbol} closes back below {price}</>
            : <>when {symbol} is at {price}</>}
          <span className="text-foreground/45">{away}</span>
        </span>
      )}
    </p>
  );
}
