"use client";
/**
 * Signal scanner: the desk's backtested Buy / Wait / Don't buy yet read across 100 popular names or the S&P 500, ranked by
 * fear score, with the close or VIX level that would turn each into Buy. Same code as the stock page's signal.
 * Swing mode (hedge.swing, its own backtest): 1 week – 1 month trades — a fear dip or a 5% 5-day drop above the 200-day,
 * sold at the first close above the 10-day average or after 20 trading days.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { fetchSignalScan, ScanUniverse, SignalScan, SignalScanRow } from "@/lib/api";
import { stockHref } from "@/components/TickerLink";
import { PageHeader, Panel, RefreshButton, Segmented } from "@/components/ui";
import { Tag } from "@/components/desk";
import { TrackRecord } from "@/components/signal/TrackRecord";

type Filter = "all" | "buy" | "near" | "held" | "avoid";
type SortKey = "fear_score" | "rsi" | "vs_50d" | "off_high" | "to_trigger" | "symbol" | "ret5" | "vs_200d" | "to_swing";
type Mode = "trend" | "swing";

const pct = (v?: number | null, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%`);
const usd = (v?: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const TONE: Record<SignalScanRow["verdict"], "gain" | "loss" | "warn" | "neutral"> = { ADD: "gain", HOLD: "neutral", CAUTION: "warn", TRIM: "loss", ROLL: "warn" };
/** How far the price must fall to trigger Buy at today's VIX (negative %), or null. */
const toTrigger = (r: SignalScanRow) => (r.verdict === "ADD" ? 0 : r.buy_below != null ? r.buy_below / r.price - 1 : null);
/** Swing: how far the price must fall for a swing buy (negative %), 0 when it is one, or null. */
const toSwing = (r: SignalScanRow) => (r.swing === "BUY" ? 0 : r.swing_buy_below != null ? r.swing_buy_below / r.price - 1 : null);

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
  const [universe, setUniverse] = useState<ScanUniverse>("popular");
  useEffect(() => { try { if (localStorage.getItem("signal_scan_universe") === "sp500") setUniverse("sp500"); } catch { /* private mode */ } }, []);
  const pickUniverse = (u: ScanUniverse) => { setUniverse(u); try { localStorage.setItem("signal_scan_universe", u); } catch { /* private mode */ } };
  const [mode, setMode] = useState<Mode>("trend");
  useEffect(() => { try { if (localStorage.getItem("signal_scan_mode") === "swing") { setMode("swing"); setSort("to_swing"); } } catch { /* private mode */ } }, []);
  const pickMode = (m: Mode) => {
    setMode(m); setFilter("all"); setSort(m === "swing" ? "to_swing" : "fear_score"); setDir(-1);
    try { localStorage.setItem("signal_scan_mode", m); } catch { /* private mode */ }
  };
  const { data, isLoading, isFetching, refetch, error } = useQuery<SignalScan>({
    queryKey: ["signal-scan", universe],
    queryFn: () => fetchSignalScan(universe),
    staleTime: 1_000,
    // live in market hours: the server re-prices the scan every second (hedge.scan_live), so poll every second
    refetchInterval: (q) => (q.state.data?.live ? 1_000 : q.state.data?.building && !q.state.data.rows.length ? 5_000 : 60_000),
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("fear_score");
  const [dir, setDir] = useState<1 | -1>(-1);
  const cut = data?.score_cut ?? 0.283;
  const all = useMemo(() => data?.rows ?? [], [data]);
  const rows = useMemo(() => {
    const f = all.filter((r) => filter === "all" ? true : filter === "held" ? r.held
      : mode === "swing" ? (filter === "buy" ? r.swing === "BUY" : filter === "near" ? r.swing !== "BUY" && (toSwing(r) ?? -1) >= -0.03 : true)
      : filter === "buy" ? r.verdict === "ADD"
      : filter === "near" ? r.verdict !== "ADD" && ((toTrigger(r) ?? -1) >= -0.05)
      : r.verdict === "CAUTION");
    const key = (r: SignalScanRow): number | string => sort === "symbol" ? r.symbol : sort === "to_trigger" ? (toTrigger(r) ?? -9)
      : sort === "to_swing" ? (toSwing(r) ?? -9) : (r[sort] ?? -9);
    return [...f].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }, [all, filter, sort, dir, mode]);
  const swingBuys = all.filter((r) => r.swing === "BUY").length;
  const swingNear = all.filter((r) => r.swing !== "BUY" && (toSwing(r) ?? -1) >= -0.03).length;
  const ss = data?.swing_stats;
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
        sub={mode === "swing"
          ? "Swing trades, 1 week to 1 month, backtested on their own: buy a fear dip or a 5% five-day drop above the 200-day at the next open; sell at the first close above the 10-day average, or after 20 trading days."
          : "The desk's backtested buy read on 100 popular names or the whole S&P 500: who is a Buy now, and the close or VIX level that would make the rest one. A timing call for the next 1–3 months, not a long-term pick."}
        action={
          <span className="inline-flex items-center gap-3">
            {data?.live && (
              <span data-testid="scan-live" title={`Re-priced every ${data.tick_seconds ?? 1}s in market hours; Buy alerts go to your Notification Center`}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-gain">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />Live · {data.tick_seconds ?? 1}s
              </span>
            )}
            <RefreshButton onRefresh={() => refetch()} isRefreshing={isFetching && !data?.live} />
          </span>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(mode === "swing" ? [
          ["Swing buys now", swingBuys, "text-gain"],
          ["Within 3% of one", swingNear, "text-accent"],
          ["Backtest win rate", ss ? `${Math.round(ss.oos.win * 100)}% · ${ss.oos.days.toFixed(0)}d` : "—", "text-foreground"],
          ["VIX · percentile", data?.vix != null ? `${data.vix.toFixed(1)} · ${Math.round((data.vix_pct ?? 0) * 100)}%` : "—", "text-foreground"],
        ] as const : [
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
          <Segmented label="Signal" value={mode} onChange={pickMode} options={[
            { value: "trend", label: "1–3 months" }, { value: "swing", label: "Swing · 1–4 wk" }]} />
          <Segmented label="Universe" value={universe} onChange={pickUniverse} options={[
            { value: "popular", label: "Popular 100" }, { value: "sp500", label: "S&P 500" }]} />
          <Segmented label="Show" value={filter} onChange={setFilter} options={mode === "swing" ? [
            { value: "all", label: "All" }, { value: "buy", label: "Swing buy" }, { value: "near", label: "Near one" }, { value: "held", label: "You hold" }] : [
            { value: "all", label: "All" }, { value: "buy", label: "Buy" }, { value: "near", label: "Near a buy" },
            { value: "avoid", label: "Don't buy yet" }, { value: "held", label: "You hold" }]} />
          <span className="font-mono text-[11px] text-foreground/45">{mode === "swing"
            ? "Buy: fear dip, or −5% in 5 days above the 200-day. Sell: first close above the 10-day avg, max 20 days."
            : <>Fear score = VIX percentile × how oversold. Buy at ≥ {cut.toFixed(2)}.</>}</span>
        </div>
        {error && <p className="px-4 py-6 text-[14px] text-loss">{(error as Error).message || "Couldn't load the scan."}</p>}
        {data?.building && !all.length && <p className="px-4 py-6 text-[14px] text-foreground/60">Building the first scan of {data.universe} tickers… {data.universe > 200 ? "about a minute" : "a few seconds"}.</p>}
        {!!all.length && mode === "swing" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] font-mono text-[12.5px] tabular-nums" data-testid="swing-scan">
              <thead><tr className="border-b border-[var(--border-strong)] text-left text-[10px] text-foreground/45">
                <th className="py-2 pl-4 pr-3 font-normal"><button type="button" onClick={() => onSort("symbol")} className="uppercase tracking-[0.12em] hover:text-foreground">Ticker{sort === "symbol" ? (dir === -1 ? " ↓" : " ↑") : ""}</button></th>
                <th className="py-2 pr-3 text-right font-normal uppercase tracking-[0.12em]">Price</th>
                <th className="py-2 pr-3 font-normal uppercase tracking-[0.12em]">Swing</th>
                <Th k="ret5" right>5-day</Th>
                <Th k="vs_200d" right>vs 200d</Th>
                <Th k="rsi" right>RSI</Th>
                <Th k="to_swing" right>Buy if closes ≤</Th>
                <th className="py-2 pr-3 text-right font-normal uppercase tracking-[0.12em]">Sell above</th>
                <th className="py-2 pr-4 font-normal uppercase tracking-[0.12em]">Why</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const ts = toSwing(r);
                  return (
                    <tr key={r.symbol} className="border-b border-[var(--border)] hover:bg-foreground/[0.03]">
                      <td className="py-2 pl-4 pr-3"><Link href={stockHref(r.symbol)} className="font-semibold text-foreground hover:text-accent">{r.symbol}</Link>
                        {r.held && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.1em] text-accent">held</span>}</td>
                      <td className="py-2 pr-3 text-right">{usd(r.price)} <span className={clsx("text-[11px]", (r.day_change ?? 0) >= 0 ? "text-gain" : "text-loss")}>{pct(r.day_change)}</span></td>
                      <td className="py-2 pr-3">{r.swing ? <Tag tone={r.swing === "BUY" ? "gain" : "neutral"}>{r.swing === "BUY" ? (r.swing_strong ? "Strong swing" : "Swing buy") : "Wait"}</Tag> : "—"}</td>
                      <td className={clsx("py-2 pr-3 text-right", (r.ret5 ?? 0) <= -0.05 ? "text-loss" : undefined)}>{pct(r.ret5)}</td>
                      <td className="py-2 pr-3 text-right">{pct(r.vs_200d)}</td>
                      <td className="py-2 pr-3 text-right">{r.rsi != null ? r.rsi.toFixed(0) : "—"}</td>
                      <td className="py-2 pr-3 text-right">{r.swing === "BUY" ? <span className="text-gain">now</span> : r.swing_buy_below != null ? <>{usd(r.swing_buy_below)} <span className="text-[11px] text-foreground/45">{pct(ts)}</span></> : "—"}</td>
                      <td className="py-2 pr-3 text-right" title="Sell at the first close above the 10-day average (today's value), or after 20 trading days">{usd(r.swing_exit_above)}</td>
                      <td className="max-w-[380px] truncate py-2 pr-4 font-sans text-[12px] text-foreground/60" title={r.swing_reason ?? ""}>{r.swing_reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!!all.length && mode === "trend" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] font-mono text-[12.5px] tabular-nums" data-testid="signal-scan">
              <thead><tr className="border-b border-[var(--border-strong)] text-left text-[10px] text-foreground/45">
                <th className="py-2 pl-4 pr-3 font-normal"><button type="button" onClick={() => onSort("symbol")} className="uppercase tracking-[0.12em] hover:text-foreground">Ticker{sort === "symbol" ? (dir === -1 ? " ↓" : " ↑") : ""}</button></th>
                <th className="py-2 pr-3 text-right font-normal uppercase tracking-[0.12em]">Price</th>
                <th className="py-2 pr-3 font-normal uppercase tracking-[0.12em]">Signal</th>
                <Th k="fear_score">Fear score</Th>
                <th className="py-2 pr-3 text-right font-normal uppercase tracking-[0.12em]" title="The fear-score band's 60-day return vs holding, on years no rule was set on (1963–1994 and 2015–2026)">60d edge</th>
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
                      <td className="py-2 pr-3 text-right" title={r.score_band ? `${r.score_band}: ${pct(r.score_edge_60)} vs holding over 60 days, on average` : undefined}>
                        <span className={(r.score_edge_60 ?? 0) >= 0.01 ? "text-gain" : "text-foreground/60"}>{pct(r.score_edge_60)}</span>
                        {r.score_band && <span className="ml-1.5 font-sans text-[10.5px] text-foreground/45">{r.score_band}</span>}</td>
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
        {data?.live && <p className="px-4 py-2 font-mono text-[11px] text-foreground/45">Live: read on the last trade every second. A Buy here means &ldquo;if it closes here&rdquo;; the backtests buy at the next open after the close. A Buy that holds 3 seconds alerts once a day.</p>}
        {!!data?.failed?.length && <p className="px-4 py-2 font-mono text-[11px] text-foreground/40">No history this scan: {data.failed.join(" · ")}</p>}
      </Panel>
      {mode === "swing" ? (
        <p className="mt-3 text-[12px] leading-relaxed text-foreground/45">
          Backtest, {ss?.symbols ?? 148} US stocks and ETFs, bought at the next open, 0.2% round-trip cost, rule chosen on 1995–2014.
          {ss && <> In 2015–2026 (unseen): {ss.oos.trades.toLocaleString("en-US")} trades, {Math.round(ss.oos.win * 100)}% winners,
          average {pct(ss.oos.avg, 2)} (median {pct(ss.oos.median, 2)}) in {ss.oos.days.toFixed(1)} days; the worst 1 in 20 lost {pct(-ss.oos.worst5, 0).replace("+", "")} or more.
          Any day held 5 days: {pct(ss.baseline_oos_5d.avg, 2)}.
          {ss.strong_oos && <> Strong swing buys (a 7%+ drop): {ss.strong_oos.trades.toLocaleString("en-US")} trades, average {pct(ss.strong_oos.avg, 2)},
          but the worst 1 in 20 lost {pct(-ss.strong_oos.worst5, 0).replace("+", "")} or more.</>}</>} No stop-loss: every stop tested lowered the average. Most fear-dip
          gains are the whole market bouncing, so many swing buys on one day are one bet, not many. Not financial advice.
        </p>
      ) : (
      <p className="mt-3 text-[12px] leading-relaxed text-foreground/45">
        Read as if you don&apos;t hold the stock. Buy = fear score ≥ {cut.toFixed(2)}. On every year no rule was set on (1963–1994 and 2015–2026, 265 stocks and ETFs)
        such days beat holding by +2.4% over 60 trading days on average (95% range +0.3% to +4.5%). The edge grows with the score:
        about +0.5% more for every 0.1 (the 60d edge column). Buy in thirds, ≥10 trading days apart. Averages for the setup,
        not a forecast for one stock. Not financial advice.
      </p>
      )}
      <div className="mt-6"><TrackRecord /></div>
    </div>
  );
}
