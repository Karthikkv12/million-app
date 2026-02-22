"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fetchBudget, saveBudget, BudgetEntry } from "@/lib/api";
import { Plus, X, PiggyBank } from "lucide-react";
import { PageHeader, SectionLabel, EmptyState, SkeletonStatGrid } from "@/components/ui";

const PIE_COLORS = ["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#84cc16","#f97316"];
const TYPE_COLOR: Record<string, string> = {
  EXPENSE: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  INCOME:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  ASSET:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};
const fmt = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2 });

const inp = "w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

function NewEntryForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [cat, setCat]     = useState("");
  const [type, setType]   = useState("EXPENSE");
  const [amount, setAmt]  = useState("");
  const [date, setDate]   = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc]   = useState("");
  const [err, setErr]     = useState("");

  const mut = useMutation({
    mutationFn: () => saveBudget({ category: cat, type, amount: parseFloat(amount), date, description: desc || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 dark:text-white">New Entry</h3>
        <button onClick={onDone} className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Category</label>
          <input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="e.g. Commissions" className={inp} />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inp}>
            <option>EXPENSE</option><option>INCOME</option><option>ASSET</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Amount ($)</label>
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmt(e.target.value)} className={inp} />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
        </div>
      </div>
      <div className="mb-4">
        <label className="text-xs text-gray-400 block mb-1">Description (opt.)</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional note…" className={inp} />
      </div>
      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      <button onClick={() => mut.mutate()} disabled={mut.isPending || !cat || !amount}
        className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
        {mut.isPending ? "Saving…" : "Add Entry"}
      </button>
    </div>
  );
}

export default function BudgetPage() {
  const { data: entries = [], isLoading } = useQuery<BudgetEntry[]>({ queryKey: ["budget"], queryFn: fetchBudget, staleTime: 30_000 });
  const [showNew, setShowNew]       = useState(false);
  const [typeFilter, setTypeFilter] = useState("ALL");

  const totalIncome  = entries.filter((e) => e.type.toUpperCase() === "INCOME").reduce((s, e) => s + e.amount, 0);
  const totalExpense = entries.filter((e) => e.type.toUpperCase() === "EXPENSE").reduce((s, e) => s + e.amount, 0);
  const totalAssets  = entries.filter((e) => e.type.toUpperCase() === "ASSET").reduce((s, e) => s + e.amount, 0);
  const net = totalIncome - totalExpense;

  const filtered = typeFilter === "ALL" ? entries : entries.filter((e) => e.type.toUpperCase() === typeFilter);
  const pieData = Object.entries(
    entries.filter((e) => e.type.toUpperCase() === "EXPENSE")
      .reduce((acc, e) => ({ ...acc, [e.category]: (acc[e.category] ?? 0) + e.amount }), {} as Record<string, number>)
  ).map(([name, value]) => ({ name, value }));

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Budget"
        action={
          <button onClick={() => setShowNew((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${showNew ? "bg-gray-100 dark:bg-gray-800 text-gray-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
            {showNew ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Entry</>}
          </button>
        }
      />

      {showNew && <NewEntryForm onDone={() => setShowNew(false)} />}

      {/* Stats */}
      {isLoading ? (
        <div className="mb-6"><SkeletonStatGrid count={4} /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {[
            { label: "Income",   value: fmt(totalIncome),  cls: "text-green-500" },
            { label: "Expenses", value: fmt(totalExpense), cls: "text-red-500"   },
            { label: "Assets",   value: fmt(totalAssets),  cls: "text-blue-500"  },
            { label: "Net",      value: fmt(net),          cls: net >= 0 ? "text-green-500" : "text-red-500" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 card-hover">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
              <p className={`text-xl sm:text-2xl font-black ${cls}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Chart + Entries */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Pie chart */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 lg:w-80 shrink-0">
          <SectionLabel>Expense Breakdown</SectionLabel>
          {pieData.length === 0 ? (
            <p className="text-sm text-gray-400">No expenses recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tooltip formatter={(v: any) => [fmt(Number(v)), "Amount"]} contentStyle={{ background: "#1f2937", border: "none", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Entries */}
        <div className="flex-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
          {/* Filter chips */}
          <div className="flex gap-1.5 flex-wrap p-3 border-b border-gray-100 dark:border-gray-800">
            {["ALL", "EXPENSE", "INCOME", "ASSET"].map((t) => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${typeFilter === t ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"}`}>{t}</button>
            ))}
          </div>

          {isLoading && <div className="p-4 space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-10 rounded-xl" />)}</div>}

          {!isLoading && filtered.length === 0 && (
            <EmptyState icon={PiggyBank} title="No entries" body="Add your first budget entry above." />
          )}

          {filtered.length > 0 && (
            <>
              {/* Mobile */}
              <div className="flex flex-col divide-y divide-gray-50 dark:divide-gray-800 sm:hidden overflow-y-auto max-h-[400px]">
                {filtered.map((e, i) => (
                  <div key={i} className="flex items-center justify-between p-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-900 dark:text-white">{e.category}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${TYPE_COLOR[e.type.toUpperCase()] ?? ""}`}>{e.type.toUpperCase()}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{e.date.slice(0, 10)} {e.description ? `· ${e.description}` : ""}</p>
                    </div>
                    <span className={`font-bold text-sm ${e.type.toUpperCase() === "EXPENSE" ? "text-red-500" : e.type.toUpperCase() === "INCOME" ? "text-green-500" : "text-blue-500"}`}>
                      {fmt(e.amount)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Desktop */}
              <div className="hidden sm:block overflow-y-auto max-h-[340px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 uppercase tracking-wide sticky top-0 bg-white dark:bg-gray-900">
                      {["Date", "Category", "Type", "Amount", "Desc"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e, i) => (
                      <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{e.date.slice(0, 10)}</td>
                        <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-white">{e.category}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${TYPE_COLOR[e.type.toUpperCase()] ?? ""}`}>
                            {e.type.toUpperCase()}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 font-bold text-xs ${e.type.toUpperCase() === "EXPENSE" ? "text-red-500" : e.type.toUpperCase() === "INCOME" ? "text-green-500" : "text-blue-500"}`}>
                          {fmt(e.amount)}
                        </td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs truncate max-w-[140px]">{e.description ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
