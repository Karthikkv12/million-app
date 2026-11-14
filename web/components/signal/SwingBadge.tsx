"use client";
/**
 * The swing read (hedge.swing: 1 week – 1 month) as a tag next to the regular signal, with a side drawer like the
 * signal's (full screen on phones): the call, the trigger, the exit, and the backtest.
 */
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { X } from "lucide-react";
import { Tag } from "@/components/desk";
import type { StockSignal } from "@/lib/api";

export type SwingData = NonNullable<StockSignal["swing"]>;
const pct = (v?: number | null, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%`);
const usd = (v?: number | null) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const SWING_HORIZON = "1–4 wk";

export function SwingBadge({ swing: s, symbol, className }: { swing: SwingData; symbol?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [open]);
  const buy = s.verdict === "BUY";
  const o = s.stats?.oos;
  const name = buy ? "Swing buy" : "Wait";
  return (
    <span className={clsx("inline-flex", className)}>
      <button type="button" data-testid="swing-badge" aria-haspopup="dialog" aria-controls={open ? id : undefined} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center rounded-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <Tag tone={buy ? "gain" : "neutral"}>{name}</Tag>
        <span className="ml-1.5 whitespace-nowrap font-mono text-[10px] text-foreground/45">{SWING_HORIZON}</span>
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div id={id} className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true" data-testid="swing-pop"
          aria-label={`${symbol ? `${symbol} ` : ""}swing: ${name}`} onClick={(e) => e.stopPropagation()}>
          <button className="absolute inset-0 hidden bg-black/50 backdrop-blur-[2px] sm:block" onClick={() => setOpen(false)} aria-label="Close swing" tabIndex={-1} />
          <aside className="relative flex h-[100dvh] w-full flex-col bg-[var(--background)] text-left sm:max-w-[480px] sm:border-l sm:border-[var(--border-strong)]">
            <header className="flex items-center gap-3 border-b border-[var(--border-strong)] px-5 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
              <div className="min-w-0">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/45">Swing · {SWING_HORIZON}</p>
                {symbol && <h2 className="font-mono text-[22px] font-semibold tracking-tight text-foreground">{symbol}</h2>}
              </div>
              <button type="button" autoFocus onClick={() => setOpen(false)} aria-label="Close"
                className="ml-auto grid h-9 w-9 place-items-center rounded-full border border-[var(--border)] text-foreground/70 hover:text-foreground"><X size={16} /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-4 text-[13px]">
              <Tag tone={buy ? "gain" : "neutral"}>{name}</Tag>
              <p className="mt-2 text-[14px] font-medium leading-snug text-foreground">{s.reason}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2 font-mono">
                {([
                  [buy ? "Buy" : "Buy if it closes ≤", buy ? "next open" : s.buy_below != null ? usd(s.buy_below) : "—"],
                  ["Sell at first close above", usd(s.exit_above)],
                  ["Or sell after", `${s.max_days} trading days`],
                  ["5-day change", pct(s.ret5)],
                  ["vs 200-day avg", pct(s.vs_200d)],
                  ["Setup", s.fear && s.drop ? "fear dip + 5% drop" : s.fear ? "fear dip" : s.drop ? "5% drop, uptrend" : "none"],
                ] as const).map(([k, v]) => (
                  <div key={k} className="rounded-md bg-[var(--surface-2)] px-2.5 py-2">
                    <dt className="text-[9.5px] uppercase tracking-[0.1em] text-foreground/45">{k}</dt>
                    <dd className="mt-0.5 text-[14px] tabular-nums text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45">The rule</p>
              <p className="mt-1 leading-snug text-foreground/75">
                Buy at the next open after a fear dip (the 1–3 month Add) or a drop of 5% or more in 5 trading days while above
                the 200-day average. Sell at the first close above the 10-day average, or after 20 trading days. No stop-loss:
                every stop tested lowered the average trade.
              </p>
              {o && (
                <>
                  <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45">Backtest · 2015–2026, unseen</p>
                  <span className="mt-1 grid grid-cols-3 gap-2 font-mono">
                    {([["Winners", pct(o.win, 0).replace("+", "")], ["Avg trade", pct(o.avg, 2)], ["Days held", o.days.toFixed(1)]] as const).map(([k, v]) => (
                      <span key={k} className="block rounded-md bg-[var(--surface-2)] px-2 py-1.5">
                        <span className="block text-[9.5px] uppercase tracking-[0.1em] text-foreground/45">{k}</span>
                        <span className="block text-[15px] tabular-nums text-foreground">{v}</span>
                      </span>
                    ))}
                  </span>
                  <p className="mt-2 font-mono text-[11px] text-foreground/50">
                    {o.trades.toLocaleString("en-US")} trades on 148 stocks and ETFs, after 0.2% costs; median {pct(o.median, 2)}; the worst 1 in 20
                    lost {pct(-o.worst5, 0).replace("+", "")} or more. Any day held 5 days: {s.stats ? pct(s.stats.baseline_oos_5d.avg, 2) : "—"}.
                  </p>
                </>
              )}
              <p className="mt-3 border-l-2 border-[var(--border-strong)] pl-2 text-[11.5px] leading-snug text-foreground/55">
                Fear-dip swing gains are mostly the whole market bouncing; the 5% drop in an uptrend is more about the stock itself.
                Separate from the 1–3 month signal: both can be true at once, or disagree.
              </p>
              <p className="mt-2 text-[10.5px] text-foreground/40">Averages for this setup, not a forecast for one trade. Not financial advice.</p>
            </div>
          </aside>
        </div>, document.body)}
    </span>
  );
}
