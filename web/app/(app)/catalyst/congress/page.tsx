"use client";
/**
 * Research → Congress: the newest congressional trade disclosures (both chambers), filterable to My stocks or a
 * watchlist, and for those names their latest quarter of lobbying. Trades need an FMP key on the server; lobbying
 * comes from lda.gov and fills in in the background (names still being fetched are listed as pending).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ExternalLink } from "lucide-react";
import { BrokerPortfolio, fetchBrokerPortfolio, fetchPoliticsFeed, fetchWatchlistGroups, PoliticalFeed, WatchlistGroups } from "@/lib/api";
import { PageHeader, Panel, RefreshButton, Segmented } from "@/components/ui";
import { stockHref } from "@/components/TickerLink";
import { usdShort } from "@/components/insight/PoliticalCard";

const day = (iso?: string | null) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" }) : "—");
const ALL = "all", HELD = "held";

export default function CongressPage() {
  const [scope, setScope] = useState<string>(HELD);
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");

  const pf = useQuery<BrokerPortfolio>({ queryKey: ["broker", "portfolio", null], queryFn: () => fetchBrokerPortfolio(null), staleTime: 60_000 });
  const lists = useQuery<WatchlistGroups>({ queryKey: ["watchlists"], queryFn: fetchWatchlistGroups, staleTime: 60_000 });
  const held = useMemo(() => [...new Set([...(pf.data?.holdings ?? []).filter((h) => h.shares > 0).map((h) => h.symbol.toUpperCase()),
    ...(pf.data?.options ?? []).filter((o) => o.contracts).map((o) => o.symbol.toUpperCase())])], [pf.data]);
  const symbols = useMemo(() => {
    if (scope === ALL) return [];
    if (scope === HELD) return held;
    return (lists.data?.lists ?? []).find((l) => String(l.id) === scope)?.symbols.map((s) => s.toUpperCase()) ?? [];
  }, [scope, held, lists.data]);

  const ready = scope === ALL || symbols.length > 0;
  const q = useQuery<PoliticalFeed>({
    queryKey: ["politics-feed", symbols.join(","), days],
    queryFn: () => fetchPoliticsFeed(symbols, Number(days)),
    enabled: ready,
    refetchInterval: (query) => (query.state.data?.pending?.length ? 20_000 : 10 * 60_000),
  });
  const d = q.data;
  const trades = (d?.congress.trades ?? []).filter((t) => side === "all" || t.side === side);
  const buys = trades.filter((t) => t.side === "buy").length, sells = trades.filter((t) => t.side === "sell").length;

  const scopes = [{ value: HELD, label: "My stocks" }, { value: ALL, label: "All of Congress" },
    ...(lists.data?.lists ?? []).map((l) => ({ value: String(l.id), label: l.name }))];

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 pb-16 pt-8 sm:px-6">
      <PageHeader eyebrow="Research" title="Congress"
        sub="Stock trades disclosed by members of Congress, and what companies spend on lobbying."
        action={<RefreshButton onRefresh={() => q.refetch()} isRefreshing={q.isFetching} />} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-foreground/60">
          Names
          <select value={scope} onChange={(e) => setScope(e.target.value)}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[13px] text-foreground outline-none focus:border-foreground/30">
            {scopes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <Segmented label="Disclosed within" value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        <Segmented label="Side" value={side} onChange={setSide} options={[{ value: "all", label: "All" }, { value: "buy", label: "Buys" }, { value: "sell", label: "Sells" }]} />
      </div>

      {!ready && <p className="text-[14px] text-foreground/55">{scope === HELD ? (pf.isLoading ? "Loading your stocks…" : "No positions synced from Robinhood yet. Pick a watchlist or All of Congress.") : "This list is empty."}</p>}

      {ready && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel padded={false} title="Congress trades"
            sub={d?.congress.status === "ok" ? `${trades.length} disclosures · ${buys} buys · ${sells} sells` : undefined}>
            {q.isLoading ? <div className="grid gap-2 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div>
              : d?.congress.status === "not_configured" ? <p className="p-4 text-[13.5px] text-foreground/60">Not set up yet: congressional trades need an FMP data key on the server. Lobbying (right) works without it.</p>
              : d?.congress.status === "unavailable" ? <p className="p-4 text-[13.5px] text-foreground/60">{d.congress.message || "The trades source didn't answer. Try again later."}</p>
              : !trades.length ? <p className="p-4 text-[13.5px] text-foreground/60">No disclosures {scope === ALL ? "" : "for these names "}in the last {days} days.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[13px]">
                    <thead className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground/45">
                      <tr className="border-b border-[var(--border)]">
                        {["Ticker", "Member", "Side", "Amount", "Traded", "Reported", ""].map((h) => <th key={h} className="px-3 py-2.5 font-normal">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {trades.map((t, i) => (
                        <tr key={i} className="hover:bg-foreground/[0.03]">
                          <td className="px-3 py-2 font-mono font-medium">{t.symbol ? <Link href={stockHref(t.symbol) + "#political"} className="hover:underline">{t.symbol}</Link> : "—"}</td>
                          <td className="px-3 py-2"><span className="text-foreground">{t.member}</span> <span className="text-foreground/45">· {t.chamber}{t.owner && !/self/i.test(t.owner) ? ` · ${t.owner}` : ""}</span></td>
                          <td className="px-3 py-2"><span className={clsx("rounded px-1.5 py-0.5 font-mono text-[10.5px] uppercase", t.side === "buy" ? "bg-gain/10 text-gain" : t.side === "sell" ? "bg-loss/10 text-loss" : "bg-foreground/[0.06] text-foreground/60")}>{t.side}</span></td>
                          <td className="px-3 py-2 font-mono text-[12px] tabular-nums text-foreground/75">{t.amount ?? "—"}</td>
                          <td className="px-3 py-2 font-mono text-[12px] text-foreground/65">{day(t.transaction_date)}</td>
                          <td className="px-3 py-2 font-mono text-[12px] text-foreground/65">{day(t.disclosure_date)}{t.days_late != null && <span className="text-foreground/40"> · {t.days_late}d</span>}</td>
                          <td className="px-3 py-2">{t.link && <a href={t.link} target="_blank" rel="noreferrer" aria-label="Filing" className="text-foreground/45 hover:text-accent"><ExternalLink size={13} /></a>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Panel>

          <Panel padded={false} title="Lobbying, latest quarter" sub={scope === ALL ? "Pick My stocks or a watchlist" : "lda.gov · as reported"}>
            {scope === ALL ? <p className="p-4 text-[13.5px] text-foreground/60">Lobbying is shown per company: choose My stocks or a watchlist.</p>
              : q.isLoading ? <div className="grid gap-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>
              : (
                <>
                  {!!d?.lobbying.length && (
                    <ul className="divide-y divide-[var(--border)]">
                      {d.lobbying.map((l) => (
                        <li key={l.symbol} className="px-4 py-2.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <Link href={stockHref(l.symbol) + "#political"} className="font-mono text-[13px] font-medium hover:underline">{l.symbol}</Link>
                            <span className="font-mono text-[13px] tabular-nums text-foreground">{usdShort(l.amount)} <span className="text-[11px] text-foreground/45">{l.period}</span></span>
                          </div>
                          {l.issues.length > 0 && <p className="mt-0.5 truncate text-[12px] text-foreground/55">{l.issues.join(" · ")}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {d && !d.lobbying.length && !d.pending.length && <p className="p-4 text-[13.5px] text-foreground/60">None of these companies filed lobbying reports in the last four quarters.</p>}
                  {!!d?.pending.length && (
                    <p className="border-t border-[var(--border)] px-4 py-2.5 font-mono text-[11px] text-foreground/45">
                      Still fetching {d.pending.length} name{d.pending.length === 1 ? "" : "s"} ({d.pending.slice(0, 6).join(", ")}{d.pending.length > 6 ? "…" : ""}); this list fills in on its own.
                    </p>
                  )}
                </>
              )}
          </Panel>
        </div>
      )}
      <p className="mt-6 max-w-3xl text-[12px] leading-relaxed text-foreground/45">
        Members of Congress must report trades within 45 days, so this shows past positioning, not today&apos;s. Amounts are the disclosed ranges.
        Lobbying is matched to tickers by company name; filings made under a subsidiary or a trade group aren&apos;t included.
      </p>
    </div>
  );
}
