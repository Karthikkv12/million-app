"use client";
/**
 * Watchlists: up to 20 named lists. The first visit seeds "My watchlist" (the old single list)
 * plus one list per sector, each starting with its SPDR ETF. The list name is a dropdown (like
 * Robinhood's): pick one list, or a whole category ("All symbols", "All sectors", "All my lists")
 * which merges its lists. ⋮ holds Edit name / Restore / Delete. Sector narrows the table by the
 * quote's own sector. Quotes come from /market/watchlist-quotes and refresh every minute.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, X, type LucideIcon } from "lucide-react";
import TickerSearchInput from "@/components/TickerSearchInput";
import { Panel, SkeletonCard } from "@/components/ui";
import {
  addToWatchlistGroup, createWatchlistGroup, deleteWatchlistGroup, fetchBrokerPortfolio, fetchWatchlistGroups,
  fetchWatchlistQuotes, removeFromWatchlistGroup, restoreSectorWatchlists, updateWatchlistGroup,
  BrokerPortfolio, WatchlistGroup, WatchlistGroups, WatchlistQuote,
} from "@/lib/api";
import { pct, TD, TH, tone, usd } from "./broker";

type SortKey = "symbol" | "price" | "change_pct" | "market_cap" | "pe_ratio" | "range" | "sector";
type Category = "all" | "sector" | "custom";
const KEY = ["watchlists"];
const SEL_KEY = "watchlist_selected";
const ALL = -1;                                   // the "All symbols" pseudo-list
const QUOTE_CAP = 150;                            // /market/watchlist-quotes limit

const pos = (price?: number | null, lo?: number | null, hi?: number | null) =>
  price == null || lo == null || hi == null || hi <= lo ? null : Math.min(1, Math.max(0, (price - lo) / (hi - lo)));


export function WatchlistTab() {
  const qc = useQueryClient();
  const [category, setCategory] = useState<Category>("all");
  const [selected, setSelected] = useState<number>(ALL);
  const [sector, setSector] = useState<string>("");
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "symbol", dir: 1 });

  const groupsQ = useQuery<WatchlistGroups>({ queryKey: KEY, queryFn: fetchWatchlistGroups });
  const lists = useMemo(() => groupsQ.data?.lists ?? [], [groupsQ.data]);
  const maxLists = groupsQ.data?.max_lists ?? 20;

  // Remember the open list between visits.
  useEffect(() => { try { const v = Number(localStorage.getItem(SEL_KEY)); if (v) setSelected(v); } catch { /* storage off */ } }, []);
  useEffect(() => { try { localStorage.setItem(SEL_KEY, String(selected)); } catch { /* storage off */ } }, [selected]);

  const inCategory = lists.filter((g) => category === "all" || g.kind === category);
  const current = lists.find((g) => g.id === selected) ?? null;
  // A list that's gone (deleted, or hidden by the category) falls back to "All symbols".
  useEffect(() => {
    if (selected !== ALL && groupsQ.data && (!current || (category !== "all" && current.kind !== category))) setSelected(ALL);
  }, [selected, current, category, groupsQ.data]);

  const symbols = useMemo(() => {
    const src = current ? [current] : inCategory;
    return [...new Set(src.flatMap((g) => g.symbols))];
  }, [current, inCategory]);
  const memberOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of lists) for (const s of g.symbols) m.set(s, [...(m.get(s) ?? []), g.name]);
    return m;
  }, [lists]);

  const shown = symbols.slice(0, QUOTE_CAP);
  const quotes = useQuery<WatchlistQuote[]>({
    queryKey: ["watchlist", "quotes", [...shown].sort().join(",")],
    queryFn: () => fetchWatchlistQuotes(shown),
    enabled: shown.length > 0,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
  const { data: pf } = useQuery<BrokerPortfolio>({ queryKey: ["broker", "portfolio", null], queryFn: () => fetchBrokerPortfolio(null), refetchInterval: 60_000 });
  const owned = useMemo(() => new Set((pf?.holdings ?? []).map((h) => h.symbol)), [pf]);

  // ── mutations ──
  const setList = (g: WatchlistGroup) => qc.setQueryData<WatchlistGroups>(KEY, (d) => d && { ...d, lists: d.lists.map((x) => (x.id === g.id ? g : x)) });
  const fail = (e: Error) => setErr(e.message || "Something went wrong.");
  const add = useMutation({
    mutationFn: ({ id, s }: { id: number; s: string }) => addToWatchlistGroup(id, s),
    onSuccess: (g) => { setList(g); setInput(""); setErr(null); }, onError: fail,
  });
  const remove = useMutation({
    mutationFn: ({ id, s }: { id: number; s: string }) => removeFromWatchlistGroup(id, s),
    onSuccess: setList, onError: fail,
  });
  const replace = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { name?: string; symbols?: string[] } }) => updateWatchlistGroup(id, body),
    onSuccess: (g) => { setList(g); setRename(null); setErr(null); }, onError: fail,
  });
  const create = useMutation({
    mutationFn: (name: string) => createWatchlistGroup(name),
    onSuccess: (g) => {
      qc.setQueryData<WatchlistGroups>(KEY, (d) => d && { ...d, lists: [...d.lists, g] });
      setNewName(null); setErr(null); setCategory("all"); setSelected(g.id);
    },
    onError: fail,
  });
  const drop = useMutation({
    mutationFn: (id: number) => deleteWatchlistGroup(id),
    onSuccess: (_v, id) => { qc.setQueryData<WatchlistGroups>(KEY, (d) => d && { ...d, lists: d.lists.filter((x) => x.id !== id) }); setSelected(ALL); },
    onError: fail,
  });
  const restore = useMutation({ mutationFn: restoreSectorWatchlists, onSuccess: (d) => qc.setQueryData(KEY, d), onError: fail });

  const onAdd = (raw: string) => {
    if (!current) return;
    const s = raw.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.\-^=]{0,11}$/.test(s)) { setErr("Enter a ticker symbol, e.g. AAPL."); return; }
    if (current.symbols.includes(s)) { setErr(`${s} is already in ${current.name}.`); return; }
    add.mutate({ id: current.id, s });
  };
  const missingHoldings = current ? [...owned].filter((s) => !current.symbols.includes(s)) : [];
  const sectorListsMissing = lists.filter((g) => g.kind === "sector").length < 11;

  // ── rows ──
  const qmap = useMemo(() => new Map((quotes.data ?? []).map((r) => [r.symbol, r])), [quotes.data]);
  const sectorsInView = useMemo(() => [...new Set(symbols.map((s) => qmap.get(s)?.sector).filter(Boolean) as string[])].sort(), [symbols, qmap]);
  useEffect(() => { if (sector && quotes.data && !sectorsInView.includes(sector)) setSector(""); }, [sector, sectorsInView, quotes.data]);
  const rows = useMemo(() => {
    const out = shown.map((s) => ({ symbol: s, q: qmap.get(s) })).filter((r) => !sector || r.q?.sector === sector);
    const val = (r: (typeof out)[number]): string | number | null => {
      switch (sort.key) {
        case "symbol": return r.symbol;
        case "sector": return r.q?.sector ?? null;
        case "range": return pos(r.q?.price, r.q?.week_52_low, r.q?.week_52_high);
        default: return (r.q?.[sort.key] as number | null | undefined) ?? null;
      }
    };
    // Inside a list, "Symbol" sort keeps the list's own order (ETF first on sector lists).
    if (sort.key === "symbol" && current) return sort.dir === 1 ? out : [...out].reverse();
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [shown, qmap, sector, sort, current]);
  const up = rows.filter((r) => (r.q?.change_pct ?? 0) > 0).length;
  const down = rows.filter((r) => (r.q?.change_pct ?? 0) < 0).length;

  const head = (key: SortKey, label: string, right = true, cls = "") => (
    <th className={clsx(TH, right && "text-right", cls)}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === "symbol" || key === "sector" ? 1 : -1 }))}
        className={clsx("inline-flex items-center gap-1 uppercase hover:text-foreground", sort.key === key && "text-foreground")}>
        {label}{sort.key === key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );

  if (groupsQ.isLoading) return <SkeletonCard rows={6} />;
  if (groupsQ.isError) return <p className="py-10 text-center text-[13px] text-loss">Couldn&apos;t load your watchlists. {(groupsQ.error as Error)?.message}</p>;

    const atLimit = lists.length >= maxLists;

  return (
    <div className="space-y-4">
      {/* Robinhood-style header: the open list's name is the dropdown; ⋮ holds the list actions. */}
      <div className="flex items-center justify-between gap-3">
        <ListPicker
          label={current ? current.name : category === "sector" ? "All sectors" : category === "custom" ? "All my lists" : "All symbols"}
          lists={lists} selected={selected} category={category}
          onPick={(cat, id) => { setCategory(cat); setSelected(id); setSector(""); setErr(null); }}
          onNew={atLimit ? undefined : () => { setNewName(""); setErr(null); }}
          used={lists.length} max={maxLists}
        />
        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden font-mono text-[11px] text-foreground/45 sm:inline">{lists.length}/{maxLists} lists</span>
          <button onClick={() => { setNewName(""); setErr(null); }} disabled={atLimit} aria-label="New list" title={atLimit ? `Up to ${maxLists} lists` : "New list"}
            className="grid h-9 w-9 place-items-center rounded-lg text-foreground/60 transition hover:bg-[var(--surface-2)] hover:text-foreground disabled:opacity-35">
            <Plus size={17} />
          </button>
          <ActionsMenu items={[
            ...(current ? [{ label: "Edit name", icon: Pencil, onClick: () => setRename(current.name) }] : []),
            ...(sectorListsMissing ? [{ label: "Restore sector lists", icon: RotateCcw, onClick: () => restore.mutate(), disabled: atLimit }] : []),
            ...(current ? [{ label: "Delete list", icon: Trash2, danger: true, onClick: () => {
              if (window.confirm(`Delete the list "${current.name}"? Its ${current.symbols.length} symbols go with it.`)) drop.mutate(current.id);
            } }] : []),
          ]} />
        </div>
      </div>

      {(newName != null || (rename != null && current)) && (
        <form onSubmit={(e) => {
            e.preventDefault();
            if (newName != null) { if (newName.trim()) create.mutate(newName.trim()); }
            else if (current && rename?.trim()) replace.mutate({ id: current.id, body: { name: rename.trim() } });
          }}
          className="flex max-w-sm items-center gap-1 rounded-xl border border-foreground/40 py-1 pl-3 pr-1">
          <input autoFocus maxLength={40} placeholder={newName != null ? "New list name" : "List name"}
            value={newName ?? rename ?? ""} onChange={(e) => (newName != null ? setNewName(e.target.value) : setRename(e.target.value))}
            onKeyDown={(e) => { if (e.key === "Escape") { setNewName(null); setRename(null); } }}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground/40" />
          <button type="submit" className="h-7 rounded-lg bg-foreground px-3 text-[12px] font-medium text-[var(--background)]">{newName != null ? "Create" : "Save"}</button>
          <button type="button" aria-label="Cancel" onClick={() => { setNewName(null); setRename(null); }} className="rounded-lg p-1.5 text-foreground/50 hover:text-foreground"><X size={14} /></button>
        </form>
      )}

      {/* Tools for the open list. */}
      {current && (
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-full max-w-sm">
            <TickerSearchInput value={input} onChange={(v) => { setInput(v); setErr(null); }} onSelect={onAdd}
              placeholder={`Add to ${current.name}…`} actionLabel={add.isPending ? "…" : "ADD"} />
          </div>
          {current.kind === "custom" && missingHoldings.length > 0 && (
            <button onClick={() => replace.mutate({ id: current.id, body: { symbols: [...current.symbols, ...missingHoldings].slice(0, groupsQ.data?.max_symbols ?? 100) } })}
              disabled={replace.isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 text-[12px] font-medium text-foreground/70 transition hover:text-foreground disabled:opacity-50">
              <Plus size={13} /> Add my {missingHoldings.length} holding{missingHoldings.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      )}
      {err && <p className="text-[12px] text-loss">{err}</p>}

      {!symbols.length ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] px-6 py-14 text-center">
          <p className="text-[15px] font-medium text-foreground">{current ? `${current.name} is empty` : "No symbols here yet"}</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] text-foreground/55">
            {current ? "Search for a ticker above to add it." : "Pick a list, or make a new one, and add tickers to it."}
          </p>
        </div>
      ) : (
        <Panel padded={false}
          title="Quotes"
          sub={<span>{rows.length}{sector ? ` of ${shown.length}` : ""} symbols · <span className="text-gain">{up} up</span> · <span className="text-loss">{down} down</span>
            {symbols.length > QUOTE_CAP ? ` · first ${QUOTE_CAP} quoted` : ""}{quotes.isFetching ? " · refreshing…" : ""}</span>}
          actions={sectorsInView.length > 1 ? (
            <label className="flex items-center gap-1.5 text-[12px] text-foreground/55">
              Sector
              <select value={sector} onChange={(e) => setSector(e.target.value)}
                className="h-8 max-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] text-foreground">
                <option value="">All sectors</option>
                {sectorsInView.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          ) : undefined}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {head("symbol", current ? "Symbol · list order" : "Symbol", false)}
                  {head("price", "Price")}
                  {head("change_pct", "Today")}
                  <th className={`${TH} text-right`}>Day range</th>
                  {head("range", "52-week", true, "w-[150px]")}
                  {head("market_cap", "Mkt cap")}
                  {head("pe_ratio", "P/E")}
                  {head("sector", "Sector", false)}
                  <th className={TH}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ symbol, q }) => {
                  const p52 = pos(q?.price, q?.week_52_low, q?.week_52_high);
                  const lists = memberOf.get(symbol) ?? [];
                  return (
                    <tr key={symbol} className="group border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                      <td className={TD}>
                        <Link href={`/stocks/${symbol}`} className="font-medium text-foreground hover:text-accent">{symbol}</Link>
                        {owned.has(symbol) && <span className="ml-2 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 font-sans text-[10px] text-foreground/55">Held</span>}
                        <p className="max-w-[240px] truncate font-sans text-[11px] text-foreground/45">
                          {q?.name ?? (quotes.isLoading ? "…" : q?.error ? "No quote" : "")}
                          {!current && lists.length > 0 && <span className="text-foreground/35"> · {lists.join(", ")}</span>}
                        </p>
                      </td>
                      <td className={`${TD} text-right text-foreground`}>{usd(q?.price)}</td>
                      <td className={`${TD} text-right ${tone(q?.change_pct)}`}>
                        {q?.change_pct != null ? pct(q.change_pct / 100) : "—"}
                        <p className="text-[11px]">{q?.change != null ? `${q.change > 0 ? "+" : ""}${q.change.toFixed(2)}` : ""}</p>
                      </td>
                      <td className={`${TD} text-right text-[12px] text-foreground/65`}>
                        {q?.day_low != null && q?.day_high != null ? `${q.day_low.toFixed(2)} – ${q.day_high.toFixed(2)}` : "—"}
                      </td>
                      <td className={`${TD} text-right`}>
                        {p52 != null ? (
                          <div title={`52w low ${usd(q?.week_52_low)} · high ${usd(q?.week_52_high)}`}>
                            <div className="relative ml-auto h-1 w-[120px] rounded-full bg-[var(--border)]">
                              <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-accent" style={{ left: `${p52 * 100}%` }} />
                            </div>
                            <p className="mt-1 text-[10.5px] text-foreground/45">{(p52 * 100).toFixed(0)}% of range</p>
                          </div>
                        ) : <span className="text-foreground/40">—</span>}
                      </td>
                      <td className={`${TD} text-right text-foreground/80`}>{q?.market_cap_fmt ?? "—"}</td>
                      <td className={`${TD} text-right text-foreground/80`}>{q?.pe_ratio != null ? q.pe_ratio.toFixed(1) : "—"}</td>
                      <td className={`${TD} max-w-[160px] truncate font-sans text-[12px] text-foreground/65`}>
                        {q?.sector ? <button onClick={() => setSector(q.sector!)} className="hover:text-foreground hover:underline">{q.sector}</button> : "—"}
                      </td>
                      <td className={`${TD} w-10 text-right`}>
                        {current && (
                          <button onClick={() => remove.mutate({ id: current.id, s: symbol })} aria-label={`Remove ${symbol} from ${current.name}`} title={`Remove from ${current.name}`}
                            className="rounded-md p-1 text-foreground/35 transition hover:bg-[var(--surface)] hover:text-loss sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">
                            <X size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

/** Close a popover on outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("touchstart", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("touchstart", down); document.removeEventListener("keydown", key); };
  }, [open, close]);
  return ref;
}

const MENU = "absolute z-30 mt-1.5 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-1 shadow-[var(--shadow-float)]";
const ITEM = "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition hover:bg-[var(--surface-2)]";

/** The list name as a dropdown: categories first, then every list grouped by Sectors / My lists. */
function ListPicker({ label, lists, selected, category, onPick, onNew, used, max }: {
  label: string; lists: WatchlistGroup[]; selected: number; category: Category;
  onPick: (cat: Category, id: number) => void; onNew?: () => void; used: number; max: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const pick = (cat: Category, id: number) => { onPick(cat, id); setOpen(false); };
  const uniq = (gs: WatchlistGroup[]) => new Set(gs.flatMap((g) => g.symbols)).size;
  const sectors = lists.filter((g) => g.kind === "sector");
  const mine = lists.filter((g) => g.kind === "custom");
  const row = (key: string, text: string, n: number, on: boolean, go: () => void, strong = false) => (
    <button key={key} role="option" aria-selected={on} onClick={go}
      className={clsx(ITEM, on ? "bg-[var(--surface-2)] text-foreground" : "text-foreground/80", strong && "font-medium")}>
      <span className="w-3.5 shrink-0">{on && <Check size={14} />}</span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <span className="font-mono text-[11px] text-foreground/45">{n}</span>
    </button>
  );
  const group = (title: string) => <p className="px-2.5 pb-1 pt-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground/45">{title}</p>;
  return (
    <div ref={ref} className="relative min-w-0">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-left transition hover:opacity-80">
        <span className="truncate text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground">{label}</span>
        <ChevronsUpDown size={18} className="shrink-0 text-foreground/55" />
      </button>
      {open && (
        <div role="listbox" className={clsx(MENU, "left-0 max-h-[70vh] w-[min(320px,calc(100vw-32px))]")}>
          {row("all", "All symbols", uniq(lists), selected === ALL && category === "all", () => pick("all", ALL), true)}
          {row("all-s", "All sectors", uniq(sectors), selected === ALL && category === "sector", () => pick("sector", ALL), true)}
          {row("all-c", "All my lists", uniq(mine), selected === ALL && category === "custom", () => pick("custom", ALL), true)}
          {sectors.length > 0 && group("Sectors")}
          {sectors.map((g) => row(String(g.id), g.name, g.symbols.length, selected === g.id, () => pick("all", g.id)))}
          {group("My lists")}
          {mine.map((g) => row(String(g.id), g.name, g.symbols.length, selected === g.id, () => pick("all", g.id)))}
          <div className="mt-1 border-t border-[var(--border)] pt-1">
            <button onClick={() => { setOpen(false); onNew?.(); }} disabled={!onNew}
              className={clsx(ITEM, "text-accent disabled:text-foreground/35")}>
              <Plus size={14} /> <span className="flex-1">New list</span>
              <span className="font-mono text-[11px] text-foreground/45">{used}/{max}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** ⋮ menu for the open list. */
function ActionsMenu({ items }: { items: { label: string; icon: LucideIcon; onClick: () => void; danger?: boolean; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="List actions" aria-haspopup="menu" aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-lg text-foreground/60 transition hover:bg-[var(--surface-2)] hover:text-foreground">
        <MoreHorizontal size={18} className="rotate-90" />
      </button>
      {open && (
        <div role="menu" className={clsx(MENU, "right-0 w-52")}>
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}
              className={clsx(ITEM, it.danger ? "text-loss" : "text-foreground/85", "disabled:opacity-40")}>
              <it.icon size={14} /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
