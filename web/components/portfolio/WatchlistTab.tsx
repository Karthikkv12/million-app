"use client";
/**
 * Watchlist: the tickers you follow. Add by search, remove with ×, or pull in
 * every stock you hold with one click. Quotes come from /market/watchlist-quotes
 * (price, day move, ranges, valuation, sector) and refresh every minute.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import TickerSearchInput from "@/components/TickerSearchInput";
import { Panel, SkeletonCard } from "@/components/ui";
import {
  deleteWatchlistSymbol, fetchBrokerPortfolio, fetchWatchlist, fetchWatchlistQuotes, upsertWatchlistSymbol,
  BrokerPortfolio, WatchlistQuote, WatchlistSymbol,
} from "@/lib/api";
import { pct, TD, TH, tone, usd } from "./broker";

type SortKey = "symbol" | "price" | "change_pct" | "market_cap" | "pe_ratio" | "range" | "sector";
const LIST_KEY = ["watchlist"];

/** Where the price sits between the low and high, 0..1. */
const pos = (price?: number | null, lo?: number | null, hi?: number | null) =>
  price == null || lo == null || hi == null || hi <= lo ? null : Math.min(1, Math.max(0, (price - lo) / (hi - lo)));

export function WatchlistTab() {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "symbol", dir: 1 });
  const [err, setErr] = useState<string | null>(null);

  const list = useQuery<WatchlistSymbol[]>({ queryKey: LIST_KEY, queryFn: fetchWatchlist });
  const symbols = useMemo(() => (list.data ?? []).filter((w) => w.is_active).map((w) => w.symbol), [list.data]);
  const quotes = useQuery<WatchlistQuote[]>({
    queryKey: ["watchlist", "quotes", [...symbols].sort().join(",")],
    queryFn: () => fetchWatchlistQuotes(symbols),
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
  });
  const { data: pf } = useQuery<BrokerPortfolio>({ queryKey: ["broker", "portfolio", null], queryFn: () => fetchBrokerPortfolio(null), refetchInterval: 60_000 });
  const owned = useMemo(() => new Set((pf?.holdings ?? []).map((h) => h.symbol)), [pf]);
  const missingHoldings = [...owned].filter((s) => !symbols.includes(s));

  const add = useMutation({
    mutationFn: (syms: string[]) => Promise.all(syms.map((s) => upsertWatchlistSymbol(s))),
    onSuccess: () => { setInput(""); setErr(null); qc.invalidateQueries({ queryKey: LIST_KEY }); },
    onError: (e: Error) => setErr(e.message || "Could not add that symbol."),
  });
  const remove = useMutation({
    mutationFn: (s: string) => deleteWatchlistSymbol(s),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<WatchlistSymbol[]>(LIST_KEY);
      qc.setQueryData<WatchlistSymbol[]>(LIST_KEY, (d) => (d ?? []).filter((w) => w.symbol !== s));
      return { prev };
    },
    onError: (_e, _s, ctx) => { if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });

  const onSelect = (raw: string) => {
    const s = raw.trim().toUpperCase();
    if (!/^[A-Z0-9.\-^=]{1,12}$/.test(s)) { setErr("Enter a ticker symbol, e.g. AAPL."); return; }
    if (symbols.includes(s)) { setErr(`${s} is already on your watchlist.`); return; }
    add.mutate([s]);
  };

  const rows = useMemo(() => {
    const q = new Map((quotes.data ?? []).map((r) => [r.symbol, r]));
    const meta = new Map((list.data ?? []).map((w) => [w.symbol, w]));
    const out = symbols.map((s) => ({ symbol: s, q: q.get(s), w: meta.get(s) }));
    const val = (r: (typeof out)[number]): string | number | null => {
      switch (sort.key) {
        case "symbol": return r.symbol;
        case "sector": return r.q?.sector ?? null;
        case "range": return pos(r.q?.price, r.q?.week_52_low, r.q?.week_52_high);
        default: return (r.q?.[sort.key] as number | null | undefined) ?? null;
      }
    };
    return out.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;           // blanks last either way
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [symbols, quotes.data, list.data, sort]);

  const head = (key: SortKey, label: string, right = true, cls = "") => (
    <th className={clsx(TH, right && "text-right", cls)}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === "symbol" || key === "sector" ? 1 : -1 }))}
        className={clsx("inline-flex items-center gap-1 uppercase hover:text-foreground", sort.key === key && "text-foreground")}>
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );

  const up = rows.filter((r) => (r.q?.change_pct ?? 0) > 0).length;
  const down = rows.filter((r) => (r.q?.change_pct ?? 0) < 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-full max-w-sm">
          <TickerSearchInput value={input} onChange={(v) => { setInput(v); setErr(null); }} onSelect={onSelect}
            placeholder="Add a ticker or company…" actionLabel={add.isPending ? "…" : "ADD"} />
          {err && <p className="mt-1.5 text-[12px] text-loss">{err}</p>}
        </div>
        {missingHoldings.length > 0 && (
          <button onClick={() => add.mutate(missingHoldings)} disabled={add.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 text-[12px] font-medium text-foreground/70 transition hover:text-foreground disabled:opacity-50">
            <Plus size={13} /> Add my {missingHoldings.length} holding{missingHoldings.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {list.isLoading ? <SkeletonCard rows={6} /> : !symbols.length ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] px-6 py-14 text-center">
          <p className="text-[15px] font-medium text-foreground">Your watchlist is empty</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] text-foreground/55">Search for a ticker above to start following it{owned.size ? ", or add the stocks you already hold in one click" : ""}.</p>
        </div>
      ) : (
        <Panel padded={false} title="Watching"
          sub={<span>{rows.length} symbols · <span className="text-gain">{up} up</span> · <span className="text-loss">{down} down</span>{quotes.isFetching ? " · refreshing…" : ""}</span>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {head("symbol", "Symbol", false)}
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
                  return (
                    <tr key={symbol} className="group border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                      <td className={TD}>
                        <Link href={`/stocks/${symbol}`} className="font-medium text-foreground hover:text-accent">{symbol}</Link>
                        {owned.has(symbol) && <span className="ml-2 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 font-sans text-[10px] text-foreground/55">Held</span>}
                        <p className="max-w-[220px] truncate font-sans text-[11px] text-foreground/45">{q?.name ?? (quotes.isLoading ? "…" : q?.error ? "No quote" : "")}</p>
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
                      <td className={`${TD} max-w-[160px] truncate font-sans text-[12px] text-foreground/65`}>{q?.sector ?? "—"}</td>
                      <td className={`${TD} w-10 text-right`}>
                        <button onClick={() => remove.mutate(symbol)} aria-label={`Remove ${symbol}`} title={`Remove ${symbol}`}
                          className="rounded-md p-1 text-foreground/35 opacity-100 transition hover:bg-[var(--surface)] hover:text-loss sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">
                          <X size={14} />
                        </button>
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
