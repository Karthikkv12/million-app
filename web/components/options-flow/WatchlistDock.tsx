"use client";
/**
 * WatchlistDock — the floating bar at the bottom of the Flow board for browsing a watchlist one name at a time.
 *
 *   [lists] [‹] [TICKER · price · move ⌃⌄] [›] [GEX | VEX]
 *
 * ‹ / › (or the ← / → keys) step through the chosen list and wrap at the ends. The lists button picks which
 * watchlist to browse ("All lists" merges them); the ticker button opens that list to jump straight to a name.
 * Above it, a small pill sums the board's exposure above and below the price. The next name's GEX is prefetched
 * so stepping feels instant. Lists come from /watchlists (the same lists as Portfolio → Watchlist), plus
 * "My stocks": every name you have a Robinhood position in, shares or options (bought or sold), largest exposure
 * first; it follows each Robinhood sync.
 * "My stocks" is the default until you pick another list.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, Layers, Zap, Activity } from "lucide-react";
import { BrokerPortfolio, fetchBrokerPortfolio, fetchGex, fetchWatchlistGroups, GexResult, WatchlistGroups } from "@/lib/api";
import { useQuotes } from "@/components/dashboard/quotes";
import type { Metric } from "./GexHeatmap";

const LIST_KEY = "flow_dock_list";
const ALL = -1;
const HELD = -2;                                  // "My stocks": Robinhood holdings

const money = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(0)}K` : `${s}$${a.toFixed(0)}`;
};

/** Net exposure summed over the shown expiries, split at the price (strikes above vs at-or-below). */
export function aboveBelow(data: GexResult | undefined, metric: Metric, expiries: string[] | null): { above: number; below: number } | null {
  if (!data || data.error) return null;
  const values = metric === "vex" ? data.heatmap_vex_values : data.heatmap_values;
  const strikes = data.heatmap_strikes ?? [];
  if (!values?.length || !strikes.length) return null;
  const cols = (data.heatmap_expiries ?? []).map((e, i) => [e, i] as const).filter(([e]) => !expiries || expiries.includes(e)).map(([, i]) => i);
  let above = 0, below = 0;
  strikes.forEach((k, si) => {
    const v = cols.reduce((a, ei) => a + (values[ei]?.[si] ?? 0), 0);
    if (k > data.spot) above += v; else below += v;
  });
  return { above, below };
}

/** Close a popover on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

const POP = "absolute bottom-full mb-2 max-h-[50vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-float)]";
const ROW = "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition hover:bg-foreground/[0.06]";

export function WatchlistDock({ ticker, metric, expiries, onTicker, onMetric }: {
  ticker: string;
  metric: Metric;
  /** The board's chosen expiry columns (null = all), so the above/below pill matches the table. */
  expiries: string[] | null;
  onTicker: (symbol: string) => void;
  onMetric: (m: Metric) => void;
}) {
  const qc = useQueryClient();
  const groupsQ = useQuery<WatchlistGroups>({ queryKey: ["watchlists"], queryFn: fetchWatchlistGroups, staleTime: 60_000 });
  const lists = useMemo(() => groupsQ.data?.lists ?? [], [groupsQ.data]);

  // Same query (and cache) as Portfolio; the holdings refresh with every Robinhood sync.
  const pfQ = useQuery<BrokerPortfolio>({ queryKey: ["broker", "portfolio", null], queryFn: () => fetchBrokerPortfolio(null), refetchInterval: 60_000 });
  // Exposure per name: stock market value + |contracts| × 100 × price (spot, else strike) for each option leg,
  // long or short. Options-only names count too.
  const held = useMemo(() => {
    const exp = new Map<string, number>();
    const add = (sym: string, v: number) => { const k = sym.toUpperCase(); exp.set(k, (exp.get(k) ?? 0) + v); };
    for (const h of pfQ.data?.holdings ?? []) if (h.shares > 0) add(h.symbol, Math.abs(h.market_value ?? 0));
    for (const o of pfQ.data?.options ?? []) if (o.contracts) add(o.symbol, Math.abs(o.contracts) * 100 * (o.spot ?? o.strike ?? 0));
    return [...exp.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [pfQ.data]);

  const [listId, setListId] = useState<number>(HELD);
  useEffect(() => { try { const v = Number(localStorage.getItem(LIST_KEY)); if (v) setListId(v); } catch { /* storage off */ } }, []);
  const pickList = (id: number) => { setListId(id); try { localStorage.setItem(LIST_KEY, String(id)); } catch { /* storage off */ } };

  // A deleted list falls back to My stocks.
  const current = lists.find((g) => g.id === listId) ?? null;
  const mode = listId === ALL ? "all" : current ? "list" : "held";
  const symbols = useMemo(() => {
    const raw = mode === "held" ? held : mode === "all" ? lists.flatMap((g) => g.symbols) : current!.symbols;
    return [...new Set(raw.map((s) => s.toUpperCase()))];
  }, [mode, held, lists, current]);
  const listName = mode === "held" ? "My stocks" : mode === "all" ? "All lists" : current!.name;

  const idx = symbols.indexOf(ticker.toUpperCase());
  const step = (d: 1 | -1) => {
    if (!symbols.length) return;
    const i = idx < 0 ? (d === 1 ? 0 : symbols.length - 1) : (idx + d + symbols.length) % symbols.length;
    onTicker(symbols[i]);
  };
  const next = symbols.length ? symbols[idx < 0 ? 0 : (idx + 1) % symbols.length] : null;

  // ← / → step through the list (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Warm the next name so › feels instant.
  useEffect(() => {
    if (next && next !== ticker.toUpperCase()) qc.prefetchQuery({ queryKey: ["gex", next], queryFn: () => fetchGex(next), staleTime: 60_000 });
  }, [next, ticker, qc]);

  const quote = useQuotes([ticker.toUpperCase()]).data?.[ticker.toUpperCase()];
  const gex = useQuery<GexResult>({ queryKey: ["gex", ticker], queryFn: () => fetchGex(ticker), staleTime: 60_000 }).data;
  const split = aboveBelow(gex, metric, expiries);

  const [listsOpen, setListsOpen] = useState(false);
  const [namesOpen, setNamesOpen] = useState(false);
  const listsRef = useDismiss(listsOpen, () => setListsOpen(false));
  const namesRef = useDismiss(namesOpen, () => setNamesOpen(false));

  const btn = "inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-foreground/70 transition hover:border-foreground/40 hover:text-foreground disabled:opacity-40";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[88px] z-30 flex justify-start px-3 pr-[76px] md:bottom-6 md:justify-center md:pr-3">
      <div className="pointer-events-auto flex w-full max-w-[600px] flex-col items-start gap-1.5">
        {split && (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 font-mono text-[11.5px] tabular-nums text-foreground/55 shadow-[var(--shadow-float)]">
            Above <span className={split.above < 0 ? "text-loss" : "text-gain"}>{money(split.above)}</span>
            {" · "}Below <span className={split.below < 0 ? "text-loss" : "text-gain"}>{money(split.below)}</span>
          </p>
        )}
        <div role="toolbar" aria-label="Browse watchlist"
          className="flex w-full items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-float)] sm:gap-1.5">
          <div ref={listsRef} className="relative">
            <button type="button" onClick={() => setListsOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={listsOpen}
              title={`Watchlist: ${listName}`} aria-label={`Watchlist: ${listName}`} className={clsx(btn, "w-9 sm:w-10")}>
              <Layers size={17} />
            </button>
            {listsOpen && (
              <div role="listbox" aria-label="Watchlists" className={clsx(POP, "left-0 w-60")}>
                {[{ id: HELD, name: "My stocks", n: held.length }, { id: ALL, name: "All lists", n: new Set(lists.flatMap((g) => g.symbols)).size },
                  ...lists.map((g) => ({ id: g.id, name: g.name, n: g.symbols.length }))].map((g) => {
                  const on = g.id === HELD ? mode === "held" : g.id === ALL ? mode === "all" : current?.id === g.id;
                  return (
                    <button key={g.id} role="option" aria-selected={on} onClick={() => { pickList(g.id); setListsOpen(false); }} className={ROW}>
                      <span className="flex min-w-0 items-center gap-2"><Check size={13} className={on ? "text-accent" : "invisible"} /><span className="truncate">{g.name}</span></span>
                      <span className="font-mono text-[11px] text-foreground/45">{g.n}</span>
                    </button>
                  );
                })}
                {groupsQ.isLoading && <p className="px-2.5 py-2 text-[12.5px] text-foreground/55">Loading lists…</p>}
              </div>
            )}
          </div>

          <button type="button" onClick={() => step(-1)} disabled={!symbols.length} aria-label="Previous name" title="Previous (←)" className={clsx(btn, "w-9 sm:w-10")}>
            <ChevronLeft size={18} />
          </button>

          <div ref={namesRef} className="relative min-w-0 flex-1">
            <button type="button" onClick={() => setNamesOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={namesOpen}
              className={clsx(btn, "w-full justify-between gap-1.5 px-2 sm:gap-2 sm:px-3")}>
              {/* Phones: price and move under the ticker; wider: one line. */}
              <span className="flex min-w-0 flex-col items-start font-mono leading-tight tabular-nums sm:flex-row sm:items-baseline sm:gap-2">
                <span className="text-[13.5px] font-semibold text-foreground sm:text-[14px]">{ticker.toUpperCase()}</span>
                {quote?.price != null && (
                  <span className="truncate text-[10.5px] sm:text-[12.5px]">
                    <span className="text-foreground/70">{quote.price.toFixed(2)}</span>{" "}
                    {quote.change_pct != null && (
                      <span className={quote.change_pct < 0 ? "text-loss" : "text-gain"}>{quote.change_pct >= 0 ? "+" : ""}{quote.change_pct.toFixed(2)}%</span>
                    )}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-foreground/40">
                {idx >= 0 && <span className="hidden sm:inline">{idx + 1}/{symbols.length}</span>}
                <ChevronsUpDown size={14} />
              </span>
            </button>
            {namesOpen && (
              <div role="listbox" aria-label={listName} className={clsx(POP, "left-0 right-0 min-w-[200px]")}>
                <p className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">{listName} · {symbols.length}</p>
                {symbols.map((s) => (
                  <button key={s} role="option" aria-selected={s === ticker.toUpperCase()} onClick={() => { onTicker(s); setNamesOpen(false); }}
                    className={clsx(ROW, "font-mono", s === ticker.toUpperCase() && "bg-foreground/[0.06] text-foreground")}>
                    {s}{s === ticker.toUpperCase() && <Check size={13} className="text-accent" />}
                  </button>
                ))}
                {!symbols.length && <p className="px-2.5 py-2 text-[12.5px] text-foreground/55">{mode === "held" ? (pfQ.isLoading ? "Loading your stocks…" : "No positions synced from Robinhood yet.") : "This list is empty."}</p>}
              </div>
            )}
          </div>

          <button type="button" onClick={() => step(1)} disabled={!symbols.length} aria-label="Next name" title="Next (→)" className={clsx(btn, "w-9 sm:w-10")}>
            <ChevronRight size={18} />
          </button>

          <div role="radiogroup" aria-label="Exposure" className="flex h-11 shrink-0 items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {([["gex", "GEX", Zap], ["vex", "VEX", Activity]] as const).map(([m, label, Icon]) => (
              <button key={m} type="button" role="radio" aria-checked={metric === m} onClick={() => onMetric(m)}
                title={m === "gex" ? "Gamma exposure, $ per 1% move" : "Vanna exposure, $ per 1 vol point"}
                className={clsx("inline-flex h-full items-center gap-1 rounded-lg px-1.5 font-mono text-[11.5px] font-medium uppercase tracking-[0.08em] transition sm:px-2.5",
                  metric === m ? "bg-foreground/[0.08] text-foreground" : "text-foreground/45 hover:text-foreground")}>
                <Icon size={13} className={metric === m && m === "gex" ? "text-amber-500" : undefined} />
                <span className="hidden min-[400px]:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
