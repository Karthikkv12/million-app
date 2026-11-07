"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import TickerSearchInput from "@/components/TickerSearchInput";
import { ArrowRight } from "lucide-react";
import { SectionHeader } from "@/components/ui";
import MarketCards from "@/components/dashboard/MarketCards";
import VixPanel from "@/components/dashboard/VixPanel";
import EconomicCalendar from "@/components/dashboard/EconomicCalendar";

const JUMP = [
  { href: "/options-flow", label: "Flow", sub: "Strike × expiry gamma board with king node, flip and walls." },
  { href: "/markets",      label: "Markets", sub: "Breadth, sector ETFs, movers and sector heatmaps." },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [lookupQuery, setLookupQuery] = useState("");

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 pb-16 pt-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="eyebrow mb-2 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />Today</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-[40px]">
            {greeting()}{user?.username ? `, ${user.username}` : ""}
          </h1>
          <p className="mt-2 text-[15px] text-foreground/60">Indexes, volatility and the day's calendar.</p>
        </div>
        <TickerSearchInput
          value={lookupQuery}
          onChange={setLookupQuery}
          onSelect={(sym) => {
            setLookupQuery(sym);
            router.push(`/stocks/${encodeURIComponent(sym.trim().toUpperCase())}`);
          }}
          placeholder="Look up a ticker or company"
          actionLabel="Open"
          className="w-full sm:w-96"
        />
      </div>

      <MarketCards />

      <SectionHeader label="Volatility" />
      <div className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <VixPanel />
        <VixPanel symbol="%5EINDIAVIX" title="India VIX" sublabel="NSE India Volatility Index" gradId="indiaVixGrad" />
      </div>

      <EconomicCalendar />

      <SectionHeader label="Jump to" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {JUMP.map(({ href, label, sub }) => (
          <Link key={href} href={href}
            className="group flex items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--border-strong)]">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/55">OptionFlow / {label}</p>
              <p className="mt-1.5 text-[15px] text-foreground/75">{sub}</p>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] text-foreground transition group-hover:translate-x-0.5 group-hover:bg-foreground group-hover:text-background">
              <ArrowRight size={16} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
