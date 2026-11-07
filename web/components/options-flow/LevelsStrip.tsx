"use client";
/** LevelsStrip — the at-a-glance row: spot, regime, flip, call wall, put wall. */
import type { GexResult } from "@/lib/api";
import { fmtGex } from "@/lib/gex";
import { Pill } from "@/components/ui";

function pct(level: number | null | undefined, spot: number): string {
  if (level == null || !spot) return "";
  const d = ((level - spot) / spot) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">{label}</div>
      <div className={`truncate font-mono text-[15px] font-medium leading-tight tabular-nums ${tone ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="font-mono text-[11px] tabular-nums text-foreground/50">{sub}</div>}
    </div>
  );
}

export function LevelsStrip({ data }: { data: GexResult }) {
  const { spot, zero_gamma, max_call_wall, max_put_wall, net_gex } = data;
  const longGamma = (net_gex ?? 0) >= 0;
  const aboveFlip = zero_gamma != null ? spot >= zero_gamma : null;
  const money = (v: number | null | undefined) => (v == null ? "—" : `$${v.toFixed(v % 1 === 0 ? 0 : 2)}`);

  return (
    <div className="border-b border-[var(--border)]">
      <div className="flex items-center justify-between gap-3 px-3 pt-2.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-2xl font-medium tracking-tight tabular-nums text-foreground">${spot.toFixed(2)}</span>
          {aboveFlip != null && (
            <span className="truncate text-[13px] text-foreground/55">
              {aboveFlip ? "above" : "below"} flip
            </span>
          )}
        </div>
        <span title={longGamma ? "Dealers net long gamma: tends to dampen moves" : "Dealers net short gamma: tends to amplify moves"}>
          <Pill tone={longGamma ? "good" : "warn"} className="normal-case tracking-normal">
            {longGamma ? "+GEX · Pinned" : "−GEX · Volatile"} {fmtGex(net_gex)}
          </Pill>
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
        <Stat label="Flip" value={money(zero_gamma)} sub={pct(zero_gamma, spot)} tone="text-accent" />
        <Stat label="Call wall" value={money(max_call_wall)} sub={pct(max_call_wall, spot)} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Put wall" value={money(max_put_wall)} sub={pct(max_put_wall, spot)} tone="text-red-600 dark:text-red-400" />
      </div>
    </div>
  );
}
