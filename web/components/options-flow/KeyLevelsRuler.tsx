"use client";
import { Target } from "lucide-react";
import { GexResult } from "@/lib/api";

interface Props {
  data: GexResult;
}

export function KeyLevelsRuler({ data }: Props) {
  const { spot, zero_gamma, max_call_wall, max_put_wall } = data;

  type Level = { label: string; value: number; color: string };
  const levels: Level[] = [];
  if (max_put_wall  != null) levels.push({ label: "Put Wall",  value: max_put_wall,  color: "#ef4444" });
  if (zero_gamma    != null) levels.push({ label: "Zero γ",    value: zero_gamma,    color: "#f59e0b" });
  if (spot          != null) levels.push({ label: "Spot",      value: spot,          color: "#f9fafb" });
  if (max_call_wall != null) levels.push({ label: "Call Wall", value: max_call_wall, color: "#22c55e" });

  levels.sort((a, b) => a.value - b.value);
  if (levels.length < 2) return null;

  const lo    = levels[0].value;
  const hi    = levels[levels.length - 1].value;
  const range = hi - lo || 1;
  const pct   = (v: number) => ((v - lo) / range) * 100;

  return (
    <div className="px-4 py-3 border-b border-[var(--border)]">
      {/* header */}
      <div className="flex items-center gap-2 mb-4">
        <Target size={10} className="text-foreground/60" />
        <span className="text-[9px] text-foreground uppercase tracking-widest font-black">
          Key Levels Ruler
        </span>
        <span className="text-[8px] text-foreground/50 ml-auto">
          Put Wall → Spot → Call Wall
        </span>
      </div>

      {/* ruler track */}
      <div className="relative h-10 mb-6">
        {/* gradient fill between put wall and call wall */}
        <div className="absolute top-1/2 left-0 right-0 h-1.5 -translate-y-1/2 rounded-full bg-[var(--surface-2)] overflow-hidden">
          {max_put_wall != null && max_call_wall != null && (
            <div
              className="absolute h-full rounded-full opacity-20"
              style={{
                left:  `${pct(max_put_wall)}%`,
                width: `${pct(max_call_wall) - pct(max_put_wall)}%`,
                background: "linear-gradient(90deg, #ef4444, #22c55e)",
              }}
            />
          )}
        </div>

        {/* pins */}
        {levels.map((lv) => (
          <div
            key={lv.label}
            className="absolute -translate-x-1/2"
            style={{ left: `${pct(lv.value)}%`, top: 0 }}
          >
            <div
              className="w-3 h-3 rounded-full border-2 mx-auto"
              style={{
                background: lv.color,
                borderColor: "var(--surface)",
              }}
            />
            <div className="text-center mt-1">
              <p className="text-[8px] font-bold whitespace-nowrap" style={{ color: lv.color }}>
                {lv.label}
              </p>
              <p
                className="text-[9px] font-black tabular-nums"
                style={{ color: lv.color }}
              >
                ${lv.value.toFixed(0)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
