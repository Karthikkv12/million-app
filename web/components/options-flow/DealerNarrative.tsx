"use client";
import { BookOpen } from "lucide-react";
import { GexResult } from "@/lib/api";
import { fmtGex } from "@/lib/gex";

interface Props {
  data: GexResult;
}

function fmt$(v: number | null | undefined): string {
  if (v == null) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function DealerNarrative({ data }: Props) {
  const {
    net_gex, spot, zero_gamma,
    max_call_wall, max_put_wall,
    call_premium = 0, put_premium = 0, net_flow = 0,
  } = data;

  const regime    = (net_gex ?? 0) >= 0 ? "long gamma" : "short gamma";
  const regimeCol = (net_gex ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";
  const netGexFmt = fmtGex(net_gex);
  const pcRatio   = call_premium > 0 ? (put_premium / call_premium).toFixed(2) : "N/A";
  const flowBias  = net_flow >= 0 ? "bullish (call-heavy)" : "bearish (put-heavy)";
  const flowCol   = net_flow >= 0 ? "text-emerald-400" : "text-red-400";
  const aboveZeroG   = zero_gamma != null && spot != null && spot > zero_gamma;
  const nearCallWall = max_call_wall != null && spot != null && (max_call_wall - spot) / spot < 0.02;
  const nearPutWall  = max_put_wall  != null && spot != null && (spot - max_put_wall)  / spot < 0.02;

  type Line = { text: string; highlight?: string; color?: string };
  const lines: Line[] = [
    {
      text: "Dealers are currently in ",
      highlight: regime,
      color: regimeCol,
    },
    ...(net_gex != null
      ? [{
          text: ` positioning (${netGexFmt} net GEX). ${
            (net_gex ?? 0) >= 0
              ? "In long gamma, dealers sell rallies & buy dips — acting as a market stabiliser."
              : "In short gamma, dealers amplify directional moves — buy rallies, sell dips."
          }`,
        }]
      : []),
    ...(zero_gamma != null && spot != null
      ? [{
          text: `Zero-gamma is ${fmt$(zero_gamma)} — spot is ${aboveZeroG ? "above" : "below"} it. ${
            aboveZeroG
              ? "Above zero-gamma, dealer hedging dampens price swings."
              : "Below zero-gamma, dealer hedging can amplify moves."
          }`,
        }]
      : []),
    ...(max_call_wall != null
      ? [{
          text: `Call wall at ${fmt$(max_call_wall)} acts as ceiling.${
            nearCallWall ? " ⚠️ Spot is approaching this wall." : ""
          }`,
        }]
      : []),
    ...(max_put_wall != null
      ? [{
          text: `Put wall at ${fmt$(max_put_wall)} acts as floor.${
            nearPutWall ? " ⚠️ Spot is near this support." : ""
          }`,
        }]
      : []),
    ...(call_premium > 0 || put_premium > 0
      ? [{
          text: `Overall flow is `,
          highlight: flowBias,
          color: flowCol,
        }, {
          text: ` — $${(call_premium / 1e6).toFixed(1)}M calls vs $${(put_premium / 1e6).toFixed(1)}M puts (P/C: ${pcRatio}).`,
        }]
      : []),
  ];

  return (
    <div className="px-4 py-3 border-b border-[var(--border)]">
      {/* header */}
      <div className="flex items-center gap-2 mb-3">
        <BookOpen size={10} className="text-foreground/60" />
        <span className="text-[9px] text-foreground uppercase tracking-widest font-black">
          Dealer Narrative
        </span>
      </div>

      <div className="space-y-1.5">
        {lines.map((ln, i) => (
          <p key={i} className="text-[11px] text-foreground/80 leading-relaxed">
            {ln.text}
            {ln.highlight && (
              <span className={`font-bold ${ln.color ?? ""}`}>{ln.highlight}</span>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}
