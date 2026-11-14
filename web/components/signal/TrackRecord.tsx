"use client";
/**
 * The live track record (GET /hedge/signal-log): every scanner Buy / Swing buy / Strong swing buy since logging began,
 * with what the stock did after, beside the backtest. A forward test on data no rule was fitted to.
 */
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { fetchSignalLog, SignalLog } from "@/lib/api";
import { Panel } from "@/components/ui";
import { Tag } from "@/components/desk";

const pct = (v?: number | null, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%`);
const NAME = { BUY: "Buy · 1–3 mo", SWING: "Swing buy", SWING_STRONG: "Strong swing" } as const;

export function TrackRecord() {
  const { data } = useQuery<SignalLog>({ queryKey: ["signal-log"], queryFn: () => fetchSignalLog(365), refetchInterval: 5 * 60_000 });
  const entries = (data?.entries ?? []).filter((e) => e.trigger === "close");
  return (
    <Panel title="Live track record" sub="Every scanner buy at the close since logging began: bought at the next open, after 0.2% costs">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="track-record">
        {(["BUY", "SWING", "SWING_STRONG"] as const).map((k) => {
          const s = data?.summary?.[k];
          const bt = k === "BUY" ? null : data?.backtest?.[k];
          return (
            <div key={k} className="rounded-md bg-[var(--surface-2)] px-3 py-2.5 font-mono text-[12px]">
              <p className="text-[10px] uppercase tracking-[0.12em] text-foreground/45">{NAME[k]}</p>
              <p className="mt-1 text-[18px] tabular-nums text-foreground">{s?.closed ? pct(s.avg, 2) : "—"}
                <span className="ml-2 text-[11px] text-foreground/45">{s?.closed ? `${Math.round((s.win ?? 0) * 100)}% won` : ""}</span></p>
              <p className="mt-0.5 text-[11px] text-foreground/50">
                {s ? `${s.signals} signals · ${s.closed} finished (${s.measure})` : "No signals logged yet"}
                {bt ? ` · backtest ${pct(bt.avg, 2)}, ${Math.round(bt.win * 100)}% won` : k === "BUY" ? " · backtest +3.6% vs holding" : ""}
              </p>
            </div>
          );
        })}
      </div>
      {entries.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] font-mono text-[12px] tabular-nums">
            <thead><tr className="text-[10px] uppercase tracking-[0.12em] text-foreground/45">
              <th className="py-1.5 pr-3 text-left font-normal">Day</th><th className="py-1.5 pr-3 text-left font-normal">Symbol</th>
              <th className="py-1.5 pr-3 text-left font-normal">Signal</th><th className="py-1.5 pr-3 text-right font-normal">Entry</th>
              <th className="py-1.5 pr-3 text-right font-normal">5 days</th><th className="py-1.5 pr-3 text-right font-normal">20 days</th>
              <th className="py-1.5 pr-3 text-right font-normal">Result</th>
            </tr></thead>
            <tbody>
              {entries.slice(0, 25).map((e) => {
                const res = e.kind === "BUY" ? e.r60 : e.swing_ret;
                return (
                  <tr key={`${e.day}-${e.symbol}-${e.kind}`} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-3 text-foreground/60">{e.day}</td>
                    <td className="py-1.5 pr-3 text-foreground">{e.symbol}</td>
                    <td className="py-1.5 pr-3"><Tag tone="gain">{NAME[e.kind]}</Tag></td>
                    <td className="py-1.5 pr-3 text-right">{e.entry != null ? e.entry.toFixed(2) : "next open"}</td>
                    <td className={clsx("py-1.5 pr-3 text-right", (e.r5 ?? 0) >= 0 ? "text-gain" : "text-loss")}>{pct(e.r5)}</td>
                    <td className={clsx("py-1.5 pr-3 text-right", (e.r20 ?? 0) >= 0 ? "text-gain" : "text-loss")}>{pct(e.r20)}</td>
                    <td className={clsx("py-1.5 pr-3 text-right", res == null ? "text-foreground/45" : res >= 0 ? "text-gain" : "text-loss")}>
                      {res == null ? "open" : `${pct(res)}${e.kind !== "BUY" && e.swing_days ? ` · ${e.swing_days}d` : ""}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11.5px] leading-snug text-foreground/45">
        Logged once a day after the close from the live scanner, so it starts empty and grows. Results use the backtest&apos;s rules: Buy is
        measured over 60 sessions, swing buys by the swing exit. A few weeks of signals are mostly one or two market moves; read it against
        the backtest only after several months.
      </p>
    </Panel>
  );
}
