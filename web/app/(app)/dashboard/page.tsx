"use client";
/**
 * Dashboard — the morning desk (owner, 2026-11-08: no cards, more usable, US only).
 * Tape · your book · what to do (hedge signals, expiring options) · SPY dealer map ·
 * movers in your holdings · US market pulse · sectors (the old Markets page). The economic calendar lives on /catalyst.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowUpRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import TickerSearchInput from "@/components/TickerSearchInput";
import { fetchBrokerIncome, fetchBrokerPortfolio, fetchGex, fetchHedgeBooks, BrokerIncome, BrokerPortfolio, GexResult, HedgeBooks } from "@/lib/api";
import { DeskFigure, DeskFigures, DeskPage, DeskRow, DeskSection, Ladder, Tag } from "@/components/desk";
import { SourceBadge } from "@/components/options-flow/SourceBadge";
import { Quote, useQuotes } from "@/components/dashboard/quotes";
import { Sectors } from "@/components/dashboard/Sectors";

const usd = (v?: number | null, d = 2) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const signed = (v?: number | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${usd(v, d)}`);
const pct = (v?: number | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const tone = (v?: number | null) => (v == null || v === 0 ? "text-foreground/55" : v > 0 ? "text-gain" : "text-loss");

type Inst = { symbol: string; label: string; fmt?: (p: number) => string };
const PULSE: { group: string; items: Inst[] }[] = [
  { group: "Indexes", items: [
    { symbol: "SPY", label: "S&P 500" }, { symbol: "QQQ", label: "Nasdaq 100" }, { symbol: "IWM", label: "Russell 2000" }, { symbol: "DIA", label: "Dow 30" },
  ] },
  { group: "Futures", items: [
    { symbol: "ES=F", label: "ES" }, { symbol: "NQ=F", label: "NQ" }, { symbol: "RTY=F", label: "RTY" },
  ] },
  { group: "Vol · rates · dollar", items: [
    { symbol: "^VIX", label: "VIX", fmt: (p) => p.toFixed(2) }, { symbol: "^TNX", label: "10Y yield", fmt: (p) => `${p.toFixed(3)}%` },
    { symbol: "DX-Y.NYB", label: "Dollar index", fmt: (p) => p.toFixed(2) },
  ] },
  { group: "Commodities · crypto", items: [
    { symbol: "GC=F", label: "Gold" }, { symbol: "CL=F", label: "WTI crude" }, { symbol: "NG=F", label: "Nat gas" }, { symbol: "BTC-USD", label: "Bitcoin" },
  ] },
];
const TAPE = ["SPY", "QQQ", "IWM", "^VIX", "^TNX", "DX-Y.NYB", "GC=F", "CL=F", "BTC-USD"];
const ALL = Array.from(new Set([...TAPE, ...PULSE.flatMap((g) => g.items.map((i) => i.symbol))]));
const LABEL: Record<string, Inst> = Object.fromEntries(PULSE.flatMap((g) => g.items).map((i) => [i.symbol, i]));
const fmtPx = (sym: string, p: number) => LABEL[sym]?.fmt?.(p) ?? p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const chg = (q?: Quote) => (q?.change_pct != null ? q.change_pct / 100 : null);

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Tape({ quotes }: { quotes?: Record<string, Quote> }) {
  return (
    <div className="-mx-4 overflow-x-auto border-y border-[var(--border-strong)] sm:-mx-8">
      <div className="flex min-w-max divide-x divide-[var(--border)] px-4 sm:px-8">
        {TAPE.map((s) => {
          const q = quotes?.[s];
          return (
            <Link key={s} href={`/stocks/${encodeURIComponent(s)}`}
              className="flex items-baseline gap-2 px-4 py-2.5 font-mono text-[12.5px] tabular-nums first:pl-0 hover:bg-foreground/[0.03]">
              <span className="text-foreground/50">{LABEL[s]?.label ?? s}</span>
              <span className="text-foreground">{q?.price != null ? fmtPx(s, q.price) : "—"}</span>
              <span className={tone(chg(q))}>{pct(chg(q))}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState("");
  const quotes = useQuotes(ALL);
  const pf = useQuery<BrokerPortfolio>({ queryKey: ["broker", "portfolio", null], queryFn: () => fetchBrokerPortfolio(null), refetchInterval: 30_000 });
  const inc = useQuery<BrokerIncome>({ queryKey: ["broker", "income", null], queryFn: () => fetchBrokerIncome(null) });
  const hedge = useQuery<HedgeBooks>({ queryKey: ["hedge-books"], queryFn: fetchHedgeBooks, refetchInterval: 15_000 });
  const spy = useQuery<GexResult>({ queryKey: ["gex", "SPY"], queryFn: () => fetchGex("SPY"), refetchInterval: 60_000 });

  const p = pf.data;
  const week = inc.data?.weekly.at(-1);
  const books = (hedge.data?.books ?? []).filter((b) => !b.error);
  const signals = books.filter((b) => b.suggestion && ["SELL_CALL", "SELL_PUT", "BUY_PUT"].includes(b.suggestion.action));
  const spikes = books.filter((b) => b.iv?.spike && !signals.includes(b));
  const expiring = (p?.options ?? []).filter((o) => o.dte != null && o.dte <= 7).sort((a, b) => (a.dte ?? 0) - (b.dte ?? 0));
  const movers = [...(p?.holdings ?? [])].filter((h) => h.day_change_pct != null).sort((a, b) => Math.abs(b.day_change_pct ?? 0) - Math.abs(a.day_change_pct ?? 0)).slice(0, 6);
  const g = spy.data && !spy.data.error ? spy.data : null;
  const longGamma = (g?.net_gex ?? 0) >= 0;
  const hasBook = !!p && (p.accounts.length > 0 || p.holdings.length > 0);

  return (
    <DeskPage>
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">{greeting()}{user?.username ? `, ${user.username.split(".")[0]}` : ""}</h1>
        </div>
        <TickerSearchInput value={q} onChange={setQ} onSelect={(s) => router.push(`/stocks/${encodeURIComponent(s.trim().toUpperCase())}`)}
          placeholder="Ticker or company" actionLabel="Open" className="w-full sm:w-80" />
      </div>

      <Tape quotes={quotes.data} />

      {/* ── Your book ─────────────────────────────────────────────────── */}
      <div className="py-6">
        {hasBook ? (
          <DeskFigures>
            <DeskFigure size="lg" label="Account value" value={usd(p!.total_value, 0)}
              sub={<span className={tone(p!.day_change)}>{signed(p!.day_change, 0)} since last sync</span>} />
            <DeskFigure size="lg" label="Unrealized" value={signed(p!.unrealized, 0)} tone={tone(p!.unrealized)} sub={`stocks ${usd(p!.stock_value, 0)}`} />
            <DeskFigure size="lg" label="Premium · this week" value={signed(week?.collected ?? 0, 0)} tone="text-gain" sub={`net ${signed(week?.premium ?? 0, 0)}`} />
            <DeskFigure size="lg" label="Cash" value={usd(p!.cash, 0)} sub={`buying power ${usd(p!.buying_power, 0)}`} />
          </DeskFigures>
        ) : (
          <p className="text-[14px] text-foreground/55">Your Robinhood book shows here after the nightly sync. <Link href="/portfolio" className="text-accent">Portfolio →</Link></p>
        )}
      </div>

      <div className="grid gap-x-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {/* ── To do ───────────────────────────────────────────────── */}
          <DeskSection label="To do" className="lg:grid-cols-[120px_minmax(0,1fr)]" meta={<Link href="/hedge" className="text-accent">Hedge desk →</Link>}>
            {!signals.length && !spikes.length && !expiring.length ? (
              <p className="py-2 text-[14px] text-foreground/55">Nothing needs action. Every holding is on its delta target.</p>
            ) : (
              <div className="border-t border-[var(--border)]">
                {signals.map((b) => (
                  <Link key={b.symbol} href="/hedge" className="block">
                    <DeskRow edge={b.suggestion!.action === "SELL_PUT" ? "gain" : b.suggestion!.action === "BUY_PUT" ? "loss" : "accent"}>
                      <div className="flex items-center gap-3 py-3 pl-4 pr-2">
                        <span className="w-14 font-mono text-[14px] font-semibold text-foreground">{b.symbol}</span>
                        <Tag tone={b.suggestion!.action === "SELL_PUT" ? "gain" : b.suggestion!.action === "BUY_PUT" ? "loss" : "accent"}>{b.suggestion!.action.replace("_", " ").toLowerCase()}</Tag>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground/80">{b.suggestion!.headline}</span>
                        <span className="font-mono text-[13px] tabular-nums text-foreground">{usd(Math.abs(b.suggestion!.credit ?? 0), 0)}</span>
                      </div>
                    </DeskRow>
                  </Link>
                ))}
                {spikes.map((b) => (
                  <DeskRow key={`s-${b.symbol}`} edge="loss">
                    <div className="flex items-center gap-3 py-3 pl-4 pr-2">
                      <span className="w-14 font-mono text-[14px] font-semibold text-foreground">{b.symbol}</span>
                      <Tag tone="loss">IV spike</Tag>
                      <span className="truncate text-[13.5px] text-foreground/80">ATM IV {pct(b.iv?.iv_roc_day, 0)} today. Premium is rich; check the hedge desk.</span>
                    </div>
                  </DeskRow>
                ))}
                {expiring.map((o, i) => (
                  <DeskRow key={`e-${i}`} edge={o.moneyness === "ITM" && o.contracts < 0 ? "warn" : null}>
                    <div className="flex items-center gap-3 py-3 pl-4 pr-2">
                      <span className="w-14 font-mono text-[14px] font-semibold text-foreground">{o.symbol}</span>
                      <Tag tone={o.moneyness === "ITM" && o.contracts < 0 ? "warn" : "neutral"}>{o.dte}d · {o.moneyness ?? "—"}</Tag>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground/80">
                        {o.contracts < 0 ? "Short" : "Long"} {Math.abs(o.contracts)} {o.strike}{o.option_type === "call" ? "C" : "P"} expires {o.expiry} · spot {usd(o.spot)}
                      </span>
                      <span className={clsx("font-mono text-[13px] tabular-nums", tone(o.premium))}>{signed(o.premium, 0)}</span>
                    </div>
                  </DeskRow>
                ))}
              </div>
            )}
          </DeskSection>

          {/* ── Movers in your holdings ─────────────────────────────── */}
          {movers.length > 0 && (
            <DeskSection label="Your movers" className="lg:grid-cols-[120px_minmax(0,1fr)]" meta="today, live price">
              <div className="border-t border-[var(--border)]">
                {movers.map((h) => {
                  const w = Math.min(100, Math.abs(h.day_change_pct ?? 0) * 100 * 12);
                  return (
                    <Link key={h.symbol} href={`/stocks/${h.symbol}`} className="block">
                      <DeskRow>
                        <div className="grid grid-cols-[56px_minmax(0,1fr)_80px_76px] items-center gap-3 py-2.5 pl-4 pr-2 font-mono text-[13px] tabular-nums">
                          <span className="font-semibold text-foreground">{h.symbol}</span>
                          <div className="relative h-[6px] bg-foreground/[0.05]">
                            <div className={clsx("absolute inset-y-0 left-0", (h.day_change_pct ?? 0) >= 0 ? "bg-gain/70" : "bg-loss/70")} style={{ width: `${w}%` }} />
                          </div>
                          <span className="text-right text-foreground">{usd(h.price)}</span>
                          <span className={clsx("text-right", tone(h.day_change_pct))}>{pct(h.day_change_pct)}</span>
                        </div>
                      </DeskRow>
                    </Link>
                  );
                })}
              </div>
            </DeskSection>
          )}
        </div>

        <div className="min-w-0">
          {/* ── SPY dealer map ──────────────────────────────────────── */}
          <DeskSection label="SPY dealers" className="lg:grid-cols-1" meta={g ? <span className="inline-flex items-center gap-2"><SourceBadge data={g} /><Link href="/options-flow?ticker=SPY" className="text-accent">Flow board →</Link></span> : undefined}>
            {g ? (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
                <div>
                  <Tag tone={longGamma ? "gain" : "warn"}>{longGamma ? "+GEX · pinned" : "−GEX · volatile"}</Tag>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-foreground/70">
                    {longGamma
                      ? "Dealers are long gamma: they sell rallies and buy dips, so moves tend to fade toward the king."
                      : "Dealers are short gamma: they chase moves, so ranges widen and trends run."}
                    {g.zero_gamma != null && <> Price is <b className="font-medium text-foreground">{g.spot >= g.zero_gamma ? "above" : "below"}</b> the flip at {g.zero_gamma.toFixed(2)}.</>}
                  </p>
                </div>
                <Ladder spot={g.spot} height={170} levels={[
                  { label: "call wall", price: g.max_call_wall, tone: "text-gain" },
                  { label: "★ king", price: g.max_gex_strike, tone: "text-[#b45309] dark:text-[#fde725]" },
                  { label: "flip", price: g.zero_gamma, tone: "text-accent" },
                  { label: "put wall", price: g.max_put_wall, tone: "text-loss" },
                ]} />
              </div>
            ) : <p className="text-[13px] text-foreground/50">{spy.isLoading ? "Loading SPY levels…" : "SPY levels unavailable right now."}</p>}
          </DeskSection>

          {/* ── Market pulse (US) ───────────────────────────────────── */}
          <DeskSection label="Market pulse" className="lg:grid-cols-1" meta="US · live">
            <div className="grid gap-5">
              {PULSE.map((grp) => (
                <div key={grp.group}>
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/40">{grp.group}</p>
                  {grp.items.map((it) => {
                    const qt = quotes.data?.[it.symbol];
                    return (
                      <div key={it.symbol} className="grid grid-cols-[minmax(0,1fr)_96px_72px] items-baseline gap-3 border-b border-[var(--border)] py-1.5 font-mono text-[13px] tabular-nums last:border-0">
                        <span className="truncate font-sans text-[13px] text-foreground/75">{it.label}</span>
                        <span className="text-right text-foreground">{qt?.price != null ? fmtPx(it.symbol, qt.price) : "—"}</span>
                        <span className={clsx("text-right", tone(chg(qt)))}>{pct(chg(qt))}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </DeskSection>
        </div>
      </div>

      <DeskSection id="sectors" label="Sectors" meta={<>Ranked by today&apos;s move.<br />Tap a sector for its stocks, sized by market cap.</>}>
        <Sectors />
      </DeskSection>

      <nav className="mt-2 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--border-strong)] pt-5 font-mono text-[12px] uppercase tracking-[0.14em]">
        {[["/options-flow", "Flow"], ["/hedge", "Hedge"], ["/portfolio", "Portfolio"], ["/catalyst", "Catalyst · calendar"], ["/unusual", "Unusual"]].map(([href, l]) => (
          <Link key={href} href={href} className="inline-flex items-center gap-1 text-foreground/60 hover:text-foreground">{l}<ArrowUpRight size={12} /></Link>
        ))}
      </nav>
    </DeskPage>
  );
}
