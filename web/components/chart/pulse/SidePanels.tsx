"use client";
/**
 * Pulse side panel: Watchlist · Details · Flow · Alerts · Plans · Objects. Everything here is free data the app
 * already has (watchlists, quotes, fundamentals, chain-snapshot flow, the GEX result) or lives in this browser.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Bell, Eye, EyeOff, Lock, Trash2, Unlock } from "lucide-react";
import {
  fetchMarketQuotes, fetchNetFlowHistory, fetchStockInfo, fetchWatchlistGroups,
  type GexResult, type MarketQuote,
} from "@/lib/api";
import { anchorOf, fmtGex } from "@/lib/gex";
import type { Drawing } from "./drawings";
import { toolLabel } from "./drawings";
import type { PriceAlert, TradePlan } from "./store";
import { uid } from "./store";

export type PanelId = "watchlist" | "details" | "flow" | "alerts" | "plans" | "objects";
export const PANELS: { id: PanelId; label: string }[] = [
  { id: "watchlist", label: "Watchlist" },
  { id: "details", label: "Details" },
  { id: "flow", label: "Flow" },
  { id: "alerts", label: "Alerts" },
  { id: "plans", label: "Plans" },
  { id: "objects", label: "Objects" },
];

const usd = (v?: number | null, dp = 2) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const big = (v?: number | null) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e12) return `${s}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
};
const pct = (v?: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => (
  <div className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
    <span className="text-foreground/55">{k}</span>
    <span className={clsx("font-mono tabular-nums", tone ?? "text-foreground")}>{v}</span>
  </div>
);
const Head = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-1.5 mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45 first:mt-0">{children}</p>
);
const input = "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-mono text-[12px] tabular-nums text-foreground focus:border-[var(--border-strong)] focus:outline-none";

// ── Watchlist ────────────────────────────────────────────────────────────────
function WatchlistPanel({ symbol, onSymbol }: { symbol: string; onSymbol: (s: string) => void }) {
  const { data: groups } = useQuery({ queryKey: ["watchlistGroups"], queryFn: fetchWatchlistGroups, staleTime: 60_000 });
  const lists = groups?.lists ?? [];
  const [listId, setListId] = useState<number | null>(null);
  const list = lists.find((l) => l.id === listId) ?? lists[0];
  const symbols = useMemo(() => (list?.symbols ?? []).slice(0, 40), [list]);
  const { data: quotes } = useQuery({
    queryKey: ["pulseWlQuotes", symbols.join(",")], queryFn: () => fetchMarketQuotes(symbols),
    enabled: symbols.length > 0, refetchInterval: 30_000, staleTime: 15_000,
  });
  const bySym = new Map<string, MarketQuote>((quotes ?? []).map((q) => [q.symbol.toUpperCase(), q]));
  if (!groups) return <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-7" />)}</div>;
  if (!lists.length) return <p className="text-[12px] text-foreground/55">No watchlists yet.</p>;
  return (
    <div>
      <select value={list?.id} onChange={(e) => setListId(Number(e.target.value))} aria-label="Watchlist"
        className="mb-2 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[12px] text-foreground">
        {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.symbols.length})</option>)}
      </select>
      {!symbols.length && <p className="text-[12px] text-foreground/55">This list is empty.</p>}
      <ul className="divide-y divide-[var(--border)]">
        {symbols.map((s) => {
          const q = bySym.get(s.toUpperCase());
          const up = (q?.change_pct ?? 0) >= 0;
          return (
            <li key={s}>
              <button onClick={() => onSymbol(s)} aria-current={s.toUpperCase() === symbol ? "true" : undefined}
                className={clsx("flex w-full items-center justify-between gap-2 px-1.5 py-1.5 text-left text-[12px] hover:bg-foreground/[0.05]",
                  s.toUpperCase() === symbol && "bg-foreground/[0.07]")}>
                <span className="font-mono font-medium text-foreground">{s}</span>
                <span className="flex items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-foreground/80">{q?.price != null ? q.price.toFixed(2) : "—"}</span>
                  <span className={clsx("w-14 text-right", up ? "text-gain" : "text-loss")}>{pct(q?.change_pct)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Details (+ Dealer Edge) ──────────────────────────────────────────────────
export function DealerEdge({ gex }: { gex?: GexResult | null }) {
  if (!gex || gex.error) return <p className="text-[12px] text-foreground/55">No options data.</p>;
  const anchor = anchorOf(gex);
  const flip = gex.zero_gamma;
  const vsFlip = flip ? ((gex.spot - flip) / flip) * 100 : null;
  const long = (gex.net_gex ?? 0) >= 0;
  return (
    <div>
      <Row k="Spot" v={usd(gex.spot)} />
      <Row k="⚓ Anchor" v={anchor ? usd(anchor.price) : "no pin"} tone="text-[#0e7490] dark:text-[#67e8f9]" />
      <Row k="Flip" v={usd(flip)} tone="text-accent" />
      <Row k="Spot vs flip" v={vsFlip == null ? "—" : `${pct(vsFlip)} ${vsFlip >= 0 ? "above" : "below"}`} tone={vsFlip == null ? undefined : vsFlip >= 0 ? "text-gain" : "text-loss"} />
      <Row k="Net GEX" v={fmtGex(gex.net_gex)} tone={long ? "text-gain" : "text-loss"} />
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground/55">
        {vsFlip == null ? "" : vsFlip >= 0
          ? "Above the flip: dealers tend to sell rallies and buy dips, so moves get damped."
          : "Below the flip: dealers tend to sell drops and buy rallies, so moves get stretched."}
      </p>
    </div>
  );
}

function DetailsPanel({ symbol, gex }: { symbol: string; gex?: GexResult | null }) {
  const { data: info, isLoading } = useQuery({ queryKey: ["stockInfo", symbol], queryFn: () => fetchStockInfo(symbol), staleTime: 300_000, retry: 0 });
  const lo = info?.week_52_low, hi = info?.week_52_high, px = gex?.spot;
  const pos = lo != null && hi != null && px != null && hi > lo ? Math.min(1, Math.max(0, (px - lo) / (hi - lo))) : null;
  return (
    <div>
      <Head>Dealer edge</Head>
      <DealerEdge gex={gex} />
      <Head>Company</Head>
      {isLoading ? <div className="skeleton h-24" /> : !info || info.error ? <p className="text-[12px] text-foreground/55">No company details.</p> : (
        <>
          {info.name && <p className="mb-1 text-[12.5px] font-medium text-foreground">{info.name}</p>}
          {(info.sector || info.industry) && <p className="mb-2 text-[11.5px] text-foreground/55">{[info.sector, info.industry].filter(Boolean).join(" · ")}</p>}
          {pos != null && (
            <div className="mb-2">
              <div className="mb-1 flex justify-between font-mono text-[10.5px] text-foreground/50"><span>{usd(lo)}</span><span>52-week</span><span>{usd(hi)}</span></div>
              <div className="relative h-1.5 rounded-full bg-foreground/10"><span className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded bg-foreground" style={{ left: `calc(${pos * 100}% - 2px)` }} /></div>
            </div>
          )}
          <Row k="Market cap" v={big(info.market_cap)} />
          <Row k="P/E" v={info.pe_ratio?.toFixed(1) ?? "—"} />
          <Row k="Forward P/E" v={info.forward_pe?.toFixed(1) ?? "—"} />
          <Row k="Avg volume" v={big(info.avg_volume)} />
          <Row k="Beta" v={info.beta?.toFixed(2) ?? "—"} />
          <Row k="Dividend yield" v={info.dividend_yield != null ? `${(info.dividend_yield * (info.dividend_yield < 1 ? 100 : 1)).toFixed(2)}%` : "—"} />
          <Row k="Short % float" v={info.short_pct_float != null ? `${(info.short_pct_float * 100).toFixed(1)}%` : "—"} />
          <Row k="Next earnings" v={info.earnings_date ? new Date(info.earnings_date * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"} />
        </>
      )}
    </div>
  );
}

// ── Flow (snapshot positioning, not prints) ──────────────────────────────────
function FlowPanel({ symbol, gex }: { symbol: string; gex?: GexResult | null }) {
  const { data: hist } = useQuery({ queryKey: ["netFlowHist", symbol, 1], queryFn: () => fetchNetFlowHistory(symbol, 1), staleTime: 60_000, refetchInterval: 60_000, retry: 0 });
  const w = 260, h = 70;
  const path = useMemo(() => {
    const pts = hist ?? [];
    if (pts.length < 2) return null;
    const vals = pts.map((p) => p.net_flow);
    const mn = Math.min(0, ...vals), mx = Math.max(0, ...vals);
    const y = (v: number) => h - ((v - mn) / (mx - mn || 1)) * h;
    return { d: vals.map((v, i) => `${i ? "L" : "M"}${(i / (vals.length - 1)) * w},${y(v)}`).join(" "), zero: y(0), last: vals[vals.length - 1] };
  }, [hist]);
  const cp = gex?.call_premium ?? 0, pp = gex?.put_premium ?? 0;
  const share = cp + pp > 0 ? cp / (cp + pp) : null;
  return (
    <div>
      <p className="mb-2 rounded-md bg-foreground/[0.05] px-2 py-1.5 text-[11px] leading-snug text-foreground/60">Positioning from option-chain snapshots (volume × price), not individual prints.</p>
      <Head>Premium today</Head>
      <Row k="Calls" v={big(gex?.call_premium)} tone="text-gain" />
      <Row k="Puts" v={big(gex?.put_premium)} tone="text-loss" />
      <Row k="Net (calls − puts)" v={big(gex?.net_flow)} tone={(gex?.net_flow ?? 0) >= 0 ? "text-gain" : "text-loss"} />
      {share != null && (
        <div className="mt-1 flex h-1.5 overflow-hidden rounded-full"><span className="bg-gain" style={{ width: `${share * 100}%` }} /><span className="flex-1 bg-loss" /></div>
      )}
      <Head>Net flow through the day</Head>
      {path ? (
        <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-[70px]" role="img" aria-label="Net flow through the day">
          <line x1={0} x2={w} y1={path.zero} y2={path.zero} stroke="currentColor" className="text-foreground/20" strokeDasharray="3 3" />
          <path d={path.d} fill="none" strokeWidth={1.5} className={path.last >= 0 ? "stroke-gain" : "stroke-loss"} vectorEffect="non-scaling-stroke" />
        </svg>
      ) : <p className="text-[12px] text-foreground/55">Not enough snapshots yet today.</p>}
      {(gex?.flow_by_expiry?.length ?? 0) > 0 && <>
        <Head>By expiry</Head>
        {gex!.flow_by_expiry!.slice(0, 6).map((f) => (
          <Row key={f.expiry} k={f.expiry} v={big(f.net)} tone={f.net >= 0 ? "text-gain" : "text-loss"} />
        ))}
      </>}
    </div>
  );
}

// ── Alerts ───────────────────────────────────────────────────────────────────
function AlertsPanel({ last, alerts, onChange }: { last: number | null; alerts: PriceAlert[]; onChange: (a: PriceAlert[]) => void }) {
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const add = () => {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    onChange([...alerts, { id: uid(), price: p, dir: last != null && p < last ? "below" : "above", note: note.trim() || undefined, created: Date.now() }]);
    setPrice(""); setNote("");
    if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  };
  const live = alerts.filter((a) => !a.triggered), done = alerts.filter((a) => a.triggered);
  return (
    <div>
      <p className="mb-2 rounded-md bg-foreground/[0.05] px-2 py-1.5 text-[11px] leading-snug text-foreground/60">Checked while this chart is open, with a browser notification. Alerts that run on the server come later.</p>
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="grid grid-cols-[1fr_auto] gap-1.5">
        <input className={input} inputMode="decimal" placeholder={last != null ? `Price, e.g. ${(last * 1.01).toFixed(2)}` : "Price"} value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Alert price" />
        <button className="btn-ghost h-7 px-2 text-[12px]" type="submit"><Bell size={13} /> Add</button>
        <input className={clsx(input, "col-span-2")} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Alert note" />
      </form>
      <Head>Active</Head>
      {!live.length && <p className="text-[12px] text-foreground/55">None. Tip: the chart’s right-click menu can also add one at a price.</p>}
      {live.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 py-1 text-[12px]">
          <span className="font-mono tabular-nums text-amber-500">{a.dir === "above" ? "≥" : "≤"} {a.price.toFixed(2)}</span>
          <span className="min-w-0 flex-1 truncate text-foreground/55">{a.note}</span>
          <button onClick={() => onChange(alerts.filter((x) => x.id !== a.id))} aria-label="Delete alert" className="text-foreground/45 hover:text-loss"><Trash2 size={13} /></button>
        </div>
      ))}
      {done.length > 0 && <>
        <Head>Triggered</Head>
        {done.map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 py-1 text-[12px] text-foreground/55">
            <span className="font-mono tabular-nums">{a.price.toFixed(2)}</span>
            <span className="text-[11px]">{new Date(a.triggered!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            <button onClick={() => onChange(alerts.filter((x) => x.id !== a.id))} aria-label="Delete alert" className="hover:text-loss"><Trash2 size={13} /></button>
          </div>
        ))}
      </>}
    </div>
  );
}

// ── Paper trade plans ────────────────────────────────────────────────────────
function PlansPanel({ last, plans, onChange }: { last: number | null; plans: TradePlan[]; onChange: (p: TradePlan[]) => void }) {
  const [side, setSide] = useState<"long" | "short">("long");
  const ref = last ?? 0;
  const [entry, setEntry] = useState(""), [stop, setStop] = useState(""), [target, setTarget] = useState(""), [qty, setQty] = useState("100");
  const e = Number(entry || ref), s = Number(stop || (side === "long" ? ref * 0.98 : ref * 1.02)), t = Number(target || (side === "long" ? ref * 1.04 : ref * 0.96)), q = Number(qty) || 0;
  const valid = e > 0 && s > 0 && t > 0 && q > 0 && (side === "long" ? s < e && t > e : s > e && t < e);
  const risk = Math.abs(e - s) * q, reward = Math.abs(t - e) * q;
  const add = () => {
    if (!valid) return;
    onChange([...plans, { id: uid(), side, entry: +e.toFixed(2), stop: +s.toFixed(2), target: +t.toFixed(2), qty: q, created: Date.now(), status: "planned" }]);
    setEntry(""); setStop(""); setTarget("");
  };
  const tone = (st: TradePlan["status"]) => st === "target" ? "text-gain" : st === "stopped" ? "text-loss" : "text-foreground/60";
  return (
    <div>
      <p className="mb-2 rounded-md bg-foreground/[0.05] px-2 py-1.5 text-[11px] leading-snug text-foreground/60">Paper only: nothing is sent to a broker. Plans live in this browser and are drawn on the chart.</p>
      <div className="mb-1.5 flex gap-1">
        {(["long", "short"] as const).map((x) => (
          <button key={x} onClick={() => setSide(x)} aria-pressed={side === x}
            className={clsx("flex-1 rounded-md py-1 text-[12px] font-medium capitalize", side === x ? (x === "long" ? "bg-gain/20 text-gain" : "bg-loss/20 text-loss") : "text-foreground/55 hover:bg-foreground/[0.05]")}>{x}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="text-[10.5px] text-foreground/50">Entry<input className={input} inputMode="decimal" placeholder={ref.toFixed(2)} value={entry} onChange={(x) => setEntry(x.target.value)} /></label>
        <label className="text-[10.5px] text-foreground/50">Qty<input className={input} inputMode="numeric" value={qty} onChange={(x) => setQty(x.target.value)} /></label>
        <label className="text-[10.5px] text-loss">Stop<input className={input} inputMode="decimal" placeholder={s.toFixed(2)} value={stop} onChange={(x) => setStop(x.target.value)} /></label>
        <label className="text-[10.5px] text-gain">Target<input className={input} inputMode="decimal" placeholder={t.toFixed(2)} value={target} onChange={(x) => setTarget(x.target.value)} /></label>
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums text-foreground/60">
        <span>Risk {usd(risk, 0)} · Reward {usd(reward, 0)}</span><span>R:R {risk ? (reward / risk).toFixed(2) : "—"}</span>
      </div>
      {!valid && <p className="mt-1 text-[11px] text-warn">{side === "long" ? "Long: stop below entry, target above." : "Short: stop above entry, target below."}</p>}
      <button onClick={add} disabled={!valid} className="btn-ghost mt-2 h-8 w-full justify-center text-[12px] disabled:opacity-40">Add paper plan</button>
      <Head>Plans</Head>
      {!plans.length && <p className="text-[12px] text-foreground/55">None yet.</p>}
      {[...plans].reverse().map((p) => {
        const pnl = last != null && (p.status === "open") ? (p.side === "long" ? last - p.entry : p.entry - last) * p.qty : null;
        return (
          <div key={p.id} className="border-b border-[var(--border)] py-1.5 text-[12px] last:border-0">
            <div className="flex items-center justify-between">
              <span className={clsx("font-medium capitalize", p.side === "long" ? "text-gain" : "text-loss")}>{p.side} {p.qty}</span>
              <span className={clsx("font-mono text-[11px] uppercase tracking-wide", tone(p.status))}>{p.status}</span>
              <button onClick={() => onChange(plans.filter((x) => x.id !== p.id))} aria-label="Delete plan" className="text-foreground/45 hover:text-loss"><Trash2 size={13} /></button>
            </div>
            <div className="font-mono text-[11px] tabular-nums text-foreground/60">@ {p.entry.toFixed(2)} · stop {p.stop.toFixed(2)} · target {p.target.toFixed(2)}{pnl != null && <span className={pnl >= 0 ? " text-gain" : " text-loss"}> · {pnl >= 0 ? "+" : "−"}{usd(Math.abs(pnl), 0)}</span>}</div>
            {(p.status === "planned" || p.status === "open") && (
              <button onClick={() => onChange(plans.map((x) => (x.id === p.id ? { ...x, status: "closed" } : x)))} className="mt-0.5 text-[11px] text-foreground/50 underline-offset-2 hover:underline">Close</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Objects ──────────────────────────────────────────────────────────────────
function ObjectsPanel({ drawings, onChange, selected, onSelect }: { drawings: Drawing[]; onChange: (d: Drawing[]) => void; selected: string | null; onSelect: (id: string | null) => void }) {
  const patch = (id: string, p: Partial<Drawing>) => onChange(drawings.map((d) => (d.id === id ? { ...d, ...p } : d)));
  if (!drawings.length) return <p className="text-[12px] text-foreground/55">No drawings on this symbol yet. Pick a tool on the left of the chart.</p>;
  return (
    <div>
      <ul className="divide-y divide-[var(--border)]">
        {[...drawings].reverse().map((d) => (
          <li key={d.id} className={clsx("flex items-center gap-2 py-1.5 text-[12px]", d.id === selected && "bg-foreground/[0.06]")}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
            <button onClick={() => onSelect(d.id)} className={clsx("min-w-0 flex-1 truncate text-left", d.hidden ? "text-foreground/40" : "text-foreground")}>{toolLabel(d)}</button>
            <button onClick={() => patch(d.id, { hidden: !d.hidden })} aria-label={d.hidden ? "Show" : "Hide"} className="text-foreground/50 hover:text-foreground">{d.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            <button onClick={() => patch(d.id, { locked: !d.locked })} aria-label={d.locked ? "Unlock" : "Lock"} className="text-foreground/50 hover:text-foreground">{d.locked ? <Lock size={13} /> : <Unlock size={13} />}</button>
            <button onClick={() => onChange(drawings.filter((x) => x.id !== d.id))} aria-label="Delete" className="text-foreground/50 hover:text-loss"><Trash2 size={13} /></button>
          </li>
        ))}
      </ul>
      <button onClick={() => { if (window.confirm("Remove every drawing on this symbol?")) onChange([]); }} className="mt-2 text-[11.5px] text-loss/80 hover:text-loss">Remove all</button>
    </div>
  );
}

export function SidePanel(props: {
  panel: PanelId; onPanel: (p: PanelId) => void;
  symbol: string; onSymbol: (s: string) => void; gex?: GexResult | null; last: number | null;
  alerts: PriceAlert[]; onAlerts: (a: PriceAlert[]) => void;
  plans: TradePlan[]; onPlans: (p: TradePlan[]) => void;
  drawings: Drawing[]; onDrawings: (d: Drawing[]) => void; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const { panel } = props;
  return (
    <aside aria-label="Chart side panel" className="flex min-h-0 flex-col border-[var(--border)] bg-[var(--surface)]">
      <div role="tablist" aria-label="Side panel" className="flex flex-wrap gap-x-0.5 border-b border-[var(--border)] px-1.5">
        {PANELS.map((p) => (
          <button key={p.id} role="tab" aria-selected={panel === p.id} onClick={() => props.onPanel(p.id)}
            className={clsx("-mb-px border-b-2 px-1.5 py-2 text-[11.5px] transition",
              panel === p.id ? "border-foreground font-medium text-foreground" : "border-transparent text-foreground/55 hover:text-foreground")}>
            {p.label}{p.id === "alerts" && props.alerts.some((a) => !a.triggered) ? ` ${props.alerts.filter((a) => !a.triggered).length}` : ""}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">
        {panel === "watchlist" && <WatchlistPanel symbol={props.symbol} onSymbol={props.onSymbol} />}
        {panel === "details" && <DetailsPanel symbol={props.symbol} gex={props.gex} />}
        {panel === "flow" && <FlowPanel symbol={props.symbol} gex={props.gex} />}
        {panel === "alerts" && <AlertsPanel last={props.last} alerts={props.alerts} onChange={props.onAlerts} />}
        {panel === "plans" && <PlansPanel last={props.last} plans={props.plans} onChange={props.onPlans} />}
        {panel === "objects" && <ObjectsPanel drawings={props.drawings} onChange={props.onDrawings} selected={props.selected} onSelect={props.onSelect} />}
      </div>
    </aside>
  );
}
