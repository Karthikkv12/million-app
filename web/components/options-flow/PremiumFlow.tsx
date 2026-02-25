"use client";
import { Zap } from "lucide-react";
import { GexResult } from "@/lib/api";

interface Props {
  data: GexResult;
}

export function PremiumFlow({ data }: Props) {
  const callPrem = data.call_premium ?? 0;
  const putPrem = data.put_premium ?? 0;

  if (callPrem === 0 && putPrem === 0) return null;

  const total = callPrem + putPrem;
  const callPct = Math.round((callPrem / total) * 100);
  const putPct = 100 - callPct;
  const pcRatio = putPrem / Math.max(callPrem, 1);

  return (
    <div className="px-4 py-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={10} className="text-foreground/60" />
        <span className="text-[9px] text-foreground uppercase tracking-widest font-black">
          Premium Flow
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Call premium bar */}
        <div className="flex-1">
          <div className="flex justify-between mb-1.5">
            <span className="text-[9px] text-emerald-400 font-black uppercase tracking-wide">
              Calls
            </span>
            <span className="text-[10px] font-black text-emerald-400 tabular-nums">
              ${(callPrem / 1e6).toFixed(1)}M
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-sm"
              style={{ width: `${callPct}%` }}
            />
          </div>
        </div>

        {/* P/C ratio badge */}
        <div className="flex flex-col items-center px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] shrink-0">
          <span className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold">
            P/C
          </span>
          <span
            className={`text-[15px] font-black tabular-nums leading-none mt-0.5 ${
              pcRatio > 1 ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {pcRatio.toFixed(2)}
          </span>
        </div>

        {/* Put premium bar */}
        <div className="flex-1">
          <div className="flex justify-between mb-1.5">
            <span className="text-[9px] text-red-400 font-black uppercase tracking-wide">
              Puts
            </span>
            <span className="text-[10px] font-black text-red-400 tabular-nums">
              ${(putPrem / 1e6).toFixed(1)}M
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-400 shadow-sm"
              style={{ width: `${putPct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
