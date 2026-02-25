"use client";
import { GexResult } from "@/lib/api";
import { fmtGex } from "@/lib/gex";
import { GexRegimeBadge } from "./GexRegimeBadge";

interface Props {
  data: GexResult;
  ticker: string;
}

export function GexKeyLevels({ data, ticker }: Props) {
  const netGex = data.net_gex ?? 0;
  const isCallBias = netGex >= 0;

  const impliedMove =
    data.spot && data.zero_gamma
      ? Math.abs(((data.zero_gamma - data.spot) / data.spot) * 100)
      : null;

  return (
    <div className="px-4 pt-4 pb-3 border-b border-[var(--border)]">
      {/* Spot price + regime row */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] font-black tabular-nums text-[var(--foreground)] leading-none">
            {data.spot != null ? `$${data.spot.toFixed(2)}` : "—"}
          </span>
          <span className="text-[11px] text-foreground font-bold tracking-wide">
            {ticker}
          </span>
        </div>
        <GexRegimeBadge netGex={netGex} />
        {impliedMove != null && (
          <span className="text-[9px] text-foreground border border-foreground/20 rounded-full px-2.5 py-1 font-bold tracking-wide">
            {impliedMove.toFixed(1)}% to zero-γ
          </span>
        )}
      </div>

      {/* Key level cards */}
      <div className="grid grid-cols-5 gap-2">
        {/* Net GEX */}
        <div
          className={`rounded-xl border px-2.5 py-2 ${
            isCallBias
              ? "bg-emerald-500/5 border-emerald-500/20"
              : "bg-red-500/5 border-red-500/20"
          }`}
        >
          <p className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold mb-1">
            Net GEX
          </p>
          <p
            className={`text-[13px] font-black tabular-nums leading-none ${
              isCallBias ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {fmtGex(netGex)}
          </p>
        </div>

        {/* Zero Gamma */}
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-2.5 py-2">
          <p className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold mb-1">
            Zero γ
          </p>
          <p className="text-[13px] font-black tabular-nums text-yellow-400 leading-none">
            {data.zero_gamma != null ? `$${data.zero_gamma.toFixed(0)}` : "—"}
          </p>
        </div>

        {/* Call Wall */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
          <p className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold mb-1">
            Call Wall
          </p>
          <p className="text-[13px] font-black tabular-nums text-emerald-400 leading-none">
            {data.max_call_wall != null ? `$${data.max_call_wall.toFixed(0)}` : "—"}
          </p>
        </div>

        {/* Put Wall */}
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-2.5 py-2">
          <p className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold mb-1">
            Put Wall
          </p>
          <p className="text-[13px] font-black tabular-nums text-red-400 leading-none">
            {data.max_put_wall != null ? `$${data.max_put_wall.toFixed(0)}` : "—"}
          </p>
        </div>

        {/* Max GEX */}
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 px-2.5 py-2">
          <p className="text-[8px] text-foreground/70 uppercase tracking-widest font-bold mb-1">
            Max GEX
          </p>
          <p className="text-[13px] font-black tabular-nums text-purple-400 leading-none">
            {data.max_gex_strike != null ? `$${data.max_gex_strike.toFixed(0)}` : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
