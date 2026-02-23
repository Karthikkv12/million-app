"use client";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AreaChart, Area, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import { fetchTrades, fetchOrders, fetchCashBalance, Trade, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  Plus, X, TrendingUp, TrendingDown, DollarSign, Activity, Clock, ArrowRight,
  Search,
} from "lucide-react";
import { PageHeader, SectionLabel, SkeletonStatGrid, Tabs, Badge, RefreshButton } from "@/components/ui";
import MarketCards from "@/components/dashboard/MarketCards";
import VixPanel from "@/components/dashboard/VixPanel";
import EconomicCalendar from "@/components/dashboard/EconomicCalendar";

const QUICK = [
  { href: "/options-flow", label: "GEX Flow",    sub: "Gamma exposure data",  color: "from-purple-500 to-purple-700" },
  { href: "/trades",       label: "Trades",      sub: "View all positions",   color: "from-blue-500 to-blue-700" },
  { href: "/accounts",     label: "Accounts",    sub: "Manage portfolios",    color: "from-emerald-500 to-emerald-700" },
  { href: "/budget",       label: "Budget",      sub: "Track expenses",       color: "from-orange-500 to-orange-600" },
];

function calcPnl(trades: Trade[]) {
  let pnl = 0; let open = 0; let closed = 0;
  for (const t of trades) {
    if (t.exit_price == null) { open++; continue; }
    closed++;
    const d = t.action?.toUpperCase() === "SELL" ? t.price - t.exit_price : t.exit_price - t.price;
    pnl += d * t.qty;
  }
  return { pnl, openCount: open, closedCount: closed };
}

const fmt = (v: number) => "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardPage() {
  const { user } = useAuth();
  const [lookupQuery, setLookupQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const t = lookupQuery.trim().toUpperCase();
    if (t) router.push(`/search?q=${t}`);
  };

  const tradesQ = useQuery({ queryKey: ["trades"],       queryFn: fetchTrades,          staleTime: 30_000 });
  const cashQ   = useQuery({ queryKey: ["cash-balance"], queryFn: () => fetchCashBalance(), staleTime: 30_000 });
  const ordersQ = useQuery({ queryKey: ["orders"],       queryFn: fetchOrders,          staleTime: 30_000 });

  const handleRefresh = () => {
    tradesQ.refetch();
    cashQ.refetch();
    ordersQ.refetch();
  };
  const isRefreshing = tradesQ.isFetching || cashQ.isFetching || ordersQ.isFetching;

  const trades = tradesQ.data ?? [];
  const { pnl, openCount, closedCount } = calcPnl(trades);
  const cash = cashQ.data?.balance ?? null;
  const pendingOrders = (ordersQ.data ?? []).filter((o) => o.status?.toUpperCase() === "PENDING").length;
  const pnlUp = pnl >= 0;

  const sparkData = trades
    .filter((t) => t.exit_price != null)
    .slice(-14)
    .map((t, i) => {
      const d = t.action?.toUpperCase() === "SELL" ? t.price - (t.exit_price ?? 0) : (t.exit_price ?? 0) - t.price;
      return { i, v: d * t.qty };
    });

  const isLoading = tradesQ.isLoading && cashQ.isLoading;

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">

      <PageHeader
        title={user?.username ? `Hey, ${user.username} 👋` : "Dashboard"}
        sub="Your portfolio at a glance."
        action={
          <div className="flex items-center gap-2">
            <RefreshButton onRefresh={handleRefresh} isRefreshing={isRefreshing} />
          </div>
        }
      />

      {/* ── Slim stock search bar ── */}
      <form onSubmit={handleLookup} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            ref={searchRef}
            value={lookupQuery}
            onChange={(e) => setLookupQuery(e.target.value.toUpperCase())}
            placeholder="Look up a ticker — AAPL, SPY, TSLA…"
            className="w-full pl-9 pr-4 py-2 border border-[var(--border)] rounded-xl text-sm bg-[var(--surface)] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button type="submit" disabled={!lookupQuery.trim()}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition">
          View
        </button>
      </form>

      {/* Stat cards */}
      {isLoading ? (
        <div className="mb-6 sm:mb-8"><SkeletonStatGrid count={4} /></div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {/* P&L + sparkline */}
          <div className="col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 card-hover">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Realized P/L</p>
                <p className={`text-2xl sm:text-3xl font-black ${pnlUp ? "text-green-500" : "text-red-500"}`}>
                  {tradesQ.data ? (pnlUp ? "+" : "-") + fmt(pnl) : "—"}
                </p>
                <p className="text-xs text-gray-400 mt-1">{closedCount} closed trade{closedCount !== 1 ? "s" : ""}</p>
              </div>
              <span className={`p-2 rounded-xl ${pnlUp ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                {pnlUp ? <TrendingUp size={18} className="text-green-500" /> : <TrendingDown size={18} className="text-red-500" />}
              </span>
            </div>
            {sparkData.length > 1 && (
              <ResponsiveContainer width="100%" height={52}>
                <AreaChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Area type="monotone" dataKey="v" stroke={pnlUp ? "#22c55e" : "#ef4444"}
                    fill={pnlUp ? "#22c55e22" : "#ef444422"} strokeWidth={2} dot={false} />
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <RTooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "P/L"]}
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "inherit" }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Cash */}
          <Link href="/accounts"
            className="text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 hover:border-blue-300 dark:hover:border-blue-700 active:scale-[0.98] transition group card-hover">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Cash</p>
              <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30"><DollarSign size={15} className="text-blue-500" /></span>
            </div>
            <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">{cash == null ? "—" : fmt(cash)}</p>
            <p className="text-xs text-gray-400 mt-1 group-hover:text-blue-500 transition">manage in accounts</p>
          </Link>

          {/* Positions */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 card-hover">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Positions</p>
              <span className="p-2 rounded-xl bg-purple-50 dark:bg-purple-900/30"><Activity size={15} className="text-purple-500" /></span>
            </div>
            <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">{openCount}</p>
            <div className="flex items-center gap-1 mt-1">
              <Clock size={11} className="text-yellow-500" />
              <p className="text-xs text-gray-400">{pendingOrders} pending order{pendingOrders !== 1 ? "s" : ""}</p>
            </div>
          </div>
        </div>
      )}

      {/* Market ticker cards */}
      <MarketCards />

      {/* ── VIX ── */}
      <div className="mb-6 sm:mb-8">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Volatility</p>
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
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

      {/* Recent trades */}
      {tradesQ.isLoading ? (
        <>
          <SectionLabel>Recent Trades</SectionLabel>
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="skeleton h-14 rounded-xl" />)}
          </div>
        </>
      ) : trades.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Recent Trades</SectionLabel>
            <Link href="/trades" className="text-xs text-blue-500 hover:underline flex items-center gap-1 -mt-3">
              View all <ArrowRight size={11} />
            </Link>
          </div>

          {/* Mobile card list */}
          <div className="flex flex-col gap-2 sm:hidden divide-y divide-[var(--border)]">
            {[...trades].reverse().slice(0, 6).map((t) => {
              const ep = t.exit_price;
              const rowPnl = ep != null
                ? (t.action?.toUpperCase() === "SELL" ? t.price - ep : ep - t.price) * t.qty
                : null;
              return (
                <div key={t.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 dark:text-white text-sm">{t.symbol}</span>
                      <Badge variant={t.action?.toUpperCase() === "BUY" ? "success" : "danger"}>{t.action}</Badge>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{t.qty} × ${t.price?.toFixed(2)} · {String(t.date ?? "").slice(0, 10)}</p>
                  </div>
                  <div className={`text-sm font-bold ${rowPnl == null ? "text-gray-400" : rowPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {rowPnl == null ? <span className="text-xs px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-full">Open</span> : `${rowPnl >= 0 ? "+" : ""}${fmt(rowPnl)}`}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] text-gray-400 uppercase tracking-wide bg-[var(--surface-2)]">
                  {["Date", "Ticker", "Action", "Qty", "Entry", "Exit", "P/L"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...trades].reverse().slice(0, 8).map((t) => {
                  const ep = t.exit_price;
                  const rowPnl = ep != null
                    ? (t.action?.toUpperCase() === "SELL" ? t.price - ep : ep - t.price) * t.qty
                    : null;
                  return (
                    <tr key={t.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3 text-gray-400 text-xs">{String(t.date ?? "").slice(0, 10)}</td>
                      <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{t.symbol}</td>
                      <td className="px-4 py-3">
                        <Badge variant={t.action?.toUpperCase() === "BUY" ? "success" : "danger"}>{t.action}</Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{t.qty}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">${t.price?.toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-400">{ep != null ? `$${ep.toFixed(2)}` : "—"}</td>
                      <td className={`px-4 py-3 font-bold ${rowPnl == null ? "text-gray-400" : rowPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {rowPnl == null ? "—" : `${rowPnl >= 0 ? "+" : ""}${fmt(rowPnl)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
