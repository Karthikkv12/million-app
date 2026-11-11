"use client";
/**
 * SampleBoard — a static, illustrative strike × expiry GEX board for the
 * landing and login pages. Same colour scale as the live board (cellColor),
 * fixed sample numbers so it renders identically on server and client.
 */
import { cellColor, fmtMoney } from "@/components/options-flow/GexHeatmap";
import { clsx } from "clsx";

const EXPIRIES = ["Nov 14", "Nov 21", "Nov 28", "Dec 19", "Jan 16"];
const SPOT = 585;
const KING = { strike: 590, col: 1 };

// $ gamma exposure in millions — illustrative only
const ROWS: { strike: number; vals: number[] }[] = [
  { strike: 595, vals: [  42,  118,   36,   64,   21] },
  { strike: 590, vals: [ 310,  962,  140,  205,   88] },
  { strike: 588, vals: [  74,  166,   52,   40,   17] },
  { strike: 585, vals: [ -38,   55,  -12,   26,   -9] },
  { strike: 583, vals: [ -96, -142,  -48,  -30,  -14] },
  { strike: 580, vals: [-412, -688, -174, -122,  -61] },
  { strike: 575, vals: [ -88, -205,  -95,  -58,  -27] },
];

export function SampleBoard({ compact = false, bare = false, className }: { compact?: boolean; bare?: boolean; className?: string }) {
  const vmax = Math.max(...ROWS.flatMap((r) => r.vals.map(Math.abs)));
  // Phones always get 3 expiries; wider screens get all 5 unless compact.
  const cols = compact ? 3 : EXPIRIES.length;
  const gridCls = compact
    ? "grid [grid-template-columns:60px_repeat(3,minmax(0,1fr))]"
    : "grid [grid-template-columns:60px_repeat(3,minmax(0,1fr))] sm:[grid-template-columns:64px_repeat(5,minmax(0,1fr))]";
  const colCls = (i: number) => (i >= 3 ? "hidden sm:block" : "");
  return (
    <div className={clsx("overflow-hidden bg-[var(--surface)]", !bare && "rounded-2xl border border-[var(--border)] shadow-[var(--shadow-float)]", className)}>
      {/* window chrome */}
      <div className={clsx(bare && "hidden")}>
      <div className="grid grid-cols-[52px_minmax(0,1fr)_52px] items-center border-b border-[var(--border)] px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        </div>
        <span className="truncate text-center font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/55">
          OptionFlow / Flow / SPY
        </span>
        <span />
      </div>
      </div>

      {/* levels strip */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-[var(--border)] px-4 py-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Spot</p>
          <p className="font-mono text-lg font-medium tabular-nums text-foreground">$585.12</p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Flip</p>
          <p className="font-mono text-sm tabular-nums text-accent">$586.40</p>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Call wall</p>
          <p className="font-mono text-sm tabular-nums text-gain">$590</p>
        </div>
        {!compact && (
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Put wall</p>
            <p className="font-mono text-sm tabular-nums text-loss">$580</p>
          </div>
        )}
      </div>

      {/* board */}
      <div className="bg-[#0b0c10] font-mono text-[11px] tabular-nums sm:text-[12px]">
        <div className={clsx(gridCls, "border-b border-white/10 text-white/55")}>
          <span className="px-3 py-2">Strike</span>
          {EXPIRIES.slice(0, cols).map((e, i) => <span key={e} className={clsx("px-2 py-2 text-right", colCls(i))}>{e}</span>)}
        </div>
        {ROWS.map((r) => (
          <div
            key={r.strike}
            className={clsx(gridCls, r.strike === SPOT && "shadow-[inset_0_-1px_0_rgba(255,255,255,0.75)]")}
          >
            <span className={clsx("flex items-center gap-1 px-3 py-[7px]", r.strike === SPOT ? "font-semibold text-white" : "text-white/80")}>
              {r.strike === SPOT && <span aria-label="spot" className="text-[9px] leading-none">▶</span>}
              {r.strike}
            </span>
            {r.vals.slice(0, cols).map((v, i) => {
              const king = r.strike === KING.strike && i === KING.col;
              const c = king ? { bg: "#fde725", fg: "#0b0c10" } : cellColor(v, vmax, "heat");
              return (
                <span
                  key={i}
                  className={clsx("truncate px-2 py-[7px] text-right", colCls(i), king && "font-semibold outline outline-2 -outline-offset-2 outline-[#fde725]")}
                  style={{ background: c.bg, color: c.fg }}
                >
                  {king ? "★ " : ""}{fmtMoney(v * 1e6)}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <p className="px-4 py-2 text-right font-mono text-[11px] text-foreground/45">Sample data</p>
    </div>
  );
}
