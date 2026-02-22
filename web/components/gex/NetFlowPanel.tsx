"use client";

import React, { useMemo } from "react";
import { GexResult, FlowByExpiry, TopFlowStrike } from "@/lib/api";

interface Props {
  data: GexResult;
  accentColor?: string;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function NetFlowPanel({ data }: Props) {
  const { call_premium = 0, put_premium = 0, net_flow = 0, flow_by_expiry = [], top_flow_strikes = [] } = data;

  const total = call_premium + put_premium;
  const callPct = total > 0 ? (call_premium / total) * 100 : 50;
  const putPct = 100 - callPct;
  const isCallBias = net_flow >= 0;

  const nearExpiries: FlowByExpiry[] = useMemo(() => {
    return [...flow_by_expiry]
      .sort((a, b) => a.expiry.localeCompare(b.expiry))
      .slice(0, 8);
  }, [flow_by_expiry]);

  const maxExpPrem = useMemo(() => {
    return Math.max(...nearExpiries.map((e) => e.call_prem + e.put_prem), 1);
  }, [nearExpiries]);

  const sortedStrikes: TopFlowStrike[] = useMemo(() => {
    return [...top_flow_strikes].sort(
      (a, b) => b.call_prem + b.put_prem - (a.call_prem + a.put_prem)
    );
  }, [top_flow_strikes]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/80 tracking-wide uppercase">
          Net Options Flow
        </h3>
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            isCallBias
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-red-500/20 text-red-400"
          }`}
        >
          {isCallBias ? "▲ CALL BIAS" : "▼ PUT BIAS"}
        </span>
      </div>

      {/* Total premium row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2">
          <p className="text-[10px] text-emerald-400/70 uppercase font-semibold mb-0.5">Call Premium</p>
          <p className="text-sm font-bold text-emerald-400">{fmt(call_premium)}</p>
        </div>
        <div
          className={`rounded-lg border p-2 ${
            isCallBias
              ? "bg-emerald-500/10 border-emerald-500/20"
              : "bg-red-500/10 border-red-500/20"
          }`}
        >
          <p className={`text-[10px] uppercase font-semibold mb-0.5 ${isCallBias ? "text-emerald-400/70" : "text-red-400/70"}`}>
            Net Flow
          </p>
          <p className={`text-sm font-bold ${isCallBias ? "text-emerald-400" : "text-red-400"}`}>
            {fmt(net_flow)}
          </p>
        </div>
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2">
          <p className="text-[10px] text-red-400/70 uppercase font-semibold mb-0.5">Put Premium</p>
          <p className="text-sm font-bold text-red-400">{fmt(put_premium)}</p>
        </div>
      </div>

      {/* Call / Put split bar */}
      <div>
        <div className="flex justify-between text-[10px] text-white/50 mb-1">
          <span>Calls {callPct.toFixed(1)}%</span>
          <span>Puts {putPct.toFixed(1)}%</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex">
          <div
            className="bg-emerald-500 transition-all duration-500"
            style={{ width: `${callPct}%` }}
          />
          <div
            className="bg-red-500 transition-all duration-500"
            style={{ width: `${putPct}%` }}
          />
        </div>
      </div>

      {/* Flow by expiry */}
      {nearExpiries.length > 0 && (
        <div>
          <p className="text-[10px] text-white/40 uppercase font-semibold mb-2">
            Flow by Expiry (nearest {nearExpiries.length})
          </p>
          <div className="space-y-1.5">
            {nearExpiries.map((row) => {
              const rowTotal = row.call_prem + row.put_prem;
              const cPct = (row.call_prem / maxExpPrem) * 100;
              const pPct = (row.put_prem / maxExpPrem) * 100;
              return (
                <div key={row.expiry} className="flex items-center gap-2">
                  <span className="text-[10px] text-white/50 w-16 shrink-0 tabular-nums">
                    {row.expiry}
                  </span>
                  <div className="flex-1 flex flex-col gap-0.5">
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500/70 rounded-full"
                        style={{ width: `${cPct}%` }}
                      />
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500/70 rounded-full"
                        style={{ width: `${pPct}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-white/40 w-14 text-right tabular-nums shrink-0">
                    {fmt(rowTotal)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top flow strikes table */}
      {sortedStrikes.length > 0 && (
        <div>
          <p className="text-[10px] text-white/40 uppercase font-semibold mb-2">
            Top Flow Strikes
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-white/40 border-b border-white/10">
                  <th className="text-left py-1 pr-2 font-medium">Strike</th>
                  <th className="text-right py-1 pr-2 font-medium text-emerald-400/60">Call $</th>
                  <th className="text-right py-1 pr-2 font-medium text-red-400/60">Put $</th>
                  <th className="text-right py-1 pr-2 font-medium">Net</th>
                  <th className="text-center py-1 font-medium">Bias</th>
                </tr>
              </thead>
              <tbody>
                {sortedStrikes.map((s) => (
                  <tr
                    key={s.strike}
                    className="border-b border-white/5 hover:bg-white/5 transition-colors"
                  >
                    <td className="py-1 pr-2 font-semibold text-white/80 tabular-nums">
                      {s.strike.toLocaleString()}
                    </td>
                    <td className="py-1 pr-2 text-right text-emerald-400 tabular-nums">
                      {fmt(s.call_prem)}
                    </td>
                    <td className="py-1 pr-2 text-right text-red-400 tabular-nums">
                      {fmt(s.put_prem)}
                    </td>
                    <td
                      className={`py-1 pr-2 text-right tabular-nums font-medium ${
                        s.net >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {fmt(s.net)}
                    </td>
                    <td className="py-1 text-center">
                      <span
                        className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          s.bias === "call"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {s.bias.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
