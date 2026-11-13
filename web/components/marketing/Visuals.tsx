"use client";
/** Static, illustrative product visuals for the marketing pages. Sample data only. */
import { clsx } from "clsx";
import { heatColor } from "@/components/ui";

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



export function SectorTiles({ className }: { className?: string }) {
  return (
    <WindowFrame title="OptionFlow / Markets / Tech" className={className}>
      <div className="grid gap-1 p-3">
        {TILES.map((row, i) => (
          <div key={i} className={clsx("flex gap-1", i === 0 ? "h-24" : "h-14")}>
            {row.map((t) => (
              <div
                key={t.s}
                className="flex min-w-0 flex-col items-center justify-center rounded-md"
                style={{ flexGrow: t.w, flexBasis: 0, background: heatColor(t.ch).bg, color: heatColor(t.ch).fg }}
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

// ── Net premium (sample) ─────────────────────────────────────────────────────
// Cumulative from the 9:30 bell: NCP (calls bought − sold) and NPP (puts bought − sold), with the price.
const NCP = [0, 0.4, 0.2, -0.6, -1.1, -1.8, -1.5, -2.4, -3.1, -2.8, -3.9, -4.6, -4.2, -5.3, -6.1];
const NPP = [0, 0.8, 1.9, 2.6, 2.2, 3.9, 5.1, 4.6, 6.2, 7.4, 8.1, 9.6, 10.2, 11.5, 12.2];
const PX = [116.2, 116.6, 116.1, 115.4, 115.7, 114.9, 114.2, 114.6, 113.8, 113.1, 113.5, 112.6, 112.9, 112.4, 112.5];

export function NetPremiumCard({ className }: { className?: string }) {
  const W = 480, H = 200, n = NCP.length - 1, lo = -8, hi = 14, plo = 111.5, phi = 117;
  const x = (i: number) => (i / n) * W * 0.62;                     // the session so far: about 62% of the day
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const py = (v: number) => H - ((v - plo) / (phi - plo)) * H;
  const path = (vals: number[], f: (v: number) => number) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${f(v).toFixed(1)}`).join(" ");
  const area = (vals: number[]) => `${path(vals, y)} L${x(n).toFixed(1)},${y(0)} L0,${y(0)} Z`;
  return (
    <WindowFrame title="OptionFlow / Flow / Premium / NBIS" className={className}>
      <div className="p-5">
        <div className="mb-1 flex justify-between font-mono text-[11px] tabular-nums">
          <span className="text-loss">Bearish 56%</span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/40">Net sentiment</span>
          <span className="text-gain">Bullish 44%</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full"><div className="w-[56%] bg-loss" /><div className="w-[44%] bg-gain" /></div>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11.5px] tabular-nums">
          {([["Calls bought", "$27.8M", "bg-gain"], ["Calls sold", "$33.9M", "bg-loss"], ["Puts bought", "$49.3M", "bg-loss"], ["Puts sold", "$37.1M", "bg-gain"]] as const).map(([l, v, dot]) => (
            <span key={l} className="flex items-center gap-1.5 whitespace-nowrap"><span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} /><span className="text-foreground/50">{l}</span><span className="ml-auto text-foreground">{v}</span></span>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H + 18}`} className="mt-4 w-full" role="img" aria-label="Sample chart: net put premium rising and net call premium falling from the open while the price drifts lower">
          <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="stroke-[var(--border-strong)]" strokeDasharray="3 3" />
          <path d={area(NPP)} className="fill-loss/10" />
          <path d={area(NCP)} className="fill-gain/10" />
          <path d={path(NPP, y)} fill="none" className="stroke-loss" strokeWidth={2} />
          <path d={path(NCP, y)} fill="none" className="stroke-gain" strokeWidth={2} />
          <path d={path(PX, py)} fill="none" className="stroke-foreground/45" strokeWidth={1.25} />
          {[["9:30", 0], ["12:00", 0.385], ["2:00", 0.692], ["4:00", 1]].map(([l, f]) => (
            <text key={l as string} x={(f as number) * W} y={H + 14} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} className="fill-foreground/45 font-mono text-[10px]">{l}</text>
          ))}
        </svg>
        <div className="mt-2 flex flex-wrap gap-4 font-mono text-[11px]">
          <span className="text-gain">NCP −$6.1M</span><span className="text-loss">NPP +$12.2M</span><span className="text-foreground/55">Price 112.50</span>
        </div>
      </div>
      <p className="px-5 pb-3 text-right font-mono text-[11px] text-foreground/45">Sample data</p>
    </WindowFrame>
  );
}

// ── Hedge (sample) ───────────────────────────────────────────────────────────
export function HedgeCard({ className }: { className?: string }) {
  const delta = 412, band = 150, span = 600;
  const pos = (v: number) => `${((v + span) / (2 * span)) * 100}%`;
  return (
    <WindowFrame title="OptionFlow / Hedge" className={className}>
      <div className="p-5">
        <p className="eyebrow">Net delta, share-equivalent</p>
        <p className="mt-2 font-mono text-3xl font-medium tabular-nums tracking-tight text-foreground">+{delta}</p>
        <div className="relative mt-4 h-2 rounded-full bg-foreground/10" aria-hidden>
          <div className="absolute inset-y-0 rounded-full bg-gain/25" style={{ left: pos(-band), right: `calc(100% - ${pos(band)})` }} />
          <div className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-foreground" style={{ left: pos(delta) }} />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[11px] text-foreground/45"><span>−{span}</span><span>target 0 ± {band}</span><span>+{span}</span></div>
        <div className="mt-5 grid gap-2">
          {[["Sell 2 × NVDA 175C Dec 19", "Δ −86", "+$640"], ["Sell 1 × AAPL 240C Dec 19", "Δ −38", "+$290"], ["Sell 300 × SPY shares", "Δ −300", ""]].map(([what, d, cr]) => (
            <div key={what} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 font-mono text-[12px]">
              <span className="truncate text-foreground">{what}</span>
              <span className="shrink-0 tabular-nums text-foreground/60">{d}{cr && <span className="ml-2 text-gain">{cr}</span>}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="px-5 pb-3 text-right font-mono text-[11px] text-foreground/45">Sample data</p>
    </WindowFrame>
  );
}
