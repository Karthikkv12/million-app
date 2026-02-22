"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { fetchTrades, fetchCashBalance, fetchOrders, addCash, Trade } from "@/lib/api";

// ── Cash modal ────────────────────────────────────────────────────────────────
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 dark:text-white mb-4 text-base">Cash Transaction</h3>
        <div className="flex gap-2 mb-4">
          {(["deposit", "withdrawal"] as const).map((d) => (
            <button key={d} onClick={() => setDir(d)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
                dir === d
                  ? d === "deposit" ? "bg-green-600 text-white" : "bg-red-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500"
              }`}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
        <div className="mb-3">
          <label className="text-xs text-gray-400 block mb-1">Amount ($)</label>
          <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
        <div className="mb-4">
          <label className="text-xs text-gray-400 block mb-1">Note (opt.)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly contribution"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button onClick={() => mut.mutate()} disabled={mut.isPending || !amount}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition ${
              dir === "deposit" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
            }`}>
            {mut.isPending ? "Processing…" : `Confirm ${dir}`}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, color,
}: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      <span className="text-2xl font-black" style={{ color: color ?? undefined }}>{value}</span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}

const QUICK = [
  { href: "/options-flow", label: "Options Flow",  sub: "GEX & gamma levels"    },
  { href: "/trades",       label: "Trades",        sub: "Positions & P/L"       },
  { href: "/orders",       label: "Orders",        sub: "Pending & filled"      },
  { href: "/accounts",     label: "Accounts",      sub: "Holdings & cash"       },
];

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

export default function DashboardPage() {
  const { user } = useAuth();
  const [showCash, setShowCash] = useState(false);
  const tradesQ = useQuery({ queryKey: ["trades"], queryFn: fetchTrades, staleTime: 30_000 });
  const cashQ   = useQuery({ queryKey: ["cash-balance"], queryFn: () => fetchCashBalance(), staleTime: 30_000 });
  const ordersQ = useQuery({ queryKey: ["orders"], queryFn: fetchOrders, staleTime: 30_000 });

  const trades = tradesQ.data ?? [];
  const { pnl, openCount, closedCount } = calcPnl(trades);
  const cash = cashQ.data?.balance ?? null;
  const pendingOrders = (ordersQ.data ?? []).filter((o) => o.status?.toUpperCase() === "PENDING").length;

  const pnlColor = pnl > 0 ? "#00cc44" : pnl < 0 ? "#ff4444" : undefined;

  return (
    <div className="p-4 max-w-screen-xl mx-auto">
      {showCash && <CashModal onClose={() => setShowCash(false)} />}

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">
            Welcome back{user?.username ? `, ${user.username}` : ""}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Here&apos;s your portfolio at a glance.</p>
        </div>
        <button onClick={() => setShowCash(true)}
          className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition shrink-0">
          + Cash
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatCard
          label="Realized P/L"
          value={pnl === 0 && !tradesQ.data ? "—" : `$${Math.abs(pnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub={`${closedCount} closed trade${closedCount !== 1 ? "s" : ""}`}
          color={pnlColor}
        />
        <button onClick={() => setShowCash(true)} className="text-left">
          <StatCard
            label="Cash Balance"
            value={cash == null ? "—" : `$${cash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            sub="click to deposit / withdraw"
          />
        </button>
        <StatCard
          label="Open Positions"
          value={String(openCount)}
          sub="live trades"
        />
        <StatCard
          label="Pending Orders"
          value={String(pendingOrders)}
          sub="awaiting fill"
        />
      </div>

      {/* Quick actions */}
      <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">Quick Actions</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {QUICK.map(({ href, label, sub }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-sm transition-all group"
          >
            <span className="text-[15px] font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {label}
            </span>
            <span className="text-xs text-gray-400">{sub}</span>
          </Link>
        ))}
      </div>

      {/* Recent trades */}
      {trades.length > 0 && (
        <>
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">Recent Trades</h2>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 uppercase tracking-wide">
                  {["Date", "Ticker", "Action", "Qty", "Price", "Exit", "P/L"].map((h) => (
                    <th key={h} className="px-4 py-2 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...trades].reverse().slice(0, 8).map((t) => {
                  const ep = t.exit_price;
                  const rowPnl = ep != null
                    ? (t.action?.toUpperCase() === "SELL" ? t.price - ep : ep - t.price) * t.qty
                    : null;
                  const pnlC = rowPnl == null ? "" : rowPnl >= 0 ? "#00cc44" : "#ff4444";
                  return (
                    <tr key={t.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-2 text-gray-500">{t.date?.slice(0, 10) ?? "—"}</td>
                      <td className="px-4 py-2 font-bold text-gray-900 dark:text-white">{t.symbol}</td>
                      <td className="px-4 py-2" style={{ color: t.action?.toUpperCase() === "BUY" ? "#00cc44" : "#ff4444" }}>{t.action}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{t.qty}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">${t.price?.toFixed(2)}</td>
                      <td className="px-4 py-2 text-gray-500">{ep != null ? `$${ep.toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-2 font-semibold" style={{ color: pnlC }}>
                        {rowPnl == null ? "—" : `${rowPnl >= 0 ? "+" : ""}$${rowPnl.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-right">
            <Link href="/trades" className="text-xs text-blue-500 hover:underline">View all trades →</Link>
          </div>
        </>
      )}
    </div>
  );
}
