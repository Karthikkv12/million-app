"use client";
/**
 * Factors — the Hedge page's "Factors" tab: the synced book's exposure to a few broad risks (Arbitrage Pricing
 * Theory), from GET /risk/factors (server: optionflow/modules/risk/factors.py).
 *
 * Factors: market (SPY), tech vs market (QQQ − SPY), small vs large (IWM − SPY), rates (TLT). Each holding is
 * regressed on them over the last year of daily returns; the book's betas are the weighted sum. The page shows
 * what a 1% factor move does to the book, how its risk splits by factor, the ETF trade that would neutralise
 * each factor, and each holding's betas. The theory is behind the Theory button (FactorsTheory).
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { BookFactor, fetchFactors, Factors, FactorHolding } from "@/lib/api";
import { DeskFigure, DeskFigures, DeskSection } from "@/components/desk";
import { Formula, H, P, Terms, Theory } from "./Theory";

const REFRESH_MS = 60_000;

const pct = (v?: number | null, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const beta = (v?: number | null) => {
  if (v == null) return "—";
  const r = Math.round(v * 100) / 100;                 // no "−0.00"
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}`;
};
const money = (v?: number | null, signed = true) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : signed && v > 0 ? "+" : "";
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}K` : `${s}$${a.toFixed(0)}`;
};
const shares = (v?: number | null) => (v == null ? "" : ` (≈${Math.abs(v) >= 10 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)} sh)`);

/** A bar from the middle: right for positive, left for negative. Neutral ink; the sign is in the number. */
function CenterBar({ v, max = 1 }: { v?: number | null; max?: number }) {
  if (v == null) return <span className="inline-block h-1.5 w-24" />;
  const w = Math.min(1, Math.abs(v) / max) * 50;
  return (
    <span className="relative inline-block h-1.5 w-24 rounded-full bg-foreground/[0.08]" aria-hidden>
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-foreground/30" />
      <span className="absolute inset-y-0 rounded-full bg-foreground/60" style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
    </span>
  );
}

function ShareBar({ v }: { v?: number | null }) {
  if (v == null) return <span className="text-foreground/30">—</span>;
  const off = v < 0;
  return (
    <span className="inline-flex items-center justify-end gap-2" title={off ? "Negative: this factor offsets some of the others' risk" : undefined}>
      <span className="relative hidden h-1.5 w-16 overflow-hidden rounded-full bg-foreground/[0.08] sm:inline-block" aria-hidden>
        <span className={clsx("absolute inset-y-0 left-0 rounded-full", off ? "bg-foreground/30" : "bg-accent")} style={{ width: `${Math.min(1, Math.abs(v)) * 100}%` }} />
      </span>
      <span className="w-10 text-right">{pct(v)}</span>
      {off && <span className="text-[10.5px] text-foreground/45">offsets</span>}
    </span>
  );
}

function hedgeText(f: BookFactor) {
  if (!f.hedge.length || f.dollar_per_pct == null || Math.abs(f.dollar_per_pct) < 1) return "—";
  return f.hedge.map((l) => `${l.dollars < 0 ? "Sell" : "Buy"} ${money(Math.abs(l.dollars), false)} ${l.symbol}${shares(l.shares)}`).join(" + ");
}

function FactorTable({ d }: { d: Factors }) {
  const meta = new Map(d.factors.map((f) => [f.key, f]));
  const maxBeta = Math.max(0.5, ...d.book!.factors.map((f) => Math.abs(f.beta)));
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full font-mono text-[12.5px] tabular-nums sm:min-w-[760px]">
        <thead>
          <tr className="border-b border-[var(--border-strong)] text-[10px] uppercase tracking-[0.14em] text-foreground/45">
            <th className="pb-2 pr-3 text-left font-normal">Factor</th>
            <th className="pb-2 pr-3 text-right font-normal" title="% of capital the book moves per 1% factor move">Beta</th>
            <th className="pb-2 pr-3 text-right font-normal">Per +1% move</th>
            <th className="pb-2 pr-3 text-right font-normal">Risk share</th>
            <th className="hidden pb-2 text-left font-normal md:table-cell">To neutralise</th>
          </tr>
        </thead>
        <tbody>
          {d.book!.factors.map((f) => {
            const m = meta.get(f.key)!;
            return (
              <tr key={f.key} className="border-b border-[var(--border)] align-top">
                <td className="py-2.5 pr-3">
                  <span className="font-sans text-[13px] font-medium text-foreground">{m.label}</span>
                  <p className="text-[11px] text-foreground/45" title={m.about}>{m.minus ? `${m.etf} − ${m.minus}` : m.etf} · vol {pct(f.factor_vol)}</p>
                  <p className="mt-0.5 text-[11px] text-foreground/60 md:hidden">{hedgeText(f)}</p>
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <span className="inline-flex items-center gap-2"><span className="hidden sm:inline-flex"><CenterBar v={f.beta} max={maxBeta} /></span>{beta(f.beta)}</span>
                </td>
                <td className={clsx("sensitive py-2.5 pr-3 text-right", (f.dollar_per_pct ?? 0) > 0 ? "text-gain" : (f.dollar_per_pct ?? 0) < 0 ? "text-loss" : "text-foreground/55")}>{money(f.dollar_per_pct)}</td>
                <td className="py-2.5 pr-3 text-right"><ShareBar v={f.risk_share} /></td>
                <td className="sensitive hidden py-2.5 text-[12px] text-foreground/75 md:table-cell">{hedgeText(f)}</td>
              </tr>
            );
          })}
          <tr className="align-top">
            <td className="py-2.5 pr-3">
              <span className="font-sans text-[13px] font-medium text-foreground">Specific</span>
              <p className="text-[11px] text-foreground/45">what no factor explains</p>
            </td>
            <td className="py-2.5 pr-3 text-right text-foreground/40">—</td>
            <td className="py-2.5 pr-3 text-right text-foreground/40">—</td>
            <td className="py-2.5 pr-3 text-right"><ShareBar v={d.book!.specific_share} /></td>
            <td className="hidden py-2.5 text-[12px] text-foreground/55 md:table-cell">Diversify: more, less related holdings</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function HoldingRow({ h, keys }: { h: FactorHolding; keys: string[] }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className="py-2.5 pr-3">
        <Link href={`/stocks/${h.symbol}`} className="font-medium text-foreground hover:text-accent">{h.symbol}</Link>
        <p className="font-sans text-[11px] text-foreground/45">{h.shares ? `${h.shares} sh` : "no shares"}{h.has_options ? " + opts" : ""}</p>
      </td>
      <td className="sensitive py-2.5 pr-3 text-right">{money(h.exposure, false)}<p className="text-[11px] text-foreground/45">{pct(h.weight, 1)}</p></td>
      {keys.map((k, i) => (
        <td key={k} className={clsx("py-2.5 pr-3 text-right", i >= 2 && "hidden sm:table-cell", h.betas == null && "text-foreground/30")}
          title={h.dollar_betas ? `${money(h.dollar_betas[k])} per +1% move` : undefined}>
          {h.betas ? beta(h.betas[k]) : "—"}
        </td>
      ))}
      <td className="hidden py-2.5 pr-3 text-right sm:table-cell" title="Share of this stock's daily moves the factors explain">{pct(h.r2)}</td>
      <td className="hidden py-2.5 pr-3 text-right sm:table-cell" title="Annual vol no factor explains">{pct(h.specific_vol)}</td>
      <td className="py-2.5 text-right">{pct(h.risk_share)}</td>
    </tr>
  );
}

export function FactorsTab() {
  const { data: d, isLoading, error } = useQuery({ queryKey: ["risk-factors"], queryFn: () => fetchFactors(), refetchInterval: REFRESH_MS });
  if (isLoading) return <div className="mt-4 h-40 animate-pulse bg-foreground/[0.03]" />;
  if (error && !d) return <p className="py-6 text-[14px] text-loss">{(error as Error).message || "Couldn't compute factor exposure."}</p>;
  if (!d) return null;
  if (d.error || !d.book) return <p className="border-t border-[var(--border-strong)] py-10 text-[15px] text-foreground/60">{d.error ?? "No factor exposure yet."}</p>;

  const fs = d.book.factors;
  const keys = d.factors.map((f) => f.key);
  const label = new Map(d.factors.map((f) => [f.key, f.label]));
  const mkt = fs.find((f) => f.key === "market")!;
  const top = [...fs].sort((a, b) => (b.risk_share ?? 0) - (a.risk_share ?? 0))[0];
  const headline = top.risk_share != null && top.risk_share >= 0.5
    ? `${pct(top.risk_share)} of your risk is one bet: ${label.get(top.key)!.toLowerCase()}.`
    : d.book.specific_share != null && d.book.specific_share >= 0.5
      ? `Most of your risk (${pct(d.book.specific_share)}) is stock-specific, not a broad factor.`
      : `Your risk is spread: the largest factor, ${label.get(top.key)!.toLowerCase()}, is ${pct(top.risk_share)}.`;
  const skipped = d.holdings.filter((h) => h.error);

  return (
    <>
      <div className="py-5">
        <p className="mb-4 border-l-[3px] border-accent pl-3 text-[15px] font-medium text-foreground">{headline}</p>
        <DeskFigures>
          <DeskFigure size="lg" label="Market beta" value={beta(mkt.beta)} sub={`${money(mkt.dollar_per_pct)} per +1% SPY`} sensitive />
          <DeskFigure label="Book vol" value={pct(d.book.vol, 1)} sub="annual, of capital" />
          <DeskFigure label="Explained" value={pct(d.book.factor_share)} sub={`by factors · R² ${pct(d.book.r2)}`} />
          <DeskFigure sensitive label="Capital" value={money(d.capital, false)} sub={d.capital_source === "account" ? "synced account" : d.capital_source === "gross" ? "= gross exposure" : "set"} />
        </DeskFigures>
      </div>

      <DeskSection label="By factor" meta={<>Beta: % of capital per 1%<br />factor move. Risk share:<br />part of the book&apos;s variance.<br />{d.window && <>Daily, {d.window.start} → {d.window.end}.</>}</>}>
        <FactorTable d={d} />
      </DeskSection>

      <DeskSection label="By holding" meta={<>Each stock&apos;s betas,<br />last year of daily returns.<br />Hover a beta for $ per 1%.</>}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full font-mono text-[12.5px] tabular-nums sm:min-w-[760px]">
            <thead>
              <tr className="border-b border-[var(--border-strong)] text-[10px] uppercase tracking-[0.14em] text-foreground/45">
                <th className="pb-2 pr-3 text-left font-normal">Symbol</th>
                <th className="pb-2 pr-3 text-right font-normal">Exposure</th>
                {d.factors.map((f, i) => (
                  <th key={f.key} className={clsx("pb-2 pr-3 text-right font-normal", i >= 2 && "hidden sm:table-cell")} title={f.about}>
                    {{ market: "Mkt", tech: "Tech", size: "Size", rates: "Rates" }[f.key]}
                  </th>
                ))}
                <th className="hidden pb-2 pr-3 text-right font-normal sm:table-cell">R²</th>
                <th className="hidden pb-2 pr-3 text-right font-normal sm:table-cell">Specific</th>
                <th className="pb-2 text-right font-normal">Risk</th>
              </tr>
            </thead>
            <tbody>{d.holdings.map((h) => <HoldingRow key={h.symbol} h={h} keys={keys} />)}</tbody>
          </table>
        </div>
        {skipped.length > 0 && (
          <p className="mt-2 font-mono text-[11px] text-foreground/45">Left out: {skipped.map((h) => `${h.symbol} (${h.error})`).join(" · ")}</p>
        )}
      </DeskSection>
    </>
  );
}

/** The Theory pop-up for this tab. */
export function FactorsTheory() {
  return (
    <Theory title="Factor exposure (Arbitrage Pricing Theory)">
      <P>A stock&apos;s expected return depends only on how exposed it is to a few broad, market-wide risks. Many risks, one rule:</P>
      <Formula>E[r] = r_f + Σ βₖ · premiumₖ</Formula>
      <Terms rows={[
        ["r_f", "the risk-free rate"],
        ["factor k", "a risk that hits many stocks at once: the market, rates, inflation, oil, size, growth vs value"],
        ["βₖ", "how strongly the stock reacts to factor k (β −1.5 to rates: down 1.5% when the rate factor moves 1%)"],
        ["premiumₖ", "the extra return investors demand for carrying one unit of that risk"],
      ]} />
      <P>Example, risk-free 4%: market β 1.2 × 5% = 6.0%, rates β −0.5 × 1% = −0.5%, size β 0.3 × 2% = 0.6%, so 4 + 6.0 − 0.5 + 0.6 = <b className="font-medium text-foreground">10.1%</b>.</P>

      <H>Why &quot;arbitrage&quot;</H>
      <P>Everything else a stock does (earnings, news) is its own specific risk, and in a diversified book it mostly cancels, so the market doesn&apos;t pay for it. If two portfolios had the same betas but different expected returns, you could buy one and short the other: the factor risk cancels and you pocket the gap with no risk. Traders close that gap fast, so returns line up with betas.</P>
      <P>CAPM is the one-factor case (the market only); it&apos;s the β column on Holdings and the Delta desk. More factors explain what market beta misses: two stocks with the same market beta can still sink together when rates jump.</P>

      <H>How this tab measures it</H>
      <Terms rows={[
        ["Market", "SPY"],
        ["Tech vs market", "QQQ − SPY: tech / growth beyond what the market already has"],
        ["Small vs large", "IWM − SPY: small companies beyond the market"],
        ["Rates", "TLT (20+ year Treasuries): positive β gains when long rates fall"],
      ]} />
      <P>Subtracting SPY keeps the factors from overlapping, so each beta means one thing. Each holding&apos;s daily returns over the last year are regressed on the four factors:</P>
      <Formula>rᵢ = αᵢ + βᵢ,mkt·f_mkt + βᵢ,tech·f_tech + βᵢ,size·f_size + βᵢ,rates·f_rates + εᵢ</Formula>
      <P>Exposure is in delta dollars, so options count with shares. The book&apos;s beta is Σ (delta dollars ÷ capital) × βᵢ: a market beta of 0.60 means the book moves 0.6% of capital when SPY moves 1%.</P>
      <P><b className="font-medium text-foreground">Risk share</b> splits the book&apos;s variance: factor k contributes βₖ × (F β)ₖ, with F the factors&apos; covariance; what&apos;s left is specific. A negative share means that factor offsets the others. <b className="font-medium text-foreground">To neutralise</b> is the ETF trade that takes that one beta to zero (each factor ETF loads only on its own factor, so it doesn&apos;t disturb the rest).</P>

      <H>Limits</H>
      <P>Betas come from the last year and drift; options&apos; delta changes as prices move, so exposure is today&apos;s. The tab doesn&apos;t estimate premiums: those are noisy over any short window, so it shows exposure and risk, not expected return. A measurement, not advice.</P>
    </Theory>
  );
}
