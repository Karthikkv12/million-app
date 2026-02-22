"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { fetchTrades, fetchCashBalance, fetchOrders, Trade } from "@/lib/api";

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
      <div className="mb-6">
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">
          Welcome back{user?.username ? `, ${user.username}` : ""}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Here&apos;s your portfolio at a glance.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatCard
          label="Realized P/L"
          value={pnl === 0 && !tradesQ.data ? "—" : `$${Math.abs(pnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub={`${closedCount} closed trade${closedCount !== 1 ? "s" : ""}`}
          color={pnlColor}
        />
        <StatCard
          label="Cash Balance"
          value={cash == null ? "—" : `$${cash.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="USD"
        />
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
