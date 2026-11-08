"use client";
/** Static, illustrative product visuals for the marketing pages. Sample data only. */
import { clsx } from "clsx";

export function WindowFrame({ title, children, className, tone = "surface" }: {
  title: string; children: React.ReactNode; className?: string; tone?: "surface" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div className={clsx(
      "overflow-hidden rounded-2xl border shadow-[var(--shadow-float)]",
      dark ? "border-white/10 bg-[#0f1013]" : "border-[var(--border)] bg-[var(--surface)]",
      className,
    )}>
      <div className={clsx("grid grid-cols-[52px_minmax(0,1fr)_52px] items-center border-b px-4 py-2.5", dark ? "border-white/10" : "border-[var(--border)]")}>
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => <span key={i} className={clsx("h-2.5 w-2.5 rounded-full", dark ? "bg-white/15" : "bg-foreground/15")} />)}
        </div>
        <span className={clsx("truncate text-center font-mono text-[11px] uppercase tracking-[0.2em]", dark ? "text-white/50" : "text-foreground/55")}>
          {title}
        </span>
        <span />
      </div>
      {children}
    </div>
  );
}

const TILES: { s: string; w: number; ch: number }[][] = [
  [{ s: "AAPL", w: 30, ch: 1.4 }, { s: "MSFT", w: 28, ch: 0.8 }, { s: "NVDA", w: 42, ch: -2.1 }],
  [{ s: "AVGO", w: 22, ch: 2.6 }, { s: "ORCL", w: 16, ch: -0.4 }, { s: "CRM", w: 14, ch: 0.2 }, { s: "AMD", w: 18, ch: -1.3 }, { s: "ADBE", w: 14, ch: 0.9 }, { s: "CSCO", w: 16, ch: -0.1 }],
  [{ s: "INTC", w: 18, ch: -3.2 }, { s: "QCOM", w: 20, ch: 1.1 }, { s: "TXN", w: 18, ch: 0.5 }, { s: "IBM", w: 22, ch: -0.7 }, { s: "NOW", w: 22, ch: 1.8 }],
];

function tileColor(ch: number): string {
  const a = Math.min(Math.abs(ch) / 3, 1);
  return ch >= 0 ? `rgba(53,183,121,${0.18 + a * 0.62})` : `rgba(220,38,38,${0.18 + a * 0.62})`;
}

export function SectorTiles({ className }: { className?: string }) {
  return (
    <WindowFrame title="OptionFlow / Markets / Tech" className={className}>
      <div className="grid gap-1 p-3">
        {TILES.map((row, i) => (
          <div key={i} className={clsx("flex gap-1", i === 0 ? "h-24" : "h-14")}>
            {row.map((t) => (
              <div
                key={t.s}
                className="flex min-w-0 flex-col items-center justify-center rounded-md text-foreground"
                style={{ flexGrow: t.w, flexBasis: 0, background: tileColor(t.ch) }}
              >
                <span className="truncate font-mono text-[12px] font-medium">{t.s}</span>
                <span className="font-mono text-[11px] tabular-nums opacity-80">{t.ch > 0 ? "+" : ""}{t.ch.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="px-4 pb-3 text-right font-mono text-[11px] text-foreground/45">Sample data · sized by market cap</p>
    </WindowFrame>
  );
}

/** A price ladder showing spot relative to the put wall, flip and call wall. */
export function RegimeCard({ className }: { className?: string }) {
  const lo = 576, hi = 594;
  const pos = (v: number) => `${((hi - v) / (hi - lo)) * 100}%`;
  const marks = [
    { v: 590, label: "Call wall", cls: "bg-gain", text: "text-gain" },
    { v: 586.4, label: "Flip", cls: "bg-accent", text: "text-accent" },
    { v: 580, label: "Put wall", cls: "bg-loss", text: "text-loss" },
  ];
  return (
    <WindowFrame title="OptionFlow / Levels / SPY" className={className}>
      <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia-500/10 px-2.5 py-1 font-mono text-[12px] text-fuchsia-700 dark:text-fuchsia-300">
            −GEX · Volatile
          </span>
          <p className="mt-3 font-mono text-3xl font-medium tabular-nums tracking-tight text-foreground">$585.12</p>
          <p className="mt-1 text-[14px] leading-relaxed text-foreground/60">
            Spot is <b className="font-medium text-foreground">0.2% below the flip</b>. Dealers are short gamma here, so they
            sell into drops and buy into rallies. Expect wider ranges until price reclaims $586.40.
          </p>
        </div>
        <div className="relative h-56 w-full min-w-[150px] sm:w-44" aria-hidden>
          <div className="absolute inset-y-0 left-3 w-px bg-[var(--border-strong)]" />
          {marks.map((m) => (
            <div key={m.label} className="absolute left-0 right-0 flex -translate-y-1/2 items-center gap-2" style={{ top: pos(m.v) }}>
              <span className={clsx("ml-[9px] h-[7px] w-[7px] rounded-full", m.cls)} />
              <span className={clsx("font-mono text-[12px]", m.text)}>{m.label}</span>
              <span className="ml-auto font-mono text-[12px] tabular-nums text-foreground/60">{m.v.toFixed(m.v % 1 ? 2 : 0)}</span>
            </div>
          ))}
          <div className="absolute left-0 right-0 flex -translate-y-1/2 items-center gap-2" style={{ top: pos(585.12) }}>
            <span className="ml-[5px] flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[8px] text-background">▶</span>
            <span className="font-mono text-[12px] font-medium text-foreground">Spot</span>
            <span className="ml-auto font-mono text-[12px] tabular-nums text-foreground">585.12</span>
          </div>
        </div>
      </div>
      <p className="px-5 pb-3 text-right font-mono text-[11px] text-foreground/45">Sample data</p>
    </WindowFrame>
  );
}
