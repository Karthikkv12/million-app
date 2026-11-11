"use client";
/**
 * Watchlists: up to 20 named lists. The first visit seeds "My watchlist" (the old single list)
 * plus one list per sector, each starting with its SPDR ETF. Pick a category (All, Sectors, My lists),
 * then a list. "All symbols" merges every list in the category. Sector narrows the table by the
 * quote's own sector. Quotes come from /market/watchlist-quotes and refresh every minute.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
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

const chip = (on: boolean) => clsx(
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12px] font-medium transition",
  on ? "border-foreground bg-foreground text-[var(--background)]" : "border-[var(--border)] text-foreground/65 hover:text-foreground",
);

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
      setNewName(null); setErr(null); setCategory((c) => (c === "sector" ? "all" : c)); setSelected(g.id);
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

  const counts = { all: lists.length, sector: lists.filter((g) => g.kind === "sector").length, custom: lists.filter((g) => g.kind === "custom").length };
  const atLimit = lists.length >= maxLists;

  return (
    <div className="space-y-4">
      {/* Category, then the lists in it. */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Category" className="inline-flex rounded-full border border-[var(--border)] p-0.5">
            {([["all", "All"], ["sector", "Sectors"], ["custom", "My lists"]] as [Category, string][]).map(([c, label]) => (
              <button key={c} role="tab" aria-selected={category === c} onClick={() => { setCategory(c); setSelected(ALL); }}
                className={clsx("h-7 rounded-full px-3 text-[12px] font-medium transition",
                  category === c ? "bg-[var(--surface-2)] text-foreground" : "text-foreground/55 hover:text-foreground")}>
                {label} <span className="font-mono text-foreground/45">{counts[c]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-foreground/50">
            {sectorListsMissing && (
              <button onClick={() => restore.mutate()} disabled={restore.isPending || atLimit} title={atLimit ? "At the 20-list limit" : undefined}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-sans text-[12px] text-foreground/60 hover:text-foreground disabled:opacity-40">
                <RotateCcw size={12} /> Restore sector lists
              </button>
            )}
            <span>{lists.length}/{maxLists} lists</span>
          </div>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <div className="flex gap-1.5 sm:flex-wrap">
            <button onClick={() => setSelected(ALL)} className={chip(selected === ALL)}>
              All symbols <span className="font-mono opacity-60">{new Set(inCategory.flatMap((g) => g.symbols)).size}</span>
            </button>
            {inCategory.map((g) => (
              <button key={g.id} onClick={() => setSelected(g.id)} className={chip(selected === g.id)}>
                {g.name} <span className="font-mono opacity-60">{g.symbols.length}</span>
              </button>
            ))}
            {category !== "sector" && (newName == null ? (
              <button onClick={() => { setNewName(""); setErr(null); }} disabled={atLimit} title={atLimit ? `Up to ${maxLists} lists` : "New list"}
                className={clsx(chip(false), "border-dashed disabled:opacity-40")}>
                <Plus size={13} /> New list
              </button>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create.mutate(newName.trim()); }}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-foreground/40 pl-3 pr-1">
                <input autoFocus value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} placeholder="List name"
                  onKeyDown={(e) => e.key === "Escape" && setNewName(null)}
                  className="w-32 bg-transparent text-[12px] text-foreground outline-none placeholder:text-foreground/40" />
                <button type="submit" aria-label="Create list" className="rounded-full p-1 text-foreground/70 hover:text-foreground"><Check size={13} /></button>
                <button type="button" aria-label="Cancel" onClick={() => setNewName(null)} className="rounded-full p-1 text-foreground/50 hover:text-foreground"><X size={13} /></button>
              </form>
            ))}
          </div>
        </div>
      </div>

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
          <div className="ml-auto flex items-center gap-1">
            {rename == null ? (
              <button onClick={() => setRename(current.name)} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] text-foreground/60 hover:text-foreground">
                <Pencil size={13} /> Rename
              </button>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); if (rename.trim()) replace.mutate({ id: current.id, body: { name: rename.trim() } }); }}
                className="inline-flex h-9 items-center gap-1 rounded-full border border-foreground/40 pl-3 pr-1">
                <input autoFocus value={rename} maxLength={40} onChange={(e) => setRename(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setRename(null)}
                  className="w-36 bg-transparent text-[12px] text-foreground outline-none" />
                <button type="submit" aria-label="Save name" className="rounded-full p-1 text-foreground/70 hover:text-foreground"><Check size={13} /></button>
                <button type="button" aria-label="Cancel" onClick={() => setRename(null)} className="rounded-full p-1 text-foreground/50 hover:text-foreground"><X size={13} /></button>
              </form>
            )}
            <button onClick={() => { if (window.confirm(`Delete the list "${current.name}"? Its ${current.symbols.length} symbols go with it.`)) drop.mutate(current.id); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] text-foreground/60 hover:text-loss">
              <Trash2 size={13} /> Delete list
            </button>
          </div>
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
          title={current ? current.name : category === "sector" ? "All sector lists" : category === "custom" ? "All my lists" : "All symbols"}
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
