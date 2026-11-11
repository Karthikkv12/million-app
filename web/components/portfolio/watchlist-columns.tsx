"use client";
/**
 * Watchlist columns: every metric a list can show, and the "Customize columns" picker.
 * Each list saves its own column ids, in order (WatchlistGroup.columns); null = DEFAULT_COLUMNS.
 * Ids are stored server-side, so never rename one: add a new id instead.
 */
import { useRef, useState } from "react";
import { clsx } from "clsx";
import { Check, GripVertical, X } from "lucide-react";
import type { OptionMetrics, WatchlistQuote } from "@/lib/api";
import { pct, tone, usd } from "./broker";

export interface WRow {
  symbol: string;
  q?: WatchlistQuote;
  o?: OptionMetrics;
  /** Net delta of my book in this symbol, share-equivalents (live hedge books). */
  posDelta?: number | null;
  shares?: number | null;
}

type Need = "options" | "books";
export interface Col {
  id: string;
  label: string;
  group: Group;
  help?: string;
  left?: boolean;
  needs?: Need;
  width?: string;
  sort: (r: WRow) => number | string | null | undefined;
  cell: (r: WRow) => React.ReactNode;
}
export type Group = "Price" | "Volume" | "Range" | "Fundamentals" | "Options" | "My position";
export const GROUPS: Group[] = ["Price", "Volume", "Range", "Options", "Fundamentals", "My position"];

const dash = <span className="text-foreground/35">—</span>;
const num = (v: number | null | undefined, d = 2) => (v == null ? dash : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const big = (v: number | null | undefined) => {
  if (v == null) return dash;
  const a = Math.abs(v);
  return a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0);
};
const pctOf = (v: number | null | undefined, d = 1) => (v == null ? dash : `${(v * 100).toFixed(d)}%`);
/** Yahoo's dividendYield is a percent number on newer feeds (0.45 = 0.45%) and a fraction on older ones. */
const divPct = (v: number | null | undefined) => (v == null ? null : v > 0.2 ? v / 100 : v);
const range = (p?: number | null, lo?: number | null, hi?: number | null) =>
  p == null || lo == null || hi == null || hi <= lo ? null : Math.min(1, Math.max(0, (p - lo) / (hi - lo)));
const vsAvg = (p?: number | null, avg?: number | null) => (p != null && avg ? p / avg - 1 : null);

function RangeBar({ at, title }: { at: number | null; title?: string }) {
  if (at == null) return dash;
  return (
    <div title={title} className="inline-block">
      <div className="relative ml-auto h-1 w-[96px] rounded-full bg-[var(--border)]">
        <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-accent" style={{ left: `${at * 100}%` }} />
      </div>
      <p className="mt-1 text-right text-[10.5px] text-foreground/45">{(at * 100).toFixed(0)}% of range</p>
    </div>
  );
}

export const COLUMNS: Col[] = [
  // Price
  { id: "last", label: "Last", group: "Price", sort: (r) => r.q?.price, cell: (r) => <span className="text-foreground">{usd(r.q?.price)}</span> },
  { id: "change", label: "Net change", group: "Price", sort: (r) => r.q?.change,
    cell: (r) => <span className={tone(r.q?.change)}>{r.q?.change == null ? "—" : `${r.q.change > 0 ? "+" : ""}${r.q.change.toFixed(2)}`}</span> },
  { id: "change_pct", label: "Change %", group: "Price", sort: (r) => r.q?.change_pct,
    cell: (r) => <span className={tone(r.q?.change_pct)}>{r.q?.change_pct != null ? pct(r.q.change_pct / 100) : "—"}</span> },
  { id: "prev_close", label: "Previous close", group: "Price", sort: (r) => r.q?.prev_close, cell: (r) => usd(r.q?.prev_close) },
  { id: "day_high", label: "High", group: "Price", sort: (r) => r.q?.day_high, cell: (r) => usd(r.q?.day_high) },
  { id: "day_low", label: "Low", group: "Price", sort: (r) => r.q?.day_low, cell: (r) => usd(r.q?.day_low) },
  { id: "day_range", label: "Day range", group: "Price", sort: (r) => range(r.q?.price, r.q?.day_low, r.q?.day_high),
    cell: (r) => (r.q?.day_low != null && r.q?.day_high != null ? <span className="text-[12px] text-foreground/65">{r.q.day_low.toFixed(2)} – {r.q.day_high.toFixed(2)}</span> : dash) },
  // Volume
  { id: "volume", label: "Volume", group: "Volume", sort: (r) => r.q?.volume, cell: (r) => big(r.q?.volume) },
  { id: "avg_volume", label: "Average volume", group: "Volume", sort: (r) => r.q?.avg_volume, cell: (r) => big(r.q?.avg_volume) },
  { id: "rel_volume", label: "Relative volume", group: "Volume", help: "Today's volume ÷ average", sort: (r) => r.q?.rel_volume,
    cell: (r) => (r.q?.rel_volume == null ? dash : <span className={r.q.rel_volume >= 2 ? "text-warn" : undefined}>{r.q.rel_volume.toFixed(2)}×</span>) },
  // Range
  { id: "w52_pos", label: "52W range", group: "Range", width: "w-[120px]", sort: (r) => range(r.q?.price, r.q?.week_52_low, r.q?.week_52_high),
    cell: (r) => <RangeBar at={range(r.q?.price, r.q?.week_52_low, r.q?.week_52_high)} title={`52W low ${usd(r.q?.week_52_low)} · high ${usd(r.q?.week_52_high)}`} /> },
  { id: "w52_high", label: "52W high", group: "Range", sort: (r) => r.q?.week_52_high, cell: (r) => usd(r.q?.week_52_high) },
  { id: "w52_low", label: "52W low", group: "Range", sort: (r) => r.q?.week_52_low, cell: (r) => usd(r.q?.week_52_low) },
  { id: "ma50", label: "vs 50-day avg", group: "Range", sort: (r) => vsAvg(r.q?.price, r.q?.fifty_day_avg),
    cell: (r) => { const v = vsAvg(r.q?.price, r.q?.fifty_day_avg); return <span className={tone(v)} title={`50-day ${usd(r.q?.fifty_day_avg)}`}>{v == null ? "—" : pct(v, 1)}</span>; } },
  { id: "ma200", label: "vs 200-day avg", group: "Range", sort: (r) => vsAvg(r.q?.price, r.q?.two_hundred_day_avg),
    cell: (r) => { const v = vsAvg(r.q?.price, r.q?.two_hundred_day_avg); return <span className={tone(v)} title={`200-day ${usd(r.q?.two_hundred_day_avg)}`}>{v == null ? "—" : pct(v, 1)}</span>; } },
  // Options
  { id: "atm_iv", label: "IV (ATM)", group: "Options", needs: "options", help: "Implied vol at the money, weekly expiry", sort: (r) => r.o?.atm_iv, cell: (r) => pctOf(r.o?.atm_iv) },
  { id: "iv_change", label: "IV change today", group: "Options", needs: "options", help: "ATM IV vs the first reading today", sort: (r) => r.o?.iv_change_day,
    cell: (r) => <span className={tone(r.o?.iv_change_day)}>{r.o?.iv_change_day == null ? "—" : pct(r.o.iv_change_day, 1)}</span> },
  { id: "hv20", label: "HV 20-day", group: "Options", needs: "options", help: "Historical (realised) vol, 20 days", sort: (r) => r.o?.hv20, cell: (r) => pctOf(r.o?.hv20) },
  { id: "iv_hv", label: "IV / HV", group: "Options", needs: "options", help: "Over 1: options price more movement than the stock has shown", sort: (r) => r.o?.iv_hv,
    cell: (r) => (r.o?.iv_hv == null ? dash : <span className={r.o.iv_hv >= 1.5 ? "text-warn" : undefined}>{r.o.iv_hv.toFixed(2)}</span>) },
  { id: "exp_move", label: "Expected move", group: "Options", needs: "options", help: "± to the weekly expiry: price × IV × √(days/365)", sort: (r) => r.o?.expected_move_pct,
    cell: (r) => (r.o?.expected_move == null ? dash : <span>±{usd(r.o.expected_move)}<span className="block text-[11px] text-foreground/45">{pctOf(r.o.expected_move_pct)} · {r.o.expiry?.slice(5)}</span></span>) },
  { id: "atm_call_delta", label: "Delta, call (ATM)", group: "Options", needs: "options", help: "Delta of the weekly at-the-money call", sort: (r) => r.o?.atm_call_delta, cell: (r) => num(r.o?.atm_call_delta) },
  { id: "atm_put_delta", label: "Delta, put (ATM)", group: "Options", needs: "options", help: "Delta of the weekly at-the-money put", sort: (r) => r.o?.atm_put_delta, cell: (r) => num(r.o?.atm_put_delta) },
  // Fundamentals
  { id: "market_cap", label: "Market cap", group: "Fundamentals", sort: (r) => r.q?.market_cap, cell: (r) => r.q?.market_cap_fmt ?? big(r.q?.market_cap) },
  { id: "pe_ratio", label: "P/E", group: "Fundamentals", sort: (r) => r.q?.pe_ratio, cell: (r) => num(r.q?.pe_ratio, 1) },
  { id: "forward_pe", label: "Forward P/E", group: "Fundamentals", sort: (r) => r.q?.forward_pe, cell: (r) => num(r.q?.forward_pe, 1) },
  { id: "eps", label: "EPS (TTM)", group: "Fundamentals", sort: (r) => r.q?.eps_ttm, cell: (r) => num(r.q?.eps_ttm) },
  { id: "eps_growth", label: "EPS growth", group: "Fundamentals", sort: (r) => r.q?.eps_growth,
    cell: (r) => <span className={tone(r.q?.eps_growth)}>{r.q?.eps_growth == null ? "—" : pct(r.q.eps_growth, 1)}</span> },
  { id: "div_yield", label: "Dividend yield", group: "Fundamentals", sort: (r) => divPct(r.q?.div_yield), cell: (r) => pctOf(divPct(r.q?.div_yield), 2) },
  { id: "beta", label: "Beta", group: "Fundamentals", sort: (r) => r.q?.beta, cell: (r) => num(r.q?.beta) },
  { id: "rating", label: "Analyst rating", group: "Fundamentals", left: true, sort: (r) => r.q?.analyst_rating,
    cell: (r) => <span className="font-sans text-[12px] text-foreground/70">{r.q?.analyst_rating ?? "—"}</span> },
  { id: "sector", label: "Sector", group: "Fundamentals", left: true, sort: (r) => r.q?.sector,
    cell: (r) => <span className="font-sans text-[12px] text-foreground/65">{r.q?.sector ?? "—"}</span> },
  { id: "industry", label: "Industry", group: "Fundamentals", left: true, sort: (r) => r.q?.industry,
    cell: (r) => <span className="block max-w-[180px] truncate font-sans text-[12px] text-foreground/65">{r.q?.industry ?? "—"}</span> },
  // My position
  { id: "pos_delta", label: "Position delta", group: "My position", needs: "books", help: "Net delta of your shares + options, in shares", sort: (r) => r.posDelta,
    cell: (r) => (r.posDelta == null ? dash : <span className="sensitive">{r.posDelta > 0 ? "+" : ""}{r.posDelta.toFixed(0)}</span>) },
  { id: "shares", label: "Shares held", group: "My position", sort: (r) => r.shares, cell: (r) => (r.shares ? <span className="sensitive">{r.shares}</span> : dash) },
];

export const COL = new Map(COLUMNS.map((c) => [c.id, c]));
export const DEFAULT_COLUMNS = ["last", "change_pct", "day_range", "w52_pos", "market_cap", "pe_ratio", "sector"];
/** The list's saved columns that still exist, else the default set. */
export const columnsFor = (saved?: string[] | null) => {
  const ids = (saved?.length ? saved : DEFAULT_COLUMNS).filter((id) => COL.has(id));
  return ids.length ? ids : DEFAULT_COLUMNS;
};

/** Robinhood-style "Customize columns": shown columns (reorder / remove) on top, then every metric by group. */
export function ColumnPicker({ value, onChange, onClose, onReset }: {
  value: string[]; onChange: (ids: string[]) => void; onClose: () => void; onReset: () => void;
}) {
  const [q, setQ] = useState("");
  const on = new Set(value);
  const toggle = (id: string) => onChange(on.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  // Drag to reorder (mouse and touch, by the ⠿ handle). The order is local while dragging and saved once on drop.
  const [drag, setDrag] = useState<{ id: string; order: string[] } | null>(null);
  const rowsRef = useRef(new Map<string, HTMLDivElement>());
  const order = drag?.order ?? value;
  const onDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, order: value });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const rest = drag.order.filter((x) => x !== drag.id);
    // New slot = how many of the other rows sit above the pointer.
    const at = rest.filter((x) => { const r = rowsRef.current.get(x)?.getBoundingClientRect(); return r && r.top + r.height / 2 < e.clientY; }).length;
    const next = [...rest.slice(0, at), drag.id, ...rest.slice(at)];
    if (next.join() !== drag.order.join()) setDrag({ id: drag.id, order: next });
  };
  const onUp = () => {
    if (drag && drag.order.join() !== value.join()) onChange(drag.order);
    setDrag(null);
  };
  /** Keyboard: focus the handle, ↑/↓ moves the column. */
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const j = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
    if (j < 0 || j >= value.length) return;
    e.preventDefault();
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const match = (c: Col) => !q || `${c.label} ${c.group} ${c.help ?? ""}`.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="flex max-h-[78vh] w-full flex-col sm:max-h-[min(78vh,640px)] sm:w-[360px]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <p className="text-[14px] font-medium text-foreground">Customize columns</p>
        <div className="flex items-center gap-1">
          <button onClick={onReset} className="rounded-lg px-2 py-1 text-[12px] text-foreground/55 hover:text-foreground">Reset</button>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-foreground/55 hover:text-foreground"><X size={15} /></button>
        </div>
      </div>
      <div className="overflow-y-auto p-1.5">
        <p className="px-2 pb-1 pt-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground/45">Shown · {value.length}</p>
        <p className="px-2 pb-1 text-[11px] text-foreground/40">Drag ⠿ to reorder: top = leftmost column.</p>
        {order.map((id, i) => {
          const c = COL.get(id)!;
          const dragging = drag?.id === id;
          return (
            <div key={id} ref={(el) => { if (el) rowsRef.current.set(id, el); else rowsRef.current.delete(id); }}
              className={clsx("flex select-none items-center gap-1 rounded-lg px-1 py-1.5 transition-shadow",
                dragging ? "relative z-10 bg-[var(--surface-2)] shadow-[var(--shadow-float)] ring-1 ring-[var(--border-strong)]" : "hover:bg-[var(--surface-2)]")}>
              <button aria-label={`Drag to move ${c.label}`} title="Drag to reorder"
                onPointerDown={(e) => onDown(e, id)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => onKey(e, i)}
                className={clsx("touch-none rounded p-1.5 text-foreground/40 hover:text-foreground", dragging ? "cursor-grabbing text-foreground" : "cursor-grab")}>
                <GripVertical size={16} />
              </button>
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{c.label}<span className="ml-1.5 text-[11px] text-foreground/40">{c.group}</span></span>
              <button onClick={() => toggle(id)} aria-label={`Hide ${c.label}`} className="rounded p-1.5 text-foreground/50 hover:text-loss"><X size={14} /></button>
            </div>
          );
        })}
        <div className="mx-1 my-2 border-t border-[var(--border)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a metric (IV, delta, volume…)"
          className="mx-1 mb-1 h-8 w-[calc(100%-8px)] rounded-lg border border-[var(--border)] bg-transparent px-2.5 text-[12.5px] text-foreground outline-none placeholder:text-foreground/40 focus:border-foreground/40" />
        {GROUPS.map((g) => {
          const cols = COLUMNS.filter((c) => c.group === g && match(c));
          if (!cols.length) return null;
          return (
            <div key={g}>
              <p className="px-2 pb-1 pt-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground/45">{g}</p>
              {cols.map((c) => (
                <button key={c.id} onClick={() => toggle(c.id)} role="menuitemcheckbox" aria-checked={on.has(c.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-2)]">
                  <span className={clsx("grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition",
                    on.has(c.id) ? "border-foreground bg-foreground text-[var(--background)]" : "border-[var(--border-strong)]")}>
                    {on.has(c.id) && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-foreground">{c.label}</span>
                    {c.help && <span className="block truncate text-[11px] text-foreground/45">{c.help}</span>}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
