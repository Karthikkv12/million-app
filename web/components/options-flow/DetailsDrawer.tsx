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
      <aside className="relative flex h-full w-full max-w-[600px] flex-col border-l border-[var(--border-strong)] bg-[var(--background)]">
        <header className="flex items-center gap-4 border-b border-[var(--border-strong)] px-5 pb-0 pt-4">
          <div className="pb-3">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/45">Details</p>
            <h2 className="font-mono text-[20px] font-semibold tracking-tight text-foreground">{ticker} <span className="text-[14px] font-normal tabular-nums text-foreground/55">{data.spot.toFixed(2)}</span></h2>
          </div>
          <div role="tablist" aria-label="Details section" className="ml-auto flex gap-4 self-end">
            {(["levels", "flow"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`-mb-px border-b-2 pb-2.5 font-mono text-[11px] uppercase tracking-[0.14em] ${tab === t ? "border-foreground text-foreground" : "border-transparent text-foreground/45 hover:text-foreground"}`}>
                {t}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="mb-2.5 self-end rounded-md p-1.5 text-foreground/60 hover:bg-[var(--surface-2)] hover:text-foreground" aria-label="Close">
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
