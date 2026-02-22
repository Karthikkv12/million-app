"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { useAuth } from "@/lib/auth";
import { fetchTrades, fetchCashBalance, fetchOrders, addCash, Trade } from "@/lib/api";
import { TrendingUp, TrendingDown, DollarSign, Activity, Clock, ArrowRight, Plus } from "lucide-react";

// ── Cash modal (bottom-sheet on mobile, centered on sm+) ─────────────────────
function CashModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [dir, setDir]       = useState<"deposit" | "withdrawal">("deposit");
  const [amount, setAmount] = useState("");
  const [note, setNote]     = useState("");
  const [err, setErr]       = useState("");

  const mut = useMutation({
    mutationFn: () => addCash(parseFloat(amount), dir, note || undefined),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cash-balance"] }); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700 mx-auto mb-5 sm:hidden" />
        <h3 className="font-bold text-gray-900 dark:text-white mb-4 text-base">Cash Transaction</h3>
        <div className="flex gap-2 mb-4">
          {(["deposit", "withdrawal"] as const).map((d) => (
            <button key={d} onClick={() => setDir(d)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
                  dir === d
                    ? d === "deposit" ? "bg-green-600 text-white" : "bg-red-600 text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-500"
              }`}>
              {d === "deposit" ? "Deposit" : "Withdraw"}
            </button>
          ))}
        </div>
        <div className="mb-3">
          <label className="text-xs text-gray-400 block mb-1">Amount ($)</label>
          <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="mb-5">
          <label className="text-xs text-gray-400 block mb-1">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly contribution"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button onClick={() => mut.mutate()} disabled={mut.isPending || !amount}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 transition ${
              dir === "deposit" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
            }`}>
            {mut.isPending ? "Processing…" : `Confirm ${dir}`}
          </button>
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function calcPnl(trades: Trade[]) {
  const closed = trades.filter((t) => t.exit_price != null);
  const pnl = closed.reduce((acc, t) => {
    const ep = t.exit_price ?? 0;
    const en = t.price ?? 0;
    const d = t.action?.toUpperCase() === "SELL" ? en - ep : ep - en;
    return acc + d * (t.qty ?? 0);
  }, 0);
  return { pnl, closedCount: closed.length, openCount: trades.filter((t) => t.exit_price == null).length };
}

const QUICK = [
  { href: "/options-flow", label: "Options Flow", sub: "GEX heatmap",     color: "from-violet-500 to-purple-600" },
  { href: "/trades",       label: "Trades",       sub: "Positions & P/L", color: "from-blue-500 to-blue-600"    },
  { href: "/orders",       label: "Orders",       sub: "Place & manage",  color: "from-emerald-500 to-green-600" },
  { href: "/search",       label: "Search",       sub: "Find any ticker", color: "from-orange-500 to-amber-600"  },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [showCash, setShowCash] = useState(false);
  const tradesQ = useQuery({ queryKey: ["trades"],        queryFn: fetchTrades,              staleTime: 30_000 });
  const cashQ   = useQuery({ queryKey: ["cash-balance"],  queryFn: () => fetchCashBalance(), staleTime: 30_000 });
  const ordersQ = useQuery({ queryKey: ["orders"],        queryFn: fetchOrders,              staleTime: 30_000 });

  const trades = tradesQ.data ?? [];
  const { pnl, openCount, closedCount } = calcPnl(trades);
  const cash = cashQ.data?.balance ?? null;
  const pendingOrders = (ordersQ.data ?? []).filter((o) => o.status?.toUpperCase() === "PENDING").length;
  const pnlUp = pnl >= 0;

  // sparkline from last 14 closed trades
  const sparkData = trades
    .filter((t) => t.exit_price != null)
    .slice(-14)
    .map((t, i) => {
      const d = t.action?.toUpperCase() === "SELL" ? t.price - (t.exit_price ?? 0) : (t.exit_price ?? 0) - t.price;
      return { i, v: d * t.qty };
    });

  const fmt = (v: number) =>
    "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      {showCash && <CashModal onClose={() => setShowCash(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">
            {user?.username ? `Hey, ${user.username} 👋` : "Dashboard"}
          </h1>
          <p className="text-sm text-gray-400 mt-1">Your portfolio at a glance.</p>
        </div>
        <button
          onClick={() => setShowCash(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition shadow-sm shrink-0"
        >
          <Plus size={15} strokeWidth={2.5} />
          <span className="hidden sm:inline">Cash</span>
        </button>
      </div>

      {/* Stat cards — 2-col mobile, 4-col lg */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">

        {/* P&L + sparkline — spans 2 cols always */}
        <div className="col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Realized P/L</p>
              <p className={`text-2xl sm:text-3xl font-black ${pnlUp ? "text-green-500" : "text-red-500"}`}>
                {tradesQ.data ? (pnlUp ? "+" : "-") + fmt(pnl) : "—"}
              </p>
              <p className="text-xs text-gray-400 mt-1">{closedCount} closed trade{closedCount !== 1 ? "s" : ""}</p>
            </div>
            <span className={`p-2 rounded-xl ${pnlUp ? "bg-green-100 dark:bg-green-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
              {pnlUp
                ? <TrendingUp size={18} className="text-green-500" />
                : <TrendingDown size={18} className="text-red-500" />}
            </span>
          </div>
          {sparkData.length > 1 && (
            <ResponsiveContainer width="100%" height={52}>
              <AreaChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Area type="monotone" dataKey="v" stroke={pnlUp ? "#22c55e" : "#ef4444"}
                  fill={pnlUp ? "#22c55e22" : "#ef444422"} strokeWidth={2} dot={false} />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "P/L"]}
                  contentStyle={{ background: "#1f2937", border: "none", borderRadius: 8, fontSize: 11 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Cash */}
        <button
          onClick={() => setShowCash(true)}
          className="text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5 hover:border-blue-300 dark:hover:border-blue-700 transition group"
        >
          <div className="flex items-start justify-between mb-2">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Cash</p>
            <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30">
              <DollarSign size={16} className="text-blue-500" />
            </span>
          </div>
          <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">
            {cash == null ? "—" : fmt(cash)}
          </p>
          <p className="text-xs text-gray-400 mt-1 group-hover:text-blue-500 transition">tap to transact</p>
        </button>

        {/* Positions */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start justify-between mb-2">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Positions</p>
            <span className="p-2 rounded-xl bg-purple-50 dark:bg-purple-900/30">
              <Activity size={16} className="text-purple-500" />
            </span>
          </div>
          <p className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">{openCount}</p>
          <div className="flex items-center gap-1 mt-1">
            <Clock size={11} className="text-yellow-500" />
            <p className="text-xs text-gray-400">{pendingOrders} pending order{pendingOrders !== 1 ? "s" : ""}</p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Quick Actions</h2>
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
      {trades.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Recent Trades</h2>
            <Link href="/trades" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
              View all <ArrowRight size={11} />
            </Link>
          </div>

          {/* Mobile card list */}
          <div className="flex flex-col gap-2 sm:hidden">
            {[...trades].reverse().slice(0, 6).map((t) => {
              const ep = t.exit_price;
              const rowPnl = ep != null
                ? (t.action?.toUpperCase() === "SELL" ? t.price - ep : ep - t.price) * t.qty
                : null;
              return (
                <div key={t.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 dark:text-white text-sm">{t.symbol}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        t.action?.toUpperCase() === "BUY"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                      }`}>{t.action}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{t.qty} × ${t.price?.toFixed(2)} · {String(t.date ?? "").slice(0, 10)}</p>
                  </div>
                  <div className={`text-sm font-bold ${rowPnl == null ? "text-gray-400" : rowPnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {rowPnl == null ? "Open" : `${rowPnl >= 0 ? "+" : ""}${fmt(rowPnl)}`}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 uppercase tracking-wide">
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
                    <tr key={t.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3 text-gray-400 text-xs">{String(t.date ?? "").slice(0, 10)}</td>
                      <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{t.symbol}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          t.action?.toUpperCase() === "BUY"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                        }`}>{t.action}</span>
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
