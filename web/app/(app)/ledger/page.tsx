"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface LedgerLine {
  entry_id: number;
  account_name: string;
  amount: number;
  side: "debit" | "credit" | string;
  created_at: string;
  effective_at?: string;
}

interface LedgerEntry {
  id: number;
  description?: string;
  created_at: string;
  effective_at?: string;
  lines?: LedgerLine[];
  // flat rows from /ledger/entries
  account_name?: string;
  amount?: number;
  side?: string;
  entry_description?: string;
  entry_effective_at?: string;
}

const fetchLedger = (limit = 100) =>
  api.get<LedgerEntry[]>(`/ledger/entries?limit=${limit}`);

const SIDE_STYLE: Record<string, string> = {
  debit:  "text-red-500 font-bold",
  credit: "text-green-500 font-bold",
};

const fmt = (v: number) =>
  `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

export default function LedgerPage() {
  const { data: rows = [], isLoading, isError } = useQuery<LedgerEntry[]>({
    queryKey: ["ledger"],
    queryFn: () => fetchLedger(200),
    staleTime: 30_000,
  });

  // Aggregate totals by account
  const totals: Record<string, { debit: number; credit: number }> = {};
  for (const r of rows) {
    const acct = r.account_name ?? "Unknown";
    const side = (r.side ?? "").toLowerCase();
    const amt  = r.amount ?? 0;
    if (!totals[acct]) totals[acct] = { debit: 0, credit: 0 };
    if (side === "debit")  totals[acct].debit  += amt;
    if (side === "credit") totals[acct].credit += amt;
  }

  return (
    <div className="p-4 max-w-screen-xl mx-auto">
      <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-4">Ledger</h1>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {isError   && <p className="text-sm text-red-400">Failed to load ledger entries.</p>}

      {/* Account summary cards */}
      {Object.keys(totals).length > 0 && (
        <>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Account Balances</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {Object.entries(totals).map(([acct, { debit, credit }]) => {
              const net = credit - debit;
              return (
                <div key={acct} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
                  <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">{acct}</div>
                  <div className={`text-lg font-black ${net >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt(net)}</div>
                  <div className="flex gap-2 mt-1 text-[10px] text-gray-400">
                    <span className="text-red-400">Dr {fmt(debit)}</span>
                    <span>·</span>
                    <span className="text-green-400">Cr {fmt(credit)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Entry table */}
      {!isLoading && rows.length === 0 && (
        <p className="text-sm text-gray-400">
          No ledger entries yet. Deposits and withdrawals will appear here.
        </p>
      )}

      {rows.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 uppercase tracking-wide">
                {["Effective", "Account", "Side", "Amount", "Description"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const side = (r.side ?? "").toLowerCase();
                return (
                  <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                      {(r.effective_at ?? r.entry_effective_at ?? r.created_at ?? "").slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 font-semibold text-gray-900 dark:text-white text-xs">
                      {r.account_name ?? "—"}
                    </td>
                    <td className={`px-3 py-2 text-xs uppercase ${SIDE_STYLE[side] ?? "text-gray-500"}`}>
                      {side || "—"}
                    </td>
                    <td className={`px-3 py-2 text-xs font-bold ${SIDE_STYLE[side] ?? ""}`}>
                      {r.amount != null ? fmt(r.amount) : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-400 text-xs truncate max-w-[220px]">
                      {r.entry_description ?? r.description ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
