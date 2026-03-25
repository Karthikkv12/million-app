"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchWatchlist, upsertWatchlistSymbol, deleteWatchlistSymbol,
  syncWatchlist, fetchWatchlistQuotes, WatchlistSymbol, WatchlistQuote,
} from "@/lib/api";
import { EmptyState } from "@/components/ui";
import {
  Plus, Trash2, RefreshCw, Search, TrendingUp, TrendingDown,
  Minus, AlertCircle, BookMarked, ChevronUp, ChevronDown, ChevronsUpDown,
  AlertTriangle,
} from "lucide-react";
import TickerSearchInput from "@/components/TickerSearchInput";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "change_pct" | "volume" | "market_cap" | "pe_ratio" | "beta" | "rel_volume";
type SortDir = "asc" | "desc";
const ALL_TAB = "All";
const UNCATEGORIZED_TAB = "Other";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtVol(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

// ── Analyst rating badge ──────────────────────────────────────────────────────

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span className="text-foreground/30 text-xs">—</span>;
  const map: Record<string, string> = {
    "Strong Buy":   "bg-green-500/15 text-green-500",
    "Buy":          "bg-green-500/10 text-green-400",
    "Hold":         "bg-yellow-500/10 text-yellow-500",
    "Underperform": "bg-red-500/10 text-red-400",
    "Sell":         "bg-red-500/15 text-red-500",
  };
  const cls = map[rating] ?? "bg-foreground/5 text-foreground/40";
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cls}`}>
      {rating}
    </span>
  );
}

// ── Skeleton shimmer cell ─────────────────────────────────────────────────────

function SkeletonCell({ right, className = "" }: { right?: boolean; className?: string }) {
  return (
    <td className={`px-3 py-2.5 ${right ? "text-right" : ""} ${className}`}>
      <div className="h-3 rounded bg-foreground/8 animate-pulse inline-block w-12" />
    </td>
  );
}

// ── Inline remove confirmation ────────────────────────────────────────────────

function RemoveCell({
  symbol,
  onConfirm,
  disabled,
}: {
  symbol: string;
  onConfirm: () => void;
  disabled: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <td className="px-2 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => { onConfirm(); setConfirming(false); }}
            className="px-2 py-0.5 rounded-lg bg-foreground/10 text-foreground/70 text-[10px] font-bold hover:bg-foreground/15 transition"
          >
            Remove
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="px-2 py-0.5 rounded-lg bg-foreground/10 text-foreground/50 text-[10px] font-bold hover:bg-foreground/15 transition"
          >
            Cancel
          </button>
        </div>
      </td>
    );
  }

  return (
    <td className="px-3 py-2.5 text-right">
      <button
        onClick={() => setConfirming(true)}
        disabled={disabled}
        className="p-1 rounded-lg text-foreground/30 hover:text-foreground hover:bg-foreground/10 transition disabled:opacity-30"
        title={`Remove ${symbol} from watchlist`}
      >
        <Trash2 size={12} />
      </button>
    </td>
  );
}

// ── Sortable column header ────────────────────────────────────────────────────

function TH({
  children, right, hidden, sortKey, currentSort, currentDir, onSort,
}: {
  children: React.ReactNode;
  right?: boolean;
  hidden?: "sm" | "md" | "lg" | "xl";
  sortKey?: SortKey;
  currentSort?: SortKey | null;
  currentDir?: SortDir;
  onSort?: (k: SortKey) => void;
}) {
  const hiddenCls = hidden ? `hidden ${hidden}:table-cell` : "";
  const isActive  = sortKey && currentSort === sortKey;
  const baseClass = `px-3 py-2 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${
    right ? "text-right" : "text-left"
  } ${hiddenCls}`;

  if (sortKey && onSort) {
    return (
      <th className={`${baseClass} cursor-pointer select-none group`} onClick={() => onSort(sortKey)}>
        <span className={`flex items-center gap-0.5 ${right ? "justify-end" : ""} ${
          isActive ? "text-foreground" : "text-foreground/50 group-hover:text-foreground/70"
        }`}>
          {children}
          {isActive
            ? currentDir === "desc"
              ? <ChevronDown size={10} className="shrink-0" />
              : <ChevronUp size={10} className="shrink-0" />
            : <ChevronsUpDown size={10} className="shrink-0 opacity-40" />
          }
        </span>
      </th>
    );
  }

  return (
    <th className={`${baseClass} text-foreground/50`}>
      {children}
    </th>
  );
}

// ── Watchlist table (extracted) ───────────────────────────────────────────────

function WatchlistTable({
  rows,
  quoteMap,
  quotesLoading,
  onRemove,
  removePending,
  hideSectorCol,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: WatchlistSymbol[];
  quoteMap: Map<string, WatchlistQuote>;
  quotesLoading: boolean;
  onRemove: (sym: string) => void;
  removePending: boolean;
  hideSectorCol: boolean;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--border)] overflow-x-auto">
      <table className="w-full text-xs min-w-[1000px]">
        <thead>
          <tr className="bg-[var(--surface-2)] border-b border-[var(--border)]">
            <TH>Symbol</TH>
            <TH hidden="sm">Company</TH>
            <TH right>Price</TH>
            <TH right sortKey="change_pct" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>Chg %</TH>
            <TH right hidden="md" sortKey="volume" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>Volume</TH>
            <TH right hidden="md" sortKey="rel_volume" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>Rel Vol</TH>
            <TH right hidden="lg" sortKey="market_cap" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>Mkt Cap</TH>
            <TH right hidden="lg" sortKey="pe_ratio" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>P/E</TH>
            <TH right hidden="xl">EPS TTM</TH>
            <TH right hidden="xl">EPS Grw</TH>
            <TH right hidden="xl">Div %</TH>
            <TH right hidden="xl" sortKey="beta" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>Beta</TH>
            {!hideSectorCol && <TH hidden="lg">Sector</TH>}
            <TH hidden="xl">Rating</TH>
            <th className="px-3 py-2 w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((item: WatchlistSymbol) => {
            const q        = quoteMap.get(item.symbol);
            const hasError = !!q?.error;
            const loading  = quotesLoading && !q;

            const chgPct = q?.change_pct ?? 0;
            const isUp   = chgPct > 0;
            const isDown = chgPct < 0;
            const rowBg  = "hover:bg-[var(--surface-2)]";

            const hi52 = q?.week_52_high;
            const lo52 = q?.week_52_low;
            const px   = q?.price;
            const rangePct = (!hasError && hi52 && lo52 && px && hi52 > lo52)
              ? Math.round(((px - lo52) / (hi52 - lo52)) * 100)
              : null;

            return (
              <tr
                key={item.id}
                className={`border-b border-[var(--border)] last:border-0 transition-colors ${rowBg}`}
              >
                {/* Symbol */}
                <td className="px-3 py-2.5 w-24">
                  <div className="flex items-center gap-1.5">
                    {hasError && (
                      <span title={q?.error ?? "Data unavailable"}>
                        <AlertTriangle size={10} className="text-foreground/40 shrink-0" />
                      </span>
                    )}
                    <span className="font-bold text-foreground tracking-wide text-sm">
                      {item.symbol}
                    </span>
                  </div>
                </td>

                {/* Company */}
                {loading ? (
                  <SkeletonCell className="hidden sm:table-cell" />
                ) : (
                  <td className="px-3 py-2.5 hidden sm:table-cell max-w-[150px]">
                    <div className="truncate text-foreground/60">
                      {q?.name ?? item.company_name ?? "—"}
                    </div>
                  </td>
                )}

                {/* Price + 52W bar */}
                {loading ? (
                  <SkeletonCell right />
                ) : (
                  <td className="px-3 py-2.5 text-right">
                    {hasError ? (
                      <span className="text-foreground/40 text-[10px]">unavailable</span>
                    ) : (
                      <div>
                        <div className="font-bold text-foreground text-sm">
                          {q?.price != null ? `$${q.price.toFixed(2)}` : "—"}
                        </div>
                        {rangePct != null && (
                          <div className="mt-0.5 w-16 ml-auto">
                            <div className="h-1 w-full rounded-full bg-foreground/10 relative">
                              <div
                                className={`absolute top-0 left-0 h-full rounded-full ${
                                  rangePct! >= 80 ? "bg-green-500" : rangePct! >= 40 ? "bg-blue-400" : "bg-red-400"
                                }`}
                                style={{ width: `${rangePct}%` }}
                              />
                            </div>
                            <div className="text-[8px] text-foreground/30 flex justify-between mt-0.5">
                              <span>${lo52!.toFixed(0)}</span>
                              <span>${hi52!.toFixed(0)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                )}

                {/* Change % */}
                {loading ? (
                  <SkeletonCell right />
                ) : (
                  <td className="px-3 py-2.5 text-right">
                    {hasError ? (
                      <span className="text-foreground/30">—</span>
                    ) : (
                      <div className={`flex items-center justify-end gap-0.5 font-semibold ${isUp ? "text-green-500" : isDown ? "text-red-400" : "text-foreground/40"}`}>
                        {isUp && <TrendingUp size={10} />}
                        {isDown && <TrendingDown size={10} />}
                        {!isUp && !isDown && <Minus size={10} />}
                        <span>
                          {q?.change_pct != null
                            ? `${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}%`
                            : "—"}
                        </span>
                      </div>
                    )}
                  </td>
                )}

                {/* Volume */}
                {loading ? (
                  <SkeletonCell right className="hidden md:table-cell" />
                ) : (
                  <td className="px-3 py-2.5 text-right text-foreground/60 hidden md:table-cell">
                    {fmtVol(q?.volume)}
                  </td>
                )}

                {/* Rel Volume */}
                {loading ? (
                  <SkeletonCell right className="hidden md:table-cell" />
                ) : (
                  <td className="px-3 py-2.5 text-right hidden md:table-cell">
                    {q?.rel_volume == null ? (
                      <span className="text-foreground/30">—</span>
                    ) : (
                      <span className={`font-semibold ${q.rel_volume > 2 ? "text-orange-400" : q.rel_volume > 1 ? "text-green-400" : "text-foreground/50"}` }>
                        {q.rel_volume.toFixed(2)}x
                      </span>
                    )}
                  </td>
                )}

                {/* Market Cap */}
                {loading ? (
                  <SkeletonCell right className="hidden lg:table-cell" />
                ) : (
                  <td className="px-3 py-2.5 text-right text-foreground/60 hidden lg:table-cell">
                    {q?.market_cap_fmt ?? "—"}
                  </td>
                )}

                {/* P/E */}
                {loading ? (
                  <SkeletonCell right className="hidden lg:table-cell" />
                ) : (
                  <td className="px-3 py-2.5 text-right text-foreground/60 hidden lg:table-cell">
                    {q?.pe_ratio != null ? q.pe_ratio.toFixed(1) : "—"}
                  </td>
                )}

                {/* EPS TTM */}
                {loading ? (
                  <SkeletonCell right className="hidden xl:table-cell" />
                ) : (
                  <td className="px-3 py-2.5 text-right hidden xl:table-cell">
                    {q?.eps_ttm == null ? (
                      <span className="text-foreground/30">—</span>
                    ) : (
                      <span className={q.eps_ttm >= 0 ? "text-green-400" : "text-red-400"}>
                        ${q.eps_ttm.toFixed(2)}
                      </span>
                    )}
                  </td>
                )}

                {/* EPS Growth */}
                {loading ? (
                  <SkeletonCell right className="hidden xl:table-cell" />
                ) : (
                  <td className="px-3 py-2.5 text-right hidden xl:table-cell">
                    {q?.eps_growth == null ? (
                      <span className="text-foreground/30">—</span>
                    ) : (
                      <span className={`font-semibold ${q.eps_growth >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {q.eps_growth >= 0 ? "+" : ""}{(q.eps_growth * 100).toFixed(1)}%
                      </span>
                    )}
                  </td>
                )}

                {/* Div Yield */}
                {loading ? (
                  <SkeletonCell right className="hidden xl:table-cell" />
                ) : (
                  <td className="px-3 py-2.5 text-right text-foreground/50 hidden xl:table-cell">
                    {q?.div_yield != null ? `${(q.div_yield * 100).toFixed(2)}%` : "—"}
                  </td>
                )}

                {/* Beta */}
                {loading ? (
                  <SkeletonCell right className="hidden xl:table-cell" />
                ) : (
                  <td className="px-3 py-2.5 text-right hidden xl:table-cell">
                    {q?.beta == null ? (
                      <span className="text-foreground/30">—</span>
                    ) : (
                      <span className={q.beta > 1.5 ? "text-orange-400 font-semibold" : q.beta < 0.5 ? "text-blue-400" : "text-foreground/60"}>
                        {q.beta.toFixed(2)}
                      </span>
                    )}
                  </td>
                )}

                {/* Sector — hidden on sector-specific tabs */}
                {!hideSectorCol && (
                  loading ? (
                    <SkeletonCell className="hidden lg:table-cell" />
                  ) : (
                    <td className="px-3 py-2.5 hidden lg:table-cell max-w-[130px]">
                      <span className="truncate block text-foreground/45 text-[10px]">
                        {q?.sector ?? "—"}
                      </span>
                    </td>
                  )
                )}

                {/* Analyst Rating */}
                {loading ? (
                  <SkeletonCell className="hidden xl:table-cell" />
                ) : (
                  <td className="px-3 py-2.5 hidden xl:table-cell">
                    <RatingBadge rating={q?.analyst_rating ?? null} />
                  </td>
                )}

                {/* Inline remove */}
                <RemoveCell
                  symbol={item.symbol}
                  onConfirm={() => onRemove(item.symbol)}
                  disabled={removePending}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AddSymbolForm({ onAdd }: { onAdd: (symbol: string, company: string) => void }) {
  const [symbol, setSymbol]   = useState("");
  const [company, setCompany] = useState("");
  const [open, setOpen]       = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    onAdd(sym, company.trim());
    setSymbol("");
    setCompany("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-xs font-semibold hover:opacity-80 transition"
      >
        <Plus size={12} /> Add Symbol
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-wrap">
      <TickerSearchInput
        value={symbol}
        onChange={(v) => setSymbol(v)}
        onSelect={(sym) => setSymbol(sym)}
        placeholder="Ticker…"
        className="w-28 text-sm"
      />
      <input
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        placeholder="Company (optional)"
        className="px-2 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm text-foreground focus:outline-none focus:border-foreground/40 w-44"
      />
      <button
        type="submit"
        disabled={!symbol.trim()}
        className="px-3 py-1.5 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-xs font-semibold hover:opacity-80 disabled:opacity-40 transition"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setSymbol(""); setCompany(""); }}
        className="px-3 py-1.5 rounded-xl bg-[var(--surface-2)] text-foreground/60 text-xs font-semibold hover:bg-[var(--surface-3)] transition"
      >
        Cancel
      </button>
    </form>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function WatchlistTab() {
  const qc = useQueryClient();
  const [search, setSearch]       = useState("");
  const [sortKey, setSortKey]     = useState<SortKey | null>(null);
  const [sortDir, setSortDir]     = useState<SortDir>("desc");
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);

  // ── Watchlist entries ──────────────────────────────────────────────────────

  const {
    data: watchlist = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["watchlist"],
    queryFn: fetchWatchlist,
    staleTime: 30_000,
  });

  const allSymbols = useMemo(() => watchlist.map((w) => w.symbol), [watchlist]);

  // ── Rich quotes ────────────────────────────────────────────────────────────

  const { data: richQuotes = [], isLoading: quotesLoading } = useQuery({
    queryKey: ["watchlistRichQuotes", allSymbols.join(",")],
    queryFn: () => fetchWatchlistQuotes(allSymbols),
    enabled: allSymbols.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const quoteMap = useMemo(
    () => new Map<string, WatchlistQuote>(richQuotes.map((q) => [q.symbol, q])),
    [richQuotes],
  );

  // ── Derived sector list — auto-updates as quotes arrive ───────────────────

  const sectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of watchlist) {
      const s = quoteMap.get(item.symbol)?.sector ?? null;
      const label = s ?? UNCATEGORIZED_TAB;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    // Alphabetical, "Other" always last
    const sorted = [...counts.keys()].sort((a, b) => {
      if (a === UNCATEGORIZED_TAB) return 1;
      if (b === UNCATEGORIZED_TAB) return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [watchlist, quoteMap]);

  // If the active tab was removed (sector no longer present), reset to All
  const validTab = activeTab === ALL_TAB || sectors.includes(activeTab)
    ? activeTab
    : ALL_TAB;

  // ── Mutations ──────────────────────────────────────────────────────────────

  const addMut = useMutation({
    mutationFn: ({ symbol, company }: { symbol: string; company: string }) =>
      upsertWatchlistSymbol(symbol, { company_name: company || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
    onError: (e: Error) => alert(`Could not add symbol: ${e.message}`),
  });

  const removeMut = useMutation({
    mutationFn: (symbol: string) => deleteWatchlistSymbol(symbol),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
    onError: (e: Error) => alert(`Could not remove symbol: ${e.message}`),
  });

  const syncMut = useMutation({
    mutationFn: syncWatchlist,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
    onError: (e: Error) => alert(`Sync failed: ${e.message}`),
  });

  // ── Sort handler ───────────────────────────────────────────────────────────

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // ── Filter + sector tab + sort ─────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    let list = watchlist.filter((w) => {
      // sector tab filter
      if (validTab !== ALL_TAB) {
        const sector = quoteMap.get(w.symbol)?.sector ?? null;
        const rowSector = sector ?? UNCATEGORIZED_TAB;
        if (rowSector !== validTab) return false;
      }
      // text search
      if (!q) return true;
      return (
        w.symbol.toLowerCase().includes(q) ||
        (w.company_name ?? "").toLowerCase().includes(q) ||
        (quoteMap.get(w.symbol)?.sector ?? "").toLowerCase().includes(q)
      );
    });

    if (sortKey) {
      list = list.sort((a, b) => {
        const qa = quoteMap.get(a.symbol);
        const qb = quoteMap.get(b.symbol);
        const va = (qa?.[sortKey] as number | null) ?? null;
        const vb = (qb?.[sortKey] as number | null) ?? null;
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return sortDir === "desc" ? vb - va : va - vb;
      });
    }

    return list;
  }, [watchlist, search, quoteMap, sortKey, sortDir, validTab]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const gainers = richQuotes.filter((q: WatchlistQuote) => (q.change_pct ?? 0) > 0).length;
  const losers  = richQuotes.filter((q: WatchlistQuote) => (q.change_pct ?? 0) < 0).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 rounded-xl bg-[var(--surface-2)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-foreground/70 text-sm">
        <AlertCircle size={16} />
        Failed to load watchlist.
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Header bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <AddSymbolForm onAdd={(sym, company) => addMut.mutate({ symbol: sym, company })} />
          <button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
            title="Sync symbols from all positions and holdings"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-foreground/70 text-xs font-semibold hover:bg-[var(--surface-3)] disabled:opacity-40 transition"
          >
            <RefreshCw size={11} className={syncMut.isPending ? "animate-spin" : ""} />
            Sync
          </button>
          {syncMut.isSuccess && (
            <span className="text-[10px] text-foreground/60 font-semibold">
              {syncMut.data?.total_added === 0 ? "✓ Up to date" : `✓ Added ${syncMut.data?.total_added} symbols`}
            </span>
          )}
          {quotesLoading && allSymbols.length > 0 && (
            <span className="text-[10px] text-foreground/40 font-semibold flex items-center gap-1">
              <RefreshCw size={9} className="animate-spin" /> Loading quotes…
            </span>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol, sector…"
            className="pl-7 pr-3 py-1.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-sm text-foreground focus:outline-none focus:border-foreground/40 w-52"
          />
        </div>
      </div>

      {/* ── Summary pills ────────────────────────────────────────────────── */}
      {watchlist.length > 0 && richQuotes.length > 0 && (
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="px-2 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--border)] font-semibold text-foreground/60">
            {watchlist.length} symbols
          </span>
          <span className="px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20 font-semibold text-green-500">
            ▲ {gainers} up
          </span>
          <span className="px-2 py-1 rounded-full bg-red-500/10 border border-red-500/20 font-semibold text-red-400">
            ▼ {losers} down
          </span>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {watchlist.length === 0 && (
        <EmptyState
          icon={BookMarked}
          title="Watchlist is empty"
          body='Symbols are auto-added when you create positions or holdings. Click "Add Symbol" to manually add a stock, or use "Sync" to import all existing symbols.'
        />
      )}

      {/* ── Sector tabs — only show once quotes have loaded ───────────────── */}
      {watchlist.length > 0 && sectors.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap border-b border-[var(--border)] pb-0 -mb-2">
          {[ALL_TAB, ...sectors].map((tab) => {
            const isActive = tab === validTab;
            // count per tab
            const count = tab === ALL_TAB
              ? watchlist.length
              : watchlist.filter((w) => {
                  const s = quoteMap.get(w.symbol)?.sector ?? null;
                  return (s ?? UNCATEGORIZED_TAB) === tab;
                }).length;

            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-foreground/50 text-foreground bg-foreground/[0.03]"
                    : "border-transparent text-foreground/50 hover:text-foreground/80 hover:bg-[var(--surface-2)]"
                }`}
              >
                {tab}
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                  isActive
                    ? "bg-foreground/10 text-foreground/70"
                    : "bg-foreground/10 text-foreground/40"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {watchlist.length > 0 && (
        <WatchlistTable
          rows={filtered}
          quoteMap={quoteMap}
          quotesLoading={quotesLoading}
          onRemove={(sym) => removeMut.mutate(sym)}
          removePending={removeMut.isPending}
          hideSectorCol={validTab !== ALL_TAB}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
        />
      )}

      {/* ── No results after filter ────────────────────────────────────────── */}
      {watchlist.length > 0 && filtered.length === 0 && (
        <div className="text-center py-8 text-foreground/40 text-sm">
          {search
            ? <>No symbols match &ldquo;{search}&rdquo;</>
            : <>No symbols in this sector yet</>
          }
        </div>
      )}

      {/* ── Footer note ───────────────────────────────────────────────────── */}
      {watchlist.length > 0 && (
        <p className="text-[10px] text-foreground/30 text-center">
          Removing a symbol only hides it — history is preserved. Quotes refresh every 5 min.
        </p>
      )}
    </div>
  );
}
