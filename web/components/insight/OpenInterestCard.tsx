"use client";
/**
 * OpenInterestCard — open interest by strike for one expiry, calls left and puts right, with the max-pain strike
 * and spot marked, plus max pain for the next expiries.
 * Max pain: the settlement price at which that expiry's open contracts are worth least to their holders (option
 * sellers lose least there), so price is often said to drift toward it into expiry. Open interest updates once a
 * day at the exchange, so this changes overnight, not during the session.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { fetchOpenInterest, OpenInterest } from "@/lib/api";

const SHOW = 21;                       // strikes shown around spot
const n = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(v));
const k = (v: number) => (v % 1 === 0 ? v.toFixed(0) : String(v));
const expLabel = (e: string) => {
  const d = new Date(`${e}T12:00:00`);
  return Number.isNaN(d.getTime()) ? e : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const dte = (e: string) => Math.max(0, Math.round((new Date(`${e}T16:00:00`).getTime() - Date.now()) / 86_400_000));
const GRID = "grid grid-cols-[minmax(0,1fr)_44px_64px_44px_minmax(0,1fr)] gap-x-2";

export function OpenInterestCard({ symbol }: { symbol: string }) {
  const [expiry, setExpiry] = useState<string | null>(null);
  const q = useQuery<OpenInterest>({
    queryKey: ["flow", "oi", symbol, expiry], queryFn: () => fetchOpenInterest(symbol, expiry), staleTime: 5 * 60_000,
  });
  const d = q.data;

  const rows = useMemo(() => {
    const all = d?.rows ?? [];
    if (!all.length) return [];
    const mid = d?.spot ?? all[Math.floor(all.length / 2)].strike;
    return [...all].sort((a, b) => Math.abs(a.strike - mid) - Math.abs(b.strike - mid)).slice(0, SHOW)
      .sort((a, b) => b.strike - a.strike);
  }, [d]);
  const max = Math.max(1, ...rows.flatMap((r) => [r.call_oi, r.put_oi]));
  const spotIdx = d?.spot != null ? rows.findIndex((r) => r.strike < d.spot!) : -1;

  if (q.isLoading) return <div className="h-48 animate-pulse rounded-lg bg-foreground/[0.03]" />;
  if (!d || !d.expiries.length) return <p className="text-[13px] text-foreground/55">No open interest for {symbol}.</p>;

  const gap = d.max_pain != null && d.spot ? ((d.max_pain - d.spot) / d.spot) * 100 : null;
  const next = d.max_pain_by_expiry.slice(0, 6);
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Max pain · {d.expiry ? `${expLabel(d.expiry)} (${dte(d.expiry)}d)` : ""}</p>
          <p className="mt-1 font-mono text-[26px] font-semibold tabular-nums text-[#7c3aed] dark:text-[#c4b5fd]">{d.max_pain != null ? k(d.max_pain) : "—"}</p>
          {gap != null && <p className="font-mono text-[11.5px] text-foreground/55">{Math.abs(gap) < 0.05 ? "at spot" : `${gap > 0 ? "+" : "−"}${Math.abs(gap).toFixed(1)}% from spot ${d.spot!.toFixed(2)}`}</p>}
        </div>
        <div className="grid grid-cols-3 gap-x-5 font-mono text-[12px] tabular-nums">
          <span className="text-foreground/50">Calls<br /><span className="text-[14px] text-gain">{n(d.call_oi)}</span></span>
          <span className="text-foreground/50">Puts<br /><span className="text-[14px] text-loss">{n(d.put_oi)}</span></span>
          <span className="text-foreground/50">Put/call<br /><span className="text-[14px] text-foreground">{d.put_call_ratio?.toFixed(2) ?? "—"}</span></span>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11.5px]">
        <select value={d.expiry ?? ""} onChange={(e) => setExpiry(e.target.value || null)} aria-label="Expiry"
          className="h-7 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-foreground">
          {d.expiries.map((e) => <option key={e} value={e}>{expLabel(e)} · {dte(e)}d</option>)}
        </select>
        <span className="text-foreground/40">contracts open · <span className="text-[#7c3aed] dark:text-[#c4b5fd]">◎</span> max pain</span>
      </div>

      <div className={clsx(GRID, "border-b border-[var(--border)] pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/40")}>
        <span className="col-span-2 text-right">Calls</span><span className="text-center">Strike</span><span className="col-span-2">Puts</span>
      </div>
      {rows.map((r, i) => {
        const pain = d.max_pain === r.strike;
        return (
          <div key={r.strike}>
            {i === spotIdx && d.spot != null && (
              <div className="my-0.5 flex items-center gap-2 font-mono text-[10.5px] text-foreground">
                <span className="h-px flex-1 bg-foreground/50" />spot {d.spot.toFixed(2)}<span className="h-px flex-1 bg-foreground/50" />
              </div>
            )}
            <div className={clsx(GRID, "items-center py-[3px] font-mono text-[11.5px] tabular-nums", pain && "rounded bg-[#7c3aed]/[0.08] dark:bg-[#c4b5fd]/[0.08]")}
              title={`${r.strike}: ${r.call_oi.toLocaleString()} calls · ${r.put_oi.toLocaleString()} puts open`}>
              <div className="flex h-[10px] justify-end"><div className="h-full bg-gain/60" style={{ width: `${(r.call_oi / max) * 100}%` }} /></div>
              <span className="text-right text-[10.5px] text-foreground/60">{r.call_oi ? n(r.call_oi) : ""}</span>
              <span className={clsx("text-center", pain ? "font-medium text-[#7c3aed] dark:text-[#c4b5fd]" : "text-foreground")}>{pain && "◎ "}{k(r.strike)}</span>
              <span className="text-[10.5px] text-foreground/60">{r.put_oi ? n(r.put_oi) : ""}</span>
              <div className="flex h-[10px]"><div className="h-full bg-loss/60" style={{ width: `${(r.put_oi / max) * 100}%` }} /></div>
            </div>
          </div>
        );
      })}

      {next.length > 1 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Max pain by expiry</p>
          <div className="flex flex-wrap gap-1.5">
            {next.map((m) => (
              <button key={m.expiry} onClick={() => setExpiry(m.expiry)} aria-pressed={m.expiry === d.expiry}
                className={clsx("rounded-md border px-2 py-1 font-mono text-[11.5px] tabular-nums",
                  m.expiry === d.expiry ? "border-foreground/40 bg-[var(--surface-2)] text-foreground" : "border-[var(--border)] text-foreground/60 hover:text-foreground")}>
                {expLabel(m.expiry)} <span className="text-[#7c3aed] dark:text-[#c4b5fd]">{m.max_pain != null ? k(m.max_pain) : "—"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-foreground/50">
        Max pain is where this expiry&apos;s open contracts would be worth least at settlement. Price often drifts toward it
        in the last days before expiry, most of all on heavily traded tickers. Open interest is updated once a day.
      </p>
    </div>
  );
}
