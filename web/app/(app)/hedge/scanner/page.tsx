"use client";
/**
 * Scanner — finds trades for the owner's strategy across the market (strategy module).
 * Price screen (pullback off the 20-day high, RSI, 200-day trend) → chains for survivors (IV, IV/HV,
 * liquidity, earnings) → the strategy's contract and yield, scored 0–100. Filters and rules are saved
 * server-side; with notifications on, a background scan pushes new picks to every device.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Bell, ChevronDown, Loader2, Play, RotateCcw } from "lucide-react";
import { fetchPicks, fetchPushDevices, fetchScan, runScan, ScanResult, ScanRow } from "@/lib/api";
import { DeskPage, DeskRow, DeskSection, Tag } from "@/components/desk";
import { useStrategy } from "@/components/strategy/useStrategy";

type Unit = "pct" | "num" | "usd" | "days" | "x" | "delta";
type Field = { key: string; label: string; unit: Unit; step?: number; hint?: string; when?: (strategy: string) => boolean };
type Toggle = { key: string; label: string; hint?: string; when?: (strategy: string) => boolean };

const spread = (s: string) => s === "put_credit_spread";
const calls = (s: string) => ["covered_call", "wheel", "spike_wheel"].includes(s);
const RULES: Field[] = [
  { key: "delta_min", label: "Delta from", unit: "delta", step: 0.01, hint: "|Δ| of the option you sell" },
  { key: "delta_max", label: "Delta to", unit: "delta", step: 0.01 },
  { key: "dte_min", label: "Days out from", unit: "days", step: 1 },
  { key: "dte_max", label: "Days out to", unit: "days", step: 1 },
  { key: "min_yield", label: "Min yield / yr", unit: "pct", step: 1, hint: "premium ÷ cash (puts), shares (calls) or max loss (spreads)" },
  { key: "take_profit", label: "Buy back at", unit: "pct", step: 5, hint: "share of the premium captured" },
  { key: "spread_width_pct", label: "Spread width", unit: "pct", step: 0.5, hint: "of the stock price", when: spread },
  { key: "min_credit_ratio", label: "Min credit", unit: "pct", step: 1, hint: "of the width", when: spread },
];
const RULE_TOGGLES: Toggle[] = [
  { key: "require_pullback", label: "Puts only on a pullback", hint: "red day, ≥1% off the high, or IV cooling (desk)" },
  { key: "calls_above_avg", label: "Calls at or above my average", when: calls },
];
const FILTERS: Field[] = [
  { key: "pullback_min", label: "Pullback from", unit: "pct", step: 0.5, hint: "off the 20-day high" },
  { key: "pullback_max", label: "Pullback to", unit: "pct", step: 0.5 },
  { key: "rsi_max", label: "RSI at most", unit: "num", step: 1, hint: "14-day; lower = more oversold" },
  { key: "min_iv", label: "Min IV", unit: "pct", step: 1, hint: "at the money" },
  { key: "min_iv_hv", label: "Min IV ÷ realized", unit: "x", step: 0.05, hint: "1.0 = IV equals 20-day realized vol" },
  { key: "min_iv_pctile", label: "Min IV in range", unit: "pct", step: 5, hint: "where IV sits in a year of realized vol" },
  { key: "min_price", label: "Price from", unit: "usd", step: 1 },
  { key: "max_price", label: "Price to", unit: "usd", step: 1 },
  { key: "min_oi", label: "Min open interest", unit: "num", step: 10 },
  { key: "max_spread_pct", label: "Max bid/ask spread", unit: "pct", step: 1, hint: "of the mid" },
  { key: "max_collateral", label: "Max cash per contract", unit: "usd", step: 500, hint: "0 = any" },
  { key: "max_results", label: "Results", unit: "num", step: 1 },
  { key: "interval_min", label: "Scan every (min)", unit: "num", step: 5, hint: "background, market hours" },
];
const FILTER_TOGGLES: Toggle[] = [
  { key: "above_sma200", label: "Uptrends only", hint: "price above its 200-day average" },
  { key: "skip_earnings", label: "Skip earnings before expiry" },
  { key: "use_default_universe", label: "Scan ~130 liquid stocks and ETFs" },
  { key: "use_watchlists", label: "Add my watchlists" },
];
const SKIP: Record<string, string> = {
  price: "price", pullback: "no pullback in range", rsi: "RSI too high", trend: "below 200-day", no_data: "no price data",
  chain_cap: "over the chain cap", no_chain: "no chain", iv: "IV too low", iv_hv: "IV ≤ realized", iv_pctile: "IV low in range",
  no_contract: "no liquid contract in the rules", yield: "yield too low", collateral: "too much cash", earnings: "earnings before expiry",
};

const toView = (v: number, u: Unit) => (u === "pct" ? +(v * 100).toFixed(2) : v);
const fromView = (v: number, u: Unit) => (u === "pct" ? v / 100 : v);
const pct = (v?: number | null, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const usd = (v?: number | null) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
const ago = (iso?: string | null) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const trade = (r: ScanRow) => r.action === "SELL_PUT_SPREAD" ? `${r.strike}/${r.long_strike}P` : r.action === "BUY_WRITE" ? `100 sh + ${r.strike}C` : `${r.strike}P`;
const ACTION: Record<string, { label: string; tone: "gain" | "accent" | "warn" }> = {
  SELL_PUT: { label: "Sell put", tone: "gain" }, SELL_PUT_SPREAD: { label: "Put spread", tone: "gain" }, BUY_WRITE: { label: "Buy-write", tone: "accent" },
};

function NumberField({ f, value, onChange }: { f: Field; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(toView(value, f.unit)));
  useEffect(() => { setText(String(toView(value, f.unit))); }, [value, f.unit]);
  const suffix = f.unit === "pct" ? "%" : f.unit === "days" ? "d" : f.unit === "x" ? "×" : null;
  return (
    <label className="block min-w-0">
      <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/50">{f.label}</span>
      <span className="mt-1 flex items-center border-b border-[var(--border-strong)] focus-within:border-foreground">
        {f.unit === "usd" && <span className="pr-1 font-mono text-[13px] text-foreground/45">$</span>}
        <input inputMode="decimal" value={text} step={f.step}
          onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(fromView(n, f.unit)); }}
          className="w-full min-w-0 bg-transparent py-1 font-mono text-[14px] tabular-nums text-foreground outline-none" />
        {suffix && <span className="pl-1 font-mono text-[12px] text-foreground/45">{suffix}</span>}
      </span>
      {f.hint && <span className="mt-1 block text-[11.5px] leading-snug text-foreground/45">{f.hint}</span>}
    </label>
  );
}

function Check({ t, on, onChange }: { t: Toggle; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent-rgb))]" />
      <span className="min-w-0">
        <span className="block text-[13.5px] text-foreground">{t.label}</span>
        {t.hint && <span className="block text-[11.5px] leading-snug text-foreground/45">{t.hint}</span>}
      </span>
    </label>
  );
}

function Settings() {
  const { data, current, save } = useStrategy();
  const [rules, setRules] = useState<Record<string, unknown>>({});
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [symbols, setSymbols] = useState("");
  useEffect(() => {
    if (!data) return;
    setRules(data.rules); setFilters(data.scanner);
    setSymbols(((data.scanner.symbols as string[]) ?? []).join(", "));
  }, [data]);
  if (!data || !current) return <div className="h-48 animate-pulse bg-foreground/[0.03]" />;
  const key = data.strategy;
  const ruleDiff = Object.fromEntries(Object.entries(rules).filter(([k, v]) => k !== "key" && v !== (current.defaults as Record<string, unknown>)[k]));
  const dirty = JSON.stringify(rules) !== JSON.stringify(data.rules)
    || JSON.stringify({ ...filters, symbols: undefined }) !== JSON.stringify({ ...data.scanner, symbols: undefined })
    || symbols.split(/[\s,]+/).filter(Boolean).map((x) => x.toUpperCase()).join(",") !== ((data.scanner.symbols as string[]) ?? []).join(",");
  const submit = () => save.mutate({ rules: ruleDiff, scanner: { ...filters, symbols: symbols.split(/[\s,]+/).filter(Boolean) } });

  return (
    <>
      <DeskSection label="Strategy rules" meta={<>{current.name}. The desk uses these for your holdings and the scanner for new trades.
        {key === "spike_wheel" && <><br />On the desk the spike wheel keeps its own strikes; here they shape the scanner&apos;s weekly put.</>}</>}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-4">
          {RULES.filter((f) => !f.when || f.when(key)).map((f) => (
            <NumberField key={f.key} f={f} value={Number(rules[f.key] ?? 0)} onChange={(v) => setRules((r) => ({ ...r, [f.key]: v }))} />
          ))}
        </div>
        <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
          {RULE_TOGGLES.filter((t) => !t.when || t.when(key)).map((t) => (
            <Check key={t.key} t={t} on={!!rules[t.key]} onChange={(v) => setRules((r) => ({ ...r, [t.key]: v }))} />
          ))}
        </div>
      </DeskSection>

      <DeskSection label="Scanner filters" meta={<>What counts as a favourable setup.<br />{current.scanner}</>}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-4">
          {FILTERS.map((f) => (
            <NumberField key={f.key} f={f} value={Number(filters[f.key] ?? 0)} onChange={(v) => setFilters((r) => ({ ...r, [f.key]: v }))} />
          ))}
        </div>
        <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
          {FILTER_TOGGLES.map((t) => (
            <Check key={t.key} t={t} on={!!filters[t.key]} onChange={(v) => setFilters((r) => ({ ...r, [t.key]: v }))} />
          ))}
        </div>
        <label className="mt-4 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/50">Also scan these symbols</span>
          <input value={symbols} onChange={(e) => setSymbols(e.target.value)} placeholder="e.g. UPST, HIMS, CELH"
            className="mt-1 w-full border-b border-[var(--border-strong)] bg-transparent py-1 font-mono text-[14px] uppercase text-foreground outline-none placeholder:normal-case placeholder:text-foreground/35 focus:border-foreground" />
        </label>
      </DeskSection>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+72px)] z-20 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--border-strong)] bg-[var(--background)] py-3 lg:bottom-0">
        {save.isError && <span className="mr-auto text-[13px] text-loss">Couldn&apos;t save. Check the values and try again.</span>}
        {save.isSuccess && !dirty && <span className="mr-auto text-[13px] text-foreground/55">Saved. The desk and the next scan use it.</span>}
        <button type="button" onClick={() => save.mutate({ rules: {}, scanner: {} })} disabled={save.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] text-foreground/60 hover:text-foreground disabled:opacity-50">
          <RotateCcw size={14} /> Defaults
        </button>
        <button type="button" onClick={submit} disabled={!dirty || save.isPending}
          className="bg-foreground px-4 py-2 text-[13.5px] font-medium text-[var(--background)] transition disabled:opacity-30">
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}

function Notify() {
  const { data, save } = useStrategy();
  const devices = useQuery({ queryKey: ["push-devices"], queryFn: fetchPushDevices, staleTime: 60_000 });
  const on = !!data?.notify;
  const none = devices.data && devices.data.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border-strong)] py-4">
      <Bell size={16} className={on ? "text-accent" : "text-foreground/40"} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-foreground">Notify me when the scanner picks something</p>
        <p className="text-[12.5px] text-foreground/55">
          Scans every {String(data?.scanner.interval_min ?? 15)} min while the market is open; each new trade is pushed once a day.
          {none && <> No device is set up yet: <Link href="/settings/notifications" className="text-accent hover:underline">turn on notifications</Link> on your phone first.</>}
        </p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label="Scanner notifications" disabled={!data || save.isPending}
        onClick={() => save.mutate({ notify: !on })}
        className={clsx("relative h-6 w-10 shrink-0 rounded-full transition disabled:opacity-50", on ? "bg-foreground" : "bg-foreground/20")}>
        <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-[var(--background)] shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
      </button>
    </div>
  );
}

function Results({ scan, running }: { scan?: ScanResult; running: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = scan?.rows ?? [];
  const skipped = Object.entries(scan?.skipped ?? {}).sort((a, b) => b[1] - a[1]);
  const isNew = useMemo(() => new Set(scan?.new ?? []), [scan]);
  if (!scan?.as_of) {
    return <p className="py-10 text-[14px] text-foreground/55">{running ? "Scanning the market… the first run takes up to a minute while price history loads." : "No scan yet. Press Scan now, or turn on notifications to scan in the background."}</p>;
  }
  return (
    <>
      <p className="font-mono text-[11.5px] text-foreground/55">
        {scan.strategy_name} · {ago(scan.as_of)} · {scan.universe} stocks → {scan.screened} pulled back → {scan.chains} chains → <span className="text-foreground">{rows.length} trades</span>
        {scan.seconds != null && <> · {scan.seconds}s</>}
      </p>
      {skipped.length > 0 && (
        <p className="mt-1 text-[12px] leading-relaxed text-foreground/45">
          Skipped: {skipped.map(([k, n]) => `${n} ${SKIP[k] ?? k}`).join(" · ")}
        </p>
      )}
      {!rows.length ? (
        <p className="py-8 text-[14px] text-foreground/60">Nothing fits right now. Loosen the pullback, IV or yield filters, or wait for a red day.</p>
      ) : (
        <div className="-mx-4 mt-4 sm:mx-0">
          <div className="hidden grid-cols-[52px_76px_minmax(170px,1.3fr)_64px_72px_80px_64px_52px_86px_20px] items-center gap-x-3 border-b border-[var(--border-strong)] pb-2 pl-4 pr-3 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45 lg:grid">
            <span>Score</span><span>Symbol</span><span>Trade</span><span className="text-right">Yield</span><span className="text-right">Credit</span>
            <span className="text-right">Cash</span><span className="text-right">Pullback</span><span className="text-right">RSI</span><span className="text-right">IV · ×HV</span><span />
          </div>
          {rows.map((r) => {
            const a = ACTION[r.action] ?? ACTION.SELL_PUT;
            const on = open === r.key;
            return (
              <Fragment key={r.key}>
                <DeskRow edge={r.score >= 70 ? "gain" : r.score >= 50 ? "accent" : null} onClick={() => setOpen(on ? null : r.key)} active={on}>
                  <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 pl-4 pr-3 lg:grid-cols-[52px_76px_minmax(170px,1.3fr)_64px_72px_80px_64px_52px_86px_20px]">
                    <span className={clsx("font-mono text-[17px] font-semibold tabular-nums", r.score >= 70 ? "text-gain" : r.score >= 50 ? "text-accent" : "text-foreground/60")}>{Math.round(r.score)}</span>
                    <span className="min-w-0 lg:contents">
                      <span className="block font-mono text-[14px] font-semibold text-foreground">{r.symbol}
                        {isNew.has(r.key) && <span className="ml-1.5 align-middle font-mono text-[9px] uppercase tracking-[0.14em] text-accent">new</span>}
                        <span className="ml-2 font-mono text-[11px] font-normal text-foreground/45 lg:hidden">${r.spot.toFixed(2)}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <Tag tone={a.tone}>{a.label}</Tag>
                        <span className="truncate font-mono text-[12.5px] text-foreground/80">{trade(r)} {r.expiry.slice(5)} · Δ{Math.abs(r.delta).toFixed(2)} · {Math.round(r.dte)}d</span>
                      </span>
                    </span>
                    <span className="text-right font-mono text-[13px] tabular-nums text-gain lg:block" title={r.action === "SELL_PUT_SPREAD" ? `${pct(r.yield_ann)} a year` : "a year"}>
                      {r.action === "SELL_PUT_SPREAD" && r.max_loss ? <>{pct(r.credit / r.max_loss)}<span className="text-[10.5px] text-foreground/40"> risk</span></>
                        : <>{pct(r.yield_ann)}<span className="text-[10.5px] text-foreground/40 lg:hidden"> /yr</span></>}
                    </span>
                    <span className="hidden text-right font-mono text-[13px] tabular-nums text-foreground lg:block">{usd(r.credit)}</span>
                    <span className="hidden text-right font-mono text-[13px] tabular-nums text-foreground/70 lg:block">{usd(r.collateral)}</span>
                    <span className="col-span-3 font-mono text-[11.5px] text-foreground/55 lg:col-span-1 lg:text-right lg:text-[13px] lg:text-loss">
                      <span className="lg:hidden">{usd(r.credit)} credit · {pct(r.pullback, 1)} off high · RSI {r.rsi?.toFixed(0) ?? "—"} · IV {pct(r.iv)} ({r.iv_hv?.toFixed(2) ?? "—"}×)</span>
                      <span className="hidden lg:inline">−{pct(r.pullback, 1)}</span>
                    </span>
                    <span className="hidden text-right font-mono text-[13px] tabular-nums text-foreground/70 lg:block">{r.rsi?.toFixed(0) ?? "—"}</span>
                    <span className="hidden text-right font-mono text-[13px] tabular-nums text-foreground/80 lg:block">{pct(r.iv)}<span className="text-foreground/40"> · {r.iv_hv?.toFixed(2) ?? "—"}</span></span>
                    <ChevronDown size={15} className={clsx("hidden text-foreground/40 transition lg:block", on && "rotate-180")} />
                  </div>
                </DeskRow>
                {on && (
                  <div className="grid gap-6 border-b border-[var(--border)] bg-foreground/[0.025] px-4 py-5 sm:px-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                    <div>
                      <p className="text-[15.5px] font-medium text-foreground">{r.headline}</p>
                      <ol className="mt-3 space-y-1.5 border-l border-[var(--border-strong)] pl-3 text-[13px] leading-snug text-foreground/70">
                        {r.reasons.map((x) => <li key={x}>{x}</li>)}
                      </ol>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 font-mono text-[13px] sm:grid-cols-3">
                      {[["Price", `$${r.spot.toFixed(2)}`], ["Day", pct(r.day_change, 1)], ["vs 200-day", pct(r.sma200_gap, 1)],
                        ["IV in range", pct(r.iv_pctile)], ["Realized 20d", pct(r.hv20)], ["Open interest", r.oi.toLocaleString("en-US")],
                        ["Bid/ask", pct(r.spread_pct, 1)], ["Earnings", r.earnings ?? "—"],
                        ...(r.max_loss != null ? [["Max loss", usd(r.max_loss)]] : [["Cash", usd(r.collateral)]])].map(([k, v]) => (
                        <div key={k}><dt className="text-[10px] uppercase tracking-[0.14em] text-foreground/45">{k}</dt><dd className="mt-0.5 tabular-nums text-foreground">{v}</dd></div>
                      ))}
                    </dl>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </>
  );
}

function Picks() {
  const { data } = useQuery({ queryKey: ["scanner-picks"], queryFn: () => fetchPicks(15), refetchInterval: 120_000 });
  const picks = data?.picks ?? [];
  if (!picks.length) return null;
  return (
    <DeskSection label="Recent picks" meta="Each contract once a day. ● = pushed to your phone.">
      <ul className="divide-y divide-[var(--border)]">
        {picks.map((p) => (
          <li key={`${p.key}-${p.found_at}`} className="flex items-center gap-3 py-2 font-mono text-[12.5px]">
            <span className="w-28 shrink-0 whitespace-nowrap text-foreground/45">{p.found_at ? new Date(p.found_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</span>
            <span className="w-14 shrink-0 font-semibold text-foreground">{p.symbol}</span>
            <span className="min-w-0 flex-1 truncate text-foreground/75">{trade(p)} {p.expiry.slice(5)} · {p.action === "SELL_PUT_SPREAD" && p.max_loss ? `${pct(p.credit / p.max_loss)} on risk` : `${pct(p.yield_ann)}/yr`} · score {Math.round(p.score)}</span>
            <span className={p.notified ? "text-accent" : "text-transparent"}>●</span>
          </li>
        ))}
      </ul>
    </DeskSection>
  );
}

export default function ScannerPage() {
  const qc = useQueryClient();
  const { current } = useStrategy();
  const latest = useQuery({ queryKey: ["scan"], queryFn: fetchScan, refetchInterval: (q) => (q.state.data?.running ? 5_000 : 60_000) });
  const run = useMutation({
    mutationFn: runScan,
    onSuccess: (r) => { qc.setQueryData(["scan"], r); qc.invalidateQueries({ queryKey: ["scanner-picks"] }); },
  });
  const running = run.isPending || !!latest.data?.running;
  return (
    <DeskPage>
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50">Hedge</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">Scanner</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-foreground/60">{current ? <><span className="text-foreground">{current.name}:</span> {current.scanner}</> : " "}</p>
        </div>
        <button type="button" onClick={() => run.mutate()} disabled={running}
          className="inline-flex items-center gap-2 bg-foreground px-4 py-2.5 text-[14px] font-medium text-[var(--background)] transition disabled:opacity-50">
          {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{running ? "Scanning…" : "Scan now"}
        </button>
      </div>
      {run.isError && <p className="pb-3 text-[13px] text-loss">{(run.error as Error).message || "The scan failed."}</p>}

      <Notify />
      <DeskSection label="Trades" meta={<>Scored 0–100: pullback depth, IV over realized, yield, IV in its range, tight market.<br />Tap a row for the reasons.</>}>
        <Results scan={latest.data} running={running} />
      </DeskSection>
      <Settings />
      <Picks />
      <p className="mt-6 text-[12px] leading-relaxed text-foreground/45">
        IV in range compares today&apos;s IV with a year of 20-day realized volatility (no IV history is stored yet, so it stands in for IV rank).
        Prices are from Public.com, falling back to Yahoo (delayed). Suggestions are not orders; check the live quote before trading.
      </p>
    </DeskPage>
  );
}
