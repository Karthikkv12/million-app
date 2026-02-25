"use client";
import { Activity } from "lucide-react";
import { GexResult } from "@/lib/api";
import { isToday } from "@/lib/gex";

interface Props {
  data: GexResult;
}

export function FlowByExpiry({ data }: Props) {
  if (!data.flow_by_expiry || data.flow_by_expiry.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
      <div className="flex items-center gap-2 mb-2.5">
        <Activity size={10} className="text-foreground/60" />
        <span className="text-[9px] text-foreground uppercase tracking-widest font-black">
          Flow by Expiry
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
        {data.flow_by_expiry.slice(0, 6).map((fe) => {
          const isPos = fe.net >= 0;
          const dte0 = isToday(fe.expiry);

          return (
            <div
              key={fe.expiry}
              className={`flex items-center justify-between gap-2 px-2 py-1 rounded-lg ${
                dte0
                  ? "bg-amber-500/8 border border-amber-500/20"
                  : "bg-[var(--border)]/30"
              }`}
            >
              <span
                className={`text-[8px] font-mono truncate font-bold ${
                  dte0 ? "text-amber-400" : "text-foreground/70"
                }`}
              >
                {dte0 ? "⚡ 0DTE" : fe.expiry}
              </span>
              <span
                className={`text-[9px] font-black tabular-nums shrink-0 ${
                  isPos ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {isPos ? "+" : ""}
                {(fe.net / 1e6).toFixed(1)}M
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
