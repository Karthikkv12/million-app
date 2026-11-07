"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import TickerSearchInput from "@/components/TickerSearchInput";
import { ArrowRight } from "lucide-react";
import { PageHeader, SectionLabel } from "@/components/ui";
import MarketCards from "@/components/dashboard/MarketCards";
import VixPanel from "@/components/dashboard/VixPanel";
import EconomicCalendar from "@/components/dashboard/EconomicCalendar";

const QUICK = [
  { href: "/options-flow", label: "GEX Flow",    sub: "Gamma exposure data",  color: "from-purple-500 to-purple-700" },
  { href: "/markets",      label: "Markets",     sub: "Sectors & breadth",    color: "from-blue-500 to-blue-700" },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [lookupQuery, setLookupQuery] = useState("");

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const t = lookupQuery.trim().toUpperCase();
    if (t) router.push(`/stocks/${t}`);
  };

  return (
    <div className="p-4 sm:p-6 w-full overflow-x-hidden">

      <PageHeader
        title={user?.username ? `Hey, ${user.username} 👋` : "Dashboard"}
        sub="Your portfolio at a glance."
      />

      {/* ── Slim stock search bar ── */}
      <div className="mb-6">
        <TickerSearchInput
          value={lookupQuery}
          onChange={setLookupQuery}
          onSelect={(sym) => {
            setLookupQuery(sym);
            router.push(`/stocks/${encodeURIComponent(sym.trim().toUpperCase())}`);
          }}
          placeholder="Search ticker or company — AAPL, Apple, Nifty…"
          actionLabel="View"
          className="w-full max-w-xl"
        />
      </div>

      {/* Market ticker cards */}
      <MarketCards />

      {/* ── VIX ── */}
      <div className="mb-6 sm:mb-8">
        <p className="text-[11px] font-bold text-foreground uppercase tracking-widest mb-3">Volatility</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <VixPanel />
          <VixPanel
            symbol="%5EINDIAVIX"
            title="India VIX"
            sublabel="NSE India Volatility Index"
            gradId="indiaVixGrad"
          />
        </div>
      </div>

      {/* ── Economic Calendar ── */}
      <EconomicCalendar />

      {/* Quick actions */}
      <SectionLabel>Quick Actions</SectionLabel>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {QUICK.map(({ href, label, sub, color }) => (
          <Link key={href} href={href}
            className="relative overflow-hidden rounded-2xl p-4 sm:p-5 text-white group hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-sm">
            <div className={`absolute inset-0 bg-gradient-to-br ${color}`} />
            <div className="relative">
              <p className="font-bold text-sm sm:text-base">{label}</p>
              <p className="text-[11px] text-white/70 mt-0.5">{sub}</p>
              <ArrowRight size={14} className="mt-3 opacity-70 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        ))}
      </div>

    </div>
  );
}
