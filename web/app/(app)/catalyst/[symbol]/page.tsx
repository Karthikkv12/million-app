"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import { fetchCatalysts, Catalysts } from "@/lib/api";
import TickerSearchInput from "@/components/TickerSearchInput";
import { Panel, Pill, Change, SectionHeader } from "@/components/ui";
import { rememberSymbol } from "@/lib/recent";
import { TickerLink } from "@/components/TickerLink";

// ── formatting ───────────────────────────────────────────────────────────────
const usd = (v?: number | null, d = 2) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const big = (v?: number | null) => {
  if (v == null) return "—";
  const a = Math.abs(v);
  return a >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : usd(v);
};
const vol = (v?: number | null) => (v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v));
const day = (iso?: string | null) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—");
const ago = (p: string | number | null) => {
  if (p == null) return "";
  const t = typeof p === "number" ? p * 1000 : Date.parse(p);
  const h = Math.round((Date.now() - t) / 3.6e6);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

// ── pieces ───────────────────────────────────────────────────────────────────
function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">{label}</p>
      <p className="mt-1 truncate font-mono text-[18px] font-medium tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-foreground/55">{sub}</p>}
    </div>
  );
}

/** Horizontal range with markers (52-week range, price targets, expected move). */
function RangeBar({ low, high, marks }: { low: number; high: number; marks: { v: number; label: string; tone?: "accent" | "ink" | "muted" }[] }) {
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - low) / (high - low || 1)) * 100))}%`;
  return (
    <div className="pb-1 pt-6">
      <div className="relative mb-5 h-1.5 rounded-full bg-foreground/[0.08]">
        {marks.map((m, i) => (
          <div key={m.label} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: pos(m.v) }}>
            <span className={clsx("block h-3 w-3 rounded-full border-2 border-[var(--surface)]",
              m.tone === "accent" ? "bg-accent" : m.tone === "muted" ? "bg-foreground/35" : "bg-foreground")} />
            <span className={clsx("absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px]", i % 2 ? "top-4" : "bottom-4", m.tone === "accent" ? "text-accent" : "text-foreground/60")}>{m.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-foreground/50">
        <span>{usd(low)}</span><span>{usd(high)}</span>
      </div>
    </div>
  );
}

function Countdown({ days, label, sub }: { days: number | null; label: string; sub: React.ReactNode }) {
  return (
    <li className="flex items-start gap-4 py-3">
      <div className="flex w-14 shrink-0 flex-col items-center rounded-xl border border-[var(--border-strong)] py-1.5">
        <span className="font-mono text-xl font-medium leading-none tabular-nums text-foreground">{days ?? "—"}</span>
        <span className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground/50">days</span>
      </div>
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-foreground">{label}</p>
        <p className="text-[13px] text-foreground/60">{sub}</p>
      </div>
    </li>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function CatalystPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = decodeURIComponent(symbol).toUpperCase();
  const router = useRouter();
  const [q, setQ] = useState("");
  const { data: c, isLoading, error } = useQuery<Catalysts>({ queryKey: ["catalyst", sym], queryFn: () => fetchCatalysts(sym), staleTime: 300_000 });
  useEffect(() => { if (c) rememberSymbol(c.symbol); }, [c]);

  const go = (s: string) => { const t = s.trim().toUpperCase(); if (t) router.push(`/catalyst/${encodeURIComponent(t)}`); };

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 pb-16 pt-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <Link href="/catalyst" className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground"><ChevronLeft size={16} /> Catalyst</Link>
        <TickerSearchInput value={q} onChange={setQ} onSelect={go} placeholder="Check another ticker" actionLabel="Check" className="w-full sm:w-80" />
      </div>

      {isLoading ? (
        <div className="grid gap-4"><div className="skeleton h-24" /><div className="grid gap-4 md:grid-cols-3"><div className="skeleton h-56" /><div className="skeleton h-56" /><div className="skeleton h-56" /></div></div>
      ) : error || !c ? (
        <Panel title="Not found">
          <p className="text-sm text-foreground/70">Couldn&apos;t load catalysts for <b className="font-mono">{sym}</b>. Check the ticker, or try again in a minute.</p>
        </Panel>
      ) : (
        <>
          {/* Header */}
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow mb-2 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />Catalyst</p>
              <h1 className="flex flex-wrap items-baseline gap-x-3 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-[40px]">
                <TickerLink symbol={c.symbol} title={`Open the ${c.symbol} stock page and chart`} className="font-mono" />
                <span className="text-lg font-normal tracking-normal text-foreground/55">{c.name}</span>
              </h1>
            </div>
            <div className="text-right">
              <p className="font-mono text-3xl font-medium tabular-nums text-foreground">{usd(c.price)}</p>
              {c.change_pct != null && <Change pct={c.change_pct} />}
            </div>
          </div>

          {/* Signals */}
          <div className="mb-8 flex flex-wrap gap-2">
            {c.signals.length ? c.signals.map((s) => <Pill key={s.label} tone={s.tone} className="normal-case tracking-normal">{s.label}</Pill>)
              : <span className="text-[13px] text-foreground/55">No standout catalysts right now.</span>}
          </div>

          <SectionHeader label="What's next" />
          <div className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel title="Upcoming" padded={false} bodyClassName="px-4">
              <ul className="divide-y divide-[var(--border)]">
                <Countdown days={c.earnings.days_until} label="Earnings"
                  sub={c.earnings.date ? <>{day(c.earnings.date)}{c.earnings.timing ? `, ${c.earnings.timing}` : ""}</> : "Date not announced"} />
                {c.dividend.ex_date && <Countdown days={c.dividend.ex_days_until} label="Ex-dividend"
                  sub={<>{day(c.dividend.ex_date)}{c.dividend.rate ? ` · ${usd(c.dividend.rate)}/yr` : ""}{c.dividend.yield_pct ? ` (${c.dividend.yield_pct.toFixed(2)}%)` : ""}</>} />}
                {c.dividend.pay_date && <Countdown days={Math.round((Date.parse(c.dividend.pay_date) - Date.now()) / 864e5)} label="Dividend paid" sub={day(c.dividend.pay_date)} />}
              </ul>
            </Panel>

            <Panel title="Earnings estimates" sub={c.earnings.date ? `For ${day(c.earnings.date)}` : undefined}>
              <div className="grid grid-cols-2 gap-5">
                <Stat label="EPS" value={c.earnings.eps_avg != null ? `$${c.earnings.eps_avg.toFixed(2)}` : "—"}
                  sub={c.earnings.eps_low != null ? `Range $${c.earnings.eps_low.toFixed(2)}–$${c.earnings.eps_high?.toFixed(2)}` : undefined} />
                <Stat label="Revenue" value={big(c.earnings.revenue_avg)}
                  sub={c.earnings.revenue_low != null ? `${big(c.earnings.revenue_low)}–${big(c.earnings.revenue_high)}` : undefined} />
              </div>
              {c.earnings_history.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Last {c.earnings_history.length} reports</p>
                  <div className="grid grid-cols-4 gap-2">
                    {[...c.earnings_history].reverse().map((h) => {
                      const s = h.surprise_pct ?? 0;
                      return (
                        <div key={h.date} className="text-center">
                          <div className="flex h-14 items-end justify-center">
                            <div className={clsx("w-6 rounded-t", s >= 0 ? "bg-gain" : "bg-loss")} style={{ height: `${Math.max(8, Math.min(100, Math.abs(s) * 8))}%` }} title={`Estimate $${h.estimate} · Reported $${h.reported}`} />
                          </div>
                          <p className={clsx("mt-1 font-mono text-[12px] tabular-nums", s >= 0 ? "text-gain" : "text-loss")}>{s >= 0 ? "+" : ""}{s.toFixed(1)}%</p>
                          <p className="font-mono text-[11px] text-foreground/45">{new Date(h.date).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Expected move" sub={c.expected_move ? `ATM straddle, ${c.expected_move.expiry} expiry` : undefined}>
              {c.expected_move ? (
                <>
                  <div className="flex items-baseline gap-3">
                    <p className="font-mono text-3xl font-medium tabular-nums text-foreground">±{c.expected_move.pct.toFixed(1)}%</p>
                    <p className="font-mono text-[14px] text-foreground/60">±{usd(c.expected_move.dollars)}</p>
                  </div>
                  <p className="mt-1 text-[13px] text-foreground/60">
                    {c.expected_move.covers_earnings ? "Priced through earnings." : "Next expiry only; earnings is further out."}
                  </p>
                  {c.price != null && (
                    <RangeBar low={c.expected_move.low - c.expected_move.dollars * 0.25} high={c.expected_move.high + c.expected_move.dollars * 0.25}
                      marks={[{ v: c.expected_move.low, label: usd(c.expected_move.low), tone: "muted" }, { v: c.price, label: "Now", tone: "accent" }, { v: c.expected_move.high, label: usd(c.expected_move.high), tone: "muted" }]} />
                  )}
                </>
              ) : <p className="text-sm text-foreground/60">No options data for this ticker.</p>}
            </Panel>
          </div>

          <SectionHeader label="Analysts" />
          <div className="mb-10 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Panel title="Consensus and targets" actions={c.analysts.rating ? <Pill tone={/buy/.test(c.analysts.rating) ? "good" : /sell|under/.test(c.analysts.rating) ? "bad" : "neutral"}>{c.analysts.rating.replace("_", " ")}</Pill> : null}>
              {c.analysts.consensus && (() => {
                const k = c.analysts.consensus;
                const parts = [["Strong buy", k.strongBuy, "bg-gain"], ["Buy", k.buy, "bg-gain/60"], ["Hold", k.hold, "bg-foreground/25"], ["Sell", k.sell, "bg-loss/60"], ["Strong sell", k.strongSell, "bg-loss"]] as const;
                const total = parts.reduce((a, p) => a + p[1], 0) || 1;
                return (
                  <>
                    <div className="flex h-2.5 overflow-hidden rounded-full">{parts.map(([l, n, cls]) => <div key={l} className={cls} style={{ width: `${(n / total) * 100}%` }} />)}</div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-foreground/60">
                      {parts.map(([l, n, cls]) => <span key={l} className="flex items-center gap-1"><span className={clsx("h-2 w-2 rounded-sm", cls)} />{l} {n}</span>)}
                    </div>
                  </>
                );
              })()}
              {c.analysts.targets.low != null && c.analysts.targets.high != null && c.price != null && (
                <div className="mt-5">
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Price target</p>
                    {c.analysts.upside_pct != null && <span className="text-[13px] text-foreground/60">Mean {usd(c.analysts.targets.mean)} · <Change pct={c.analysts.upside_pct} digits={1} /></span>}
                  </div>
                  <RangeBar low={Math.min(c.analysts.targets.low, c.price)} high={Math.max(c.analysts.targets.high, c.price)}
                    marks={[{ v: c.analysts.targets.mean ?? c.price, label: "Mean", tone: "muted" }, { v: c.price, label: "Now", tone: "accent" }]} />
                </div>
              )}
            </Panel>

            <Panel title="Rating changes · 30 days" padded={false}>
              {c.analysts.actions.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-foreground/55">No rating changes in the last 30 days.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-[13px]">
                    <thead><tr className="text-left font-mono text-[11px] uppercase tracking-[0.1em] text-foreground/50">
                      <th className="px-4 py-2 font-normal">Date</th><th className="px-2 py-2 font-normal">Firm</th><th className="px-2 py-2 font-normal">Rating</th><th className="px-4 py-2 text-right font-normal">Target</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {c.analysts.actions.map((a, i) => (
                        <tr key={i}>
                          <td className="whitespace-nowrap px-4 py-2 font-mono text-[12px] text-foreground/55">{new Date(a.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
                          <td className="px-2 py-2 text-foreground">{a.firm}</td>
                          <td className="px-2 py-2">
                            <span className="flex flex-wrap items-center gap-1.5">
                              {a.action === "up" && <Pill tone="good">Upgrade</Pill>}{a.action === "down" && <Pill tone="bad">Downgrade</Pill>}{a.action === "init" && <Pill tone="accent">New</Pill>}
                              <span className="text-foreground/70">{a.from && a.from !== a.to ? `${a.from} → ` : ""}{a.to}</span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums">
                            {a.target != null ? <>{a.prior_target && a.prior_target !== a.target ? <span className="text-foreground/45">{usd(a.prior_target, 0)} → </span> : null}<span className={clsx(a.prior_target && a.target > a.prior_target ? "text-gain" : a.prior_target && a.target < a.prior_target ? "text-loss" : "text-foreground")}>{usd(a.target, 0)}</span></> : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <SectionHeader label="Activity and news" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Panel title="Volume and positioning">
              <div className="grid grid-cols-2 gap-5">
                <Stat label="Volume" value={c.volume.relative != null ? `${c.volume.relative.toFixed(2)}×` : "—"} sub={`${vol(c.volume.today)} vs ${vol(c.volume.average)} avg`} />
                <Stat label="Short interest" value={c.volume.short_pct_float != null ? `${c.volume.short_pct_float.toFixed(1)}%` : "—"} sub={c.volume.short_ratio != null ? `${c.volume.short_ratio.toFixed(1)} days to cover` : "of float"} />
                <Stat label="Beta" value={c.volume.beta != null ? c.volume.beta.toFixed(2) : "—"} sub="vs the S&P 500" />
                <Stat label="52-week position" value={c.range.position_pct != null ? `${c.range.position_pct.toFixed(0)}%` : "—"} sub="0% = low, 100% = high" />
              </div>
              {c.range.low != null && c.range.high != null && c.price != null && (
                <RangeBar low={c.range.low} high={c.range.high} marks={[{ v: c.price, label: "Now", tone: "accent" }]} />
              )}
            </Panel>

            <Panel title="Headlines" padded={false}>
              {c.news.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-foreground/55">No recent headlines.</p> : (
                <ul className="divide-y divide-[var(--border)]">
                  {c.news.map((n, i) => (
                    <li key={i}>
                      <a href={n.url ?? "#"} target="_blank" rel="noopener noreferrer" className="group flex items-start justify-between gap-3 px-4 py-3 transition hover:bg-[var(--surface-2)]">
                        <span className="min-w-0">
                          <span className="block text-[14px] leading-snug text-foreground group-hover:underline">{n.title}</span>
                          <span className="mt-0.5 block text-[12px] text-foreground/50">{[n.publisher, ago(n.published)].filter(Boolean).join(" · ")}</span>
                        </span>
                        <ExternalLink size={14} className="mt-1 shrink-0 text-foreground/35" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <p className="mt-8 text-[12px] text-foreground/45">{c.source} · updated {new Date(c.as_of).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Not investment advice.</p>
        </>
      )}
    </div>
  );
}
