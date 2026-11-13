"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { stockHref } from "@/components/TickerLink";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Columns3, Download, Keyboard, Search } from "lucide-react";
import { clsx } from "clsx";
import { fetchUnusual, UnusualRow, UnusualScan } from "@/lib/api";
import { PageHeader, Panel, Segmented, RefreshButton } from "@/components/ui";

const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(0)}K`);
const num = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(0)}K` : v.toLocaleString("en-US"));
const expLabel = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

type SortKey = "score" | "premium" | "volume" | "vol_oi" | "dte" | "otm_pct" | "iv_pct";
const SIDE_LABEL: Record<UnusualRow["side"], string> = { ask: "Ask", bid: "Bid", mid: "Mid", unknown: "—" };

// Columns the viewer can hide (Ticker always shows). Saved in this browser.
const COLS = [
  { id: "contract", label: "Contract" }, { id: "expiry", label: "Expiry" }, { id: "side", label: "Side" },
  { id: "premium", label: "Premium" }, { id: "volume", label: "Volume" }, { id: "oi", label: "OI" },
  { id: "vol_oi", label: "Vol/OI" }, { id: "otm", label: "OTM" }, { id: "iv", label: "IV" }, { id: "score", label: "Score" },
] as const;
type ColId = (typeof COLS)[number]["id"];
const COLS_KEY = "unusual_cols";
const SHORTCUTS: [string, string][] = [["/", "Filter by ticker"], ["S", "Scan other tickers"], ["C · P · A", "Calls · puts · all"], ["E", "Export CSV"], ["R", "Refresh"], ["?", "Show these"]];

/** Filtered rows (all of them, not only the 200 on screen) as CSV. */
function toCsv(rows: UnusualRow[]): string {
  const head = ["symbol", "type", "strike", "expiry", "dte", "side", "premium", "volume", "open_interest", "vol_oi", "otm_pct", "iv_pct", "score"];
  const esc = (raw: unknown) => { const v = typeof raw === "number" && !Number.isInteger(raw) ? +raw.toFixed(4) : raw; return v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v); };
  return [head.join(","), ...rows.map((r) => head.map((h) => esc((r as unknown as Record<string, unknown>)[h])).join(","))].join("\n");
}

function Th({ k, label, sort, dir, onSort, className }: { k: SortKey; label: string; sort: SortKey; dir: 1 | -1; onSort: (k: SortKey) => void; className?: string }) {
  const on = sort === k;
  return (
    <th className={clsx("px-3 py-2.5 font-normal", className)}>
      <button onClick={() => onSort(k)} className={clsx("inline-flex items-center gap-1 uppercase tracking-[0.1em] transition hover:text-foreground", on && "text-foreground")}>
        {label}{on && (dir === -1 ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );
}

export default function UnusualPage() {
  const [type, setType] = useState<"all" | "call" | "put">("all");
  const [minPremium, setMinPremium] = useState("250000");
  const [side, setSide] = useState<"all" | "ask" | "bid">("all");
  const [maxDte, setMaxDte] = useState("60");
  const [filter, setFilter] = useState("");
  const [custom, setCustom] = useState("");
  const [symbols, setSymbols] = useState<string[] | undefined>(undefined);
  const [sort, setSort] = useState<SortKey>("score");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [hidden, setHidden] = useState<ColId[]>([]);
  const [colsOpen, setColsOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "[]"); if (Array.isArray(v)) setHidden(v); } catch { /* storage off */ } }, []);
  const toggleCol = (id: ColId) => setHidden((h) => {
    const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* storage off */ }
    return next;
  });
  const show = (id: ColId) => !hidden.includes(id);

  const { data, isFetching, refetch, error } = useQuery<UnusualScan>({
    queryKey: ["unusual", symbols?.join(","), minPremium],
    queryFn: () => fetchUnusual({ symbols, minPremium: Number(minPremium) }),
    staleTime: 120_000,
    refetchInterval: 300_000,
  });

  const rows = useMemo(() => {
    const f = filter.trim().toUpperCase();
    return (data?.rows ?? [])
      .filter((r) => (type === "all" || r.type === type) && (side === "all" || r.side === side) && r.dte <= Number(maxDte) && (!f || r.symbol.includes(f)))
      .sort((a, b) => ((a[sort] ?? -Infinity) > (b[sort] ?? -Infinity) ? 1 : -1) * dir);
  }, [data, type, side, maxDte, filter, sort, dir]);

  const callP = rows.filter((r) => r.type === "call").reduce((a, r) => a + r.premium, 0);
  const putP = rows.filter((r) => r.type === "put").reduce((a, r) => a + r.premium, 0);
  const exportCsv = () => {
    if (!rows.length) return;
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `unusual-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) {
        if (e.key === "Escape") (el as HTMLInputElement).blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (e.key === "/") { e.preventDefault(); filterRef.current?.focus(); }
      else if (k === "s") { e.preventDefault(); scanRef.current?.focus(); }
      else if (k === "c") setType("call");
      else if (k === "p") setType("put");
      else if (k === "a") setType("all");
      else if (k === "e") exportCsv();
      else if (k === "r") refetch();
      else if (e.key === "?") setHelp((h) => !h);
      else if (e.key === "Escape") { setHelp(false); setColsOpen(false); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const onSort = (k: SortKey) => { if (k === sort) setDir(dir === 1 ? -1 : 1); else { setSort(k); setDir(k === "dte" ? 1 : -1); } };

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 pb-16 pt-8 sm:px-6">
      <PageHeader
        eyebrow="Research"
        title="Unusual activity"
        sub="Option contracts trading far above their open interest with large premium: fresh positioning today."
        action={<RefreshButton onRefresh={() => refetch()} isRefreshing={isFetching} />}
      />

      {/* Summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Contracts shown", rows.length.toLocaleString()],
          ["Call premium", money(callP)],
          ["Put premium", money(putP)],
          ["Call / put", putP ? (callP / putP).toFixed(2) : "—"],
        ].map(([l, v], i) => (
          <div key={l} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/55">{l}</p>
            <p className={clsx("mt-1 font-mono text-2xl font-medium tabular-nums", i === 1 ? "text-gain" : i === 2 ? "text-loss" : "text-foreground")}>{v}</p>
          </div>
        ))}
      </div>
      {(callP + putP) > 0 && (
        <div className="mb-6 flex h-1.5 overflow-hidden rounded-full" aria-hidden>
          <div className="bg-gain" style={{ width: `${(callP / (callP + putP)) * 100}%` }} />
          <div className="bg-loss" style={{ width: `${(putP / (callP + putP)) * 100}%` }} />
        </div>
      )}

      <Panel
        padded={false}
        className="!overflow-visible"
        title={data ? `${data.symbols.length} tickers scanned` : "Scanning"}
        sub={data ? `As of ${new Date(data.as_of).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Yahoo Finance, delayed` : undefined}
      >
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Segmented label="Type" value={type} onChange={setType} options={[{ value: "all", label: "All" }, { value: "call", label: "Calls" }, { value: "put", label: "Puts" }]} />
          <Segmented label="Side" value={side} onChange={setSide} options={[{ value: "all", label: "Any side" }, { value: "ask", label: "At ask" }, { value: "bid", label: "At bid" }]} />
          <Segmented label="Minimum premium" value={minPremium} onChange={setMinPremium}
            options={[{ value: "100000", label: "$100K+" }, { value: "250000", label: "$250K+" }, { value: "500000", label: "$500K+" }, { value: "1000000", label: "$1M+" }]} />
          <Segmented label="Days to expiry" value={maxDte} onChange={setMaxDte}
            options={[{ value: "7", label: "≤7d" }, { value: "21", label: "≤21d" }, { value: "60", label: "≤60d" }]} />
          <label className="relative ml-auto">
            <span className="sr-only">Filter by ticker</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40" />
            <input ref={filterRef} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter ticker  /"
              className="h-8 w-36 rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-2 font-mono text-[12px] uppercase text-foreground outline-none focus:border-foreground/30" />
          </label>
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); const l = custom.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean); setSymbols(l.length ? l : undefined); }}>
            <input ref={scanRef} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Scan tickers: TSLA, PLTR"
              aria-label="Tickers to scan" className="h-8 w-48 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 font-mono text-[12px] uppercase text-foreground outline-none focus:border-foreground/30" />
            <button className="btn-primary h-8 px-3 text-[12px]">Scan</button>
            {symbols && <button type="button" onClick={() => { setSymbols(undefined); setCustom(""); }} className="btn-ghost h-8 px-2.5 text-[12px]">Default list</button>}
          </form>
          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen} aria-haspopup="menu" className="btn-ghost h-8 px-2.5 text-[12px]" title="Show or hide columns">
                <Columns3 size={13} /> Columns{hidden.length ? <span className="text-foreground/45"> {COLS.length - hidden.length}/{COLS.length}</span> : null}
              </button>
              {colsOpen && (
                <div role="menu" className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-float)]">
                  {COLS.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12.5px] text-foreground/80 hover:bg-foreground/[0.05]">
                      <input type="checkbox" checked={show(c.id)} onChange={() => toggleCol(c.id)} className="accent-[rgb(var(--accent-rgb))]" />{c.label}
                    </label>
                  ))}
                  {hidden.length > 0 && <button onClick={() => { setHidden([]); try { localStorage.removeItem(COLS_KEY); } catch { /* storage off */ } }} className="mt-1 w-full rounded-md px-2 py-1 text-left text-[12px] text-accent hover:bg-foreground/[0.05]">Show all</button>}
                </div>
              )}
            </div>
            <button onClick={exportCsv} disabled={!rows.length} className="btn-ghost h-8 px-2.5 text-[12px] disabled:opacity-40" title={`Download the ${rows.length} filtered rows (E)`}><Download size={13} /> CSV</button>
            <button onClick={() => setHelp((h) => !h)} aria-pressed={help} className="btn-ghost h-8 px-2 text-[12px]" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><Keyboard size={14} /></button>
          </div>
        </div>
        {help && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[12px] text-foreground/65">
            {SHORTCUTS.map(([k, l]) => <span key={k}><kbd className="rounded border border-[var(--border-strong)] px-1 font-mono text-[11px] text-foreground">{k}</kbd> {l}</span>)}
          </div>
        )}

        {error ? (
          <p className="px-4 py-10 text-center text-sm text-loss">Couldn&apos;t run the scan. Try again in a minute.</p>
        ) : !data ? (
          <div className="grid gap-2 p-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-9" />)}</div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-foreground/55">Nothing matches these filters.</p>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 240 + (COLS.length - hidden.length) * 74 }}>
              <thead className="sticky top-0 z-10 bg-[var(--surface)] text-left font-mono text-[11px] uppercase tracking-[0.1em] text-foreground/50 shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th className="px-3 py-2.5 pl-4 font-normal">Ticker</th>
                  {show("contract") && <th className="px-3 py-2.5 font-normal">Contract</th>}
                  {show("expiry") && <Th k="dte" label="Expiry" sort={sort} dir={dir} onSort={onSort} />}
                  {show("side") && <th className="px-3 py-2.5 font-normal">Side</th>}
                  {show("premium") && <Th k="premium" label="Premium" sort={sort} dir={dir} onSort={onSort} className="text-right" />}
                  {show("volume") && <Th k="volume" label="Volume" sort={sort} dir={dir} onSort={onSort} className="text-right" />}
                  {show("oi") && <th className="px-3 py-2.5 text-right font-normal">OI</th>}
                  {show("vol_oi") && <Th k="vol_oi" label="Vol/OI" sort={sort} dir={dir} onSort={onSort} className="text-right" />}
                  {show("otm") && <Th k="otm_pct" label="OTM" sort={sort} dir={dir} onSort={onSort} className="text-right" />}
                  {show("iv") && <Th k="iv_pct" label="IV" sort={sort} dir={dir} onSort={onSort} className="text-right" />}
                  {show("score") && <Th k="score" label="Score" sort={sort} dir={dir} onSort={onSort} className="pr-4" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                {rows.slice(0, 200).map((r) => (
                  <tr key={`${r.symbol}-${r.type}-${r.strike}-${r.expiry}`} className="transition hover:bg-[var(--surface-2)]">
                    <td className="px-3 py-2 pl-4">
                      <Link href={stockHref(r.symbol)} title={`Open ${r.symbol}: chart, LEAPS score, catalysts`}
                        className={clsx("inline-flex min-w-[56px] justify-center rounded-md border px-2 py-0.5 text-[12px] font-medium",
                          r.type === "call" ? "border-gain/40 bg-gain/10 text-gain" : "border-loss/40 bg-loss/10 text-loss")}>
                        {r.symbol}
                      </Link>
                    </td>
                    {show("contract") && (
                    <td className="px-3 py-2 text-foreground">
                      ${r.strike % 1 ? r.strike.toFixed(1) : r.strike} <span className={r.type === "call" ? "text-gain" : "text-loss"}>{r.type === "call" ? "Call" : "Put"}</span>
                    </td>
                    )}
                    {show("expiry") && (
                    <td className="whitespace-nowrap px-3 py-2 text-foreground/70">{expLabel(r.expiry)} <span className="text-foreground/40">{r.dte}d</span></td>
                    )}
                    {show("side") && (
                    <td className={clsx("px-3 py-2", r.side === "ask" ? "text-gain" : r.side === "bid" ? "text-loss" : "text-foreground/50")}>{SIDE_LABEL[r.side]}</td>
                    )}
                    {show("premium") && (
                    <td className="px-3 py-2 text-right font-medium text-foreground">{money(r.premium)}</td>
                    )}
                    {show("volume") && (
                    <td className="px-3 py-2 text-right text-foreground/80">{num(r.volume)}</td>
                    )}
                    {show("oi") && (
                    <td className="px-3 py-2 text-right text-foreground/50">{num(r.open_interest)}</td>
                    )}
                    {show("vol_oi") && (
                    <td className="px-3 py-2 text-right text-foreground">{r.vol_oi != null ? `${r.vol_oi.toFixed(1)}×` : "new"}</td>
                    )}
                    {show("otm") && (
                    <td className="px-3 py-2 text-right text-foreground/70">{r.otm_pct != null ? `${r.otm_pct > 0 ? "" : "ITM "}${Math.abs(r.otm_pct).toFixed(1)}%` : "—"}</td>
                    )}
                    {show("iv") && (
                    <td className="px-3 py-2 text-right text-foreground/70">{r.iv_pct != null ? `${r.iv_pct.toFixed(0)}%` : "—"}</td>
                    )}
                    {show("score") && (
                    <td className="px-3 py-2 pr-4">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-foreground/[0.08]">
                          <span className={clsx("block h-full rounded-full", r.score >= 0.8 ? "bg-gain" : r.score >= 0.6 ? "bg-warm" : "bg-loss")} style={{ width: `${r.score * 100}%` }} />
                        </span>
                        <span className="text-[12px] text-foreground/60">{r.score.toFixed(2)}</span>
                      </span>
                    </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="mt-4 grid gap-1 text-[12px] text-foreground/50">
        <p><b className="font-medium text-foreground/70">How to read it.</b> Side shows where the last trade printed: at the ask usually means a buyer paid up, at the bid usually means a seller hit it. Vol/OI above 1 means more contracts traded today than were open, so most are new positions. Score blends vol/OI, premium, distance out of the money and time to expiry.</p>
        <p>Based on delayed option chain snapshots, not a live trade tape: individual sweeps and blocks aren&apos;t visible here. Not investment advice.</p>
      </div>
    </div>
  );
}
