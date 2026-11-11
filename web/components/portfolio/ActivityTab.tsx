"use client";
import { useMemo, useState } from "react";
import { Panel, Segmented, SkeletonCard } from "@/components/ui";
import { NoData, signedUsd, TD, TH, tone, useActivity, usd } from "./broker";

const STRAT: Record<string, string> = { short_call: "Covered / short call", short_put: "Short put", long_call: "Long call", long_put: "Long put" };

export function ActivityTab() {
  const { data, isLoading } = useActivity();
  const [kind, setKind] = useState<"all" | "option_fill" | "realized">("all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => (data ?? []).filter((a) => (kind === "all" || a.kind === kind) && (!q || a.symbol.includes(q.toUpperCase()))), [data, kind, q]);
  if (isLoading) return <SkeletonCard rows={8} />;
  if (!data?.length) return <NoData what="activity" />;
  return (
    <Panel padded={false} title="Activity" sub={`${rows.length} of ${data.length}`} actions={
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol" className="h-8 w-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-[12px] uppercase text-foreground" />
        <Segmented value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "option_fill", label: "Fills" }, { value: "realized", label: "Closed" }]} />
      </div>
    }>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={TH}>When</th><th className={TH}>What</th><th className={`${TH} text-right`}>Qty</th>
              <th className={`${TH} text-right`}>Price</th><th className={`${TH} text-right`}>Cash / P&L</th><th className={TH}>Account</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const opt = a.kind === "option_fill";
              const what = opt
                ? `${a.side === "sell" ? "Sell" : "Buy"} to ${a.position_effect} ${a.symbol} ${a.strike}${a.option_type === "call" ? "C" : "P"} ${a.expiry}`
                : `Closed ${a.symbol}${a.side ? ` (${a.side})` : ""}`;
              const val = opt ? a.amount : a.realized_gain;
              return (
                <tr key={a.id} className="border-b border-[var(--border)] last:border-0">
                  <td className={`${TD} whitespace-nowrap text-foreground/60`}>{new Date(a.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td className={`${TD} font-sans text-[13px] text-foreground`}>{what}{opt && a.strategy && <span className="ml-2 text-[11px] text-foreground/45">{STRAT[a.strategy] ?? a.strategy}</span>}</td>
                  <td className={`sensitive ${TD} text-right text-foreground/70`}>{a.quantity}</td>
                  <td className={`${TD} text-right text-foreground/70`}>{usd(a.price)}</td>
                  <td className={`sensitive ${TD} text-right ${tone(val)}`}>{signedUsd(val)}</td>
                  <td className={`${TD} font-sans text-[12px] text-foreground/55`}>{a.account}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
