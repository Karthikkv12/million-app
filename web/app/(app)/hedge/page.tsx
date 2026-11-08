"use client";
/**
 * Hedge — the delta-neutral desk for every stock held on Robinhood.
 * Per holding: net delta vs target (the main indicator), gamma, ATM IV vs HV with
 * IV rate-of-change / spike state, GEX levels, and the suggested trade.
 * Live: one `books` event per second over SSE; polling while the stream is down.
 */
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Pause, RefreshCcw, ShieldCheck } from "lucide-react";
import { fetchHedgeBooks, HedgeBook, HedgeBooks, HedgeLeg, HedgeSuggestion } from "@/lib/api";
import { useHedgeStream } from "@/lib/useHedgeStream";
import { EmptyState, ErrorBanner, PageHeader, Panel, Pill, SkeletonCard } from "@/components/ui";

const usd = (v?: number | null, d = 2) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const big = (v?: number | null) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "+";
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}K` : `${s}$${a.toFixed(0)}`;
};
const pct = (v?: number | null, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const vol = (v?: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const sd = (v?: number | null, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`);
const ago = (iso?: string | null) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

const ACTION: Record<HedgeSuggestion["action"], { tone: "good" | "bad" | "warn" | "accent" | "neutral"; label: string; Icon: typeof ArrowUpRight }> = {
  SELL_CALL: { tone: "accent", label: "Sell call", Icon: ArrowDownRight },
  SELL_PUT: { tone: "good", label: "Sell put", Icon: ArrowUpRight },
  BUY_PUT: { tone: "bad", label: "Buy put", Icon: ArrowDownRight },
  HOLD: { tone: "neutral", label: "On target", Icon: ShieldCheck },
  WAIT: { tone: "warn", label: "Wait", Icon: Pause },
  TRACK: { tone: "neutral", label: "Tracking", Icon: RefreshCcw },
};

// ── Delta gauge: net delta per lot on a −1.5 … +1.5 scale, target marker ─────
function DeltaGauge({ net, target, lots, after }: { net: number; target: number; lots: number; after?: number | null }) {
  const per = (x: number) => (lots >= 1 ? x / lots : x);
  const pos = (x: number) => `${Math.min(100, Math.max(0, ((per(x) + 1.5) / 3) * 100))}%`;
  const off = Math.abs(net - target) > 0.15 * Math.max(lots, 1);
  return (
    <div>
      <div className="relative h-3 rounded-full bg-gradient-to-r from-loss/25 via-foreground/10 to-gain/25">
        <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" />
        <span title={`Target ${sd(target)}`} className="absolute -top-1 h-5 w-[3px] -translate-x-1/2 rounded bg-accent" style={{ left: pos(target) }} />
        {after != null && <span title={`After the trade ${sd(after)}`} className="absolute top-0.5 h-2 w-2 -translate-x-1/2 rounded-full border-2 border-accent bg-[var(--surface)]" style={{ left: pos(after) }} />}
        <span className={clsx("absolute -top-1.5 h-6 w-6 -translate-x-1/2 rounded-full border-2 border-[var(--surface)] shadow transition-[left] duration-500", off ? "bg-amber-500" : "bg-gain")} style={{ left: pos(net) }} />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-foreground/45"><span>−1.5</span><span>0</span><span>+1.5 / lot</span></div>
    </div>
  );
}

function IvBar({ iv, hv }: { iv?: number | null; hv?: number | null }) {
  const max = Math.max(iv ?? 0, hv ?? 0, 0.01) * 1.15;
  return (
    <div className="space-y-1.5">
      {[["ATM IV", iv, "bg-accent"], ["HV20", hv, "bg-foreground/40"]].map(([label, v, cls]) => (
        <div key={label as string} className="flex items-center gap-2 font-mono text-[11px]">
          <span className="w-12 text-foreground/55">{label as string}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
            <div className={clsx("h-full rounded-full", cls as string)} style={{ width: `${(((v as number) ?? 0) / max) * 100}%` }} />
          </div>
          <span className="w-12 text-right tabular-nums text-foreground/80">{vol(v as number)}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/50">{label}</p>
      <p className={clsx("mt-1 truncate font-mono text-[17px] tabular-nums", tone ?? "text-foreground")}>{value}</p>
      {sub && <p className="mt-0.5 truncate font-mono text-[11px] text-foreground/50">{sub}</p>}
    </div>
  );
}

function legLabel(l: HedgeLeg) {
  if (l.kind === "stock") return `${l.quantity} sh @ ${usd(l.avg_price)}`;
  const n = Math.abs(l.quantity);
  return `${l.quantity < 0 ? "Short" : "Long"} ${n} ${l.strike}${l.otype === "call" ? "C" : "P"} ${l.expiry}`;
}

function SuggestionCard({ s, book }: { s: HedgeSuggestion; book: HedgeBook }) {
  const a = ACTION[s.action];
  const trade = s.action === "SELL_CALL" || s.action === "SELL_PUT" || s.action === "BUY_PUT";
  return (
    <div className={clsx("rounded-xl border p-3.5", trade ? "border-accent/40 bg-accent/[0.06]" : "border-[var(--border)] bg-[var(--surface-2)]")}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={a.tone} dot><a.Icon size={11} /> {a.label}</Pill>
        <p className="min-w-0 flex-1 text-[14px] font-medium text-foreground">{s.headline}</p>
      </div>
      {trade && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={s.action === "BUY_PUT" ? "Debit" : "Credit"} value={usd(Math.abs(s.credit ?? 0), 0)} sub={`${usd(s.premium)} / sh mid`} />
          <Stat label="Δ per contract" value={sd(s.option_delta)} />
          <Stat label="Net Δ after" value={sd(s.net_delta_after)} sub={`target ${sd(book.target_delta)}`} />
          {s.locked_gain != null ? <Stat label="If called" value={big(s.locked_gain)} sub="vs your average" tone={s.locked_gain >= 0 ? "text-gain" : "text-loss"} />
            : <Stat label="Contracts" value={s.contracts} />}
        </div>
      )}
      {!!s.reasons?.length && (
        <ul className="mt-3 space-y-1 text-[12.5px] leading-snug text-foreground/70">
          {s.reasons.map((r) => <li key={r} className="flex gap-2"><span className="text-foreground/30">•</span>{r}</li>)}
        </ul>
      )}
      {!!s.warnings?.length && (
        <ul className="mt-2 space-y-1 text-[12.5px] text-amber-700 dark:text-amber-300">
          {s.warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</li>)}
        </ul>
      )}
    </div>
  );
}

function BookCard({ b }: { b: HedgeBook }) {
  if (b.error) {
    return <Panel title={b.symbol}><p className="text-[13px] text-foreground/60">{b.error}</p></Panel>;
  }
  const iv = b.iv;
  const lv = b.levels;
  const s = b.suggestion;
  return (
    <Panel
      padded={false}
      title={<span className="flex items-center gap-2"><span className="text-[14px] text-foreground">{b.symbol}</span>{b.accounts?.length ? <span className="normal-case tracking-normal text-foreground/45">{b.accounts.join(" · ")}</span> : null}</span>}
      actions={
        <span className="flex items-center gap-2">
          {iv?.spike && <Pill tone="bad" dot>IV spike</Pill>}
          {!iv?.spike && iv?.cooling && <Pill tone="good">IV cooling</Pill>}
          <Pill tone={b.regime === "high-vol" ? "warn" : "good"}>{b.regime === "high-vol" ? "High-vol · target 0" : "Bull · target +0.30"}</Pill>
        </span>
      }
    >
      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="font-mono text-[28px] font-semibold tabular-nums tracking-tight text-foreground">{usd(b.spot)}</p>
              <p className={clsx("font-mono text-[12px]", (b.day_change ?? 0) >= 0 ? "text-gain" : "text-loss")}>{pct(b.day_change, 2)} today</p>
            </div>
            <Stat label="Average" value={usd(b.avg_cost)} sub={b.avg_cost && b.spot ? `${pct(b.spot / b.avg_cost - 1)} vs avg` : undefined} />
            <Stat label="Net delta" value={sd(b.net_delta)} sub={`${(b.lots ?? 0).toFixed(2)} lots · gap ${sd(b.gap)}`} tone={Math.abs(b.gap ?? 0) > 0.15 * Math.max(b.lots ?? 1, 1) ? "text-amber-600 dark:text-amber-400" : "text-gain"} />
          </div>
          <DeltaGauge net={b.net_delta ?? 0} target={b.target_delta ?? 0} lots={b.lots ?? 0} after={s?.net_delta_after} />
          {s && <SuggestionCard s={s} book={b} />}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Net gamma" value={sd(b.net_gamma, 3)} sub="Δ lots per $1" tone={(b.net_gamma ?? 0) < 0 ? "text-loss" : "text-foreground"} />
            <Stat label="$ gamma / 1%" value={big(b.dollar_gamma_1pct)} />
            <Stat label="IV / HV" value={b.iv_hv == null ? "—" : `${b.iv_hv.toFixed(2)}×`} tone={(b.iv_hv ?? 0) >= 1.3 ? "text-amber-600 dark:text-amber-400" : undefined} />
            <Stat label="IV ROC · day" value={pct(iv?.iv_roc_day)} tone={(iv?.iv_roc_day ?? 0) >= 0.1 ? "text-loss" : undefined} />
            <Stat label="IV ROC · 15m" value={pct(iv?.iv_roc_15m)} />
            <Stat label="Weekly" value={b.weekly_expiry ?? "—"} sub={b.chain_source === "public" ? "Public.com · live" : b.chain_source ? "Yahoo · delayed" : undefined} />
          </div>
          <IvBar iv={iv?.atm_iv} hv={iv?.hv20} />
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--border)] p-3">
            <Stat label="★ King" value={lv?.king ?? "—"} tone="text-[#b45309] dark:text-[#fde725]" />
            <Stat label="Put wall" value={lv?.put_wall ?? "—"} tone="text-loss" />
            <Stat label="Call wall" value={lv?.call_wall ?? "—"} tone="text-gain" />
          </div>
          <table className="w-full font-mono text-[12px] tabular-nums">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-foreground/45">
                <th className="pb-1.5 font-normal">Leg</th><th className="pb-1.5 text-right font-normal">IV</th>
                <th className="pb-1.5 text-right font-normal">Δ</th><th className="pb-1.5 text-right font-normal">Pos Δ</th>
              </tr>
            </thead>
            <tbody>
              {b.legs.map((l, i) => (
                <tr key={i} className="border-t border-[var(--border)]">
                  <td className="py-1.5 pr-2 text-foreground/80">{legLabel(l)}{l.kind === "option" && l.dte != null && <span className="ml-1 text-foreground/40">{Math.floor(l.dte)}d</span>}</td>
                  <td className="py-1.5 text-right text-foreground/60">{l.kind === "option" ? vol(l.iv) : ""}</td>
                  <td className="py-1.5 text-right text-foreground/60">{l.delta.toFixed(2)}</td>
                  <td className={clsx("py-1.5 text-right", l.position_delta >= 0 ? "text-gain" : "text-loss")}>{sd(l.position_delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

export default function HedgePage() {
  const live = useHedgeStream();
  const { data, isLoading, error } = useQuery<HedgeBooks>({
    queryKey: ["hedge-books"],
    queryFn: fetchHedgeBooks,
    refetchInterval: live ? false : 15_000,
  });
  const books = data?.books ?? [];
  const actionable = books.filter((b) => b.suggestion && ["SELL_CALL", "SELL_PUT", "BUY_PUT"].includes(b.suggestion.action));

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        eyebrow="Hedge"
        title="Delta-neutral desk"
        sub="Net delta, gamma and IV for every stock you hold, with the strike to sell to stay on target."
        action={
          <div className="flex flex-col items-end gap-1 font-mono text-[11px] text-foreground/55">
            <span className="flex items-center gap-1.5">
              <span className={clsx("h-1.5 w-1.5 rounded-full", live ? "bg-gain animate-pulse" : "bg-amber-500")} />
              {live ? "Live · every second" : "Reconnecting · polling"}
            </span>
            <span>Robinhood sync {ago(data?.synced_at) ?? "pending"} · daily 8 pm ET</span>
          </div>
        }
      />

      {error && !data && <ErrorBanner message={(error as Error).message || "Couldn't load your positions."} />}
      {isLoading && <div className="grid gap-4"><SkeletonCard rows={5} /><SkeletonCard rows={5} /></div>}
      {data && !books.length && (
        <EmptyState icon={RefreshCcw} title="No positions synced yet" body="Your Robinhood stocks and options sync daily at 8 pm ET. They'll appear here after the first sync." />
      )}

      {!!books.length && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Pill tone={actionable.length ? "accent" : "neutral"} dot>{actionable.length} trade{actionable.length === 1 ? "" : "s"} suggested</Pill>
            {books.some((b) => b.iv?.spike) && <Pill tone="bad" dot>IV spike on {books.filter((b) => b.iv?.spike).map((b) => b.symbol).join(", ")}</Pill>}
            <Pill>{books.length} holdings</Pill>
          </div>
          <div className="grid gap-4">
            {[...actionable, ...books.filter((b) => !actionable.includes(b))].map((b) => <BookCard key={b.symbol} b={b} />)}
          </div>
          <p className="mt-6 text-[12px] leading-relaxed text-foreground/45">
            Delta is in lots: 100 shares = +1.00; a short call with Δ 0.70 counts −0.70, a short put with Δ −0.30 counts +0.30.
            Greeks are Black-Scholes from the live price and each contract&apos;s implied vol. Suggestions follow your volatility &amp; gamma
            protocol and are not orders; check the live quote before trading.
          </p>
        </>
      )}
    </div>
  );
}
