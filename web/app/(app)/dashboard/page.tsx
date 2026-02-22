"use client";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { fetchTrades, fetchOrders, fetchCashBalance, Trade, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  Plus, X, TrendingUp, TrendingDown, DollarSign, Activity, Clock, ArrowRight,
  Search, BarChart2,
} from "lucide-react";
import { PageHeader, SectionLabel, SkeletonStatGrid, Tabs, Badge, RefreshButton } from "@/components/ui";

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

function CashModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount]   = useState("");
  const [type, setType]       = useState<"deposit" | "withdrawal">("deposit");
  const [account, setAccount] = useState("");
  const [err, setErr]         = useState("");

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<{id:number;name:string}[]>("/accounts"), staleTime: 30_000 });

  const mut = useMutation({
    mutationFn: () => api.post("/cash/add", { amount: parseFloat(amount), type, account_id: account ? parseInt(account) : null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cash-balance"] }); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  const inputCls = "w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--surface)] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-[var(--surface)] rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-sm shadow-2xl border border-[var(--border)]">
        <div className="w-10 h-1 rounded-full bg-[var(--surface-2)] mx-auto mb-5 sm:hidden" />
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-900 dark:text-white text-lg">Cash Transaction</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl text-gray-400 hover:bg-[var(--surface-2)] transition"><X size={16} /></button>
        </div>
        <Tabs
          tabs={[
            { key: "deposit",    label: "Deposit"    },
            { key: "withdrawal", label: "Withdrawal" },
          ]}
          active={type}
          onChange={(k) => setType(k as "deposit" | "withdrawal")}
          className="w-full mb-4 [&>button]:flex-1"
        />
        <label className="block text-xs text-gray-500 mb-1">Amount ($)</label>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${inputCls} mb-3`} />
        <label className="block text-xs text-gray-500 mb-1">Account (optional)</label>
        <select value={account} onChange={(e) => setAccount(e.target.value)} className={`${inputCls} mb-4`}>
          <option value="">— Any —</option>
          {(accountsQ.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <button onClick={() => mut.mutate()} disabled={mut.isPending || !amount}
          className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
          {mut.isPending ? "Processing…" : `Confirm ${type}`}
        </button>
      </div>
    </div>
  );
}

const fmt = (v: number) => "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DashboardPage() {
  const { user } = useAuth();
  const [showCash, setShowCash]       = useState(false);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupSymbol, setLookupSymbol] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const lookupQ = useQuery({
    queryKey: ["lookup", lookupSymbol],
    queryFn: () => api.get<{ symbol: string; bars: {date:string;close:number}[]; current_price?: number; error?: string }>(`/stocks/${lookupSymbol}/history?period=3mo`),
    enabled: !!lookupSymbol,
    staleTime: 60_000,
    retry: false,
  });

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const t = lookupQuery.trim().toUpperCase();
    if (t) setLookupSymbol(t);
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
      {showCash && <CashModal onClose={() => setShowCash(false)} />}

      <PageHeader
        title={user?.username ? `Hey, ${user.username} 👋` : "Dashboard"}
        sub="Your portfolio at a glance."
        action={
          <div className="flex items-center gap-2">
            <RefreshButton onRefresh={handleRefresh} isRefreshing={isRefreshing} />
            <button onClick={() => setShowCash(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 active:scale-95 transition shadow-sm">
              <Plus size={15} strokeWidth={2.5} />
              <span className="hidden sm:inline">Cash</span>
            </button>
          </div>
        }
      />

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
          <button onClick={() => setShowCash(true)}
            className="text-left bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5 hover:border-blue-300 dark:hover:border-blue-700 active:scale-[0.98] transition group card-hover">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Cash</p>
              <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30"><DollarSign size={15} className="text-blue-500" /></span>
            </div>
            <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">{cash == null ? "—" : fmt(cash)}</p>
            <p className="text-xs text-gray-400 mt-1 group-hover:text-blue-500 transition">tap to transact</p>
          </button>

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

      {/* ── Inline Stock Lookup ── */}
      <SectionLabel>Stock Lookup</SectionLabel>
      <div className="mb-6 sm:mb-8 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 sm:p-5">
        <form onSubmit={handleLookup} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={searchRef}
              value={lookupQuery}
              onChange={(e) => setLookupQuery(e.target.value.toUpperCase())}
              placeholder="Ticker — e.g. AAPL, SPY, TSLA"
              className="w-full pl-10 pr-4 py-2.5 border border-[var(--border)] rounded-xl text-sm bg-[var(--surface-2)] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button type="submit" disabled={!lookupQuery.trim()}
            className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
            View
          </button>
          {lookupSymbol && (
            <button type="button" onClick={() => { setLookupSymbol(null); setLookupQuery(""); }}
              className="px-3 py-2.5 rounded-xl bg-[var(--surface-2)] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm transition">
              ✕
            </button>
          )}
        </form>

        {lookupSymbol && (
          <div className="mt-4">
            {lookupQ.isLoading && (
              <div className="space-y-2">
                <div className="h-16 rounded-xl bg-[var(--surface-2)] animate-pulse" />
                <div className="h-48 rounded-xl bg-[var(--surface-2)] animate-pulse" />
              </div>
            )}
            {lookupQ.data && !lookupQ.data.error && (() => {
              const bars = lookupQ.data.bars ?? [];
              const last = bars.length ? bars[bars.length - 1].close : null;
              const prev = bars.length > 1 ? bars[bars.length - 2].close : null;
              const change = last && prev ? last - prev : null;
              const pct = change && prev ? (change / prev) * 100 : null;
              const up = (change ?? 0) >= 0;
              return (
                <div>
                  <div className="flex items-end justify-between mb-3">
                    <div>
                      <p className="text-2xl font-black text-gray-900 dark:text-white">
                        {lookupSymbol} {last != null ? `$${last.toFixed(2)}` : ""}
                      </p>
                      {change != null && pct != null && (
                        <p className={`text-sm font-semibold mt-0.5 ${up ? "text-green-500" : "text-red-500"}`}>
                          {up ? "▲" : "▼"} ${Math.abs(change).toFixed(2)} ({pct.toFixed(2)}%)
                        </p>
                      )}
                    </div>
                    <a href={`/orders?symbol=${lookupSymbol}`}
                      className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition">
                      Trade
                    </a>
                  </div>
                  {bars.length > 1 && (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={bars} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb22" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false}
                          interval={Math.floor(bars.length / 6)} tickFormatter={(d: string) => d.slice(5)} />
                        <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#9ca3af" }}
                          tickLine={false} axisLine={false} width={60}
                          tickFormatter={(v: number) => "$" + v.toFixed(0)} />
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        <RTooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Close"]}
                          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "inherit" }}
                          labelStyle={{ color: "#9ca3af", fontSize: 11 }} />
                        <Line type="monotone" dataKey="close" dot={false}
                          stroke={up ? "#22c55e" : "#ef4444"} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              );
            })()}
            {(lookupQ.data?.error || lookupQ.isError) && (
              <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                No market data for <strong>{lookupSymbol}</strong>. You can still place orders manually.
              </p>
            )}
          </div>
        )}
        {!lookupSymbol && (
          <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
            <BarChart2 size={12} className="opacity-50" />
            Enter a ticker to see the chart and place a trade
          </p>
        )}
      </div>

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
