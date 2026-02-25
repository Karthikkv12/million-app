"use client";
import { Activity } from "lucide-react";
import { GexResult } from "@/lib/api";

interface Props {
  data: GexResult;
}

export function GammaConcentration({ data }: Props) {
  const strikeWeights = (data.heatmap_strikes ?? [])
    .map((strike, si) => {
      const totalAbs = (data.heatmap_values ?? []).reduce(
        (acc, row) => acc + Math.abs(row[si] ?? 0),
        0,
      );
      return { strike, weight: totalAbs / 1e9 };
    })
    .filter((r) => r.weight > 0)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 16)
    .sort((a, b) => a.strike - b.strike);

  if (!strikeWeights.length) return null;

  const max = Math.max(...strikeWeights.map((r) => r.weight), 1);

  return (
    <div className="px-4 py-3 border-b border-[var(--border)]">
      {/* header */}
      <div className="flex items-center gap-2 mb-3">
        <Activity size={10} className="text-foreground/60" />
        <span className="text-[9px] text-foreground uppercase tracking-widest font-black">
          Gamma Concentration
        </span>
        <span className="text-[8px] text-foreground/50 ml-auto">
          Total |GEX| across all expiries
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {strikeWeights.map((r) => {
          const isSpot =
            data.spot != null && Math.abs(r.strike - data.spot) < 1;
          const pct = (r.weight / max) * 100;
          return (
            <div key={r.strike} className="flex items-center gap-2.5">
              <span
                className={`text-[10px] font-bold tabular-nums w-14 text-right shrink-0 ${
                  isSpot ? "text-amber-400" : "text-foreground/80"
                }`}
              >
                ${r.strike}
              </span>
              <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: isSpot ? "#f59e0b" : "var(--foreground)",
                    opacity: isSpot ? 1 : 0.45,
                  }}
                />
              </div>
              <span className="text-[9px] text-foreground/60 tabular-nums w-14 shrink-0 text-right font-mono">
                {r.weight.toFixed(2)}B
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
