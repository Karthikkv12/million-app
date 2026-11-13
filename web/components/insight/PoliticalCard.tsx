"use client";
/**
 * Political influence on one stock (GET /politics/{symbol}): disclosed trades by members of Congress, lobbying
 * spend for the last four quarters, and federal contract dollars over 12 months. Each section says plainly when
 * it found nothing, isn't set up (no FMP key for trades) or couldn't reach its source.
 */
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ExternalLink, Landmark } from "lucide-react";
import { fetchPolitics, PoliticalProfile } from "@/lib/api";

/** $9.2K / $4.1M / $51.7B */
export const usdShort = (v: number | null | undefined) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M`
    : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(0)}K` : `${s}$${a.toFixed(0)}`;
};
const day = (iso?: string | null) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" }) : "—");

export function usePolitics(symbol: string) {
  return useQuery<PoliticalProfile>({ queryKey: ["politics", symbol.toUpperCase()], queryFn: () => fetchPolitics(symbol), staleTime: 30 * 60_000 });
}

type Status = PoliticalProfile["congress"]["status"];
function Note({ status, message, none }: { status: Status; message?: string | null; none: string }) {
  const text = status === "none" ? none
    : status === "not_configured" ? "Not set up yet: congressional trades need an FMP data key on the server."
    : status === "unknown_company" ? "Couldn't find this ticker's company name to match against government records."
    : status === "unavailable" ? (message || "The source didn't answer. Try again later.") : null;
  return text ? <p className="text-[13px] leading-relaxed text-foreground/55">{text}</p> : null;
}

function Head({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <h4 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/50">{children}</h4>
      {meta && <span className="min-w-0 font-mono text-[11px] text-foreground/45">{meta}</span>}
    </div>
  );
}

export function PoliticalCard({ symbol }: { symbol: string }) {
  const { data: p, isLoading, error } = usePolitics(symbol);
  const [all, setAll] = useState(false);

  if (isLoading) return <div className="grid gap-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>;
  if (error || !p) return <p className="text-[13px] text-foreground/55">Couldn&apos;t load political data for {symbol}.</p>;

  // Lists default to [] (the API fills them, but a partial cache entry must never crash the card).
  const c = { ...p.congress, trades: p.congress.trades ?? [] };
  const l = { ...p.lobbying, quarters: p.lobbying.quarters ?? [], issues: p.lobbying.issues ?? [], firms: p.lobbying.firms ?? [], agencies: p.lobbying.agencies ?? [] };
  const k = { ...p.contracts, agencies: p.contracts.agencies ?? [] };
  const nothing = l.status === "none" && k.status === "none" && (c.status === "none" || c.status === "not_configured");
  const trades = all ? c.trades : c.trades.slice(0, 6);
  const maxQ = Math.max(1, ...l.quarters.map((q) => q.amount));

  return (
    <div className="grid gap-5">
      {nothing && (
        <p className="flex items-center gap-2 rounded-lg bg-foreground/[0.04] px-3 py-2 text-[13px] text-foreground/65">
          <Landmark size={14} className="shrink-0 opacity-60" />
          No congressional trades, lobbying or federal contracts found for {p.company ?? symbol} in the last 12 months.
        </p>
      )}

      {/* Congress */}
      <section>
        <Head meta={c.status === "ok" ? `90 days: ${c.buys_90d} buy${c.buys_90d === 1 ? "" : "s"} · ${c.sells_90d} sell${c.sells_90d === 1 ? "" : "s"} · ${c.members_90d} member${c.members_90d === 1 ? "" : "s"}` : null}>
          Congress trades
        </Head>
        {c.status === "ok" ? (
          <>
            <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {trades.map((t, i) => (
                <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2 text-[12.5px]">
                  <span className={clsx("rounded px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]",
                    t.side === "buy" ? "bg-gain/10 text-gain" : t.side === "sell" ? "bg-loss/10 text-loss" : "bg-foreground/[0.06] text-foreground/60")}>
                    {t.side}
                  </span>
                  <span className="min-w-0 truncate text-foreground">
                    {t.member} <span className="text-foreground/45">· {t.chamber}{t.owner && !/self/i.test(t.owner) ? ` · ${t.owner}` : ""}</span>
                  </span>
                  <span className="font-mono text-[11.5px] tabular-nums text-foreground/70">{t.amount ?? "—"}</span>
                  <span />
                  <span className="col-span-2 font-mono text-[10.5px] text-foreground/45">
                    traded {day(t.transaction_date)} · reported {day(t.disclosure_date)}{t.days_late != null ? ` (${t.days_late} d later)` : ""}
                    {t.link && <a href={t.link} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-accent hover:underline">filing <ExternalLink size={10} /></a>}
                  </span>
                </li>
              ))}
            </ul>
            {c.trades.length > 6 && (
              <button onClick={() => setAll((x) => !x)} className="mt-2 font-mono text-[11px] text-accent hover:underline">
                {all ? "Show fewer" : `Show all ${c.trades.length}`}
              </button>
            )}
          </>
        ) : <Note status={c.status} message={c.message} none="No disclosed trades by members of Congress in the last 12 months." />}
      </section>

      {/* Lobbying */}
      <section>
        <Head meta={l.status === "ok" ? `last 4 quarters ${usdShort(l.total)}` : null}>Lobbying</Head>
        {l.status === "ok" ? (
          <>
            <div className="flex h-16 items-end gap-2" role="img" aria-label={l.quarters.map((q) => `${q.period} ${usdShort(q.amount)}`).join(", ")}>
              {l.quarters.map((q) => (
                <div key={q.period} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="font-mono text-[10.5px] tabular-nums text-foreground/70">{usdShort(q.amount)}</span>
                  <span className="w-full rounded-t bg-accent/70" style={{ height: `${Math.max(4, (q.amount / maxQ) * 36)}px` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-2">
              {l.quarters.map((q) => <span key={q.period} className="flex-1 text-center font-mono text-[10px] text-foreground/45">{q.period.replace(/^20(\d\d) /, "'$1 ")}</span>)}
            </div>
            {l.issues.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {l.issues.slice(0, 6).map((i) => (
                  <span key={i.name} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11.5px] text-foreground/75">{i.name}</span>
                ))}
              </div>
            )}
            <dl className="mt-3 grid gap-1 text-[12px] text-foreground/60">
              {l.agencies.length > 0 && <div><dt className="inline text-foreground/45">Lobbied: </dt><dd className="inline">{l.agencies.slice(0, 4).join(" · ")}</dd></div>}
              {l.firms.length > 0 && <div><dt className="inline text-foreground/45">Outside firms: </dt><dd className="inline">{l.firms.slice(0, 4).join(" · ")}</dd></div>}
              {l.in_house && <div className="text-foreground/45">Includes the company&apos;s own in-house lobbying.</div>}
            </dl>
          </>
        ) : <Note status={l.status} message={l.message} none="No lobbying reports filed for this company in the last four quarters." />}
      </section>

      {/* Contracts */}
      <section>
        <Head meta={k.status === "ok" ? "last 12 months" : null}>Federal contracts</Head>
        {k.status === "ok" ? (
          <>
            <p className="font-mono text-[22px] tabular-nums tracking-tight text-foreground">{usdShort(k.total_12m)}</p>
            {k.agencies.length > 0 && (
              <ul className="mt-2 grid gap-1">
                {k.agencies.slice(0, 4).map((a) => (
                  <li key={a.name} className="flex justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate text-foreground/70">{a.name}</span>
                    <span className="font-mono tabular-nums text-foreground">{usdShort(a.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : <Note status={k.status} message={k.message} none="No federal contracts found for this company in the last 12 months." />}
      </section>

      <p className="text-[11px] leading-relaxed text-foreground/40">
        Trades: congressional disclosures, reported up to 45 days late, amounts as disclosed ranges. Lobbying: lda.gov.
        Contracts: USAspending.gov, dollars obligated. Matched by company name{p.company ? ` (${p.company})` : ""}; filings under a subsidiary or trade group aren&apos;t included.
      </p>
    </div>
  );
}

/** One-line hint for the Flow details panel: shown only when there is something political to see. */
export function PoliticalBadge({ symbol, className }: { symbol: string; className?: string }) {
  const { data: p } = usePolitics(symbol);
  if (!p) return null;
  const parts: string[] = [];
  const n = (p.congress.buys_90d ?? 0) + (p.congress.sells_90d ?? 0);
  if (p.congress.status === "ok" && n > 0) parts.push(`Congress ${n} trade${n === 1 ? "" : "s"} in 90d`);
  if (p.lobbying.status === "ok" && p.lobbying.latest) parts.push(`lobbying ${usdShort(p.lobbying.latest.amount)} (${p.lobbying.latest.period})`);
  if (p.contracts.status === "ok" && (p.contracts.total_12m ?? 0) >= 1e6) parts.push(`${usdShort(p.contracts.total_12m)} federal contracts`);
  if (!parts.length) return null;
  return (
    <Link href={`/stocks/${encodeURIComponent(symbol.toUpperCase())}#political`}
      className={clsx("inline-flex max-w-full items-center gap-1.5 truncate font-mono text-[11px] text-foreground/55 hover:text-accent", className)}>
      <Landmark size={12} className="shrink-0" /><span className="truncate">{parts.join(" · ")}</span>
    </Link>
  );
}
