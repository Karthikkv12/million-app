"use client";
/** LevelsStrip — desk style: big spot, regime tag, then call wall · put wall · net exposure. */
import type { GexResult } from "@/lib/api";
import { fmtGex } from "@/lib/gex";
import { clsx } from "clsx";
import { Tag } from "@/components/desk";

function pct(level: number | null | undefined, spot: number): string {
  if (level == null || !spot) return "";
  const d = ((level - spot) / spot) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
}
const money = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(v % 1 === 0 ? 0 : 2));

function Fig({ label, value, sub, tone, className, title }: { label: string; value: string; sub?: string; tone?: string; className?: string; title?: string }) {
  return (
    <div className={clsx("min-w-0 px-3 py-0.5 first:pl-0", className)} title={title}>
      <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-foreground/45">{label}</p>
      <p className={clsx("truncate font-mono text-[15px] font-medium tabular-nums leading-tight", tone ?? "text-foreground")}>{value}</p>
      {sub && <p className="font-mono text-[10.5px] tabular-nums text-foreground/45">{sub}</p>}
    </div>
  );
}

/** Three numbers only (owner, 2026-11-12): call wall, put wall, net exposure. Flip, King, Anchor and the battleground
 *  are marked on the heatmap rows and the dealer ladder instead, so the strip isn't crowded in narrow columns. */
export function LevelsStrip({ data, metric = "gex" }: { data: GexResult; metric?: "gex" | "vex" }) {
  const { spot, zero_gamma, max_call_wall, max_put_wall, net_gex } = data;
  const longGamma = (net_gex ?? 0) >= 0;
  const aboveFlip = zero_gamma != null ? spot >= zero_gamma : null;
  return (
    <div className="px-4 pb-3 pt-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[30px] font-medium leading-none tracking-[-0.03em] tabular-nums text-foreground">{spot.toFixed(2)}</span>
        {aboveFlip != null && <span className="text-[12.5px] text-foreground/55">{aboveFlip ? "above" : "below"} the flip</span>}
        <span className="ml-auto" title={longGamma ? "Dealers net long gamma: tends to dampen moves" : "Dealers net short gamma: tends to amplify moves"}>
          <Tag tone={longGamma ? "gain" : "warn"}>{longGamma ? "+GEX · pinned" : "−GEX · volatile"}</Tag>
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-[var(--border)]">
        <Fig label="Call wall" value={money(max_call_wall)} sub={pct(max_call_wall, spot)} tone="text-gain" />
        <Fig label="Put wall" value={money(max_put_wall)} sub={pct(max_put_wall, spot)} tone="text-loss" />
        {metric === "vex"
          ? <Fig label="Net VEX" value={fmtGex(data.net_vex)} sub="per 1 vol pt" tone={(data.net_vex ?? 0) >= 0 ? "text-gain" : "text-loss"} />
          : <Fig label="Net GEX" value={fmtGex(net_gex)} sub="per 1% move" tone={longGamma ? "text-gain" : "text-loss"} />}
      </div>
    </div>
  );
}
