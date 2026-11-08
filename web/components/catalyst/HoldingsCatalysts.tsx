"use client";
/**
 * HoldingsCatalysts — Catalyst summary for every stock you hold (from the Robinhood sync).
 * One row per symbol: price, next earnings, expected move, ex-dividend, analysts, relative volume,
 * 52-week position, and flags that matter for your open options (earnings / ex-div before expiry).
 * Click a row for the full catalyst page.
 */
import { useMemo } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ChevronRight } from "lucide-react";
import { fetchBrokerPortfolio, fetchCatalysts, BrokerPortfolio, Catalysts } from "@/lib/api";
import { DeskRow, Tag } from "@/components/desk";

const pct = (v?: number | null, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const shortDate = (iso?: string | null) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");
const tone = (v?: number | null) => (v == null || v === 0 ? "text-foreground/55" : v > 0 ? "text-gain" : "text-loss");

type Flag = { label: string; tone: "loss" | "warn" | "accent" | "gain" | "neutral" };

export function HoldingsCatalysts() {
  const pf = useQuery<BrokerPortfolio>({ queryKey: ["broker", "portfolio", null], queryFn: () => fetchBrokerPortfolio(null), staleTime: 60_000 });

  // every underlying you hold stock or options in, with your nearest short-option expiry
  const held = useMemo(() => {
    const m = new Map<string, { shares: number; shortExp: string | null; options: number }>();
    for (const h of pf.data?.holdings ?? []) m.set(h.symbol, { shares: h.shares, shortExp: null, options: 0 });
    for (const o of pf.data?.options ?? []) {
      const e = m.get(o.symbol) ?? { shares: 0, shortExp: null, options: 0 };
      e.options += 1;
      if (o.contracts < 0 && o.expiry && (!e.shortExp || o.expiry < e.shortExp)) e.shortExp = o.expiry;
      m.set(o.symbol, e);
    }
    return Array.from(m.entries()).map(([symbol, v]) => ({ symbol, ...v }));
  }, [pf.data]);

  const cats = useQueries({
    queries: held.map((h) => ({ queryKey: ["catalysts", h.symbol], queryFn: () => fetchCatalysts(h.symbol), staleTime: 10 * 60_000 })),
  });

  const rows = held.map((h, i) => {
    const c = cats[i]?.data as Catalysts | undefined;
    const flags: Flag[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const ed = c?.earnings.date, xd = c?.dividend.ex_date;
    const upcoming = !!ed && ed >= today;                        // past earnings never count
    if (upcoming && h.shortExp && ed! <= h.shortExp) flags.push({ label: "Earnings before expiry", tone: "loss" });
    else if (upcoming && c?.earnings.days_until != null && c.earnings.days_until <= 14) flags.push({ label: `Earnings ${c.earnings.days_until}d`, tone: "warn" });
    if (h.shortExp && xd && xd >= today && xd <= h.shortExp) flags.push({ label: "Ex-div before expiry", tone: "warn" });
    if ((c?.volume.relative ?? 0) >= 2) flags.push({ label: `${c!.volume.relative!.toFixed(1)}× volume`, tone: "accent" });
    if (upcoming && c?.expected_move?.covers_earnings) flags.push({ label: "Move priced in", tone: "neutral" });
    return { ...h, c, upcoming, loading: cats[i]?.isLoading, flags, soon: upcoming ? c?.earnings.days_until ?? 999 : 999 };
  }).sort((a, b) => b.flags.filter((f) => f.tone === "loss").length - a.flags.filter((f) => f.tone === "loss").length || a.soon - b.soon);

  if (pf.isLoading) return <div className="h-24 animate-pulse bg-foreground/[0.03]" />;
  if (!held.length) {
    return <p className="py-3 text-[13.5px] text-foreground/55">No holdings synced yet. They appear here after the Robinhood sync.</p>;
  }

  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <div className="min-w-[940px]">
        <div className="grid grid-cols-[84px_84px_96px_116px_84px_112px_56px_minmax(180px,1fr)_16px] gap-3 border-b border-[var(--border-strong)] px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45">
          <span>Symbol</span><span className="text-right">Price</span><span>Earnings</span><span>Expected move</span>
          <span>Ex-div</span><span>Analysts</span><span className="text-right">Rel vol</span><span>Flags</span><span />
        </div>
        {rows.map((r) => {
          const c = r.c;
          const worst = r.flags.find((f) => f.tone === "loss") ? "loss" : r.flags.find((f) => f.tone === "warn") ? "warn" : null;
          return (
            <Link key={r.symbol} href={`/catalyst/${r.symbol}`} className="block">
              <DeskRow edge={worst as "loss" | "warn" | null}>
                <div className="grid grid-cols-[84px_84px_96px_116px_84px_112px_56px_minmax(180px,1fr)_16px] items-center gap-3 px-4 py-3 font-mono text-[12.5px] tabular-nums">
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-semibold tracking-tight text-foreground">{r.symbol}</p>
                    <p className="truncate font-sans text-[11px] text-foreground/45">
                      <span className="sensitive">{r.shares ? `${r.shares} sh` : ""}</span>{r.shares && r.options ? " · " : ""}{r.options ? `${r.options} opt` : ""}
                    </p>
                  </div>
                  {r.loading && !c ? (
                    <span className="col-span-6 h-3 animate-pulse rounded bg-foreground/[0.06]" />
                  ) : !c ? (
                    <span className="col-span-6 font-sans text-[12.5px] text-foreground/45">Catalyst data unavailable right now.</span>
                  ) : (
                    <>
                      <div className="text-right">
                        <p className="text-foreground">{c.price != null ? c.price.toFixed(2) : "—"}</p>
                        <p className={clsx("text-[11px]", tone(c.change_pct))}>{pct(c.change_pct, 2)}</p>
                      </div>
                      <div>
                        <p className={clsx(!r.upcoming ? "text-foreground/45" : c.earnings.days_until != null && c.earnings.days_until <= 14 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>{shortDate(c.earnings.date)}</p>
                        <p className="text-[11px] text-foreground/45">
                          {!c.earnings.date ? "" : !r.upcoming ? "reported" : `in ${c.earnings.days_until}d`}
                          {r.upcoming && c.earnings.timing ? ` · ${c.earnings.timing.replace("before open", "BMO").replace("after close", "AMC")}` : ""}
                        </p>
                      </div>
                      <div>
                        {c.expected_move ? (
                          <>
                            <p className="text-foreground">±{c.expected_move.pct.toFixed(1)}%</p>
                            <p className="text-[11px] text-foreground/45">{c.expected_move.low.toFixed(1)}–{c.expected_move.high.toFixed(1)} · {c.expected_move.expiry.slice(5)}</p>
                          </>
                        ) : <p className="text-foreground/40">—</p>}
                      </div>
                      <div>
                        <p className="text-foreground">{shortDate(c.dividend.ex_date)}</p>
                        <p className="text-[11px] text-foreground/45">{c.dividend.yield_pct != null ? `${c.dividend.yield_pct.toFixed(2)}% yld` : ""}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-sans text-[12.5px] capitalize text-foreground/85">{c.analysts.rating && c.analysts.rating !== "none" ? c.analysts.rating.replace("_", " ") : "—"}</p>
                        <p className={clsx("text-[11px]", tone(c.analysts.upside_pct))}>{c.analysts.upside_pct != null ? `${pct(c.analysts.upside_pct)} target` : ""}</p>
                      </div>
                      <p className={clsx("text-right", (c.volume.relative ?? 0) >= 1.5 ? "text-accent" : "text-foreground/60")}>{c.volume.relative != null ? `${c.volume.relative.toFixed(1)}×` : "—"}</p>
                    </>
                  )}
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {r.flags.length ? r.flags.map((f) => <Tag key={f.label} tone={f.tone}>{f.label}</Tag>)
                      : c ? <span className="truncate font-sans text-[12px] text-foreground/50">{c.news[0]?.title ?? "Nothing scheduled soon"}</span> : null}
                  </div>
                  <ChevronRight size={15} className="text-foreground/35" />
                </div>
              </DeskRow>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
