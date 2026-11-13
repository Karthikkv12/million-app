"use client";
/**
 * Dashboard sections built on data the app already serves:
 *  - ComingUp: earnings and ex-dividend dates in the next 14 days for every name you hold, flagged red when
 *    they land on or before your nearest short-option expiry in that name (shares the ["catalysts", sym] cache).
 *  - UnusualInHoldings: the biggest unusual option prints in your names today.
 *  - FlowLeadersPanel: net premium (calls − puts) leaders since the open; names you hold are marked.
 */
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { fetchCatalysts, fetchFlowLeaders, fetchUnusual, Catalysts, FlowLeaders, UnusualScan } from "@/lib/api";
import { DeskRow, DeskSection, Tag } from "@/components/desk";
import { TickerLink } from "@/components/TickerLink";
import { TickerLogo } from "@/components/TickerLogo";

const money = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : a.toFixed(0);
  return `${v < 0 ? "−" : ""}$${s}`;
};
const day = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const todayIso = () => new Date().toLocaleDateString("en-CA");

type Event = { symbol: string; kind: "Earnings" | "Ex-div"; date: string; days: number; detail: string; hitsShort: boolean };

export function ComingUp({ symbols, shortExp }: { symbols: string[]; shortExp: Record<string, string> }) {
  const cats = useQueries({
    queries: symbols.map((s) => ({ queryKey: ["catalysts", s], queryFn: () => fetchCatalysts(s), staleTime: 10 * 60_000 })),
  });
  if (!symbols.length) return null;
  const today = todayIso();
  const events: Event[] = [];
  cats.forEach((q, i) => {
    const c = q.data as Catalysts | undefined;
    if (!c) return;
    const sym = symbols[i], exp = shortExp[sym];
    const e = c.earnings;
    if (e.date && e.date >= today && e.days_until != null && e.days_until <= 14) {
      const mv = c.expected_move?.covers_earnings ? ` · priced ±${c.expected_move.pct.toFixed(1)}%` : "";
      events.push({ symbol: sym, kind: "Earnings", date: e.date, days: e.days_until, hitsShort: !!exp && e.date <= exp,
        detail: `${day(e.date)}${e.timing ? ` · ${e.timing}` : ""}${mv}` });
    }
    const d = c.dividend;
    if (d.ex_date && d.ex_date >= today && d.ex_days_until != null && d.ex_days_until <= 14) {
      events.push({ symbol: sym, kind: "Ex-div", date: d.ex_date, days: d.ex_days_until, hitsShort: !!exp && d.ex_date <= exp,
        detail: `${day(d.ex_date)}${d.rate ? ` · $${d.rate.toFixed(2)}/yr` : ""}` });
    }
  });
  events.sort((a, b) => a.date.localeCompare(b.date));
  const loading = cats.some((q) => q.isLoading);
  return (
    <DeskSection label="Coming up" className="lg:grid-cols-[120px_minmax(0,1fr)]"
      meta={<>Earnings · ex-div<br />next 14 days · <Link href="/catalyst" className="text-accent">Catalysts →</Link></>}>
      {!events.length ? (
        <p className="py-2 text-[13.5px] text-foreground/55">{loading ? "Checking your names…" : "No earnings or ex-dividend dates in your names in the next two weeks."}</p>
      ) : (
        <div className="border-t border-[var(--border)]">
          {events.map((e) => (
            <Link key={`${e.symbol}-${e.kind}`} href={`/catalyst/${e.symbol}`} className="block">
              <DeskRow edge={e.hitsShort ? "loss" : e.days <= 3 ? "warn" : null}>
                <div className="grid grid-cols-[76px_92px_minmax(0,1fr)] items-center gap-x-3 py-2.5 pl-4 pr-2 sm:grid-cols-[76px_92px_minmax(0,1fr)_auto]">
                  <span className="flex min-w-0 items-center gap-2"><TickerLogo symbol={e.symbol} size={18} /><span className="font-mono text-[13.5px] font-semibold text-foreground">{e.symbol}</span></span>
                  <span><Tag tone={e.hitsShort ? "loss" : e.kind === "Earnings" ? "warn" : "neutral"}>{e.kind} {e.days === 0 ? "today" : `${e.days}d`}</Tag></span>
                  <span className="min-w-0 truncate text-[13px] text-foreground/75">{e.detail}</span>
                  {e.hitsShort && <span className="col-span-3 font-mono text-[11.5px] text-loss sm:col-span-1 sm:text-right">before your short expires</span>}
                </div>
              </DeskRow>
            </Link>
          ))}
        </div>
      )}
    </DeskSection>
  );
}

export function UnusualInHoldings({ symbols }: { symbols: string[] }) {
  const q = useQuery<UnusualScan>({
    queryKey: ["unusual", symbols.join(","), "50000"],
    queryFn: () => fetchUnusual({ symbols, minPremium: 50_000 }),
    enabled: symbols.length > 0, staleTime: 120_000, refetchInterval: 300_000,
  });
  if (!symbols.length) return null;
  const rows = [...(q.data?.rows ?? [])].sort((a, b) => b.premium - a.premium).slice(0, 6);
  return (
    <DeskSection label="Unusual" className="lg:grid-cols-[120px_minmax(0,1fr)]"
      meta={<>Big option prints<br />in your names · <Link href="/catalyst/unusual" className="text-accent">All →</Link></>}>
      {!rows.length ? (
        <p className="py-2 text-[13.5px] text-foreground/55">{q.isLoading ? "Scanning your names…" : "Nothing unusual in your names today (≥ $50K premium)."}</p>
      ) : (
        <div className="border-t border-[var(--border)]">
          {rows.map((r) => (
            <DeskRow key={`${r.symbol}-${r.type}-${r.strike}-${r.expiry}`} edge={r.type === "call" ? "gain" : "loss"}>
              <div className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 pl-4 pr-2 font-mono text-[12.5px] tabular-nums sm:grid-cols-[76px_minmax(0,1fr)_88px_72px]">
                <span className="flex min-w-0 items-center gap-2"><TickerLogo symbol={r.symbol} size={18} /><TickerLink symbol={r.symbol} className="text-[13.5px] font-semibold text-foreground" /></span>
                <span className="min-w-0 truncate text-foreground">
                  {r.strike}{r.type === "call" ? "C" : "P"} {r.expiry.slice(5)} <span className="text-foreground/45">· {r.dte}d{r.side !== "unknown" ? ` · at ${r.side}` : ""}</span>
                </span>
                <span className="hidden text-right text-foreground/55 sm:block">{r.vol_oi != null ? `${r.vol_oi.toFixed(1)}× OI` : `${r.volume.toLocaleString()} vol`}</span>
                <span className={clsx("text-right", r.type === "call" ? "text-gain" : "text-loss")}>{money(r.premium)}</span>
              </div>
            </DeskRow>
          ))}
        </div>
      )}
    </DeskSection>
  );
}

export function FlowLeadersPanel({ held }: { held: string[] }) {
  const q = useQuery<FlowLeaders>({ queryKey: ["flow", "leaders", 5], queryFn: () => fetchFlowLeaders(5), refetchInterval: 60_000 });
  const d = q.data;
  if (!d || (!d.bullish.length && !d.bearish.length)) return null;
  const mine = new Set(held);
  const col = (title: string, rows: FlowLeaders["bullish"], cls: string) => (
    <div className="min-w-0">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/40">{title}</p>
      {rows.map((r) => (
        <div key={r.symbol} className="grid grid-cols-[minmax(0,1fr)_auto_52px] items-baseline gap-2 border-b border-[var(--border)] py-1.5 font-mono text-[12.5px] tabular-nums last:border-0">
          <TickerLink symbol={r.symbol} className={clsx("truncate font-semibold", mine.has(r.symbol) ? "text-accent" : "text-foreground")} />
          <span className={cls}>{money(r.net)}</span>
          <span className={clsx("text-right text-[11.5px]", r.change_pct == null ? "text-foreground/40" : r.change_pct >= 0 ? "text-gain" : "text-loss")}>
            {r.change_pct == null ? "—" : `${r.change_pct > 0 ? "+" : ""}${r.change_pct.toFixed(1)}%`}
          </span>
        </div>
      ))}
    </div>
  );
  return (
    <DeskSection label="Money flow" className="lg:grid-cols-1"
      meta={<>Net premium (calls − puts) since the open · <span className="text-accent">your names</span> · <Link href="/options-flow/premium" className="text-accent">Flow →</Link></>}>
      <div className="grid grid-cols-2 gap-x-6">
        {col("Bullish", d.bullish, "text-gain")}
        {col("Bearish", d.bearish, "text-loss")}
      </div>
    </DeskSection>
  );
}
