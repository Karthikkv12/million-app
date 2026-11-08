"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock } from "lucide-react";
import TickerSearchInput from "@/components/TickerSearchInput";
import { PageHeader } from "@/components/ui";
import { loadRecent } from "@/lib/recent";
import EconomicCalendar from "@/components/catalyst/EconomicCalendar";

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
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <PageHeader eyebrow="Research" title="Catalyst" sub="What could move a stock next: earnings, the move options are pricing, analyst changes, dividends, volume and news. Plus the US economic calendar." />

      <TickerSearchInput value={q} onChange={setQ} onSelect={go} placeholder="Search a ticker or company" actionLabel="Check" className="w-full" />

      {recent.length > 0 && (
        <section className="mt-10">
          <h2 className="eyebrow mb-3 flex items-center gap-2"><Clock size={12} />Recent</h2>
          <div className="flex flex-wrap gap-2">
            {recent.map((s) => (
              <Link key={s} href={`/catalyst/${s}`} className="rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 font-mono text-[13px] text-foreground transition hover:border-foreground/40">{s}</Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="eyebrow mb-3">Popular</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {POPULAR.map((s) => (
            <li key={s}>
              <Link href={`/catalyst/${s}`} className="group flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition hover:border-[var(--border-strong)]">
                <span className="font-mono text-[14px] font-medium text-foreground">{s}</span>
                <ArrowRight size={15} className="text-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <EconomicCalendar />
      </section>

      <p className="mt-10 text-[13px] text-foreground/50">Data from Yahoo Finance, delayed. For information only, not investment advice.</p>
    </div>
  );
}
