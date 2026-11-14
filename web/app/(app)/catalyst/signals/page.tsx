"use client";
/**
 * Signal scanner: the desk's backtested Buy / Wait / Don't buy yet read across 100 popular US stocks and ETFs, ranked by
 * fear score, with the close or VIX level that would turn each into Buy. Same code as the stock page's signal.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { fetchSignalScan, SignalScan, SignalScanRow } from "@/lib/api";
import { stockHref } from "@/components/TickerLink";
import { PageHeader, Panel, RefreshButton, Segmented } from "@/components/ui";
import { Tag } from "@/components/desk";

type Filter = "all" | "buy" | "near" | "held" | "avoid";
type SortKey = "fear_score" | "rsi" | "vs_50d" | "off_high" | "to_trigger" | "symbol";

const pct = (v?: number | null, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%`);
const usd = (v?: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const TONE: Record<SignalScanRow["verdict"], "gain" | "loss" | "warn" | "neutral"> = { ADD: "gain", HOLD: "neutral", CAUTION: "warn", TRIM: "loss", ROLL: "warn" };
/** How far the price must fall to trigger Buy at today's VIX (negative %), or null. */
const toTrigger = (r: SignalScanRow) => (r.verdict === "ADD" ? 0 : r.buy_below != null ? r.buy_below / r.price - 1 : null);

function ScoreBar({ v, cut }: { v?: number | null; cut: number }) {
  const w = Math.min(Math.max(v ?? 0, 0), 1) * 100;
  return (
    <span className="relative inline-block h-1.5 w-20 shrink-0 rounded-full bg-foreground/10 align-middle" aria-hidden>
      <span className={clsx("absolute inset-y-0 left-0 rounded-full", (v ?? 0) >= cut ? "bg-gain" : "bg-foreground/40")} style={{ width: `${w}%` }} />
      <span className="absolute inset-y-[-3px] w-px bg-foreground/50" style={{ left: `${cut * 100}%` }} />
    </span>
  );
}

export default function SignalScannerPage() {
  const { data, isLoading, isFetching, refetch, error } = useQuery<SignalScan>({
    queryKey: ["signal-scan"],
    queryFn: fetchSignalScan,
    staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.building && !q.state.data.rows.length ? 5_000 : 5 * 60_000),
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("fear_score");
  const [dir, setDir] = useState<1 | -1>(-1);
  const cut = data?.score_cut ?? 0.283;
  const all = useMemo(() => data?.rows ?? [], [data]);
  const rows = useMemo(() => {
    const f = all.filter((r) => filter === "all" ? true : filter === "buy" ? r.verdict === "ADD"
      : filter === "near" ? r.verdict !== "ADD" && ((toTrigger(r) ?? -1) >= -0.05)
      : filter === "held" ? r.held : r.verdict === "CAUTION");
    const key = (r: SignalScanRow): number | string => sort === "symbol" ? r.symbol : sort === "to_trigger" ? (toTrigger(r) ?? -9) : (r[sort] ?? -9);
    return [...f].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }, [all, filter, sort, dir]);
  const count = (v: SignalScanRow["verdict"]) => all.filter((r) => r.verdict === v).length;
  const near = all.filter((r) => r.verdict !== "ADD" && (toTrigger(r) ?? -1) >= -0.05).length;
  const onSort = (k: SortKey) => { if (k === sort) setDir(dir === 1 ? -1 : 1); else { setSort(k); setDir(k === "symbol" ? 1 : -1); } };
  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={clsx("py-2 pr-3 font-normal", right && "text-right")}>
      <button type="button" onClick={() => onSort(k)} className={clsx("uppercase tracking-[0.12em] hover:text-foreground", sort === k && "text-foreground")}>
        {children}{sort === k ? (dir === -1 ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 pb-16 pt-8 sm:px-6">
      <PageHeader eyebrow="Research" title="Signal scanner"
        sub="The desk's backtested buy read on 100 popular stocks and ETFs: who is a Buy now, and the close or VIX level that would make the rest one."
        action={<RefreshButton onRefresh={() => refetch()} isRefreshing={isFetching} />} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {([
          ["Buy now", count("ADD"), "text-gain"],
          ["Within 5% of a Buy", near, "text-accent"],
          ["Don't buy yet", count("CAUTION"), "text-warn"],
          ["VIX · percentile", data?.vix != null ? `${data.vix.toFixed(1)} · ${Math.round((data.vix_pct ?? 0) * 100)}%` : "—", "text-foreground"],
        ] as const).map(([l, v, c]) => (
          <div key={l} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/55">{l}</p>
            <p className={clsx("mt-1 font-mono text-2xl font-medium tabular-nums", c)}>{isLoading ? "…" : v}</p>
          </div>
        ))}
      </div>

      <Panel padded={false} className="!overflow-visible"
        title={data ? `${all.length} of ${data.universe} tickers` : "Scanning"}
        sub={data?.as_of ? `As of ${new Date(data.as_of).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · daily closes, refreshed every 15 min` : undefined}>
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Segmented label="Show" value={filter} onChange={setFilter} options={[
            { value: "all", label: "All" }, { value: "buy", label: "Buy" }, { value: "near", label: "Near a buy" },
            { value: "avoid", label: "Don't buy yet" }, { value: "held", label: "You hold" }]} />
          <span className="font-mono text-[11px] text-foreground/45">Fear score = VIX percentile × how oversold. Buy at ≥ {cut.toFixed(2)}.</span>
        </div>
        {error && <p className="px-4 py-6 text-[14px] text-loss">{(error as Error).message || "Couldn't load the scan."}</p>}
        {data?.building && !all.length && <p className="px-4 py-6 text-[14px] text-foreground/60">Building the first scan of 100 tickers… this takes a minute.</p>}
        {!!all.length && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] font-mono text-[12.5px] tabular-nums" data-testid="signal-scan">
              <thead><tr className="border-b border-[var(--border-strong)] text-left text-[10px] text-foreground/45">
                <th className="py-2 pl-4 pr-3 font-normal"><button type="button" onClick={() => onSort("symbol")} className="uppercase tracking-[0.12em] hover:text-foreground">Ticker{sort === "symbol" ? (dir === -1 ? " ↓" : " ↑") : ""}</button></th>
                <th className="py-2 pr-3 text-right font-normal uppercase tracking-[0.12em]">Price</th>
                <th className="py-2 pr-3 font-normal uppercase tracking-[0.12em]">Signal</th>
                <Th k="fear_score">Fear score</Th>
                <Th k="rsi" right>RSI</Th>
                <Th k="vs_50d" right>vs 50d</Th>
                <Th k="off_high" right>vs 52w high</Th>
                <Th k="to_trigger" right>Buy if closes ≤</Th>
                <th className="py-2 pr-3 text-right font-normal uppercase tracking-[0.12em]">or VIX ≥</th>
                <th className="py-2 pr-4 font-normal uppercase tracking-[0.12em]">Why</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const tt = toTrigger(r);
                  return (
                    <tr key={r.symbol} className="border-b border-[var(--border)] hover:bg-foreground/[0.03]">
                      <td className="py-2 pl-4 pr-3"><Link href={stockHref(r.symbol)} className="font-semibold text-foreground hover:text-accent">{r.symbol}</Link>
                        {r.held && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.1em] text-accent">held</span>}</td>
                      <td className="py-2 pr-3 text-right">{usd(r.price)} <span className={clsx("text-[11px]", (r.day_change ?? 0) >= 0 ? "text-gain" : "text-loss")}>{pct(r.day_change)}</span></td>
                      <td className="py-2 pr-3"><Tag tone={TONE[r.verdict]}>{r.label}</Tag></td>
                      <td className="py-2 pr-3"><span className="flex items-center gap-2"><ScoreBar v={r.fear_score} cut={cut} /><span className={(r.fear_score ?? 0) >= cut ? "text-gain" : "text-foreground/70"}>{r.fear_score != null ? r.fear_score.toFixed(2) : "—"}</span></span></td>
                      <td className={clsx("py-2 pr-3 text-right", (r.rsi ?? 50) < 30 ? "text-gain" : (r.rsi ?? 50) > 70 ? "text-warn" : undefined)}>{r.rsi != null ? r.rsi.toFixed(0) : "—"}</td>
                      <td className="py-2 pr-3 text-right">{pct(r.vs_50d)}</td>
                      <td className="py-2 pr-3 text-right">{pct(r.off_high)}</td>
                      <td className="py-2 pr-3 text-right">{r.verdict === "ADD" ? <span className="text-gain">now</span> : r.buy_below != null ? <>{usd(r.buy_below)} <span className="text-[11px] text-foreground/45">{pct(tt)}</span></> : "—"}</td>
                      <td className="py-2 pr-3 text-right">{r.vix_trigger != null ? r.vix_trigger.toFixed(1) : "—"}</td>
                      <td className="max-w-[360px] truncate py-2 pr-4 font-sans text-[12px] text-foreground/60" title={r.headline}>{r.headline}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!!data?.failed?.length && <p className="px-4 py-2 font-mono text-[11px] text-foreground/40">No history this scan: {data.failed.join(" · ")}</p>}
      </Panel>
      <p className="mt-3 text-[12px] leading-relaxed text-foreground/45">
        Read as if you don&apos;t hold the stock. Buy = fear score ≥ {cut.toFixed(2)}: in 2015–2026 (unseen when the rule was set) such days beat
        holding by +3.5% over 60 trading days on average, up about 6 times in 10. Buy in thirds, ≥10 trading days apart. Averages for the setup,
        not a forecast for one stock. Not financial advice.
      </p>
    </div>
  );
}
