"use client";
/**
 * Hedge — delta-neutral desk, blotter layout (no cards).
 * Summary figures, a signal queue, then one dense row per holding that expands in place
 * into the trade ticket, legs and a price ladder. Live: SSE `books` every second.
 */
import { Fragment, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { fetchHedgeBooks, HedgeBook, HedgeBooks, HedgeSuggestion } from "@/lib/api";
import { useHedgeStream } from "@/lib/useHedgeStream";
import { DeskFigure, DeskFigures, DeskPage, DeskRow, DeskSection, Ladder, Meter, Tag } from "@/components/desk";

const usd = (v?: number | null, d = 2) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const big = (v?: number | null) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "+";
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}K` : `${s}$${a.toFixed(0)}`;
};
const pct = (v?: number | null, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const vol = (v?: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const sd = (v?: number | null, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`);
const tone = (v?: number | null) => (v == null || v === 0 ? "text-foreground/55" : v > 0 ? "text-gain" : "text-loss");
const ago = (iso?: string | null) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

const TRADE = new Set(["SELL_CALL", "SELL_PUT", "BUY_PUT"]);
const ACTION: Record<HedgeSuggestion["action"], { tag: "accent" | "gain" | "loss" | "warn" | "neutral"; label: string; edge: "accent" | "gain" | "loss" | "warn" | null }> = {
  SELL_CALL: { tag: "accent", label: "Sell call", edge: "accent" },
  SELL_PUT: { tag: "gain", label: "Sell put", edge: "gain" },
  BUY_PUT: { tag: "loss", label: "Buy put", edge: "loss" },
  HOLD: { tag: "neutral", label: "On target", edge: null },
  WAIT: { tag: "warn", label: "Wait", edge: null },
  TRACK: { tag: "neutral", label: "Track", edge: null },
};

const offTarget = (b: HedgeBook) => Math.abs(b.gap ?? 0) > 0.15 * Math.max(b.lots ?? 1, 1);

// ── Expanded detail: ticket · legs · ladder ──────────────────────────────────
function Detail({ b }: { b: HedgeBook }) {
  const s = b.suggestion;
  const trade = s && TRADE.has(s.action);
  return (
    <div className="grid gap-8 bg-foreground/[0.025] px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_220px]">
      <div className="min-w-0">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Ticket</p>
        {s && (
          <>
            <p className="mt-2 text-[17px] font-medium leading-snug text-foreground">{s.headline}</p>
            {trade && (
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-[13px] sm:grid-cols-4">
                {[
                  [s.action === "BUY_PUT" ? "Debit" : "Credit", usd(Math.abs(s.credit ?? 0), 0)],
                  ["Mid / sh", usd(s.premium)],
                  ["Δ / contract", sd(s.option_delta)],
                  ["Net Δ after", sd(s.net_delta_after)],
                  ...(s.locked_gain != null ? [["If called", big(s.locked_gain)]] : []),
                  ["Contracts", String(s.contracts)],
                  ["Expiry", s.expiry ?? "—"],
                ].map(([k, v]) => (
                  <div key={k}><dt className="text-[10px] uppercase tracking-[0.14em] text-foreground/45">{k}</dt><dd className={clsx("mt-0.5 tabular-nums text-foreground", ["Credit", "Debit", "If called"].includes(k) && "sensitive")}>{v}</dd></div>
                ))}
              </dl>
            )}
            {!!s.reasons?.length && (
              <ol className="mt-4 space-y-1.5 border-l border-[var(--border-strong)] pl-3 text-[13px] leading-snug text-foreground/70">
                {s.reasons.map((r) => <li key={r}>{r}</li>)}
              </ol>
            )}
            {!!s.warnings?.length && (
              <ul className="mt-3 space-y-1 text-[13px] text-amber-700 dark:text-amber-300">
                {s.warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</li>)}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="min-w-0">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Legs</p>
        <table className="mt-2 w-full font-mono text-[12.5px] tabular-nums">
          <tbody>
            {b.legs.map((l, i) => (
              <tr key={i} className="border-b border-[var(--border)] last:border-0">
                <td className="sensitive py-1.5 pr-2 text-foreground/85">
                  {l.kind === "stock" ? `${l.quantity} sh @ ${usd(l.avg_price)}` : `${l.quantity < 0 ? "−" : "+"}${Math.abs(l.quantity)} ${l.strike}${l.otype === "call" ? "C" : "P"} ${l.expiry?.slice(5)}`}
                  {l.kind === "option" && l.dte != null && <span className="ml-1.5 text-foreground/40">{Math.floor(l.dte)}d</span>}
                </td>
                <td className="py-1.5 text-right text-foreground/50">{l.kind === "option" ? vol(l.iv) : ""}</td>
                <td className="py-1.5 text-right text-foreground/50">{l.delta.toFixed(2)}</td>
                <td className={clsx("py-1.5 text-right", tone(l.position_delta))}>{sd(l.position_delta)}</td>
              </tr>
            ))}
            <tr><td className="pt-2 text-foreground/45">net</td><td /><td /><td className="pt-2 text-right font-medium text-foreground">{sd(b.net_delta)}</td></tr>
          </tbody>
        </table>
        <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-[12px]">
          <div><p className="text-[10px] uppercase tracking-[0.14em] text-foreground/45">HV10</p><p className="text-foreground/80">{vol(b.iv?.hv10)}</p></div>
          <div><p className="text-[10px] uppercase tracking-[0.14em] text-foreground/45">HV20</p><p className="text-foreground/80">{vol(b.iv?.hv20)}</p></div>
          <div><p className="text-[10px] uppercase tracking-[0.14em] text-foreground/45">HV60</p><p className="text-foreground/80">{vol(b.iv?.hv60)}</p></div>
        </div>
      </div>

      <div>
        <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Levels</p>
        {b.spot != null && (
          <Ladder spot={b.spot} levels={[
            { label: "call wall", price: b.levels?.call_wall, tone: "text-gain" },
            { label: "★ king", price: b.levels?.king, tone: "text-[#b45309] dark:text-[#fde725]" },
            { label: "your avg", price: b.avg_cost, tone: "text-accent" },
            { label: "put wall", price: b.levels?.put_wall, tone: "text-loss" },
            ...(s?.strike != null && TRADE.has(s.action) ? [{ label: `trade ${s.otype === "call" ? "C" : "P"}`, price: s.strike, tone: "text-foreground/70" }] : []),
          ]} />
        )}
      </div>
    </div>
  );
}

// ── Legend: what every symbol on the blotter means ─────────────────────────
function Sym({ children }: { children: React.ReactNode }) {
  return <span className="relative inline-flex h-5 w-10 shrink-0 items-center justify-center">{children}</span>;
}
function Item({ sym, title, children }: { sym: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      {sym}
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="text-[12.5px] leading-snug text-foreground/55">{children}</p>
      </div>
    </div>
  );
}
function Edge({ cls }: { cls: string }) {
  return <Sym><span className={clsx("h-5 w-[3px]", cls)} /></Sym>;
}

function Legend() {
  return (
    <DeskSection label="Legend" meta="What the symbols on the Book table mean.">
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
        <div className="grid content-start gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">Net Δ meter (−1.5 … +1.5 per lot)</p>
          <Item title="Your net delta, on target" sym={<Sym><span className="h-3 w-3 rounded-full bg-gain" /></Sym>}>Where your stock + options delta sits right now, within ±0.15 of target.</Item>
          <Item title="Your net delta, off target" sym={<Sym><span className="h-3 w-3 rounded-full bg-amber-500" /></Sym>}>More than 0.15 per lot away from target: the engine looks for a trade.</Item>
          <Item title="Target" sym={<Sym><span className="h-[18px] w-[2px] bg-accent" /></Sym>}>+0.30 per lot in a calm / bull regime, 0 in a high-vol regime.</Item>
          <Item title="After the suggested trade" sym={<Sym><span className="h-2 w-2 rotate-45 border border-accent" /></Sym>}>Where net delta lands if you place the suggested trade.</Item>
          <Item title="Zero and distance from zero" sym={<Sym><span className="absolute h-[6px] w-7 bg-foreground/15" /><span className="relative h-3 w-px bg-foreground/40" /></Sym>}>The thin tick is 0 delta; the grey band shows how far from zero you are.</Item>
        </div>

        <div className="grid content-start gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">Row edge &amp; signals</p>
          <Item title="Sell call" sym={<Edge cls="bg-accent" />}>Too long after a rise over your average or an IV spike: sell a weekly call at or above your average cost.</Item>
          <Item title="Sell put" sym={<Edge cls="bg-gain" />}>Below target after a pullback, never during an IV spike: a short put adds delta.</Item>
          <Item title="Buy put / IV spike" sym={<Edge cls="bg-loss" />}>Too long with every lot already covered (buy a put), or ATM IV is spiking.</Item>
          <Item title="Off target, waiting" sym={<Edge cls="bg-amber-500" />}>Off target, but the conditions for a trade aren&apos;t met yet (see the ticket&apos;s reasons).</Item>
          <Item title="Tags" sym={<Sym><Tag tone="warn">wait</Tag></Sym>}><b className="font-medium text-foreground/75">Wait</b>: not yet. <b className="font-medium text-foreground/75">On target</b>: nothing to do. <b className="font-medium text-foreground/75">Track</b>: options only, no 100-share lot to size against.</Item>
        </div>

        <div className="grid content-start gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">Columns</p>
          <Item title="Net Δ (lots)" sym={<Sym><span className="font-mono text-[12px] text-foreground">+0.69</span></Sym>}>100 shares = +1.00. A short call at Δ 0.70 counts −0.70; a short put at Δ −0.30 counts +0.30.</Item>
          <Item title="Γ $/1%" sym={<Sym><span className="font-mono text-[12px] text-loss">−$24</span></Sym>}>How much your delta-dollars change for a 1% move. Negative = short gamma (your short options).</Item>
          <Item title="IV / HV" sym={<Sym><span className="font-mono text-[12px] text-foreground/80">75<span className="text-foreground/35">/71</span></span></Sym>}>At-the-money implied vol vs 20-day historical vol. Above 1.3× = high-vol regime, premium is rich.</Item>
          <Item title="IV day ▲" sym={<Sym><span className="font-mono text-[12px] text-loss">+12▲</span></Sym>}>ATM IV change since the first reading today; ▲ marks a spike (IV up while the stock rises hard).</Item>
          <Item title="hi-vol / bull" sym={<Sym><span className="font-mono text-[10.5px] text-foreground/45">bull</span></Sym>}>The regime that sets the target: hi-vol when IV/HV ≥ 1.3 or dealer gamma is negative.</Item>
        </div>
      </div>
      <p className="mt-6 text-[12px] leading-relaxed text-foreground/45">Greeks are Black-Scholes from the live price and each contract&apos;s IV. Suggestions are not orders; check the live quote before trading.</p>
    </DeskSection>
  );
}

// ── What this page does ──────────────────────────────────────────────────────
const INTRO_KEY = "hedge_intro_hidden";
function HowItWorks() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { try { setHidden(localStorage.getItem(INTRO_KEY) === "1"); } catch { /* storage off */ } }, []);
  const set = (v: boolean) => { setHidden(v); try { localStorage.setItem(INTRO_KEY, v ? "1" : "0"); } catch { /* storage off */ } };
  if (hidden) {
    return (
      <button onClick={() => set(false)} className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:underline">
        What does this page do?
      </button>
    );
  }
  const steps: [string, string][] = [
    ["Syncs your book", "Your Robinhood stocks and options load automatically: every hour while the market is open, and once more in the evening."],
    ["Measures your risk live", "Every second it prices each option with Black-Scholes and adds it up per stock: your net delta (how much you gain or lose per $1 move, in 100-share lots) and gamma (how fast that changes)."],
    ["Reads the volatility", "It compares at-the-money implied vol to recent realized vol and watches for IV spikes on up-moves, plus the dealer levels (king node, walls) from the Flow board."],
    ["Suggests the next trade", "It sets a delta target for the regime (+0.30 per lot when calm, 0 when volatile) and tells you which call or put, strike and expiry would bring you back to it: never a call below your average cost, never a put into a spike."],
  ];
  return (
    <DeskSection label="How it works" meta={<button onClick={() => set(true)} className="text-accent hover:underline">Hide</button>}>
      <p className="mb-5 max-w-3xl text-[15px] leading-relaxed text-foreground/80">
        The Hedge desk keeps every stock you hold close to a delta target, so you collect option premium without letting the
        position run away from you. It doesn&apos;t place orders. It tells you what to sell or buy, and why.
      </p>
      <ol className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map(([t, d], i) => (
          <li key={t} className="border-t border-[var(--border)] pt-3">
            <p className="font-mono text-[11px] text-accent">0{i + 1}</p>
            <p className="mt-1 text-[14px] font-medium text-foreground">{t}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">{d}</p>
          </li>
        ))}
      </ol>
    </DeskSection>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function HedgePage() {
  const live = useHedgeStream();
  const { data, isLoading, error } = useQuery<HedgeBooks>({ queryKey: ["hedge-books"], queryFn: fetchHedgeBooks, refetchInterval: live ? false : 15_000 });
  const [open, setOpen] = useState<string | null>(null);
  const books = (data?.books ?? []).filter((b) => !b.error);
  const errored = (data?.books ?? []).filter((b) => b.error);
  const signals = books.filter((b) => b.suggestion && TRADE.has(b.suggestion.action));
  const spikes = books.filter((b) => b.iv?.spike);
  const expiring = books.flatMap((b) => b.legs.filter((l) => l.kind === "option" && l.quantity < 0 && (l.dte ?? 99) <= 5).map((l) => ({ ...l, symbol: b.symbol })));
  const netDelta = books.reduce((a, b) => a + (b.net_delta ?? 0), 0);
  const dollarGamma = books.reduce((a, b) => a + (b.dollar_gamma_1pct ?? 0), 0);
  const sorted = [...signals, ...books.filter((b) => !signals.includes(b)).sort((a, b) => Number(offTarget(b)) - Number(offTarget(a)))];

  useEffect(() => { if (!open && signals[0]) setOpen(signals[0].symbol); }, [open, signals]);

  return (
    <DeskPage>
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50">Hedge</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">Delta-neutral desk</h1>
        </div>
        <div className="text-right font-mono text-[11px] leading-relaxed text-foreground/55">
          <p className="flex items-center justify-end gap-1.5">
            <span className={clsx("h-1.5 w-1.5 rounded-full", live ? "animate-pulse bg-gain" : "bg-amber-500")} />
            {live ? "live · 1s" : "reconnecting"}
          </p>
          <p>robinhood sync {ago(data?.synced_at) ?? "pending"}</p>
        </div>
      </div>

      <HowItWorks />

      {error && !data && <p className="border-t border-[var(--border-strong)] py-6 text-[14px] text-loss">{(error as Error).message || "Couldn't load your positions."}</p>}
      {isLoading && <div className="h-40 animate-pulse border-t border-[var(--border-strong)] bg-foreground/[0.03]" />}
      {data && !books.length && !errored.length && (
        <div className="border-t border-[var(--border-strong)] py-14">
          <p className="text-[17px] font-medium text-foreground">No positions synced yet</p>
          <p className="mt-1 text-[14px] text-foreground/55">Your Robinhood stocks and options sync every hour while the market is open, and at 7:41 pm ET.</p>
        </div>
      )}

      {!!books.length && (
        <>
          <div className="border-t border-[var(--border-strong)] py-6">
            <DeskFigures>
              <DeskFigure size="lg" label="Book Δ (lots)" value={sd(netDelta)} sub={`${books.length} underlyings`} />
              <DeskFigure sensitive size="lg" label="$ gamma / 1%" value={big(dollarGamma)} tone={dollarGamma < 0 ? "text-loss" : undefined} sub="short options = short gamma" />
              <DeskFigure size="lg" label="Signals" value={signals.length} tone={signals.length ? "text-accent" : "text-foreground/40"} sub={signals.map((b) => b.symbol).join(" · ") || "none right now"} />
              <DeskFigure size="lg" label="IV spikes" value={spikes.length} tone={spikes.length ? "text-loss" : "text-foreground/40"} sub={spikes.map((b) => b.symbol).join(" · ") || "calm"} />
              <DeskFigure size="lg" label="Expiring ≤5d" value={expiring.length} tone={expiring.length ? "text-amber-600 dark:text-amber-400" : "text-foreground/40"} sub={expiring.map((l) => `${l.symbol} ${l.strike}${l.otype === "call" ? "C" : "P"}`).join(" · ") || "—"} />
            </DeskFigures>
          </div>

          <DeskSection label="Book" meta={<>Δ in lots: 100 sh = +1.00.<br />Tap a row for the ticket, legs and levels.</>}>
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[110px_96px_80px_minmax(180px,1fr)_92px_96px_80px_minmax(200px,1.3fr)_24px] items-center gap-3 border-b border-[var(--border-strong)] px-4 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45">
                  <span>Symbol</span><span className="text-right">Last</span><span className="text-right">vs avg</span><span>Net Δ vs target</span>
                  <span className="text-right">Γ $/1%</span><span className="text-right">IV / HV</span><span className="text-right">IV day</span><span>Signal</span><span />
                </div>
                {sorted.map((b) => {
                  const s = b.suggestion;
                  const a = s ? ACTION[s.action] : null;
                  const isOpen = open === b.symbol;
                  const lots = Math.max(b.lots ?? 0, 1);
                  return (
                    <Fragment key={b.symbol}>
                      <DeskRow edge={a?.edge ?? (b.iv?.spike ? "loss" : offTarget(b) ? "warn" : null)} onClick={() => setOpen(isOpen ? null : b.symbol)} active={isOpen}>
                        <div className="grid grid-cols-[110px_96px_80px_minmax(180px,1fr)_92px_96px_80px_minmax(200px,1.3fr)_24px] items-center gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="font-mono text-[15px] font-semibold tracking-tight text-foreground">{b.symbol}</p>
                            <p className="truncate font-mono text-[10.5px] text-foreground/40"><span className="sensitive">{b.shares ? `${b.shares} sh` : "options"}</span> · {b.regime === "high-vol" ? "hi-vol" : "bull"}</p>
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            <p className="text-[14px] text-foreground">{usd(b.spot)}</p>
                            <p className={clsx("text-[11px]", tone(b.day_change))}>{pct(b.day_change, 2)}</p>
                          </div>
                          <p className={clsx("text-right font-mono text-[13px] tabular-nums", tone(b.avg_cost && b.spot ? b.spot - b.avg_cost : null))}>{b.avg_cost && b.spot ? pct(b.spot / b.avg_cost - 1) : "—"}</p>
                          <div className="flex items-center gap-3">
                            <Meter value={(b.net_delta ?? 0) / lots} target={(b.target_delta ?? 0) / lots} after={s?.net_delta_after != null ? s.net_delta_after / lots : null} />
                            <span className={clsx("w-12 shrink-0 text-right font-mono text-[13px] tabular-nums", offTarget(b) ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>{sd(b.net_delta)}</span>
                          </div>
                          <p className={clsx("sensitive text-right font-mono text-[13px] tabular-nums", (b.dollar_gamma_1pct ?? 0) < 0 ? "text-loss" : "text-foreground/70")}>{big(b.dollar_gamma_1pct)}</p>
                          <p className="text-right font-mono text-[13px] tabular-nums text-foreground/80">
                            {vol(b.iv?.atm_iv)}<span className="text-foreground/35"> / {vol(b.iv?.hv20)}</span>
                          </p>
                          <p className={clsx("text-right font-mono text-[13px] tabular-nums", (b.iv?.iv_roc_day ?? 0) >= 0.1 ? "text-loss" : "text-foreground/60")}>
                            {pct(b.iv?.iv_roc_day, 0)}{b.iv?.spike && <span className="ml-1">▲</span>}
                          </p>
                          <div className="flex min-w-0 items-center gap-2">
                            {a && <Tag tone={a.tag}>{a.label}</Tag>}
                            <span className="truncate text-[12.5px] text-foreground/70">{s && TRADE.has(s.action) ? <>{`${s.strike}${s.otype === "call" ? "C" : "P"} ${s.expiry?.slice(5)} · `}<span className="sensitive">{usd(Math.abs(s.credit ?? 0), 0)}</span></> : s?.headline}</span>
                          </div>
                          <ChevronDown size={15} className={clsx("text-foreground/40 transition", isOpen && "rotate-180")} />
                        </div>
                      </DeskRow>
                      {isOpen && <Detail b={b} />}
                    </Fragment>
                  );
                })}
                {errored.map((b) => (
                  <DeskRow key={b.symbol}><p className="px-4 py-3 font-mono text-[13px] text-foreground/55">{b.symbol} · {b.error}</p></DeskRow>
                ))}
              </div>
            </div>
          </DeskSection>

          <Legend />
        </>
      )}
    </DeskPage>
  );
}
