"use client";
/**
 * Watchlists: up to 20 named lists. The first visit seeds "My watchlist" (the old single list)
 * plus one list per sector, each starting with its SPDR ETF. Every list is a tab, with + at the end to
 * add one; "All" merges every list. ⋮ holds Customize columns / Edit name / Restore / Delete. Sector narrows the table by the
 * quote's own sector. Quotes come from /market/watchlist-quotes and refresh every minute.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TickerLogo } from "@/components/TickerLogo";
import { clsx } from "clsx";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Columns3, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, X, type LucideIcon } from "lucide-react";
import TickerSearchInput from "@/components/TickerSearchInput";
import { Panel, SkeletonCard } from "@/components/ui";
import {
  addToWatchlistGroup, createWatchlistGroup, deleteWatchlistGroup, fetchBrokerPortfolio, fetchWatchlistGroups,
  fetchOptionMetrics, fetchWatchlistQuotes, removeFromWatchlistGroup, restoreSectorWatchlists, updateWatchlistGroup,
  BrokerPortfolio, OptionMetrics, WatchlistGroup, WatchlistGroups, WatchlistQuote,
} from "@/lib/api";
import { okBooks, useLiveBooks } from "@/lib/live";
import { TD, TH } from "./broker";
import { COL, ColumnPicker, columnsFor, DEFAULT_COLUMNS, type WRow } from "./watchlist-columns";

const KEY = ["watchlists"];
const SEL_KEY = "watchlist_selected";
const ALL = -1;                                   // the "All symbols" pseudo-list
const QUOTE_CAP = 150;                            // /market/watchlist-quotes limit
const OPT_CAP = 80;                               // option columns: first 80 symbols in view…
const OPT_BATCH = 20;                             // …asked for 20 at a time so rows fill in as they arrive
const AGG_COLS_KEY = "watchlist_columns_all";     // columns for the merged views (they're not a saved list)


export function WatchlistTab() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number>(ALL);
  const [sector, setSector] = useState<string>("");
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "symbol", dir: 1 });
  const [picker, setPicker] = useState(false);
  const [aggCols, setAggCols] = useState<string[] | null>(null);
  useEffect(() => { try { const v = localStorage.getItem(AGG_COLS_KEY); if (v) setAggCols(JSON.parse(v)); } catch { /* storage off */ } }, []);

  const groupsQ = useQuery<WatchlistGroups>({ queryKey: KEY, queryFn: fetchWatchlistGroups });
  const lists = useMemo(() => groupsQ.data?.lists ?? [], [groupsQ.data]);
  const maxLists = groupsQ.data?.max_lists ?? 20;

  // Remember the open list between visits.
  useEffect(() => { try { const v = Number(localStorage.getItem(SEL_KEY)); if (v) setSelected(v); } catch { /* storage off */ } }, []);
  useEffect(() => { try { localStorage.setItem(SEL_KEY, String(selected)); } catch { /* storage off */ } }, [selected]);

  const current = lists.find((g) => g.id === selected) ?? null;
  // A list that's gone (deleted) falls back to "All".
  useEffect(() => {
    if (selected !== ALL && groupsQ.data && !current) setSelected(ALL);
  }, [selected, current, groupsQ.data]);

  const symbols = useMemo(() => {
    const src = current ? [current] : lists;
    return [...new Set(src.flatMap((g) => g.symbols))];
  }, [current, lists]);
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
    mutationFn: ({ id, body }: { id: number; body: { name?: string; symbols?: string[]; columns?: string[] } }) => updateWatchlistGroup(id, body),
    onSuccess: (g) => { setList(g); setRename(null); setErr(null); }, onError: fail,
  });
  const create = useMutation({
    mutationFn: (name: string) => createWatchlistGroup(name),
    onSuccess: (g) => {
      qc.setQueryData<WatchlistGroups>(KEY, (d) => d && { ...d, lists: [...d.lists, g] });
      setNewName(null); setErr(null); setSelected(g.id);
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
  // ── columns: the open list's own, or the merged views' (this device) ──
  const colIds = columnsFor(current ? current.columns : aggCols);
  const cols = colIds.map((id) => COL.get(id)!);
  const setColumns = (ids: string[]) => {
    if (current) {
      setList({ ...current, columns: ids });                       // instant; the PATCH confirms
      replace.mutate({ id: current.id, body: { columns: ids } });
    } else {
      setAggCols(ids);
      try { localStorage.setItem(AGG_COLS_KEY, JSON.stringify(ids)); } catch { /* storage off */ }
    }
  };
  const needOptions = cols.some((c) => c.needs === "options");
  const needBooks = cols.some((c) => c.needs === "books");

  // Option columns: batches of 20, only while one is shown.
  const optSyms = shown.slice(0, OPT_CAP);
  const batches = needOptions ? Array.from({ length: Math.ceil(optSyms.length / OPT_BATCH) }, (_, i) => optSyms.slice(i * OPT_BATCH, (i + 1) * OPT_BATCH)) : [];
  const optQs = useQueries({
    queries: batches.map((b) => ({
      queryKey: ["watchlist", "options", b.join(",")], queryFn: () => fetchOptionMetrics(b),
      refetchInterval: 120_000, staleTime: 60_000,
    })),
  });
  const omap = new Map<string, OptionMetrics>();
  for (const q of optQs) for (const m of q.data ?? []) omap.set(m.symbol, m);
  const optLoading = optQs.some((q) => q.isLoading);
  const books = okBooks(useLiveBooks(needBooks).data);
  const deltaOf = new Map(books.map((b) => [b.symbol, b.net_delta ?? null]));
  const sharesOf = new Map((pf?.holdings ?? []).map((h) => [h.symbol, h.shares]));

  const rows: WRow[] = (() => {
    const out: WRow[] = shown
      .map((s) => ({ symbol: s, q: qmap.get(s), o: omap.get(s), posDelta: deltaOf.get(s), shares: sharesOf.get(s) }))
      .filter((r) => !sector || r.q?.sector === sector);
    // Inside a list, "Symbol" sort keeps the list's own order (ETF first on sector lists).
    if (sort.key === "symbol" && current) return sort.dir === 1 ? out : [...out].reverse();
    const val = (r: WRow) => (sort.key === "symbol" ? r.symbol : COL.get(sort.key)?.sort(r) ?? null);
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;                      // blanks last either way
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  })();
  const up = rows.filter((r) => (r.q?.change_pct ?? 0) > 0).length;
  const down = rows.filter((r) => (r.q?.change_pct ?? 0) < 0).length;

  const head = (key: string, label: string, right = true, cls = "", help?: string) => (
    <th key={key} className={clsx(TH, "whitespace-nowrap", right && "text-right", cls)} title={help}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : right ? -1 : 1 }))}
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
      {/* Every list as a tab with + at the end; ⋮ (list actions) pinned on the right. */}
      <div className="flex items-end gap-1 border-b border-[var(--border)]">
        <div className="min-w-0 flex-1">
        <ListTabs
          lists={lists} selected={selected} onSelect={(id) => { setSelected(id); setSector(""); setErr(null); }}
          allLabel="All"
          allCount={new Set(lists.flatMap((g) => g.symbols)).size}
          adding={newName} onAdd={atLimit ? undefined : () => { setNewName(""); setErr(null); }}
          onAddChange={setNewName} onAddCancel={() => setNewName(null)}
          onAddSubmit={() => { if (newName?.trim()) create.mutate(newName.trim()); }}
          atLimit={atLimit} max={maxLists}
        />
        </div>
        <div className="mb-1 shrink-0">
          <ActionsMenu items={[
            { label: "Customize columns", icon: Columns3, onClick: () => setPicker(true) },
            ...(current ? [{ label: "Edit name", icon: Pencil, onClick: () => setRename(current.name) }] : []),
            ...(sectorListsMissing ? [{ label: "Restore sector lists", icon: RotateCcw, onClick: () => restore.mutate(), disabled: atLimit }] : []),
            ...(current ? [{ label: "Delete list", icon: Trash2, danger: true, onClick: () => {
              if (window.confirm(`Delete the list "${current.name}"? Its ${current.symbols.length} symbols go with it.`)) drop.mutate(current.id);
            } }] : []),
          ]} />
        </div>
      </div>

      {rename != null && current && (
        <form onSubmit={(e) => { e.preventDefault(); if (rename.trim()) replace.mutate({ id: current.id, body: { name: rename.trim() } }); }}
          className="flex max-w-sm items-center gap-1 rounded-xl border border-foreground/40 py-1 pl-3 pr-1">
          <input autoFocus maxLength={40} placeholder="List name" value={rename} onChange={(e) => setRename(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setRename(null); }}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground/40" />
          <button type="submit" className="h-7 rounded-lg bg-foreground px-3 text-[12px] font-medium text-[var(--background)]">Save</button>
          <button type="button" aria-label="Cancel" onClick={() => setRename(null)} className="rounded-lg p-1.5 text-foreground/50 hover:text-foreground"><X size={14} /></button>
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
          actions={
            <div className="flex items-center gap-1.5">
              {sectorsInView.length > 1 && (
                <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector"
                  className="h-8 max-w-[150px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] text-foreground">
                  <option value="">All sectors</option>
                  {sectorsInView.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              <div className="relative">
                <button onClick={() => setPicker((o) => !o)} aria-expanded={picker}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[12px] text-foreground/70 hover:text-foreground">
                  <Columns3 size={14} /> Columns <span className="font-mono text-foreground/45">{cols.length}</span>
                </button>
                {picker && (
                  <Popover onClose={() => setPicker(false)}>
                    <ColumnPicker value={colIds} onChange={setColumns} onClose={() => setPicker(false)} onReset={() => setColumns(current ? [] : DEFAULT_COLUMNS)} />
                  </Popover>
                )}
              </div>
            </div>
          }>
          {needOptions && (optLoading || shown.length > OPT_CAP) && (
            <p className="border-b border-[var(--border)] px-4 py-1.5 font-mono text-[11px] text-foreground/45">
              {optLoading ? "Loading option chains…" : ""}{shown.length > OPT_CAP ? ` Option columns cover the first ${OPT_CAP} symbols.` : ""}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {head("symbol", "Symbol", false, "sticky left-0 z-[1] bg-[var(--surface)]", current ? "Symbol ↑ keeps the list's own order" : undefined)}
                  {cols.map((c) => head(c.id, c.label, !c.left, c.width ?? "", c.help))}
                  <th className={TH}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const { symbol, q } = r;
                  const lists = memberOf.get(symbol) ?? [];
                  return (
                    <tr key={symbol} className="group border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                      <td className={clsx(TD, "sticky left-0 z-[1] bg-[var(--surface)] group-hover:bg-[var(--surface-2)]")}>
                        <div className="flex items-center gap-2.5">
                          <TickerLogo symbol={symbol} size={26} />
                          <div className="min-w-0">
                            <Link href={`/stocks/${symbol}`} className="font-medium text-foreground hover:text-accent">{symbol}</Link>
                            {owned.has(symbol) && <span className="ml-2 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 font-sans text-[10px] text-foreground/55">Held</span>}
                            <p className="max-w-[96px] truncate font-sans text-[11px] text-foreground/45 sm:max-w-[240px]">
                              {q?.name ?? (quotes.isLoading ? "…" : q?.error ? "No quote" : "")}
                              {!current && lists.length > 0 && <span className="text-foreground/35"> · {lists.join(", ")}</span>}
                            </p>
                          </div>
                        </div>
                      </td>
                      {cols.map((c) => (
                        <td key={c.id} className={clsx(TD, "whitespace-nowrap", c.left ? "text-left" : "text-right", "text-foreground/85")}>
                          {c.id === "sector" && q?.sector
                            ? <button onClick={() => setSector(q.sector!)} className="font-sans text-[12px] text-foreground/65 hover:text-foreground hover:underline">{q.sector}</button>
                            : c.cell(r)}
                        </td>
                      ))}
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

/** Every list as a tab (scrolls sideways on phones), "All" first and + at the end to add a list. */
function ListTabs({ lists, selected, onSelect, allLabel, allCount, adding, onAdd, onAddChange, onAddCancel, onAddSubmit, atLimit, max }: {
  lists: WatchlistGroup[]; selected: number; onSelect: (id: number) => void; allLabel: string; allCount: number;
  adding: string | null; onAdd?: () => void; onAddChange: (v: string) => void; onAddCancel: () => void; onAddSubmit: () => void;
  atLimit: boolean; max: number;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // Keep the open tab (or the new-list box) in view.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(adding != null ? "[data-adding]" : "[aria-selected='true']");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, adding, lists.length]);
  const tab = (id: number, label: string, n: number) => {
    const on = selected === id;
    return (
      <button key={id} role="tab" aria-selected={on} onClick={() => onSelect(id)}
        className={clsx("-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition",
          on ? "border-foreground font-medium text-foreground" : "border-transparent text-foreground/55 hover:text-foreground")}>
        {label}<span className={clsx("font-mono text-[11px]", on ? "text-foreground/55" : "text-foreground/35")}>{n}</span>
      </button>
    );
  };
  return (
    <div ref={strip} role="tablist" aria-label="Watchlists" className="-ml-4 overflow-x-auto pl-4 sm:ml-0 sm:pl-0 lg:overflow-visible">
      {/* Phones: one row that swipes sideways. Wide screens: tabs wrap so every list is visible. */}
      <div className="flex min-w-max items-end gap-0.5 lg:min-w-0 lg:flex-wrap">
        {tab(ALL, allLabel, allCount)}
        {lists.map((g) => tab(g.id, g.name, g.symbols.length))}
        {adding != null ? (
          <form data-adding onSubmit={(e) => { e.preventDefault(); onAddSubmit(); }}
            className="mb-1.5 ml-1 flex shrink-0 items-center gap-0.5 rounded-lg border border-foreground/40 py-0.5 pl-2.5 pr-0.5">
            <input autoFocus maxLength={40} value={adding} onChange={(e) => onAddChange(e.target.value)} placeholder="New list name"
              onKeyDown={(e) => { if (e.key === "Escape") onAddCancel(); }}
              className="w-32 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground/40" />
            <button type="submit" aria-label="Create list" className="rounded-md p-1.5 text-foreground/70 hover:text-foreground"><Check size={14} /></button>
            <button type="button" aria-label="Cancel" onClick={onAddCancel} className="rounded-md p-1.5 text-foreground/50 hover:text-foreground"><X size={14} /></button>
          </form>
        ) : (
          <button onClick={onAdd} disabled={!onAdd} aria-label="New list" title={atLimit ? `Up to ${max} lists` : "New list"}
            className="mb-1 ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-foreground/55 transition hover:bg-[var(--surface-2)] hover:text-foreground disabled:opacity-30">
            <Plus size={17} />
          </button>
        )}
      </div>
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

/** The column picker as a fixed panel (the table's card clips anything absolute): top-right on desktop,
 *  a sheet from the bottom on phones. Closes on outside click / Escape. */
function Popover({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useDismiss(true, onClose);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 sm:bg-transparent" aria-hidden />
      <div ref={ref} role="dialog" aria-label="Customize columns"
        className="fixed inset-x-0 bottom-0 z-50 overflow-hidden rounded-t-2xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-float)]
          sm:inset-x-auto sm:bottom-auto sm:right-6 sm:top-24 sm:rounded-2xl">
        {children}
      </div>
    </>
  );
}
