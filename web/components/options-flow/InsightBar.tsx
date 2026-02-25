"use client";
import { TrendingUp, TrendingDown } from "lucide-react";
import { GexResult } from "@/lib/api";

interface Props {
  data: GexResult;
}

export function InsightBar({ data }: Props) {
  const netGex = data.net_gex ?? 0;
  const isCallBias = netGex >= 0;

  if (
    data.spot == null ||
    data.max_call_wall == null ||
    data.max_put_wall == null
  ) {
    return null;
  }

  return (
    <div
      className={`px-4 py-2.5 border-b border-[var(--border)] ${
        isCallBias ? "bg-emerald-500/[0.04]" : "bg-red-500/[0.04]"
      }`}
    >
      <div className="flex items-center gap-2 text-[10px] text-foreground/80">
        {isCallBias ? (
          <TrendingDown size={11} className="text-emerald-400 shrink-0" />
        ) : (
          <TrendingUp size={11} className="text-red-400 shrink-0" />
        )}
        <span>
          Price{" "}
          <strong className="text-foreground">
            {data.spot > data.zero_gamma! ? "above" : "below"} zero-gamma
          </strong>{" "}
          — dealers{" "}
          {isCallBias
            ? "hedge by selling rallies & buying dips"
            : "amplify moves (trending mode)"}
          {data.max_call_wall && data.spot < data.max_call_wall && (
            <span className="ml-2 text-emerald-400">
              · Resistance <strong>${data.max_call_wall.toFixed(0)}</strong>
            </span>
          )}
          {data.max_put_wall && data.spot > data.max_put_wall && (
            <span className="ml-2 text-red-400">
              · Support <strong>${data.max_put_wall.toFixed(0)}</strong>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
