"use client";
/**
 * Hedge — the delta desk, blotter layout (no cards).
 * Scales (book delta per lot, portfolio beta), then one row per holding that expands in place into
 * the ticket, legs and a price ladder. Rows stack on phones and tablets; no sideways scrolling.
 * Live: the app-wide SSE stream (lib/live.tsx) every second.
 * Actions follow the strategy picked in the header dropdown (GET /strategy; spike wheel by default).
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { AlertTriangle, ChevronDown, Shapes } from "lucide-react";
import { HedgeBook, HedgeSuggestion } from "@/lib/api";
import { bookBeta, dayPnl, Tick, useLive, useLiveBooks } from "@/lib/live";
import { DeskFigure, DeskFigures, DeskPage, DeskRow, DeskSection, Ladder, Meter, Scale, Tag } from "@/components/desk";
import { StrategyPicker } from "@/components/strategy/StrategyPicker";
import { useStrategy } from "@/components/strategy/useStrategy";
import { VolTargetTab, VolTargetTheory } from "@/components/hedge/VolTarget";
import { FactorsTab, FactorsTheory } from "@/components/hedge/Factors";
import { TickerLink } from "@/components/TickerLink";
import { TickerLogo } from "@/components/TickerLogo";
import { Theory } from "@/components/hedge/Theory";

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

const OPT = new Set(["SELL_CALL", "SELL_PUT", "BUY_CALL"]);
const TRADE = new Set(["SELL_CALL", "SELL_PUT", "BUY_CALL", "BUY_STOCK"]);
const ACTION: Record<HedgeSuggestion["action"], { tag: "accent" | "gain" | "loss" | "warn" | "neutral"; label: string; edge: "accent" | "gain" | "loss" | "warn" | null }> = {
  SELL_CALL: { tag: "accent", label: "Sell call", edge: "accent" },
  SELL_PUT: { tag: "gain", label: "Sell put", edge: "gain" },
  BUY_CALL: { tag: "warn", label: "Buy call", edge: "warn" },
  BUY_STOCK: { tag: "warn", label: "Buy stock", edge: "warn" },
  HOLD: { tag: "neutral", label: "Worked", edge: null },
  WAIT: { tag: "neutral", label: "Wait", edge: null },
  TRACK: { tag: "neutral", label: "Track", edge: null },
};

const UNIT: Record<HedgeBook["units"][number]["kind"], { label: string; cls: string }> = {
  covered: { label: "covered", cls: "text-accent" },
  uncovered: { label: "uncovered", cls: "text-gain" },
  puts: { label: "puts", cls: "text-warn" },
  other: { label: "other", cls: "text-foreground/50" },
};

/** Per-lot delta (1.00 = the stock alone). */
const perLot = (b: HedgeBook) => (b.lots && b.lots >= 1 ? (b.net_delta ?? 0) / Math.floor(b.lots) : null);
/** Colour for a per-lot delta: near the stock (≥0.85), partly hedged, mostly hedged (<0.40). */
const lotTone = (v: number | null) => (v == null ? "bg-foreground/40" : v >= 0.85 ? "bg-gain" : v >= 0.4 ? "bg-accent" : "bg-warn");
const betaTone = (v?: number | null) => (v == null ? "text-foreground/40" : v >= 1.5 ? "text-loss" : v >= 1.1 ? "text-warn" : "text-foreground/75");
const tradeShort = (s?: HedgeSuggestion | null) => !s || !TRADE.has(s.action) ? s?.headline
  : s.action === "BUY_STOCK" ? `+${s.shares} sh`
  : `${s.contracts}× ${s.strike}${s.long_strike != null ? `/${s.long_strike}` : ""}${s.otype === "call" ? "C" : "P"} ${s.action === "BUY_CALL" ? s.expiry : s.expiry?.slice(5)}`;
/** The action's tag; a put with a long leg is a put credit spread. */
const actionOf = (s?: HedgeSuggestion | null) => !s ? null
  : s.long_strike != null ? { ...ACTION.SELL_PUT, label: "Put spread" } : ACTION[s.action];

// ── Expanded detail: ticket · legs · ladder ──────────────────────────────────
function Detail({ b }: { b: HedgeBook }) {
  const s = b.suggestion;
  const trade = s && OPT.has(s.action);
  return (
    <div className="grid gap-8 border-b border-[var(--border)] bg-foreground/[0.025] px-4 py-6 sm:px-6 md:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_240px]">
      <div className="min-w-0">
        {(b.closes ?? []).map((c) => (
          <div key={`${c.strike}-${c.otype}-${c.expiry}`} className="mb-6 border-l-[3px] border-loss pl-3">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-loss">Buy back</p>
            <p className="mt-1 text-[16px] font-medium leading-snug text-foreground">{c.headline}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[13px] sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
              {[["Captured", `${Math.round(c.profit_pct * 100)}%`], ["Cost to close", usd(c.cost, 0)], ["You keep", usd(c.kept, 0)], ["Days left", c.dte != null ? Math.floor(c.dte).toString() : "—"]].map(([k, v]) => (
                <div key={k}><dt className="text-[10px] uppercase tracking-[0.14em] text-foreground/45">{k}</dt><dd className={clsx("mt-0.5 tabular-nums text-foreground", k !== "Captured" && k !== "Days left" && "sensitive")}>{v}</dd></div>
              ))}
            </dl>
            <ul className="mt-2 space-y-1 text-[13px] leading-snug text-foreground/70">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        ))}
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Ticket</p>
        {s && (
          <>
            <p className="mt-2 text-[17px] font-medium leading-snug text-foreground">{s.headline}</p>
            {trade && (
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-[13px] sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  [s.action === "BUY_CALL" ? "Debit" : "Credit", usd(Math.abs(s.credit ?? 0), 0)],
                  [s.long_strike != null ? "Net credit / sh" : "Mid / sh", usd(s.premium)],
                  ...(s.long_strike != null ? [["Long put", String(s.long_strike)], ["Max loss", usd(s.max_loss, 0)]] : []),
                  ...(s.yield_ann != null ? [["Yield / yr", `${Math.round(s.yield_ann * 100)}%`]] : []),
                  ...(s.action === "BUY_CALL" ? [["Max loss", usd(s.max_loss, 0)]] : s.collateral != null && s.long_strike == null ? [["Cash secured", usd(s.collateral, 0)]] : []),
                  ["Δ / contract", sd(s.option_delta)],
                  ["Net Δ after", sd(s.net_delta_after)],
                  ...(s.locked_gain != null ? [["If called", big(s.locked_gain)]] : []),
                  ...(s.new_avg != null ? [["Net if assigned", usd(s.new_avg)]] : []),
                  ["Contracts", String(s.contracts)],
                  ["Expiry", s.expiry ?? "—"],
                ].map(([k, v]) => (
                  <div key={k}><dt className="text-[10px] uppercase tracking-[0.14em] text-foreground/45">{k}</dt><dd className={clsx("mt-0.5 tabular-nums text-foreground", ["Credit", "Debit", "If called", "Max loss", "Cash secured"].includes(k) && "sensitive")}>{v}</dd></div>
                ))}
              </dl>
            )}
            {s.action === "BUY_STOCK" && (
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-[13px] sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
                {[["Shares", `+${s.shares}`], ["Cost", usd(Math.abs(s.credit ?? 0), 0)], ["New avg", usd(s.new_avg)], ["Net Δ after", sd(s.net_delta_after)]].map(([k, v]) => (
                  <div key={k}><dt className="text-[10px] uppercase tracking-[0.14em] text-foreground/45">{k}</dt><dd className={clsx("mt-0.5 tabular-nums text-foreground", k === "Cost" && "sensitive")}>{v}</dd></div>
                ))}
              </dl>
            )}
            {!!s.reasons?.length && (
              <ol className="mt-4 space-y-1.5 border-l border-[var(--border-strong)] pl-3 text-[13px] leading-snug text-foreground/70">
                {s.reasons.map((r) => <li key={r}>{r}</li>)}
              </ol>
            )}
            {!!s.warnings?.length && (
              <ul className="mt-3 space-y-1 text-[13px] text-warn">
                {s.warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</li>)}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="min-w-0">
        {b.units.length > 0 && (
          <>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Units</p>
            <div className="mb-5 mt-2 grid grid-cols-1 gap-3">
              {b.units.map((u) => (
                <div key={u.kind}>
                  <div className="flex items-baseline justify-between gap-3 font-mono text-[12.5px] tabular-nums">
                    <span className="min-w-0 text-foreground/80"><span className={clsx("mr-2 text-[10px] uppercase tracking-[0.12em]", UNIT[u.kind].cls)}>{UNIT[u.kind].label}</span><span className="sensitive">{u.label}</span></span>
                    <span className="shrink-0 text-foreground">{sd(u.delta)}{u.per_lot != null && <span className="text-foreground/45"> · {sd(u.per_lot)}/lot</span>}</span>
                  </div>
                  {u.per_lot != null && <div className="mt-1"><Meter min={-0.5} max={1.5} value={u.per_lot} target={1} dot={lotTone(u.per_lot)}
                    tips={{ value: `${UNIT[u.kind].label}: ${sd(u.per_lot)} per lot (${sd(u.delta)} total)`, target: "+1.00 = the stock alone", zero: "0 = delta-neutral" }} /></div>}
                </div>
              ))}
            </div>
          </>
        )}
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Legs</p>
        <table className="mt-2 w-full font-mono text-[12.5px] tabular-nums">
          <tbody>
            {b.legs.map((l, i) => (
              <tr key={i} className="border-b border-[var(--border)] last:border-0">
                <td className="sensitive py-1.5 pr-2 text-foreground/85">
                  {l.kind === "stock" ? `${l.quantity} sh @ ${usd(l.avg_price)}` : `${l.quantity < 0 ? "−" : "+"}${Math.abs(l.quantity)} ${l.strike}${l.otype === "call" ? "C" : "P"} ${l.expiry?.slice(5)}`}
                  {l.kind === "option" && l.dte != null && <span className="ml-1.5 text-foreground/40">{Math.floor(l.dte)}d</span>}
                </td>
                <td className="py-1.5 text-right text-foreground/50" title={l.kind === "option" ? "live mid / IV" : undefined}>{l.kind === "option" ? <>{l.mark != null && <span className="mr-2 text-foreground/70">{usd(l.mark)}</span>}{vol(l.iv)}</> : ""}</td>
                <td className="py-1.5 text-right text-foreground/50">{l.delta.toFixed(2)}</td>
                <td className={clsx("py-1.5 text-right", tone(l.position_delta))}>{sd(l.position_delta)}</td>
              </tr>
            ))}
            <tr><td className="pt-2 text-foreground/45">net</td><td /><td /><td className="pt-2 text-right font-medium text-foreground">{sd(b.net_delta)}</td></tr>
          </tbody>
        </table>
        <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-[12px]">
          {([["Beta", b.beta != null ? b.beta.toFixed(2) : "—"], ["Γ $/1%", big(b.dollar_gamma_1pct)], ["IV day", `${pct(b.iv?.iv_roc_day, 0)}${b.iv?.spike ? " ▲" : ""}`],
            ["HV10", vol(b.iv?.hv10)], ["HV20", vol(b.iv?.hv20)], ["HV60", vol(b.iv?.hv60)]] as [string, string][]).map(([k, v]) => (
            <div key={k}><p className="text-[10px] uppercase tracking-[0.14em] text-foreground/45">{k}</p><p className={clsx("text-foreground/80", k === "Γ $/1%" && "sensitive")}>{v}</p></div>
          ))}
        </div>
      </div>

      <div className="min-w-0 md:col-span-2 xl:col-span-1">
        <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Levels</p>
        {b.spot != null && (
          <Ladder spot={b.spot} levels={[
            { label: "call wall", price: b.levels?.call_wall, tone: "text-gain" },
            { label: "★ king", price: b.levels?.king, tone: "text-[#b45309] dark:text-[#fde725]" },
            { label: "your avg", price: b.avg_cost, tone: "text-accent" },
            { label: "put wall", price: b.levels?.put_wall, tone: "text-loss" },
            ...(s?.strike != null && OPT.has(s.action) ? [{ label: `trade ${s.otype === "call" ? "C" : "P"}`, price: s.strike, tone: "text-foreground/70" }] : []),
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

/** The Legend pop-up: same button and dialog as the Theory pop-ups on the other Hedge tabs. */
function Legend() {
  return (
    <Theory title="Legend · what the symbols on this page mean" label="Legend" icon={<Shapes size={13} />}>
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <div className="grid min-w-0 grid-cols-1 content-start gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">Net Δ per lot (−0.5 … +1.5)</p>
          <Item title="Near the stock (≥ 0.85)" sym={<Sym><span className="h-3 w-3 rounded-full bg-gain" /></Sym>}>Little is sold against the lot: you carry nearly the full stock move.</Item>
          <Item title="Partly hedged (0.40 – 0.85)" sym={<Sym><span className="h-3 w-3 rounded-full bg-accent" /></Sym>}>A call (or call + put) is working: some of the move is sold off.</Item>
          <Item title="Mostly hedged (below 0.40)" sym={<Sym><span className="h-3 w-3 rounded-full bg-warn" /></Sym>}>A deep ITM call is taking most of the move.</Item>
          <Item title="+1.00 = the stock alone" sym={<Sym><span className="h-[18px] w-[2px] bg-accent" /></Sym>}>The reference tick. The playbook keeps the book near it; it is not a delta-neutral target.</Item>
          <Item title="After the suggested trade" sym={<Sym><span className="h-2 w-2 rotate-45 border border-accent" /></Sym>}>Where net delta lands if you place the suggested trade.</Item>
          <Item title="Units" sym={<Sym><span className="font-mono text-[10px] text-accent">cov</span></Sym>}>Shares covered by short calls plus those calls are one unit (300 sh + 3 calls); the rest is another (200 sh). Each shows its own delta; a new call covers the whole uncovered unit at once.</Item>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">Row edge &amp; signals</p>
          <Item title="Sell call" sym={<Edge cls="bg-accent" />}>Spike: the stock is ≥2% over your average or IV is spiking. Sell the call in the money, at the strike closest to your average from above.</Item>
          <Item title="Sell put" sym={<Edge cls="bg-gain" />}>Pullback: a red day or ≥1% off the high, IV not spiking. Sell the put at the highest strike below your average, if it pays at least 0.2% of the strike.</Item>
          <Item title="Buy back" sym={<Sym><Tag tone="solid">BB</Tag></Sym>}>A short option has given up most of its premium: 80% captured, or 50% with 3+ days left. Closing it frees the shares or cash for the next trade.</Item>
          <Item title="Buy stock" sym={<Edge cls="bg-warn" />}>An odd lot under 100 shares, priced at or below your average: round it up so it can be worked.</Item>
          <Item title="Tags" sym={<Sym><Tag>wait</Tag></Sym>}><b className="font-medium text-foreground/75">Wait</b>: conditions not met yet (see the reasons). <b className="font-medium text-foreground/75">Worked</b>: every lot has a call and a put on. <b className="font-medium text-foreground/75">Track</b>: options only.</Item>
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">Columns</p>
          <Item title="Net Δ (lots)" sym={<Sym><span className="font-mono text-[12px] text-foreground">+0.69</span></Sym>}>100 shares = +1.00. A short call at Δ 0.70 counts −0.70; a short put at Δ −0.30 counts +0.30. Always the real total, whatever legs are on.</Item>
          <Item title="β (beta)" sym={<Sym><span className="font-mono text-[12px] text-warn">1.84</span></Sym>}>1-year beta vs SPY: how far the stock moves for a 1% S&amp;P move. Amber ≥ 1.1, red ≥ 1.5.</Item>
          <Item title="IV / HV" sym={<Sym><span className="font-mono text-[12px] text-foreground/80">75<span className="text-foreground/35">/71</span></span></Sym>}>At-the-money implied vol vs 20-day historical vol. Above 1.3× = premium is rich.</Item>
          <Item title="Γ $/1%" sym={<Sym><span className="font-mono text-[12px] text-loss">−$24</span></Sym>}>How much your delta-dollars change for a 1% move. Negative = short gamma (your short options).</Item>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-foreground/45">Greeks are Black-Scholes from the live price and each contract&apos;s IV. Suggestions are not orders; check the live quote before trading.</p>
    </Theory>
  );
}

// ── What this page does ──────────────────────────────────────────────────────
const INTRO_KEY = "hedge_intro_hidden";
function HowItWorks() {
  const [hidden, setHidden] = useState(false);
  const { current } = useStrategy();
  useEffect(() => { try { setHidden(localStorage.getItem(INTRO_KEY) === "1"); } catch { /* storage off */ } }, []);
  const set = (v: boolean) => { setHidden(v); try { localStorage.setItem(INTRO_KEY, v ? "1" : "0"); } catch { /* storage off */ } };
  if (hidden) {
    return (
      <button onClick={() => set(false)} className="mt-8 font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:underline">
        What does this page do?
      </button>
    );
  }
  const steps: string[][] = [
    ["Syncs your book", "Your Robinhood stocks and options load automatically: every hour while the market is open, and once more in the evening."],
    ["Measures your risk live", "Every second it prices each option with Black-Scholes and adds it up per stock: your real net delta (100 shares = +1.00) whatever you've sold, plus gamma and beta."],
    ...(current?.steps ?? []),
  ];
  return (
    <DeskSection label="How it works" meta={<>{current ? <>Strategy: <span className="text-foreground">{current.name}</span><br /></> : null}<button onClick={() => set(true)} className="text-accent hover:underline">Hide</button></>}>
      <p className="mb-5 max-w-3xl text-[15px] leading-relaxed text-foreground/80">
        {current?.summary ?? "The desk suggests trades around the stocks you hold."} Change the strategy from the dropdown at the top;
        the actions, buy-backs and phone alerts follow it within seconds. It shows the real delta at all times and doesn&apos;t place orders.
      </p>
      <ol className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map(([t, d], i) => (
          <li key={t} className="border-t border-[var(--border)] pt-3">
            <p className="font-mono text-[11px] text-accent">{String(i + 1).padStart(2, "0")}</p>
            <p className="mt-1 text-[14px] font-medium text-foreground">{t}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/60">{d}</p>
          </li>
        ))}
      </ol>
    </DeskSection>
  );
}

// ── Scales: where the whole book stands ──────────────────────────────────────
function Scales({ books }: { books: HedgeBook[] }) {
  const lots = books.reduce((a, b) => a + Math.floor(Math.max(b.lots ?? 0, 0)), 0);
  const lotBooks = books.filter((b) => (b.lots ?? 0) >= 1);
  const lotDelta = lotBooks.reduce((a, b) => a + (b.net_delta ?? 0), 0);
  const per = lots ? lotDelta / lots : null;
  const after = lots ? lotBooks.reduce((a, b) => a + (b.suggestion?.net_delta_after ?? b.net_delta ?? 0), 0) / lots : null;
  const hasTrade = lotBooks.some((b) => b.suggestion && TRADE.has(b.suggestion.action));
  const { beta, betaDollars } = bookBeta(books);
  const today = dayPnl(books);
  return (
    <div className="grid gap-x-12 gap-y-8 border-t border-[var(--border-strong)] py-6 lg:grid-cols-2">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Book Δ per lot</p>
          <p className="font-mono text-[11.5px] text-foreground/55"><span className="sensitive">{lots} lots</span> · net <Tick value={per}><span className="text-foreground">{sd(lotDelta)}</span></Tick></p>
        </div>
        <Scale min={-0.5} max={1.5} value={per} after={hasTrade ? after : null} label={per != null ? sd(per) : undefined} pin={lotTone(per)}
          tips={{ value: per != null ? `Book now: ${sd(per)} per lot over ${lots} lots` : undefined, after: after != null ? `If you place every suggested trade: ${sd(after)} per lot` : undefined }}
          zones={[{ from: -0.5, to: 0.4, cls: "bg-warn/25" }, { from: 0.4, to: 0.85, cls: "bg-accent/20" }, { from: 0.85, to: 1.5, cls: "bg-gain/25" }]}
          marks={[{ at: -0.5, label: "−0.5" }, { at: 0, label: "0 neutral", strong: true }, { at: 0.5, label: "0.5" }, { at: 1, label: "+1 stock", strong: true }, { at: 1.5, label: "1.5" }]} />
        <p className="text-[12.5px] leading-snug text-foreground/55">
          {per == null ? "No full 100-share lot held." : per >= 0.85 ? "You carry nearly the full stock move: room to sell calls into the next spike."
            : per >= 0.4 ? "Calls are working against part of the book: you keep part of the move and the premium."
            : "Short calls take most of the move: on a pullback, a put below your average adds delta back."}
        </p>
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Portfolio beta vs SPY</p>
          <p className="font-mono text-[11.5px] text-foreground/55">SPY 1% ≈ <span className={clsx("sensitive", tone(betaDollars))}>{big(betaDollars * 0.01)}</span></p>
        </div>
        <Scale min={0} max={3} value={beta} label={beta != null ? beta.toFixed(2) : undefined}
          tips={{ value: beta != null ? `Portfolio beta ${beta.toFixed(2)}: SPY ±1% ≈ ${betaDollars >= 0 ? "±" : "∓"}${big(Math.abs(betaDollars * 0.01)).slice(1)}` : undefined }}
          pin={beta == null ? undefined : beta >= 1.5 ? "bg-loss" : beta >= 1.1 ? "bg-warn" : "bg-gain"}
          zones={[{ from: 0, to: 1.1, cls: "bg-gain/20" }, { from: 1.1, to: 1.5, cls: "bg-warn/25" }, { from: 1.5, to: 3, cls: "bg-loss/20" }]}
          marks={[{ at: 0, label: "0" }, { at: 1, label: "1 = market", strong: true }, { at: 2, label: "2" }, { at: 3, label: "3" }]} />
        <p className="text-[12.5px] leading-snug text-foreground/55">
          Delta-weighted: each stock&apos;s beta × its live delta-dollars, so short calls lower its weight.
          {today && <> Today <Tick value={Math.round(today.total)}><span className={clsx("sensitive font-mono", tone(today.total))}>{big(today.total)}</span></Tick> live.</>}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px]">
          {[...books].filter((b) => b.beta != null).sort((a, b) => (b.beta ?? 0) - (a.beta ?? 0)).map((b) => (
            <span key={b.symbol} className="text-foreground/55">{b.symbol} <span className={betaTone(b.beta)}>{b.beta!.toFixed(2)}</span></span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── One holding ──────────────────────────────────────────────────────────────
function BookRow({ b, open, onToggle }: { b: HedgeBook; open: boolean; onToggle: () => void }) {
  const s = b.suggestion;
  const a = actionOf(s);
  const per = perLot(b);
  const lots = Math.max(Math.floor(b.lots ?? 0), 1);
  const after = s?.net_delta_after != null && TRADE.has(s.action) ? s.net_delta_after / lots : null;
  return (
    <DeskRow edge={a?.edge ?? (b.iv?.spike ? "loss" : null)} onClick={onToggle} active={open}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 pl-4 pr-3 md:grid-cols-[150px_minmax(0,1fr)_auto] xl:grid-cols-[140px_150px_minmax(200px,1fr)_48px_96px_minmax(220px,1fr)_20px]">
        {/* symbol + price (phones put the price on the right) */}
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-mono text-[15px] font-semibold tracking-tight text-foreground"><TickerLogo symbol={b.symbol} size={22} /><TickerLink symbol={b.symbol} />
            <span className={clsx("ml-2 font-mono text-[11px] font-normal xl:hidden", betaTone(b.beta))}>{b.beta != null ? `β ${b.beta.toFixed(2)}` : ""}</span>
          </p>
          <p className="truncate font-mono text-[10.5px] text-foreground/40"><span className="sensitive">{b.shares ? `${b.shares} sh` : "options"}</span>{b.avg_cost ? <> · avg {usd(b.avg_cost)}</> : null}</p>
          {b.units.some((u) => u.kind === "covered") && b.units.some((u) => u.kind === "uncovered") && (
            <p className="truncate font-mono text-[10.5px] text-foreground/50">
              {b.units.filter((u) => u.kind === "covered" || u.kind === "uncovered").map((u) => (
                <span key={u.kind} className="mr-2"><span className={UNIT[u.kind].cls}>{u.kind === "covered" ? "cov" : "unc"}</span> {sd(u.delta)}</span>
              ))}
            </p>
          )}
        </div>
        <div className="text-right font-mono tabular-nums md:col-start-3 md:row-start-1 xl:col-start-auto xl:row-start-auto">
          <p className="text-[14px] text-foreground"><Tick value={b.spot} className="px-0.5">{usd(b.spot)}</Tick></p>
          <p className="text-[11px]"><span className={tone(b.day_change)}>{pct(b.day_change, 2)}</span>
            {b.avg_cost && b.spot ? <span className={clsx("ml-1.5", tone(b.spot - b.avg_cost))}>{pct(b.spot / b.avg_cost - 1)} avg</span> : null}</p>
        </div>
        {/* delta meter */}
        <div className="col-span-2 flex items-center gap-3 md:col-span-1 md:col-start-2 md:row-start-1 xl:col-start-auto xl:row-start-auto">
          <Meter min={-0.5} max={1.5} value={per ?? 0} target={per != null ? 1 : null} after={after} dot={lotTone(per)}
            tips={{
              value: per != null ? `${b.symbol} now: ${sd(per)} per lot (net ${sd(b.net_delta)})` : `${b.symbol}: no full lot (net ${sd(b.net_delta)})`,
              target: "+1.00 = the stock alone, no options",
              after: after != null && s ? `After: ${tradeShort(s)} → ${sd(after)} per lot` : undefined,
              zero: "0 = delta-neutral",
            }} />
          <span className="w-14 shrink-0 text-right font-mono text-[13px] tabular-nums text-foreground"><Tick value={b.net_delta}>{sd(b.net_delta)}</Tick></span>
        </div>
        <p className={clsx("hidden text-right font-mono text-[13px] tabular-nums xl:block", betaTone(b.beta))}>{b.beta != null ? b.beta.toFixed(2) : "—"}</p>
        <p className="hidden text-right font-mono text-[13px] tabular-nums text-foreground/80 xl:block">
          {vol(b.iv?.atm_iv)}<span className="text-foreground/35"> / {vol(b.iv?.hv20)}</span>{b.iv?.spike && <span className="ml-1 text-loss">▲</span>}
        </p>
        {/* signal */}
        <div className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-3 xl:col-span-1">
          {(b.closes?.length ?? 0) > 0 && <Tag tone="solid">Buy back</Tag>}
          {a && <Tag tone={a.tag}>{a.label}</Tag>}
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/70">
            {s && TRADE.has(s.action) ? <>{tradeShort(s)} · <span className="sensitive">{usd(Math.abs(s.credit ?? 0), 0)}</span></> : s?.headline}
          </span>
          <ChevronDown size={15} className={clsx("shrink-0 text-foreground/40 transition xl:hidden", open && "rotate-180")} />
        </div>
        <ChevronDown size={15} className={clsx("hidden text-foreground/40 transition xl:block", open && "rotate-180")} />
      </div>
    </DeskRow>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
type HedgeTab = "desk" | "vol" | "factors";
const TABS: { id: HedgeTab; label: string; hash: string }[] = [
  { id: "desk", label: "Delta desk", hash: "" },
  { id: "vol", label: "Vol target", hash: "#vol-target" },
  { id: "factors", label: "Factors", hash: "#factors" },
];
/** The tool tabs: title, one line on what it does, the theory pop-up and the body. */
const TOOLS: Record<Exclude<HedgeTab, "desk">, { title: string; line: string; theory: React.ReactNode; body: React.ReactNode }> = {
  vol: { title: "Vol target", line: "Less exposure when markets get wild: target vol ÷ forecast vol, on your whole book.",
    theory: <VolTargetTheory />, body: <VolTargetTab /> },
  factors: { title: "Factor exposure", line: "Which broad risks your book is really betting on, and how to neutralise them.",
    theory: <FactorsTheory />, body: <FactorsTab /> },
};

/** The tab from the URL hash (#vol-target), so a tab can be linked and survives a reload. */
function useHedgeTab(): [HedgeTab, (t: HedgeTab) => void] {
  const [tab, setTab] = useState<HedgeTab>("desk");
  useEffect(() => {
    const read = () => setTab(TABS.find((t) => t.hash && t.hash === window.location.hash)?.id ?? "desk");
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = (t: HedgeTab) => {
    setTab(t);
    history.replaceState(null, "", `${window.location.pathname}${TABS.find((x) => x.id === t)!.hash}`);
  };
  return [tab, go];
}

function TabBar({ tab, onChange }: { tab: HedgeTab; onChange: (t: HedgeTab) => void }) {
  return (
    <nav role="tablist" aria-label="Hedge" className="-mx-4 mb-5 flex gap-1 border-b border-[var(--border)] px-4 sm:mx-0 sm:px-0">
      {TABS.map((t) => (
        <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => onChange(t.id)}
          className={clsx("-mb-px border-b-2 px-3 py-2.5 text-[13.5px] transition",
            tab === t.id ? "border-foreground font-medium text-foreground" : "border-transparent text-foreground/55 hover:text-foreground")}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export default function HedgePage() {
  const [tab, setTab] = useHedgeTab();
  if (tab === "desk") return <DeltaDesk tabs={<TabBar tab={tab} onChange={setTab} />} />;
  const t = TOOLS[tab];
  return (
    <DeskPage>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-5">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50">Hedge</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">{t.title}</h1>
          <p className="mt-1 text-[13px] text-foreground/55">{t.line}</p>
        </div>
        {t.theory}
      </div>
      <TabBar tab={tab} onChange={setTab} />
      {t.body}
    </DeskPage>
  );
}

function DeltaDesk({ tabs }: { tabs: React.ReactNode }) {
  const live = useLive();
  const { data, isLoading, error } = useLiveBooks();
  const [open, setOpen] = useState<string | null>(null);
  const autoOpened = useRef(false);
  const books = (data?.books ?? []).filter((b) => !b.error);
  const errored = (data?.books ?? []).filter((b) => b.error);
  const signals = books.filter((b) => b.suggestion && TRADE.has(b.suggestion.action));
  const buybacks = books.flatMap((b) => (b.closes ?? []).map((c) => ({ b, c })));
  const spikes = books.filter((b) => b.iv?.spike);
  const expiring = books.flatMap((b) => b.legs.filter((l) => l.kind === "option" && l.quantity < 0 && (l.dte ?? 99) <= 5).map((l) => ({ ...l, symbol: b.symbol })));
  const dollarGamma = books.reduce((a, b) => a + (b.dollar_gamma_1pct ?? 0), 0);
  const sorted = [...signals, ...books.filter((b) => !signals.includes(b))];

  // Auto-expand the top actionable row once on first load only — never again, so every row
  // (including that one) can be collapsed and stays collapsed across live refreshes.
  useEffect(() => {
    if (autoOpened.current) return;
    const first = buybacks[0]?.b ?? signals[0];
    if (!first) return;
    autoOpened.current = true;
    setOpen((cur) => cur ?? first.symbol);
  }, [signals, buybacks]);

  return (
    <DeskPage>
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50">Hedge</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">Delta desk</h1>
        </div>
        <div className="flex w-full flex-wrap items-end justify-between gap-x-5 gap-y-3 sm:w-auto sm:flex-nowrap">
          <div className="w-full sm:w-auto"><StrategyPicker /></div>
          <Legend />
          <div className="text-right font-mono text-[11px] leading-relaxed text-foreground/55 max-sm:ml-auto">
            <p className="flex items-center justify-end gap-1.5">
              <span className={clsx("h-1.5 w-1.5 rounded-full", live ? "animate-pulse bg-gain" : "bg-warn")} />
              {live ? "live · 1s" : "reconnecting"}
            </p>
            <p>robinhood sync {ago(data?.synced_at) ?? "pending"}</p>
          </div>
        </div>
      </div>
      {tabs}

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
          {buybacks.length > 0 && (
            <div className="border-t border-[var(--border-strong)] py-4">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground">Buy back now · {buybacks.length}</p>
              <div className="mt-2 grid grid-cols-1 gap-1.5">
                {buybacks.map(({ b, c }) => (
                  <div key={`${b.symbol}-${c.strike}-${c.otype}-${c.expiry}`} role="button" tabIndex={0} onClick={() => setOpen(b.symbol)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(b.symbol); } }}
                    className="flex min-w-0 cursor-pointer items-center gap-3 border-l-[3px] border-loss bg-loss/[0.05] px-3 py-2 text-left hover:bg-loss/[0.09]">
                    <span className="flex w-[72px] shrink-0 items-center gap-2"><TickerLogo symbol={b.symbol} size={18} /><TickerLink symbol={b.symbol} className="font-mono text-[13.5px] font-semibold text-foreground" /></span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/85" title={c.headline}>
                      {c.contracts}× {c.strike}{c.otype === "call" ? "C" : "P"} {c.expiry.slice(5)} · ${c.mark.toFixed(2)} <span className="text-foreground/45">(sold ${c.sold_at.toFixed(2)})</span>
                    </span>
                    <span className="shrink-0 font-mono text-[12px] tabular-nums text-gain">{Math.round(c.profit_pct * 100)}% in</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Scales books={books} />

          <div className="border-t border-[var(--border)] py-5">
            <DeskFigures>
              <DeskFigure label="Signals" value={signals.length} tone={signals.length ? "text-accent" : "text-foreground/40"} sub={signals.map((b) => b.symbol).join(" · ") || "none right now"} />
              <DeskFigure sensitive label="$ gamma / 1%" value={big(dollarGamma)} tone={dollarGamma < 0 ? "text-loss" : undefined} sub={dollarGamma < 0 ? "short gamma" : "long gamma"} />
              <DeskFigure label="IV spikes" value={spikes.length} tone={spikes.length ? "text-loss" : "text-foreground/40"} sub={spikes.map((b) => b.symbol).join(" · ") || "calm"} />
              <DeskFigure label="Expiring ≤5d" value={expiring.length} tone={expiring.length ? "text-warn" : "text-foreground/40"} sub={expiring.map((l) => `${l.symbol} ${l.strike}${l.otype === "call" ? "C" : "P"}`).join(" · ") || "none"} />
            </DeskFigures>
          </div>

          <DeskSection label="Book" meta={<>Δ in lots: 100 sh = +1.00.<br />Tap a row for the ticket, legs and levels.</>}>
            <div className="-mx-4 sm:mx-0">
              <div className="hidden grid-cols-[140px_150px_minmax(200px,1fr)_48px_96px_minmax(220px,1fr)_20px] items-center gap-x-4 border-b border-[var(--border-strong)] pb-2 pl-4 pr-3 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45 xl:grid">
                <span>Symbol</span><span className="text-right">Last · vs avg</span><span>Net Δ per lot · total</span><span className="text-right">β</span>
                <span className="text-right">IV / HV</span><span>Signal</span><span />
              </div>
              <div className="border-t border-[var(--border-strong)] xl:border-t-0">
                {sorted.map((b) => (
                  <Fragment key={b.symbol}>
                    <BookRow b={b} open={open === b.symbol} onToggle={() => setOpen(open === b.symbol ? null : b.symbol)} />
                    {open === b.symbol && <Detail b={b} />}
                  </Fragment>
                ))}
                {errored.map((b) => (
                  <DeskRow key={b.symbol}><p className="px-4 py-3 font-mono text-[13px] text-foreground/55">{b.symbol} · {b.error}</p></DeskRow>
                ))}
              </div>
            </div>
          </DeskSection>

        </>
      )}

      <HowItWorks />
    </DeskPage>
  );
}
