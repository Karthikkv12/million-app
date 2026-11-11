"use client";
/** LevelsStrip — desk style: big spot, regime tag, then flip · call wall · put wall · king · net exposure. */
import type { GexResult } from "@/lib/api";
import { ANCHOR_TONE, anchorOf, fmtGex, shortExpiry } from "@/lib/gex";
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

/** `compact`: a narrow board column (2–3 tickers side by side). Six figures in one row leave ~55 px each, which cut
 *  values to "680…"; compact always lays them out 3 × 2 so every number shows in full. */
export function LevelsStrip({ data, metric = "gex", compact = false }: { data: GexResult; metric?: "gex" | "vex"; compact?: boolean }) {
  const { spot, zero_gamma, max_call_wall, max_put_wall, max_gex_strike, net_gex } = data;
  const longGamma = (net_gex ?? 0) >= 0;
  const aboveFlip = zero_gamma != null ? spot >= zero_gamma : null;
  const anchor = anchorOf(data);
  return (
    <div className="px-4 pb-3 pt-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[30px] font-medium leading-none tracking-[-0.03em] tabular-nums text-foreground">{spot.toFixed(2)}</span>
        {aboveFlip != null && <span className="text-[12.5px] text-foreground/55">{aboveFlip ? "above" : "below"} the flip</span>}
        <span className="ml-auto" title={longGamma ? "Dealers net long gamma: tends to dampen moves" : "Dealers net short gamma: tends to amplify moves"}>
          <Tag tone={longGamma ? "gain" : "warn"}>{longGamma ? "+GEX · pinned" : "−GEX · volatile"}</Tag>
        </span>
      </div>
      <div className={clsx("mt-3 grid grid-cols-3 divide-x divide-[var(--border)]",
        compact ? "gap-y-2.5 [&>*:nth-child(3n+1)]:border-l-0 [&>*:nth-child(3n+1)]:pl-0" : "sm:grid-cols-6")}>
        <Fig label="Flip" value={money(zero_gamma)} sub={pct(zero_gamma, spot)} tone="text-accent" />
        <Fig label="Call wall" value={money(max_call_wall)} sub={pct(max_call_wall, spot)} tone="text-gain" />
        <Fig label="Put wall" value={money(max_put_wall)} sub={pct(max_put_wall, spot)} tone="text-loss" />
        <Fig className={compact ? undefined : "hidden sm:block"} label="★ King" value={money(max_gex_strike)} sub={pct(max_gex_strike, spot)} tone="text-[#b45309] dark:text-[#fde725]" />
        <Fig className={compact ? undefined : "hidden sm:block"} label="⚓ Anchor" value={anchor ? anchor.price.toFixed(2) : "—"}
          sub={anchor ? `${pct(anchor.price, spot)} · ${shortExpiry(anchor.expiry)}` : "no pin"} tone={ANCHOR_TONE}
          title={anchor ? `Gamma-weighted centre of positive GEX within 10% of the price, ${anchor.expiry} expiry (${Math.round(anchor.share * 100)}% of gamma there is positive). Where long-gamma dealers tend to pull the price.`
            : "Positive gamma doesn't dominate near the price in the nearest expiry, so there is no pin level."} />
        {metric === "vex"
          ? <Fig className={compact ? undefined : "hidden sm:block"} label="Net VEX" value={fmtGex(data.net_vex)} sub="per 1 vol pt" tone={(data.net_vex ?? 0) >= 0 ? "text-gain" : "text-loss"} />
          : <Fig className={compact ? undefined : "hidden sm:block"} label="Net GEX" value={fmtGex(net_gex)} sub="per 1% move" tone={longGamma ? "text-gain" : "text-loss"} />}
      </div>
    </div>
  );
}
