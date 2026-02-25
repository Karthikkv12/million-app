"use client";
import { BarChart2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { GexResult } from "@/lib/api";

interface Props {
  data: GexResult;
}

export function TopFlowStrikes({ data }: Props) {
  if (!data.top_flow_strikes || data.top_flow_strikes.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2 mb-2.5">
        <BarChart2 size={10} className="text-foreground/60" />
        <span className="text-[9px] text-foreground uppercase tracking-widest font-black">
          Top Flow Strikes
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {data.top_flow_strikes.slice(0, 5).map((tf) => {
          const total = Math.max(tf.call_prem + tf.put_prem, 1);
          const callPct = Math.round((tf.call_prem / total) * 100);
          const isCall = tf.bias === "call";

          return (
            <div key={tf.strike} className="flex items-center gap-2 text-[10px]">
              <span className="w-[52px] font-black tabular-nums text-white shrink-0">
                ${tf.strike.toFixed(0)}
              </span>
              <div className="flex-1 h-2 rounded-full overflow-hidden flex bg-[var(--border)] min-w-0">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-l-full"
                  style={{ width: `${callPct}%` }}
                />
                <div
                  className="h-full bg-gradient-to-l from-red-600 to-red-400 rounded-r-full"
                  style={{ width: `${100 - callPct}%` }}
                />
              </div>
              <span
                className={`shrink-0 font-black text-[8px] flex items-center gap-0.5 ${
                  isCall ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {isCall ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                {isCall ? "CALL" : "PUT"}
              </span>
              <span className="text-foreground/70 tabular-nums shrink-0 font-mono text-[9px]">
                ${(Math.abs(tf.net) / 1e6).toFixed(1)}M
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
