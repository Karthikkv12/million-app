"use client";
/**
 * Hedge → Scenario: what a holding (or a trade you're considering) makes or loses across stock prices, days forward
 * and IV crush / expansion, drawn against the GEX walls. Legs come from the synced Robinhood book for the ticker;
 * switch any off, edit quantities, or add a hypothetical call or put. Every option is repriced with Black-Scholes
 * on the backend (POST /risk/scenario). The ticker lives in ?s= so a scenario can be bookmarked.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Plus, X } from "lucide-react";
import TickerSearchInput from "@/components/TickerSearchInput";
import { DeskPage, DeskSection } from "@/components/desk";
import { ChartTooltip, useChartStyle } from "@/components/chart/kit";
import { Segmented } from "@/components/ui";
import { postScenario, Scenario, ScenarioLegIn } from "@/lib/api";
import { okBooks, useLiveBooks } from "@/lib/live";

const usd = (v?: number | null, d = 0) => (v == null ? "—" : `${v < 0 && Math.abs(v) >= 0.5 * 10 ** -d ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const signed = (v?: number | null, d = 0) => (v == null ? "—" : Math.abs(v) < 0.5 * 10 ** -d ? usd(0, d) : `${v > 0 ? "+" : ""}${usd(v, d)}`);
const tone = (v?: number | null) => (v == null || Math.abs(v) < 0.5 ? "text-foreground/55" : v > 0 ? "text-gain" : "text-loss");
const clean = (s?: string | null) => (s ?? "").trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "").slice(0, 12);
const nextFriday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return d.toLocaleDateString("en-CA");
};

type Leg = ScenarioLegIn & { id: string; on: boolean; mine: boolean };

/** A strike ~5% out of the money, on the usual listing increment for the price. */
const otmStrike = (spot: number, otype?: string | null) => {
  const step = spot >= 200 ? 5 : spot >= 50 ? 1 : 0.5;
  return Math.round((spot * (otype === "put" ? 0.95 : 1.05)) / step) * step;
};

function ScenarioPage() {
  const router = useRouter();
  const symbol = clean(useSearchParams().get("s"));
  const books = okBooks(useLiveBooks().data);
  const book = books.find((b) => b.symbol === symbol);
  const [input, setInput] = useState("");
  const [legs, setLegs] = useState<Leg[]>([]);
  const [days, setDays] = useState(0);
  const [range, setRange] = useState<"0.1" | "0.15" | "0.25">("0.15");
  const [basis, setBasis] = useState<"now" | "entry">("now");
  const s = useChartStyle();

  const open = (t: string) => { const c = clean(t); if (c) router.replace(`/hedge/scenario?s=${encodeURIComponent(c)}`); setInput(""); };
  useEffect(() => { if (!symbol && books.length) open(books[0].symbol); }, [symbol, books.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // legs from the book, once per ticker (live marks keep changing; the legs themselves don't)
  const bookKey = book ? `${book.symbol}:${book.legs.map((l) => `${l.kind}${l.quantity}${l.strike}${l.otype}${l.expiry}`).join("|")}` : symbol;
  useEffect(() => {
    setDays(0);
    setLegs((book?.legs ?? []).map((l, i) => ({
      id: `b${i}`, on: true, mine: true, kind: l.kind === "option" ? "option" : "stock", quantity: l.quantity,
      otype: l.otype === "call" || l.otype === "put" ? l.otype : undefined, strike: l.strike ?? undefined, expiry: l.expiry ?? undefined,
      iv: l.iv && l.iv > 0 ? l.iv : undefined, avg_price: l.avg_price ?? undefined,
    })));
  }, [bookKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = legs.filter((l) => l.on && l.quantity && (l.kind === "stock" || (l.strike && l.expiry && l.otype)));
  const body = useMemo(() => ({
    symbol, days, range_pct: Number(range),
    legs: active.map(({ kind, quantity, otype, strike, expiry, iv, avg_price }) => ({ kind, quantity, otype, strike, expiry, iv, avg_price })),
  }), [symbol, days, range, JSON.stringify(active)]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery<Scenario>({
    queryKey: ["scenario", body], queryFn: () => postScenario(body), enabled: !!symbol && active.length > 0,
    placeholderData: (prev) => prev, staleTime: 30_000,
  });
  const d = q.data && !q.data.error ? q.data : null;
  const priceNow = d?.spot ?? book?.spot ?? null;
  // a leg added before the price loaded gets its strike once the price is known
  useEffect(() => {
    if (priceNow && legs.some((l) => l.kind === "option" && !l.strike && !l.mine)) {
      setLegs((ls) => ls.map((l) => (l.kind === "option" && !l.strike && !l.mine ? { ...l, strike: otmStrike(priceNow, l.otype) } : l)));
    }
  }, [priceNow, legs]);
  const off = basis === "entry" ? d?.entry_offset ?? 0 : 0;

  const chart = useMemo(() => (d ? d.spots.map((x, i) => {
    const row: Record<string, number> = { x };
    d.curves.forEach((c, j) => { row[`c${j}`] = c.pnl[i] + off; });
    return row;
  }) : []), [d, off]);
  const colors = [s.c.accent, s.c.warn, s.c.ink];
  const update = (id: string, patch: Partial<Leg>) => setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const add = (otype: "call" | "put", qty: number) => {
    const spot = d?.spot ?? book?.spot ?? 0;
    const k = spot ? otmStrike(spot, otype) : undefined;
    setLegs((ls) => [...ls, { id: `n${Date.now()}`, on: true, mine: false, kind: "option", quantity: qty, otype, strike: k,
      expiry: book?.weekly_expiry ?? nextFriday() }]);
  };
  const maxAbs = d ? Math.max(1, ...d.matrix.flat().map((v) => Math.abs(v + off))) : 1;
  const levels = d ? [
    { x: d.put_wall, label: "put wall", color: s.c.loss },
    { x: d.zero_gamma, label: "flip", color: s.c.accent },
    { x: d.king, label: "★ king", color: s.c.warn },
    { x: d.call_wall, label: "call wall", color: s.c.gain },
  ].filter((l) => l.x != null && l.x >= d.spots[0] && l.x <= d.spots[d.spots.length - 1]) : [];

  return (
    <DeskPage>
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50"><Link href="/hedge" className="hover:text-foreground">Hedge</Link> · scenario</p>
          <h1 className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[28px] font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">
            {symbol || "…"}{d?.spot != null && <span className="font-mono text-[18px] font-normal tabular-nums text-foreground/55">{d.spot.toFixed(2)}</span>}
          </h1>
        </div>
        <TickerSearchInput value={input} onChange={setInput} onSelect={open} placeholder="Any ticker" actionLabel="Open" className="w-full sm:w-72" />
      </div>
      {books.length > 0 && (
        <div className="-mx-4 overflow-x-auto border-y border-[var(--border)] px-4 py-2 sm:mx-0 sm:px-0">
          <div className="flex min-w-max gap-1 font-mono text-[12px]">
            {books.map((b) => (
              <button key={b.symbol} onClick={() => open(b.symbol)} aria-pressed={b.symbol === symbol}
                className={clsx("h-7 rounded-md px-2.5", b.symbol === symbol ? "bg-[var(--surface-2)] text-foreground" : "text-foreground/55 hover:text-foreground")}>{b.symbol}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Legs ─────────────────────────────────────────────────── */}
      <DeskSection label="Legs" meta={<>From your Robinhood book.<br />Untick a leg to leave it out.<br />Add legs to test a trade.</>}>
        <div className="space-y-1.5">
          {!legs.length && <p className="text-[13.5px] text-foreground/55">No position in {symbol || "this ticker"}. Add a leg to model a trade.</p>}
          {legs.map((l) => (
            <div key={l.id} className={clsx("flex flex-wrap items-center gap-2 font-mono text-[12.5px] tabular-nums", !l.on && "opacity-45")}>
              <input type="checkbox" checked={l.on} onChange={(e) => update(l.id, { on: e.target.checked })} aria-label="Include leg" className="accent-[var(--accent)]" />
              <input type="number" value={l.quantity} onChange={(e) => update(l.id, { quantity: Number(e.target.value) })} aria-label="Quantity"
                className="h-7 w-20 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-right text-foreground" />
              {l.kind === "stock" ? <span className="text-foreground">shares{l.avg_price != null && <span className="text-foreground/45"> · avg {usd(l.avg_price, 2)}</span>}</span> : (
                <>
                  <select value={l.otype ?? "call"} onChange={(e) => update(l.id, { otype: e.target.value as "call" | "put" })} aria-label="Type"
                    className="h-7 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 text-foreground">
                    <option value="call">call</option><option value="put">put</option>
                  </select>
                  <input type="number" step="0.5" value={l.strike ?? ""} onChange={(e) => update(l.id, { strike: Number(e.target.value) || undefined, iv: l.mine ? l.iv : undefined })} aria-label="Strike"
                    className="h-7 w-20 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-right text-foreground" />
                  <input type="date" value={l.expiry ?? ""} onChange={(e) => update(l.id, { expiry: e.target.value || undefined, iv: undefined })} aria-label="Expiry"
                    className="h-7 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 text-foreground" />
                  <span className="text-foreground/45">{l.quantity < 0 ? "sold" : "long"}{l.avg_price != null ? ` @ ${usd(l.avg_price, 2)}` : ""}
                    {(() => { const r = d?.legs.find((x) => x.kind === "option" && x.strike === l.strike && x.expiry === l.expiry && x.otype === l.otype); return r?.iv ? ` · IV ${(r.iv * 100).toFixed(0)}%${r.iv_source === "default" ? " (guess)" : ""}` : ""; })()}
                  </span>
                </>
              )}
              {!l.mine && <button onClick={() => setLegs((ls) => ls.filter((x) => x.id !== l.id))} aria-label="Remove leg" className="text-foreground/45 hover:text-loss"><X size={14} /></button>}
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-2 font-mono text-[11.5px]">
            {([["call", -1, "Sell call"], ["put", -1, "Sell put"], ["call", 1, "Buy call"], ["put", 1, "Buy put"]] as const).map(([t, qn, label]) => (
              <button key={label} onClick={() => add(t, qn)} className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2.5 text-foreground/70 hover:text-foreground"><Plus size={12} />{label}</button>
            ))}
            <button onClick={() => setLegs((ls) => [...ls, { id: `n${Date.now()}`, on: true, mine: false, kind: "stock", quantity: 100 }])}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] px-2.5 text-foreground/70 hover:text-foreground"><Plus size={12} />Shares</button>
          </div>
        </div>
      </DeskSection>

      {/* ── Payoff ───────────────────────────────────────────────── */}
      <DeskSection label="Payoff" meta={<>P&amp;L across stock prices.<br />Dashed: GEX walls, flip, king<br />and spot.</>}>
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11.5px]">
          <label className="flex items-center gap-2 text-foreground/60">
            Days forward
            <input type="range" min={0} max={Math.max(1, Math.floor(d?.expiry_days ?? 30))} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36 accent-[var(--accent)]" />
            <span className="w-8 text-foreground">{days}d</span>
          </label>
          <Segmented label="Range" value={range} onChange={setRange} options={[{ value: "0.1", label: "±10%" }, { value: "0.15", label: "±15%" }, { value: "0.25", label: "±25%" }]} />
          <Segmented label="Basis" value={basis} onChange={setBasis} options={[{ value: "now", label: "From now" }, { value: "entry", label: "Since entry" }]} />
        </div>
        {!active.length ? <p className="text-[13.5px] text-foreground/55">Add or tick a leg to see its payoff.</p>
          : q.data?.error ? <p className="text-[13.5px] text-loss">{q.data.error}</p>
          : !d ? <div className="h-[300px] animate-pulse bg-foreground/[0.03]" />
          : (
          <>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                  <CartesianGrid {...s.grid} />
                  <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} {...s.xAxis} tickFormatter={(v: number) => v.toFixed(0)} />
                  <YAxis {...s.yAxis} width={60} tickFormatter={(v: number) => signed(v)} />
                  <ReferenceLine y={0} stroke={s.c.muted} />
                  <ReferenceLine x={d.spot ?? undefined} stroke={s.c.ink} strokeDasharray="2 3" label={{ value: "spot", position: "insideBottomLeft", fill: s.c.ink, fontSize: 10 }} />
                  {levels.map((l, i) => <ReferenceLine key={l.label} x={l.x!} stroke={l.color} strokeDasharray="4 4" label={{ value: l.label, position: "insideTopLeft", dy: i * 13, fill: l.color, fontSize: 10 }} />)}
                  {d.breakevens.map((b) => <ReferenceLine key={b} x={b} stroke={s.c.muted} strokeDasharray="1 3" />)}
                  <Tooltip cursor={s.cursor} content={<ChartTooltip title={(l) => `Stock ${Number(l).toFixed(2)}`} format={(pl) => pl.map((p: { dataKey: string; value: number }) => ({
                    label: d.curves[Number(String(p.dataKey).slice(1))]?.label ?? "", value: signed(p.value), color: colors[Number(String(p.dataKey).slice(1))],
                  }))} />} />
                  {d.curves.map((c, j) => <Line key={c.label} dataKey={`c${j}`} type="monotone" dot={false} isAnimationActive={false} stroke={colors[j]} strokeWidth={j === d.curves.length - 1 ? 2 : 1.5} strokeDasharray={j === 0 ? "5 3" : undefined} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 font-mono text-[11px] text-foreground/55">
              {d.curves.map((c, j) => <span key={c.label} className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: colors[j] }} />{c.label}</span>)}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--border)] pt-4 font-mono text-[12.5px] tabular-nums sm:grid-cols-4">
              <Stat label="Delta" value={`${d.delta != null ? Math.round(d.delta) : "—"} sh`} sub={d.delta != null && d.spot ? `${usd(d.delta * d.spot * 0.01)} per 1%` : undefined} />
              <Stat label="Theta" value={signed(d.theta)} sub="per day" cls={tone(d.theta)} />
              <Stat label="Vega" value={signed(d.vega)} sub="per +1 vol pt" cls={tone(d.vega)} />
              <Stat label="Gamma" value={d.gamma != null ? (Math.abs(d.gamma) < 0.05 ? "0.0" : d.gamma.toFixed(1)) : "—"} sub="Δ shares per $1" />
              <Stat label={`Best at expiry`} value={signed((d.max_gain ?? 0) + off)} sub={`within ±${Math.round(d.range_pct * 100)}%`} cls="text-gain" />
              <Stat label="Worst at expiry" value={signed((d.max_loss ?? 0) + off)} sub={`within ±${Math.round(d.range_pct * 100)}%`} cls="text-loss" />
              <Stat label="Breakeven" value={d.breakevens.length ? d.breakevens.map((b) => b.toFixed(2)).join(" · ") : "—"} sub="since entry, at expiry" />
              <Stat label="Open P&L now" value={signed(d.entry_offset)} sub="vs average prices" cls={tone(d.entry_offset)} />
            </div>
          </>
        )}
      </DeskSection>

      {/* ── Matrix ───────────────────────────────────────────────── */}
      {d && (
        <DeskSection label="Move × IV" meta={<>P&amp;L {days ? `in ${days}d` : "now"}, {basis === "entry" ? "since entry" : "from now"}.<br />Columns: IV crush ← → expansion.</>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] font-mono text-[12.5px] tabular-nums">
              <thead>
                <tr className="border-b border-[var(--border)] text-[10.5px] uppercase tracking-[0.12em] text-foreground/45">
                  <th className="px-2 py-2 text-left font-normal">Stock</th>
                  {d.iv_shifts.map((sh) => <th key={sh} className="px-2 py-2 text-right font-normal">IV {sh === 0 ? "same" : `${sh > 0 ? "+" : "−"}${Math.abs(sh * 100)}%`}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...d.moves].map((m, i) => ({ m, row: d.matrix[i] })).reverse().map(({ m, row }) => (
                  <tr key={m} className={clsx("border-b border-[var(--border)] last:border-0", m === 0 && "font-semibold")}>
                    <td className="whitespace-nowrap px-2 py-1.5 text-left text-foreground/70">{m === 0 ? "flat" : `${m > 0 ? "+" : "−"}${Math.abs(m * 100)}%`} <span className="text-foreground/40">{d.spot != null ? (d.spot * (1 + m)).toFixed(2) : ""}</span></td>
                    {row.map((v, j) => {
                      const x = v + off, a = Math.min(0.45, (Math.abs(x) / maxAbs) * 0.45);
                      return <td key={j} className={clsx("px-2 py-1.5 text-right", tone(x))} style={{ background: Math.abs(x) < 0.5 ? undefined : `rgb(var(${x > 0 ? "--gain-rgb" : "--loss-rgb"}) / ${a})` }}>{signed(x)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-foreground/50">
            Black-Scholes on each option with the chain&apos;s current IV, scaled by the column (IV −30% = a 30% crush, e.g. 40% → 28%). Shares are linear.
            Real IV changes differ by strike and expiry; treat this as a map of exposures, not a forecast.
          </p>
        </DeskSection>
      )}
    </DeskPage>
  );
}

function Stat({ label, value, sub, cls }: { label: string; value: React.ReactNode; sub?: React.ReactNode; cls?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-[0.14em] text-foreground/45">{label}</p>
      <p className={clsx("sensitive mt-0.5 truncate text-[15px] text-foreground", cls)}>{value}</p>
      {sub && <p className="text-[10.5px] text-foreground/45">{sub}</p>}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={null}><ScenarioPage /></Suspense>;
}
