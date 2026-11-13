"use client";
/**
 * StrikeFlow — who is buying and who is selling, strike by strike, today.
 * Each strike's new volume is split into bought (filled at the ask) and sold (at the bid), and weighted by the
 * option's delta: customer Δ$ = bought − sold delta dollars (calls +, puts −). Positive = customers added long
 * delta (bought calls / sold puts), which dealers on the other side hedge by buying shares.
 * Rows run high strike → low like the dealer ladder, centred on spot, with the walls and flip marked.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { fetchStrikeFlow, StrikeFlow as StrikeFlowData } from "@/lib/api";
import { DeskSection } from "@/components/desk";

const money = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : a.toFixed(0);
  return `${v < 0 ? "−" : v > 0 ? "+" : ""}$${s}`;
};
const plain = (v: number) => money(v).replace(/^[+−]/, "");
const tone = (v: number) => (v > 0 ? "text-gain" : v < 0 ? "text-loss" : "text-foreground/45");
const SHOW = 25;                       // strikes shown around spot

type Row = StrikeFlowData["rows"][number];

export function StrikeFlow({ symbol }: { symbol: string }) {
  const [expiry, setExpiry] = useState<string | null>(null);
  const [unit, setUnit] = useState<"delta" | "premium">("delta");
  const q = useQuery<StrikeFlowData>({
    queryKey: ["flow", "strikes", symbol, expiry], queryFn: () => fetchStrikeFlow(symbol, expiry), refetchInterval: 15_000,
  });
  const d = q.data;

  const rows = useMemo(() => {
    const all = (d?.rows ?? []).filter((r) => r.call_bought + r.call_sold + r.put_bought + r.put_sold > 0);
    if (!all.length) return [] as Row[];
    const spot = d?.spot ?? all[Math.floor(all.length / 2)].strike;
    const near = [...all].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot)).slice(0, SHOW);
    return near.sort((a, b) => b.strike - a.strike);
  }, [d]);

  const val = (r: Row, side: "call" | "put") =>
    unit === "delta" ? (side === "call" ? r.call_delta : r.put_delta)
      : side === "call" ? r.call_bought - r.call_sold : r.put_bought - r.put_sold;
  const max = Math.max(1, ...rows.flatMap((r) => [Math.abs(val(r, "call")), Math.abs(val(r, "put"))]));

  const marks = (k: number) => {
    const m: string[] = [];
    if (d?.call_wall === k) m.push("CW");
    if (d?.put_wall === k) m.push("PW");
    if (d?.king === k) m.push("★");
    return m.join(" ");
  };
  const spotIdx = d?.spot != null ? rows.findIndex((r) => r.strike < d.spot!) : -1;

  const shares = d?.spot ? d.net_delta / d.spot : null;
  const meta = (
    <>
      Bought at the ask vs sold<br />at the bid, by delta.<br />+ = customers got longer,<br />dealers buy shares.
    </>
  );

  return (
    <DeskSection label="By strike" meta={meta}>
      {!d || q.isLoading ? (
        <div className="h-40 animate-pulse bg-foreground/[0.03]" />
      ) : !rows.length ? (
        <p className="py-2 text-[13.5px] text-foreground/55">No sided volume yet for {symbol} today. It fills in while the session runs and this ticker is open.</p>
      ) : (
        <div className="min-w-0">
          {/* summary */}
          <div className="mb-4 grid gap-x-8 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Customer Δ$ {d.live ? "today" : d.day ?? ""}</p>
              <p className={clsx("mt-1 font-mono text-[26px] font-semibold tabular-nums", tone(d.net_delta))}>{money(d.net_delta)}</p>
              {shares != null && <p className="font-mono text-[11.5px] text-foreground/55">≈ {Math.round(Math.abs(shares)).toLocaleString()} shares dealers {d.net_delta >= 0 ? "buy" : "sell"} to hedge</p>}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 self-end font-mono text-[12.5px] tabular-nums">
              <span className="text-foreground/55">Calls bought <span className="text-gain">{plain(d.call_bought)}</span> · sold <span className="text-loss">{plain(d.call_sold)}</span></span>
              <span className="text-foreground/55">Δ$ <span className={tone(d.call_delta)}>{money(d.call_delta)}</span></span>
              <span className="text-foreground/55">Puts bought <span className="text-loss">{plain(d.put_bought)}</span> · sold <span className="text-gain">{plain(d.put_sold)}</span></span>
              <span className="text-foreground/55">Δ$ <span className={tone(d.put_delta)}>{money(d.put_delta)}</span></span>
            </div>
          </div>

          {/* controls */}
          <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11.5px]">
            <select value={expiry ?? ""} onChange={(e) => setExpiry(e.target.value || null)} aria-label="Expiry"
              className="h-7 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-foreground">
              <option value="">All expiries</option>
              {d.expiries.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <div className="flex">
              {(["delta", "premium"] as const).map((u) => (
                <button key={u} onClick={() => setUnit(u)} aria-pressed={unit === u}
                  className={clsx("h-7 px-2.5", unit === u ? "bg-[var(--surface-2)] text-foreground" : "text-foreground/50 hover:text-foreground")}>
                  {u === "delta" ? "Delta $" : "Premium"}
                </button>
              ))}
            </div>
            <span className="text-foreground/40">{unit === "delta" ? "bought − sold delta $" : "bought − sold premium"} · <span className="text-warn">CW</span> call wall · <span className="text-warn">PW</span> put wall · <span className="text-warn">★</span> king</span>
          </div>

          {/* ladder */}
          <div className={clsx(GRID, "border-b border-[var(--border)] pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/40")}>
            <span className="col-span-2 text-right">Calls</span><span className="text-center">Strike</span><span className="col-span-2">Puts</span>
          </div>
          {rows.map((r, i) => {
            const c = val(r, "call"), p = val(r, "put");
            const m = marks(r.strike);
            return (
              <div key={r.strike}>
                {i === spotIdx && d.spot != null && (
                  <div className="my-0.5 flex items-center gap-2 font-mono text-[10.5px] text-foreground">
                    <span className="h-px flex-1 bg-foreground/50" />spot {d.spot.toFixed(2)}<span className="h-px flex-1 bg-foreground/50" />
                  </div>
                )}
                <div className={clsx(GRID, "items-center py-[3px] font-mono text-[11.5px] tabular-nums")}
                  title={`${r.strike}: calls bought ${plain(r.call_bought)} · sold ${plain(r.call_sold)} · Δ$ ${money(r.call_delta)}\nputs bought ${plain(r.put_bought)} · sold ${plain(r.put_sold)} · Δ$ ${money(r.put_delta)}`}>
                  <Bar v={c} max={max} dir="left" />
                  <span className={clsx("text-right text-[10.5px]", tone(c))}>{c ? money(c) : ""}</span>
                  <span className="text-center text-foreground">
                    {r.strike}{m && <span className="ml-1 text-[9.5px] text-warn">{m}</span>}
                  </span>
                  <span className={clsx("text-[10.5px]", tone(p))}>{p ? money(p) : ""}</span>
                  <Bar v={p} max={max} dir="right" />
                </div>
              </div>
            );
          })}
          <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-foreground/50">
            Side comes from where the last trade printed between the bid and ask at each refresh, so a burst of trades
            between two refreshes all takes one side. Volume with no clear side (mid fills, volume from before the page
            first saw a contract) is left out. Delta is Black-Scholes at the time of each refresh.
          </p>
        </div>
      )}
    </DeskSection>
  );
}

const GRID = "grid grid-cols-[minmax(0,1fr)_56px_92px_56px_minmax(0,1fr)] gap-x-2";

/** One side of the ladder: the bar grows away from the strike column, green when it adds customer delta, red when it removes it. */
function Bar({ v, max, dir }: { v: number; max: number; dir: "left" | "right" }) {
  return (
    <div className={clsx("flex h-[10px]", dir === "left" && "justify-end")}>
      <div className={clsx("h-full", v > 0 ? "bg-gain/70" : v < 0 ? "bg-loss/70" : "")} style={{ width: `${Math.min(100, (Math.abs(v) / max) * 100)}%` }} />
    </div>
  );
}
