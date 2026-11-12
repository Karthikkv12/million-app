"use client";
/**
 * Trinity — SPX, SPY and QQQ side by side for ONE expiry (no "All" column), always these three.
 *
 * Each column is that expiry's net GEX by strike around the price: the price row is marked, the King (largest
 * |GEX| in this expiry) is starred, and the header gives the price, the day's move and how far the King is.
 * The small badge on a strike is how much its GEX changed over the chosen window (5 / 15 / 30 min). The page
 * keeps those readings in memory while the app is open, so the badges fill in after the first few minutes.
 * GEX arrives over the same live stream as the Flow board (every refresh, within 2 s).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown } from "lucide-react";
import { fetchGex, GexResult } from "@/lib/api";
import { useGexStream } from "@/lib/useGexStream";
import { useQuotes } from "@/components/dashboard/quotes";
import { cellColor, fmtMoney, PALETTES, DEFAULT_HEAT_OPTS } from "@/components/options-flow/GexHeatmap";
import type { Palette } from "@/components/options-flow/GexHeatmap";
import { ANCHOR_TONE, anchorOf } from "@/lib/gex";

const NAMES = [
  { sym: "SPX", quote: "^SPX", label: "SPX" },
  { sym: "SPY", quote: "SPY", label: "SPY" },
  { sym: "QQQ", quote: "QQQ", label: "QQQ" },
] as const;
const ROWS = [20, 30, 40, 60] as const;
const WINDOWS = [5, 15, 30] as const;            // minutes for the change badges
const BADGE_MIN = 0.01;                          // hide changes under 1%…
const BADGE_SIZE = 0.02;                         // …and on strikes under 2% of the column's largest node

// ── Change history, kept for the whole app session (survives switching tabs) ──
type Snap = { t: number; v: Map<number, number> };
const HISTORY = new Map<string, Snap[]>();       // "SPY|2026-11-12" -> snapshots, oldest first
const KEEP_MS = 65 * 60_000;

function record(key: string, v: Map<number, number>) {
  const list = HISTORY.get(key) ?? [];
  const last = list.at(-1);
  if (last && last.v.size === v.size && [...v].every(([k, x]) => last.v.get(k) === x)) return;   // unchanged
  const now = Date.now();
  list.push({ t: now, v });
  while (list.length && now - list[0].t > KEEP_MS) list.shift();
  HISTORY.set(key, list);
}

/** The reading to compare with: the latest one at least `minutes` old, else the oldest we have (null if none older than 30 s). */
function baseline(key: string, minutes: number): Snap | null {
  const list = HISTORY.get(key) ?? [];
  const cut = Date.now() - minutes * 60_000;
  let pick: Snap | null = null;
  for (const s of list) { if (s.t <= cut) pick = s; else break; }
  pick = pick ?? list[0] ?? null;
  return pick && Date.now() - pick.t >= 30_000 ? pick : null;
}

const readPalette = (): Palette => {
  try {
    const p = JSON.parse(localStorage.getItem("optionsflow_layout") ?? "{}")?.heat?.palette;
    return PALETTES.some((x) => x.id === p) ? p : DEFAULT_HEAT_OPTS.palette;
  } catch { return DEFAULT_HEAT_OPTS.palette; }
};
const dayLabel = (exp: string) => {
  const d = new Date(`${exp}T12:00:00`);
  return Number.isNaN(d.getTime()) ? exp : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const daysTo = (exp: string) => Math.max(0, Math.round((new Date(`${exp}T16:00:00`).getTime() - Date.now()) / 86_400_000));
const fmtStrike = (k: number) => (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1));
/** Phone width: no "$", fewer digits ("-1.2B"), so three columns fit side by side. */
const fmtCompact = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`;
  return `${s}${a.toFixed(0)}`;
};
/** Phone header: "Nov 13" instead of "Thu, Nov 13". */
const shortDay = (exp: string) => {
  const d = new Date(`${exp}T12:00:00`);
  return Number.isNaN(d.getTime()) ? exp : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
/** Both widths in one node: the phone text below `sm`, the full text from `sm` up. */
const Fit = ({ phone, full }: { phone: React.ReactNode; full: React.ReactNode }) => (
  <><span className="sm:hidden">{phone}</span><span className="hidden sm:inline">{full}</span></>
);

// ── Data: one GEX query per name, kept live by the stream ────────────────────
function useLiveGex(sym: string) {
  const live = useGexStream(sym);
  return useQuery<GexResult>({ queryKey: ["gex", sym], queryFn: () => fetchGex(sym), staleTime: 30_000, refetchInterval: live ? false : 30_000 });
}

/** The expiry a name shows: the chosen date if it lists it, else its nearest expiry on or after it. */
function expiryFor(d: GexResult | undefined, chosen: string | null): string | null {
  const list = d?.heatmap_expiries ?? [];
  if (!list.length) return null;
  if (!chosen) return list[0];
  return list.find((e) => e >= chosen) ?? list[list.length - 1];
}

// ── One column ───────────────────────────────────────────────────────────────
function Column({ name, d, isLoading, chosen, rows, windowMin, palette, change }: {
  name: typeof NAMES[number]; d: GexResult | undefined; isLoading: boolean; chosen: string | null;
  rows: number; windowMin: number; palette: Palette; change: number | null | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const exp = expiryFor(d, chosen);
  const col = useMemo(() => {
    if (!d || d.error || !exp) return null;
    const ei = (d.heatmap_expiries ?? []).indexOf(exp);
    const strikes = d.heatmap_strikes ?? [];
    const vals = d.heatmap_values?.[ei] ?? [];
    const all = new Map<number, number>(strikes.map((k, i) => [k, vals[i] ?? 0]));
    const sorted = [...strikes].sort((a, b) => a - b);
    const si = sorted.reduce((b, k, i) => (Math.abs(k - d.spot) < Math.abs(sorted[b] - d.spot) ? i : b), 0);
    const lo = Math.max(0, Math.min(si - Math.floor(rows / 2), sorted.length - rows));
    const shown = sorted.slice(lo, lo + rows).reverse();
    const vmax = Math.max(1, ...shown.map((k) => Math.abs(all.get(k) ?? 0)));
    let king = sorted[0];
    for (const k of sorted) if (Math.abs(all.get(k) ?? 0) > Math.abs(all.get(king) ?? 0)) king = k;
    return { all, shown, vmax, king, spotRow: sorted[si] };
  }, [d, exp, rows]);

  const key = `${name.sym}|${exp}`;
  useEffect(() => { if (col) record(key, col.all); }, [key, col]);
  const base = col ? baseline(key, windowMin) : null;

  // keep the price row in the middle when the column first fills or the expiry changes
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>("[data-spot]");
    if (el && box.current) box.current.scrollTop = el.offsetTop - box.current.clientHeight / 2 + el.clientHeight / 2;
  }, [key, rows, !!col]);   // eslint-disable-line react-hooks/exhaustive-deps

  const kingDist = col && d ? (col.king / d.spot - 1) * 100 : null;
  const anchor = col && d ? anchorOf(d, exp) : null;
  const anchorDist = anchor && d ? (anchor.price / d.spot - 1) * 100 : null;
  return (
    <section className="flex min-w-0 flex-col border border-[var(--border-strong)] bg-[var(--surface)]" aria-label={`${name.label} gamma for ${exp ?? "no expiry"}`}>
      <header className="border-b border-[var(--border)] px-1.5 py-2 sm:px-3 sm:py-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <Link href={`/stocks/${name.sym}`} className="font-mono text-[13px] font-semibold text-foreground hover:text-accent sm:text-[15px]">{name.label}</Link>
          {exp && <span className="font-mono text-[10px] text-foreground/50 sm:text-[11px]" title={exp}><Fit phone={shortDay(exp)} full={dayLabel(exp)} /> · {daysTo(exp)}d</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono tabular-nums">
          <span className="text-[14px] font-medium text-foreground sm:text-[18px]">{d && !d.error ? d.spot.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</span>
          {change != null && <span className={clsx("rounded-[3px] px-1 text-[10.5px] sm:px-1.5 sm:text-[12px]", change >= 0 ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss")}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>}
        </div>
        {col && kingDist != null && (
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[10.5px] tabular-nums text-foreground/65 sm:text-[11.5px]" title="Largest |GEX| strike in this expiry, and how far it is from the price">
            <span className="text-[#b45309] dark:text-[#fde725]">★<span className="hidden sm:inline"> King</span> {fmtStrike(col.king)}</span>
            <span className={clsx("inline-flex items-center", Math.abs(kingDist) < 0.05 ? "text-foreground/60" : kingDist > 0 ? "text-gain" : "text-loss")}>
              {Math.abs(kingDist).toFixed(1)}%{Math.abs(kingDist) >= 0.05 && (kingDist > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
            </span>
          </p>
        )}
        {col && (
          <p className={clsx("mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10.5px] tabular-nums sm:text-[11.5px]", ANCHOR_TONE)}
            title={anchor ? "Gamma-weighted centre of positive GEX within 10% of the price for this expiry: where long-gamma dealers tend to pull the price."
              : "Positive gamma doesn't dominate near the price in this expiry, so there is no pin level."}>
            ⚓ {anchor && anchorDist != null ? <><span className="hidden sm:inline">Anchor </span>{anchor.price.toFixed(anchor.price >= 1000 ? 0 : 2)} <span className="text-foreground/55">{anchorDist >= 0 ? "+" : ""}{anchorDist.toFixed(1)}%</span></> : <span className="text-foreground/45"><Fit phone="—" full="No pin" /></span>}
          </p>
        )}
      </header>
      {isLoading ? <div className="skeleton m-3 h-[60vh]" />
        : !col ? <p className="p-4 text-[12.5px] text-foreground/55">{d?.error ?? `No options data for ${name.label} right now.`}</p>
        : (
          <div ref={box} className="max-h-[70vh] overflow-y-auto overscroll-contain">
            {col.shown.map((k) => {
              const v = col.all.get(k) ?? 0;
              const c = cellColor(v, col.vmax, palette);
              const was = base?.v.get(k);
              const pct = was != null && was !== 0 ? (v - was) / Math.abs(was) : null;
              const showPct = pct != null && Math.abs(pct) >= BADGE_MIN && Math.abs(v) >= BADGE_SIZE * col.vmax;
              const isSpot = k === col.spotRow, isKing = k === col.king;
              return (
                <div key={k} {...(isSpot ? { "data-spot": "" } : {})}
                  className={clsx("grid grid-cols-[38px_30px_minmax(0,1fr)] items-stretch border-b border-[var(--background)] font-mono text-[10.5px] tabular-nums sm:grid-cols-[66px_54px_minmax(0,1fr)] sm:text-[12px]",
                    isSpot && "outline outline-2 -outline-offset-2 outline-foreground")}>
                  <span className={clsx("flex items-center whitespace-nowrap px-1 sm:px-2", isSpot ? "bg-foreground font-semibold text-[var(--background)]" : "text-foreground/70")}>
                    {isSpot && <span className="hidden sm:inline">▸ </span>}{fmtStrike(k)}
                  </span>
                  <span className="flex items-center justify-center" style={{ background: c.bg }}>
                    {showPct && (
                      <span className={clsx("rounded-[3px] px-0.5 text-[9px] font-medium leading-[14px] sm:px-1 sm:text-[10px] sm:leading-[15px]", pct! > 0 ? "bg-gain text-white" : "bg-loss text-white")}
                        title={`${pct! > 0 ? "+" : ""}${(pct! * 100).toFixed(1)}% vs ${windowMin} min ago`}>
                        {pct! > 0 ? "+" : ""}<Fit phone={Math.round(pct! * 100)} full={Math.abs(pct!) >= 0.995 ? Math.round(pct! * 100) : (pct! * 100).toFixed(1)} />%
                      </span>
                    )}
                  </span>
                  <span className={clsx("flex items-center justify-end gap-0.5 whitespace-nowrap py-[5px] pr-1 sm:gap-1 sm:pr-2", isKing && "font-semibold")} style={{ background: c.bg, color: c.fg }}>
                    <Fit phone={fmtCompact(v)} full={fmtMoney(v)} />{isKing && <span aria-label="King">★</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
    </section>
  );
}

// ── Single-expiry dropdown ───────────────────────────────────────────────────
function ExpirySelect({ options, value, onChange }: { options: string[]; value: string | null; onChange: (e: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const current = value ?? options[0] ?? null;
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} disabled={!options.length}
        className="inline-flex items-center gap-2 border border-[var(--border-strong)] px-2.5 py-1 font-mono text-[12px] text-foreground hover:border-foreground/50 disabled:opacity-50">
        <CalendarDays size={13} className="text-foreground/55" />
        {current ? <>{dayLabel(current)} <span className="text-foreground/45">{daysTo(current)}d</span></> : "Expiry"}
        <ChevronDown size={13} className={clsx("text-foreground/50 transition", open && "rotate-180")} />
      </button>
      {open && (
        <ul role="listbox" aria-label="Expiry" className="absolute left-0 z-40 mt-1 max-h-[60vh] w-[220px] overflow-y-auto border border-[var(--border-strong)] bg-[var(--background)] py-1 shadow-xl">
          {options.map((e, i) => (
            <li key={e} role="option" aria-selected={e === current}>
              <button type="button" onClick={() => { onChange(i === 0 ? null : e); setOpen(false); }}
                className={clsx("flex w-full items-center gap-2.5 px-3 py-1.5 text-left font-mono text-[12px] tabular-nums hover:bg-foreground/[0.05]", e === current && "bg-foreground/[0.04]")}>
                <Check size={12} className={e === current ? "text-accent" : "invisible"} />
                <span className="flex-1">{dayLabel(e)}</span>
                <span className="text-[11px] text-foreground/45">{i === 0 ? "nearest" : `${daysTo(e)}d`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function TrinityPage() {
  const spx = useLiveGex("SPX"), spy = useLiveGex("SPY"), qqq = useLiveGex("QQQ");
  const data = [spx, spy, qqq];
  const quotes = useQuotes(NAMES.map((n) => n.quote));
  const [chosen, setChosen] = useState<string | null>(null);     // null = always the nearest expiry
  const [rows, setRows] = useState<number>(40);
  const [windowMin, setWindowMin] = useState<number>(5);
  const [palette, setPalette] = useState<Palette>(DEFAULT_HEAT_OPTS.palette);
  const [, tick] = useState(0);
  useEffect(() => { setPalette(readPalette()); }, []);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 15_000); return () => clearInterval(id); }, []);   // age the badges

  // Expiries any of the three lists, in date order (each column falls back to its own nearest on/after the pick).
  const options = useMemo(() => Array.from(new Set(data.flatMap((q) => q.data?.heatmap_expiries ?? []))).sort(),
    [spx.data, spy.data, qqq.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen w-full bg-[var(--background)]">
      <div className="px-4 pt-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50">Flow</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">Trinity</h1>
          </div>
          <p className="max-w-md text-right text-[12.5px] leading-relaxed text-foreground/50">
            SPX, SPY and QQQ for one expiry, side by side. ★ is each one&apos;s King; the badges show how much a strike&apos;s gamma changed over the window.
          </p>
        </div>
        <div className="-mx-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-[var(--border-strong)] px-4 py-2 sm:-mx-8 sm:px-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Expiry</span>
            <ExpirySelect options={options} value={chosen} onChange={setChosen} />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Strikes</span>
            <div role="radiogroup" aria-label="Strikes around the price" className="flex">
              {ROWS.map((n) => (
                <button key={n} role="radio" aria-checked={rows === n} onClick={() => setRows(n)}
                  className={clsx("px-2 py-1 font-mono text-[12px] tabular-nums", rows === n ? "text-foreground underline decoration-2 underline-offset-[6px]" : "text-foreground/45 hover:text-foreground")}>{n}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Change over</span>
            <div role="radiogroup" aria-label="Change window" className="flex">
              {WINDOWS.map((m) => (
                <button key={m} role="radio" aria-checked={windowMin === m} onClick={() => setWindowMin(m)}
                  className={clsx("px-2 py-1 font-mono text-[12px] tabular-nums", windowMin === m ? "text-foreground underline decoration-2 underline-offset-[6px]" : "text-foreground/45 hover:text-foreground")}>{m}m</button>
              ))}
            </div>
          </div>
          <p className="ml-auto text-[11.5px] text-foreground/45">Change badges build up while this page is open.</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 px-2 pb-10 pt-3 sm:gap-3 sm:px-8 sm:pt-4">
        {NAMES.map((n, i) => (
          <Column key={n.sym} name={n} d={data[i].data} isLoading={data[i].isLoading} chosen={chosen} rows={rows} windowMin={windowMin}
            palette={palette} change={quotes.data?.[n.quote]?.change_pct} />
        ))}
      </div>
    </div>
  );
}
