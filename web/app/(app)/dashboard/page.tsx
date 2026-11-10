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
import { fetchBrokerIncome, fetchBrokerPortfolio, fetchGex, fetchReports, BrokerIncome, BrokerPortfolio, GexResult } from "@/lib/api";
import { rank, reportName, reportWhen } from "@/lib/reports";
import { DeskFigure, DeskFigures, DeskPage, DeskRow, DeskSection, Ladder, Scale, Tag } from "@/components/desk";
import { bookBeta, dayPnl, liveAccount, okBooks, SESSION_LABEL, Tick, useLiveBooks, useLivePortfolio } from "@/lib/live";
import { SourceBadge } from "@/components/options-flow/SourceBadge";
import { extMove, Quote, useQuotes } from "@/components/dashboard/quotes";
import { Sectors } from "@/components/dashboard/Sectors";

const usd = (v?: number | null, d = 2) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const signed = (v?: number | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${usd(v, d)}`);
const pct = (v?: number | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const tone = (v?: number | null) => (v == null || v === 0 ? "text-foreground/55" : v > 0 ? "text-gain" : "text-loss");

const ACT: Record<string, { label: string; tone: "accent" | "gain" | "warn" | "neutral"; edge: "accent" | "gain" | "warn" | null }> = {
  SELL_CALL: { label: "Sell call", tone: "accent", edge: "accent" },
  SELL_PUT: { label: "Sell put", tone: "gain", edge: "gain" },
  BUY_STOCK: { label: "Buy stock", tone: "warn", edge: "warn" },
  WAIT: { label: "Wait", tone: "neutral", edge: null },
  HOLD: { label: "Hold", tone: "neutral", edge: null },
  TRACK: { label: "Track", tone: "neutral", edge: null },
};

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

/** "AH +0.31%": the move since the last close, outside the regular session (ext_change_pct is in percent). */
function ExtPct({ m }: { m: { label: string; pct: number } | null }) {
  if (!m) return null;
  return <span className="whitespace-nowrap text-foreground/45">{m.label} <span className={tone(m.pct)}>{m.pct > 0 ? "+" : ""}{m.pct.toFixed(2)}%</span></span>;
}

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
              <ExtPct m={extMove(q?.session, q?.ext_change_pct)} />
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
  const reports = useQuery({ queryKey: ["reports"], queryFn: fetchReports, refetchInterval: 5 * 60_000 });
  const hedge = useLiveBooks();
  const spy = useQuery<GexResult>({ queryKey: ["gex", "SPY"], queryFn: () => fetchGex("SPY"), refetchInterval: 60_000 });

  const p = useLivePortfolio(pf.data);
  const week = inc.data?.weekly.at(-1);
  const books = okBooks(hedge.data);
  const today = dayPnl(books);
  const acct = liveAccount(p, books);
  const unreal = p?.unrealized != null ? p.unrealized + (acct?.optionsUnrealized ?? 0) : null;
  const { beta } = bookBeta(books);
  const lotBooks = books.filter((b) => (b.lots ?? 0) >= 1);
  const lots = lotBooks.reduce((a, b) => a + Math.floor(b.lots ?? 0), 0);
  const perLot = lots ? lotBooks.reduce((a, b) => a + (b.net_delta ?? 0), 0) / lots : null;
  const signals = books.filter((b) => b.suggestion && ["SELL_CALL", "SELL_PUT", "BUY_STOCK"].includes(b.suggestion.action));
  const ORDER = ["SELL_CALL", "SELL_PUT", "BUY_STOCK", "WAIT", "HOLD", "TRACK"];
  const buybacks = books.flatMap((b) => (b.closes ?? []).map((c) => ({ b, c })));
  const actions = books.filter((b) => b.suggestion).sort((x, y) => ORDER.indexOf(x.suggestion!.action) - ORDER.indexOf(y.suggestion!.action));
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
      {!!reports.data?.length && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-[var(--border)] py-2.5 font-mono text-[11.5px]">
          <span className="uppercase tracking-[0.16em] text-foreground/45">Reports</span>
          {[...reports.data].sort((a, b) => rank(a.slug) - rank(b.slug)).map((r) => (
            <Link key={r.slug} href={`/catalyst/reports?r=${encodeURIComponent(r.slug)}`} className="text-accent hover:underline">
              {reportName(r)} <span className="text-foreground/45">{reportWhen(r.published_at)}</span>
            </Link>
          ))}
        </div>
      )}

      {/* ── Your book ─────────────────────────────────────────────────── */}
      <div className="py-6">
        {hasBook ? (
          <>
          <DeskFigures>
            <DeskFigure sensitive size="lg" label={acct ? "Account value · live" : "Account value"}
              value={<Tick value={acct ? Math.round(acct.value) : null}>{usd(acct?.value ?? p!.total_value, 0)}</Tick>}
              sub={<>at sync {usd(p!.total_value, 0)}{p!.synced_at ? ` · ${new Date(p!.synced_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</>} />
            {today && (
              <DeskFigure sensitive size="lg"
                label={today.ext ? `Today · ${today.closeDate ? new Date(today.closeDate + "T12:00").toLocaleDateString(undefined, { weekday: "short" }) : "last close"}` : "Today · live"}
                value={<Tick value={Math.round(today.total)}>{signed(today.total, 0)}</Tick>} tone={tone(today.total)}
                sub={today.ext
                  ? <><span className={tone(today.ext.total)}><Tick value={Math.round(today.ext.total)}>{signed(today.ext.total, 0)}</Tick></span> {SESSION_LABEL[today.session ?? "closed"].toLowerCase()} · live</>
                  : <>stocks {signed(today.stocks, 0)} · options {signed(today.options, 0)}</>} />
            )}
            <DeskFigure sensitive size="lg" label="Unrealized" value={<Tick value={unreal != null ? Math.round(unreal) : null}>{signed(unreal, 0)}</Tick>} tone={tone(unreal)}
              sub={<>stocks {signed(p!.unrealized, 0)}{acct ? <> · options {signed(acct.optionsUnrealized, 0)}</> : null}</>} />
            <DeskFigure sensitive size="lg" label="Net premium · this week" value={signed(week?.premium ?? 0, 0)} tone={tone(week?.premium ?? 0)}
              sub={`sold ${usd(week?.collected ?? 0, 0)} · bought back ${usd(week?.bought_back ?? 0, 0)}`} />
            <DeskFigure sensitive size="lg" label="Cash" value={usd(p!.cash, 0)} sub={`margin buying power ${usd(p!.buying_power, 0)}`} />
          </DeskFigures>
          {(perLot != null || beta != null) && (
            <Link href="/hedge" className="mt-5 grid gap-x-12 gap-y-2 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
              {perLot != null && (
                <div className="min-w-0">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Book Δ per lot · +1 = stock alone</p>
                  <Scale min={-0.5} max={1.5} value={perLot} tips={{ value: `Book now: ${perLot >= 0 ? "+" : ""}${perLot.toFixed(2)} per lot · +1 = stock alone` }} label={`${perLot >= 0 ? "+" : ""}${perLot.toFixed(2)}`}
                    pin={perLot >= 0.85 ? "bg-gain" : perLot >= 0.4 ? "bg-accent" : "bg-amber-500"}
                    zones={[{ from: -0.5, to: 0.4, cls: "bg-amber-500/25" }, { from: 0.4, to: 0.85, cls: "bg-accent/20" }, { from: 0.85, to: 1.5, cls: "bg-gain/25" }]}
                    marks={[{ at: 0, label: "0", strong: true }, { at: 1, label: "+1", strong: true }]} />
                </div>
              )}
              {beta != null && (
                <div className="min-w-0">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Portfolio beta vs SPY</p>
                  <Scale min={0} max={3} value={beta} label={beta.toFixed(2)} tips={{ value: `Portfolio beta ${beta.toFixed(2)} · 1 = moves with the market` }} pin={beta >= 1.5 ? "bg-loss" : beta >= 1.1 ? "bg-amber-500" : "bg-gain"}
                    zones={[{ from: 0, to: 1.1, cls: "bg-gain/20" }, { from: 1.1, to: 1.5, cls: "bg-amber-500/25" }, { from: 1.5, to: 3, cls: "bg-loss/20" }]}
                    marks={[{ at: 0, label: "0" }, { at: 1, label: "1 market", strong: true }, { at: 3, label: "3" }]} />
                </div>
              )}
            </Link>
          )}
          </>
        ) : (
          <p className="text-[14px] text-foreground/55">Your Robinhood book shows here after the first Robinhood sync. <Link href="/portfolio" className="text-accent">Portfolio →</Link></p>
        )}
      </div>

      <div className="grid gap-x-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {/* ── Actions: one line per holding ───────────────────────── */}
          <DeskSection label="Actions" className="lg:grid-cols-[120px_minmax(0,1fr)]" meta={<Link href="/hedge" className="text-accent">Hedge desk →</Link>}>
            {!actions.length && !buybacks.length ? (
              <p className="py-2 text-[14px] text-foreground/55">Your holdings show here after the first Robinhood sync.</p>
            ) : (
              <div className="border-t border-[var(--border)]">
                {buybacks.map(({ b, c }) => (
                  <Link key={`bb-${b.symbol}-${c.strike}-${c.otype}-${c.expiry}`} href="/hedge" className="block">
                    <DeskRow edge="loss">
                      <div className="grid grid-cols-[52px_84px_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 pl-4 pr-2">
                        <span className="font-mono text-[13.5px] font-semibold text-foreground">{b.symbol}</span>
                        <span><Tag tone="solid">Buy back</Tag></span>
                        <span className="min-w-0 truncate text-[13px] text-foreground" title={c.headline}>
                          {c.contracts}× {c.strike}{c.otype === "call" ? "C" : "P"} {c.expiry.slice(5)} · {Math.round(c.profit_pct * 100)}% in
                        </span>
                        <span className="sensitive text-right font-mono text-[12.5px] tabular-nums text-foreground/80">{usd(c.cost, 0)}</span>
                      </div>
                    </DeskRow>
                  </Link>
                ))}
                {actions.map((b) => {
                  const s = b.suggestion!;
                  const a = ACT[s.action];
                  const what = s.action === "BUY_STOCK" ? `+${s.shares} sh`
                    : s.action === "SELL_CALL" || s.action === "SELL_PUT" ? `${s.contracts}× ${s.strike}${s.otype === "call" ? "C" : "P"} ${s.expiry?.slice(5)}`
                    : s.headline.split(/[;:]/)[0];
                  return (
                    <Link key={b.symbol} href="/hedge" className="block">
                      <DeskRow edge={a.edge}>
                        <div className="grid grid-cols-[52px_84px_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 pl-4 pr-2">
                          <span className="font-mono text-[13.5px] font-semibold text-foreground">{b.symbol}</span>
                          <span><Tag tone={a.tone}>{a.label}</Tag></span>
                          <span className={clsx("min-w-0 truncate text-[13px]", a.edge ? "text-foreground" : "text-foreground/50")} title={s.headline}>{what}</span>
                          <span className="sensitive text-right font-mono text-[12.5px] tabular-nums text-foreground/80">{a.edge && s.credit ? usd(Math.abs(s.credit), 0) : ""}</span>
                        </div>
                      </DeskRow>
                    </Link>
                  );
                })}
              </div>
            )}
          </DeskSection>

          {/* ── Expiring & alerts ───────────────────────────────────── */}
          {(spikes.length > 0 || expiring.length > 0) && (
          <DeskSection label="Expiring" className="lg:grid-cols-[120px_minmax(0,1fr)]" meta="≤7 days · IV spikes">
              <div className="border-t border-[var(--border)]">
                {spikes.map((b) => (
                  <DeskRow key={`s-${b.symbol}`} edge="loss">
                    <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-3 pl-4 pr-2 sm:grid-cols-[56px_auto_minmax(0,1fr)]">
                      <span className="font-mono text-[14px] font-semibold text-foreground">{b.symbol}</span>
                      <span><Tag tone="loss">IV spike</Tag></span>
                      <span className="col-span-2 min-w-0 text-[13px] leading-snug text-foreground/75 sm:col-span-1 sm:truncate">ATM IV {pct(b.iv?.iv_roc_day, 0)} today. Premium is rich: a call near your average.</span>
                    </div>
                  </DeskRow>
                ))}
                {expiring.map((o, i) => (
                  <DeskRow key={`e-${i}`} edge={o.moneyness === "ITM" && o.contracts < 0 ? "warn" : null}>
                    <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-3 pl-4 pr-2 sm:grid-cols-[56px_auto_minmax(0,1fr)_auto]">
                      <span className="font-mono text-[14px] font-semibold text-foreground">{o.symbol}</span>
                      <span><Tag tone={o.moneyness === "ITM" && o.contracts < 0 ? "warn" : "neutral"}>{o.dte}d · {o.moneyness ?? "—"}</Tag></span>
                      <span className={clsx("sensitive text-right font-mono text-[13px] tabular-nums sm:order-last", tone(o.premium))}>{signed(o.premium, 0)}</span>
                      <span className="col-span-3 min-w-0 text-[13px] leading-snug text-foreground/75 sm:col-span-1 sm:truncate">
                        {o.contracts < 0 ? "Short" : "Long"} {Math.abs(o.contracts)} {o.strike}{o.option_type === "call" ? "C" : "P"} · {o.expiry.slice(5)} · spot <Tick value={o.spot}>{usd(o.spot)}</Tick>
                      </span>
                    </div>
                  </DeskRow>
                ))}
              </div>
          </DeskSection>
          )}

          {/* ── Movers in your holdings ─────────────────────────────── */}
          {movers.length > 0 && (
            <DeskSection label="Your movers" className="lg:grid-cols-[120px_minmax(0,1fr)]" meta="today, live price">
              <div className="border-t border-[var(--border)]">
                {movers.map((h) => {
                  const w = Math.min(100, Math.abs(h.day_change_pct ?? 0) * 100 * 12);
                  return (
                    <Link key={h.symbol} href={`/stocks/${h.symbol}`} className="block">
                      <DeskRow>
                        <div className="grid grid-cols-[52px_minmax(0,1fr)_76px_70px] items-center gap-3 py-2.5 pl-4 pr-3 font-mono text-[13px] tabular-nums">
                          <span className="font-semibold text-foreground">{h.symbol}</span>
                          <div className="relative h-[6px] bg-foreground/[0.05]">
                            <div className={clsx("absolute inset-y-0 left-0", (h.day_change_pct ?? 0) >= 0 ? "bg-gain/70" : "bg-loss/70")} style={{ width: `${w}%` }} />
                          </div>
                          <span className="text-right text-foreground"><Tick value={h.price}>{usd(h.price)}</Tick></span>
                          <span className={clsx("text-right", tone(h.day_change_pct))}>{pct(h.day_change_pct)}
                            {extMove(h.session, h.ext_change_pct) && <span className="block text-[10.5px] leading-tight"><ExtPct m={extMove(h.session, h.ext_change_pct)} /></span>}
                          </span>
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
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div>
                  <Tag tone={longGamma ? "gain" : "warn"}>{longGamma ? "+GEX · pinned" : "−GEX · volatile"}</Tag>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-foreground/70">
                    {longGamma
                      ? "Dealers are long gamma: they sell rallies and buy dips, so moves tend to fade toward the king."
                      : "Dealers are short gamma: they chase moves, so ranges widen and trends run."}
                    {g.zero_gamma != null && <> Price is <b className="font-medium text-foreground">{g.spot >= g.zero_gamma ? "above" : "below"}</b> the flip at {g.zero_gamma.toFixed(2)}.</>}
                  </p>
                </div>
                <div className="min-w-0 sm:min-w-[220px]"><Ladder spot={g.spot} height={170} levels={[
                  { label: "call wall", price: g.max_call_wall, tone: "text-gain" },
                  { label: "★ king", price: g.max_gex_strike, tone: "text-[#b45309] dark:text-[#fde725]" },
                  { label: "flip", price: g.zero_gamma, tone: "text-accent" },
                  { label: "put wall", price: g.max_put_wall, tone: "text-loss" },
                ]} /></div>
              </div>
            ) : <p className="text-[13px] text-foreground/50">{spy.isLoading ? "Loading SPY levels…" : "SPY levels unavailable right now."}</p>}
          </DeskSection>

          {/* ── Market pulse (US) ───────────────────────────────────── */}
          <DeskSection label="Market pulse" className="lg:grid-cols-1" meta="US · live">
            <div className="grid grid-cols-1 gap-5">
              {PULSE.map((grp) => (
                <div key={grp.group}>
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/40">{grp.group}</p>
                  {grp.items.map((it) => {
                    const qt = quotes.data?.[it.symbol];
                    return (
                      <div key={it.symbol} className="grid grid-cols-[minmax(0,1fr)_auto_68px] items-baseline gap-3 border-b border-[var(--border)] py-2 font-mono text-[13px] tabular-nums last:border-0">
                        <span className="truncate font-sans text-[13px] text-foreground/75">{it.label}</span>
                        <span className="text-right text-foreground"><Tick value={qt?.price}>{qt?.price != null ? fmtPx(it.symbol, qt.price) : "—"}</Tick></span>
                        <span className={clsx("text-right", tone(chg(qt)))}>{pct(chg(qt))}
                          {extMove(qt?.session, qt?.ext_change_pct) && <span className="block text-[10.5px] leading-tight"><ExtPct m={extMove(qt?.session, qt?.ext_change_pct)} /></span>}
                        </span>
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
        {[["/options-flow", "Flow"], ["/hedge", "Hedge"], ["/portfolio", "Portfolio"], ["/catalyst", "Catalyst"], ["/catalyst/unusual", "Unusual activity"], ["/catalyst/calendar", "Economic calendar"], ["/catalyst/reports", "Reports"]].map(([href, l]) => (
          <Link key={href} href={href} className="inline-flex items-center gap-1 text-foreground/60 hover:text-foreground">{l}<ArrowUpRight size={12} /></Link>
        ))}
      </nav>
    </DeskPage>
  );
}
