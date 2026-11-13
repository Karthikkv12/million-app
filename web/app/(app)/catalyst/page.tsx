"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock } from "lucide-react";
import TickerSearchInput from "@/components/TickerSearchInput";
import { PageHeader } from "@/components/ui";
import { loadRecent } from "@/lib/recent";
import { DeskSection } from "@/components/desk";
import { HoldingsCatalysts } from "@/components/catalyst/HoldingsCatalysts";

const POPULAR = ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "META", "AMD", "SPY"];

export default function CatalystSearchPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    setRecent(loadRecent());
  }, []);
  const go = (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (s) router.push(`/catalyst/${encodeURIComponent(s)}`);
  };

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 pb-16 pt-8 sm:px-8">
      <PageHeader eyebrow="Research" title="Catalysts" sub="What could move a stock next: earnings, the move options are pricing, analyst changes, dividends, volume and news." />

      {/* Search, then quick picks on one full-width line */}
      <TickerSearchInput value={q} onChange={setQ} onSelect={go} placeholder="Search a ticker or company" actionLabel="Check" className="w-full" />
      <div className="mt-3 flex items-stretch border-y border-[var(--border)]">
        <span className="hidden shrink-0 items-center pr-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45 sm:flex">
          {recent.length ? <><Clock size={11} className="mr-1.5" />Recent</> : "Popular"}
        </span>
        <ul className="grid min-w-0 flex-1 auto-cols-fr grid-flow-col divide-x divide-[var(--border)] overflow-x-auto">
          {(recent.length ? Array.from(new Set([...recent, ...POPULAR])) : POPULAR).slice(0, 8).map((sym, i) => (
            <li key={sym} className={i >= 4 ? "hidden min-w-[72px] sm:block" : "min-w-[72px]"}>
              <Link href={`/catalyst/${sym}`} className="group flex items-center justify-between gap-2 px-3 py-2.5 transition hover:bg-foreground/[0.04]">
                <span className="font-mono text-[13px] font-medium text-foreground">{sym}</span>
                <ArrowRight size={13} className="shrink-0 text-foreground/30 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <DeskSection label="Your holdings" className="mt-4 border-t-0 pt-4" meta={<>Sorted by what needs attention first.<br />Tap a stock for its full catalyst page.</>}>
        <HoldingsCatalysts />
      </DeskSection>

      <p className="mt-6 text-[12px] text-foreground/45">Data from Yahoo Finance, delayed. For information only, not investment advice.</p>
    </div>
  );
}
