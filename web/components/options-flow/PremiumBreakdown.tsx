"use client";
/**
 * Flow → Premium, below the day chart: Overview · Strikes · Expiries, with 0DTE / OTM filters.
 * All from the chain snapshot (open interest × mid), so it is positioning, not individual prints; the labels say so.
 *  - Overview: Dealer Edge (spot, anchor, flip, spot vs flip, net GEX), premium totals, and premium by moneyness.
 *  - Strikes: where the premium sits; "OTM only" keeps call premium above the price and put premium below it.
 *  - Expiries: call, put and net premium per expiry; "0DTE" keeps today's expiry only.
 * Strike totals cover every expiry (the API sends them summed), so 0DTE applies to the Expiries view only.
 */
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import type { GexResult } from "@/lib/api";
import { isToday } from "@/lib/gex";
import { DealerEdge } from "@/components/chart/pulse/SidePanels";
import { Premium } from "./DetailsDrawer";

const money = (v?: number | null) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(0)}K` : `${s}$${a.toFixed(0)}`;
};
const pctOf = (k: number, spot: number) => (spot ? (k / spot - 1) * 100 : 0);
const daysTo = (exp: string) => Math.max(0, Math.round((new Date(exp + "T16:00:00").getTime() - Date.now()) / 86_400_000));

type Tab = "overview" | "strikes" | "expiries";

const BUCKETS = [
  { id: "deepItm", label: "Deep ITM", note: "> 5% in the money", test: (m: number) => m < -5 },
  { id: "itm", label: "ITM", note: "1–5% in the money", test: (m: number) => m >= -5 && m < -1 },
  { id: "atm", label: "ATM", note: "within 1%", test: (m: number) => m >= -1 && m <= 1 },
  { id: "otm", label: "OTM", note: "1–5% out of the money", test: (m: number) => m > 1 && m <= 5 },
  { id: "farOtm", label: "Far OTM", note: "> 5% out of the money", test: (m: number) => m > 5 },
] as const;

/** Moneyness from the holder's side: positive = out of the money (calls above the price, puts below it). */
const callMoney = (k: number, spot: number) => pctOf(k, spot);
const putMoney = (k: number, spot: number) => -pctOf(k, spot);

function Toggle({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button onClick={onClick} aria-pressed={on} title={title}
      className={clsx("rounded-md border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] transition",
        on ? "border-foreground bg-foreground text-[var(--background)]" : "border-[var(--border)] text-foreground/60 hover:text-foreground")}>
      {children}
    </button>
  );
}

function Split({ call, put }: { call: number; put: number }) {
  const t = call + put || 1;
  return (
    <span className="flex h-2 w-full overflow-hidden bg-foreground/[0.06]">
      <span className="bg-gain/75" style={{ width: `${(call / t) * 100}%` }} />
      <span className="bg-loss/75" style={{ width: `${(put / t) * 100}%` }} />
    </span>
  );
}

function Moneyness({ d, otmOnly }: { d: GexResult; otmOnly: boolean }) {
  const rows = useMemo(() => BUCKETS.map((b) => {
    let call = 0, put = 0;
    for (const s of d.top_flow_strikes ?? []) {
      if (b.test(callMoney(s.strike, d.spot))) call += s.call_prem;
      if (b.test(putMoney(s.strike, d.spot))) put += s.put_prem;
    }
    return { ...b, call, put };
  }).filter((b) => !otmOnly || b.id === "otm" || b.id === "farOtm"), [d, otmOnly]);
  const max = Math.max(1, ...rows.map((r) => r.call + r.put));
  if (!(d.top_flow_strikes ?? []).length) return <p className="text-[13px] text-foreground/55">No strike data.</p>;
  return (
    <div className="grid gap-1.5">
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[88px_minmax(0,1fr)_70px_70px] items-center gap-3 font-mono text-[12.5px] tabular-nums">
          <span className="text-foreground" title={r.note}>{r.label}</span>
          <span className="block" style={{ width: `${((r.call + r.put) / max) * 100}%`, minWidth: 4 }}><Split call={r.call} put={r.put} /></span>
          <span className="text-right text-gain/90">{money(r.call)}</span>
          <span className="text-right text-loss/90">{money(r.put)}</span>
        </div>
      ))}
      <p className="mt-1.5 text-[12px] text-foreground/45">From each side&apos;s view: OTM calls are above the price, OTM puts below. Covers the top strikes the server sends (±30% of the price).</p>
    </div>
  );
}

export function PremiumBreakdown({ d }: { d: GexResult }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [zeroDte, setZeroDte] = useState(false);
  const [otm, setOtm] = useState(false);

  const strikes = useMemo(() => (d.top_flow_strikes ?? []).map((s) => {
    const call = otm && s.strike <= d.spot ? 0 : s.call_prem;
    const put = otm && s.strike >= d.spot ? 0 : s.put_prem;
    return { ...s, call, put, net: call - put };
  }).filter((s) => s.call + s.put > 0), [d, otm]);

  const expiries = useMemo(() => (d.flow_by_expiry ?? []).filter((e) => !zeroDte || isToday(e.expiry)), [d, zeroDte]);
  const hasToday = (d.flow_by_expiry ?? []).some((e) => isToday(e.expiry));
  const maxExp = Math.max(1, ...expiries.map((e) => e.call_prem + e.put_prem));
  const maxStrike = Math.max(1, ...strikes.map((x) => x.call + x.put));
  const sum = (k: "call" | "put") => strikes.reduce((a, s) => a + s[k], 0);

  return (
    <section className="border-t border-[var(--border-strong)] py-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div role="tablist" aria-label="Premium view" className="flex gap-5">
          {([["overview", "Overview"], ["strikes", "Strikes"], ["expiries", "Expiries"]] as const).map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={clsx("-mb-px border-b-2 pb-1.5 font-mono text-[11px] uppercase tracking-[0.14em]", tab === t ? "border-foreground text-foreground" : "border-transparent text-foreground/45 hover:text-foreground")}>{l}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Toggle on={zeroDte} onClick={() => setZeroDte((v) => !v)} title={hasToday ? "Today's expiry only (Expiries view)" : "No expiry today for this ticker"}>0DTE</Toggle>
          <Toggle on={otm} onClick={() => setOtm((v) => !v)} title="Calls above the price and puts below it only">OTM</Toggle>
        </div>
      </div>
      <p className="mb-4 text-[12px] text-foreground/45">Positioning from the option chain (open interest × mid), not individual trades.</p>

      {tab === "overview" && (
        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div>
            <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-foreground">Dealer edge</h3>
            <DealerEdge gex={d} />
          </div>
          <div className="min-w-0">
            <div className="[&_section]:border-0 [&_section]:p-0"><Premium d={d} /></div>
            <h3 className="mb-2 mt-6 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-foreground">By moneyness</h3>
            <Moneyness d={d} otmOnly={otm} />
          </div>
        </div>
      )}

      {tab === "strikes" && (strikes.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] font-mono text-[12.5px] tabular-nums">
            <thead>
              <tr className="border-b border-[var(--border-strong)] text-left text-[9.5px] uppercase tracking-[0.14em] text-foreground/45">
                <th className="pb-1.5 font-normal">Strike</th><th className="pb-1.5 text-right font-normal">vs spot</th>
                <th className="pb-1.5 pl-4 font-normal">Calls · puts</th>
                <th className="pb-1.5 text-right font-normal">Calls</th><th className="pb-1.5 text-right font-normal">Puts</th><th className="pb-1.5 text-right font-normal">Net</th>
              </tr>
            </thead>
            <tbody>
              {[...strikes].sort((a, b) => b.strike - a.strike).map((s) => (
                <tr key={s.strike} className={clsx("border-b border-[var(--border)] last:border-0", Math.abs(pctOf(s.strike, d.spot)) < 0.5 && "bg-foreground/[0.04]")}>
                  <td className="py-1.5 text-foreground">{s.strike}</td>
                  <td className="py-1.5 text-right text-foreground/50">{pctOf(s.strike, d.spot) >= 0 ? "+" : ""}{pctOf(s.strike, d.spot).toFixed(1)}%</td>
                  <td className="w-[30%] py-1.5 pl-4"><span className="block" style={{ width: `${((s.call + s.put) / maxStrike) * 100}%`, minWidth: 4 }}><Split call={s.call} put={s.put} /></span></td>
                  <td className="py-1.5 text-right text-gain/90">{money(s.call)}</td>
                  <td className="py-1.5 text-right text-loss/90">{money(s.put)}</td>
                  <td className={clsx("py-1.5 text-right", s.net >= 0 ? "text-gain" : "text-loss")}>{money(s.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--border-strong)] text-foreground/70">
                <td className="pt-2" colSpan={3}>Total{otm ? " (OTM)" : ""}{zeroDte ? <span className="ml-2 text-[11px] text-foreground/45">all expiries: strike totals aren&apos;t split by expiry</span> : null}</td>
                <td className="pt-2 text-right text-gain">{money(sum("call"))}</td>
                <td className="pt-2 text-right text-loss">{money(sum("put"))}</td>
                <td className={clsx("pt-2 text-right", sum("call") >= sum("put") ? "text-gain" : "text-loss")}>{money(sum("call") - sum("put"))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : <p className="text-[13px] text-foreground/55">No strikes match.</p>)}

      {tab === "expiries" && (expiries.length ? (
        <div className="grid gap-1.5">
          {expiries.map((e) => (
            <div key={e.expiry} className="grid grid-cols-[92px_38px_minmax(0,1fr)_72px_72px_76px] items-center gap-3 font-mono text-[12.5px] tabular-nums max-sm:grid-cols-[80px_minmax(0,1fr)_72px]">
              <span className="text-foreground">{e.expiry.slice(5)}{isToday(e.expiry) && <span className="ml-1 text-[10px] text-warn">0DTE</span>}</span>
              <span className="text-foreground/45 max-sm:hidden">{daysTo(e.expiry)}d</span>
              <span className="block" style={{ width: `${((e.call_prem + e.put_prem) / maxExp) * 100}%`, minWidth: 4 }}><Split call={e.call_prem} put={e.put_prem} /></span>
              <span className="text-right text-gain/90 max-sm:hidden">{money(e.call_prem)}</span>
              <span className="text-right text-loss/90 max-sm:hidden">{money(e.put_prem)}</span>
              <span className={clsx("text-right", e.net >= 0 ? "text-gain" : "text-loss")}>{money(e.net)}</span>
            </div>
          ))}
          <p className="mt-1.5 text-[12px] text-foreground/45">Bar: call (green) and put (red) premium; right: net = calls − puts.{otm ? " OTM doesn't apply here: expiry totals aren't split by strike." : ""}</p>
        </div>
      ) : <p className="text-[13px] text-foreground/55">{zeroDte ? "No expiry today for this ticker." : "No expiry data."}</p>)}
    </section>
  );
}
