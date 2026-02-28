"use client";
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AreaChart, Area, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import { fetchTrades, fetchOrders, fetchCashBalance, fetchPortfolioSummary, Trade } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import TickerSearchInput from "@/components/TickerSearchInput";
import {
  TrendingUp, TrendingDown, DollarSign, Activity, Clock, ArrowRight,
} from "lucide-react";
import { PageHeader, SectionLabel, SkeletonStatGrid, Badge, RefreshButton } from "@/components/ui";
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
  const router = useRouter();
  const [lookupQuery, setLookupQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const t = lookupQuery.trim().toUpperCase();
    if (t) router.push(`/stocks/${t}`);
  };

  const tradesQ   = useQuery({ queryKey: ["trades"],            queryFn: fetchTrades,             staleTime: 30_000 });
  const cashQ     = useQuery({ queryKey: ["cash-balance"],      queryFn: () => fetchCashBalance(), staleTime: 30_000 });
  const ordersQ   = useQuery({ queryKey: ["orders"],            queryFn: fetchOrders,             staleTime: 30_000 });
  const summaryQ  = useQuery({ queryKey: ["portfolioSummary"],  queryFn: fetchPortfolioSummary,   staleTime: 60_000 });

  const handleRefresh = () => {
    tradesQ.refetch();
    cashQ.refetch();
    ordersQ.refetch();
    summaryQ.refetch();
  };
  const isRefreshing = tradesQ.isFetching || cashQ.isFetching || ordersQ.isFetching || summaryQ.isFetching;

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
    <div className="p-4 sm:p-6 w-full">

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

      {/* ── Portfolio Balance Chart ── */}
      {(() => {
        const weeks = summaryQ.data?.weeks_breakdown ?? [];
        const pts = [...weeks].reverse().filter(w => w.account_value != null) as { id: number; week_end: string; account_value: number; premium: number }[];
        if (pts.length === 0) return null;
        const latest = pts[pts.length - 1];
        const first  = pts[0];
        const change  = pts.length >= 2 ? latest.account_value - first.account_value : null;
        const changePct = change != null && first.account_value > 0 ? (change / first.account_value) * 100 : null;
        const up = change == null ? true : change >= 0;
        const chartData = pts.map(w => ({
          date: new Date(w.week_end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          value: w.account_value,
          premium: w.premium,
        }));
        return (
          <div className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wide mb-1">Portfolio Balance</p>
                <p className={`text-2xl sm:text-3xl font-black ${up ? "text-green-500" : "text-red-500"}`}>
                  ${latest.account_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className={`text-xs mt-1 font-semibold ${up ? "text-green-500" : "text-red-500"}`}>
                  {change != null
                    ? `${change >= 0 ? "+" : ""}$${change.toFixed(0)}${changePct != null ? ` (${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%)` : ""} since first entry`
                    : `1 week logged · add more each Friday to track growth`
                  }
                </p>
              </div>
              <Link href="/trades" className="text-[11px] text-blue-500 hover:underline flex items-center gap-1 mt-1">
                Account tab <ArrowRight size={11} />
              </Link>
            </div>
            {pts.length >= 2 ? (
              <>
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={up ? "#22c55e" : "#ef4444"} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={up ? "#22c55e" : "#ef4444"} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={up ? "#22c55e" : "#ef4444"}
                      fill="url(#balGrad)"
                      strokeWidth={2}
                      dot={{ r: 2, fill: up ? "#22c55e" : "#ef4444", strokeWidth: 0 }}
                    />
                    <RTooltip
                      formatter={(v: number | undefined) => v != null ? [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Balance"] : ["—", "Balance"]}
                      labelFormatter={(l) => `Week ending ${l}`}
                      contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "inherit" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="flex justify-between mt-1 px-0.5">
                  <span className="text-[9px] text-foreground/40">{chartData[0].date}</span>
                  {chartData.length > 2 && <span className="text-[9px] text-foreground/40">{chartData[Math.floor(chartData.length / 2)].date}</span>}
                  <span className="text-[9px] text-foreground/40">{chartData[chartData.length - 1].date}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-20 text-[11px] text-foreground/30">
                Log account values each Friday in the Account tab to build your chart
              </div>
            )}
          </div>
        );
      })()}

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
                      <span className="font-bold text-foreground text-sm">{t.symbol}</span>
                      <Badge variant={t.action?.toUpperCase() === "BUY" ? "success" : "danger"}>{t.action}</Badge>
                    </div>
                    <p className="text-xs text-foreground/70 mt-0.5">{t.qty} × ${t.price?.toFixed(2)} · {String(t.date ?? "").slice(0, 10)}</p>
                  </div>
                  <div className={`text-sm font-bold ${rowPnl == null ? "text-foreground/60" : rowPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
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
                <tr className="border-b border-[var(--border)] text-[11px] text-foreground uppercase tracking-wide bg-[var(--surface-2)]">
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
                      <td className="px-4 py-3 text-foreground/70 text-xs">{String(t.date ?? "").slice(0, 10)}</td>
                      <td className="px-4 py-3 font-bold text-foreground">{t.symbol}</td>
                      <td className="px-4 py-3">
                        <Badge variant={t.action?.toUpperCase() === "BUY" ? "success" : "danger"}>{t.action}</Badge>
                      </td>
                      <td className="px-4 py-3 text-foreground">{t.qty}</td>
                      <td className="px-4 py-3 text-foreground">${t.price?.toFixed(2)}</td>
                      <td className="px-4 py-3 text-foreground/70">{ep != null ? `$${ep.toFixed(2)}` : "—"}</td>
                      <td className={`px-4 py-3 font-bold ${rowPnl == null ? "text-foreground/60" : rowPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
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
