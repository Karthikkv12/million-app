"use client";
/** DetailsDrawer — slide-over with every secondary GEX / flow section for one ticker. */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { GexResult } from "@/lib/api";
import NetFlowPanel from "@/components/gex/NetFlowPanel";
import { InsightBar } from "./InsightBar";
import { KeyLevelsRuler } from "./KeyLevelsRuler";
import { GexProfileChart } from "./GexProfileChart";
import { GammaConcentration } from "./GammaConcentration";
import { DealerNarrative } from "./DealerNarrative";
import { PremiumFlow } from "./PremiumFlow";
import { TopFlowStrikes } from "./TopFlowStrikes";
import { FlowByExpiry } from "./FlowByExpiry";
import { FlowMomentumChart } from "./FlowMomentumChart";

type Tab = "levels" | "flow";

interface Props {
  open: boolean;
  onClose: () => void;
  data: GexResult;
  ticker: string;
  accentColor: string;
}

export function DetailsDrawer({ open, onClose, data, ticker, accentColor }: Props) {
  const [tab, setTab] = useState<Tab>("levels");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${ticker} details`}>
      <button className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-label="Close details" />
      <aside className="relative flex h-full w-full max-w-[600px] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: accentColor }} />
          <h2 className="text-sm font-black text-foreground">{ticker}</h2>
          <span className="text-xs tabular-nums text-foreground/60">${data.spot.toFixed(2)}</span>
          <div className="ml-auto flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
            {(["levels", "flow"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-[11px] font-bold capitalize transition ${
                  tab === t ? "bg-[var(--surface)] text-foreground shadow-sm" : "text-foreground/55 hover:text-foreground"
                }`}
              >
                {t === "levels" ? "Levels" : "Flow"}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-foreground/60 hover:bg-[var(--surface-2)] hover:text-foreground" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {tab === "levels" ? (
            <>
              <InsightBar data={data} />
              <KeyLevelsRuler data={data} />
              <GexProfileChart data={data} accentColor={accentColor} />
              <GammaConcentration data={data} />
              <DealerNarrative data={data} />
            </>
          ) : (
            <>
              <PremiumFlow data={data} />
              <div className="p-4 border-b border-[var(--border)]">
                <NetFlowPanel data={data} accentColor={accentColor} />
              </div>
              <TopFlowStrikes data={data} />
              <FlowByExpiry data={data} />
              <FlowMomentumChart symbol={ticker} accentColor={accentColor} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
