"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { BookOpen } from "lucide-react";
import { PageHeader, SectionLabel, EmptyState, SkeletonStatGrid } from "@/components/ui";

interface LedgerLine {
  entry_id: number; account_name: string; amount: number;
  side: "debit" | "credit" | string; created_at: string;
  effective_at?: string;
}
interface LedgerEntry {
  id: number; description?: string; created_at: string; effective_at?: string;
  lines?: LedgerLine[];
  account_name?: string; amount?: number; side?: string;
  entry_description?: string; entry_effective_at?: string;
}

const fetchLedger = (limit = 200) => api.get<LedgerEntry[]>(`/ledger/entries?limit=${limit}`);
const SIDE_CLS: Record<string, string> = {
  debit:  "text-red-500 font-bold",
  credit: "text-green-500 font-bold",
};
const fmt = (v: number) => "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2 });

export default function LedgerPage() {
  const { data: rows = [], isLoading, isError } = useQuery<LedgerEntry[]>({
    queryKey: ["ledger"], queryFn: () => fetchLedger(200), staleTime: 30_000,
  });

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
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader title="Ledger" sub="Double-entry transaction log" />

      {isError && <p className="text-sm text-red-400 mb-4">Failed to load ledger entries.</p>}

      {/* Account balances */}
      {isLoading ? (
        <>
          <SectionLabel>Account Balances</SectionLabel>
          <div className="mb-6"><SkeletonStatGrid count={4} /></div>
        </>
      ) : Object.keys(totals).length > 0 && (
        <>
          <SectionLabel>Account Balances</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {Object.entries(totals).map(([acct, { debit, credit }]) => {
              const net = credit - debit;
              return (
                <div key={acct} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 card-hover">
                  <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1 truncate">{acct}</div>
                  <div className={`text-xl font-black ${net >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt(net)}</div>
                  <div className="flex gap-2 mt-1.5 text-[10px]">
                    <span className="text-red-400">Dr {fmt(debit)}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-green-400">Cr {fmt(credit)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Transaction log */}
      {!isLoading && rows.length === 0 && (
        <EmptyState icon={BookOpen} title="No transactions yet"
          body="Deposits, withdrawals and trades will appear here." />
      )}

      {rows.length > 0 && (
        <>
          <SectionLabel>Transaction Log</SectionLabel>

          {/* Mobile */}
          <div className="flex flex-col gap-2 md:hidden">
            {rows.map((r, i) => {
              const side = (r.side ?? "").toLowerCase();
              return (
                <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900 dark:text-white">{r.account_name ?? "—"}</span>
                      <span className={`text-[10px] font-bold uppercase ${SIDE_CLS[side] ?? "text-gray-400"}`}>{side || "—"}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {(r.effective_at ?? r.entry_effective_at ?? r.created_at ?? "").slice(0, 10)}
                      {(r.entry_description ?? r.description) ? ` · ${(r.entry_description ?? r.description)?.slice(0, 40)}` : ""}
                    </p>
                  </div>
                  <span className={`font-bold text-sm ${SIDE_CLS[side] ?? "text-gray-500"}`}>
                    {r.amount != null ? fmt(r.amount) : "—"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Desktop */}
          <div className="hidden md:block bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] text-gray-400 uppercase tracking-wide bg-[var(--surface-2)]">
                  {["Effective", "Account", "Side", "Amount", "Description"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const side = (r.side ?? "").toLowerCase();
                  return (
                    <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {(r.effective_at ?? r.entry_effective_at ?? r.created_at ?? "").slice(0, 10)}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white text-xs">{r.account_name ?? "—"}</td>
                      <td className={`px-4 py-3 text-xs uppercase ${SIDE_CLS[side] ?? "text-gray-500"}`}>{side || "—"}</td>
                      <td className={`px-4 py-3 text-xs font-bold ${SIDE_CLS[side] ?? ""}`}>{r.amount != null ? fmt(r.amount) : "—"}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs truncate max-w-[240px]">{r.entry_description ?? r.description ?? "—"}</td>
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
