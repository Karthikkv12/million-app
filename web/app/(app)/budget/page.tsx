"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fetchBudget, saveBudget, BudgetEntry } from "@/lib/api";
import { Plus, X } from "lucide-react";

const TYPES = ["EXPENSE", "INCOME", "ASSET"] as const;
const PIE_COLORS = ["#3b82f6","#22c55e","#f59e0b","#ef4444","#a78bfa","#ec4899","#14b8a6","#f97316","#6366f1","#84cc16"];
const TYPE_COLOR: Record<string, string> = {
  EXPENSE: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  INCOME:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  ASSET:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
};
const fmt = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2 });

function NewEntryForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [type, setType]     = useState<string>("EXPENSE");
  const [cat, setCat]       = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc]     = useState("");
  const [err, setErr]       = useState("");

  const mut = useMutation({
    mutationFn: () => saveBudget({ type, category: cat, amount: parseFloat(amount), date, description: desc }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  const inputCls = "w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 dark:text-white">New Entry</h3>
        <button onClick={onDone} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Category</label>
          <input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="General" className={inputCls} />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Amount ($)</label>
          <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </div>
        <div className="col-span-2 sm:col-span-2">
          <label className="text-xs text-gray-400 block mb-1">Description (opt.)</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional note" className={inputCls} />
        </div>
      </div>
      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      <button onClick={() => mut.mutate()} disabled={mut.isPending || !cat || !amount}
        className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
        {mut.isPending ? "Saving…" : "Save Record"}
      </button>
    </div>
  );
}

export default function BudgetPage() {
  const [showNew, setShowNew]         = useState(false);
  const [typeFilter, setTypeFilter]   = useState<string>("ALL");

  const { data: entries = [], isLoading } = useQuery<BudgetEntry[]>({ queryKey: ["budget"], queryFn: fetchBudget, staleTime: 30_000 });

  const expenses = entries.filter((e) => e.type.toUpperCase() === "EXPENSE");
  const income   = entries.filter((e) => e.type.toUpperCase() === "INCOME");
  const assets   = entries.filter((e) => e.type.toUpperCase() === "ASSET");
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const totalIncome   = income.reduce((s, e) => s + e.amount, 0);
  const totalAssets   = assets.reduce((s, e) => s + e.amount, 0);
  const net           = totalIncome - totalExpenses;

  const pieData = Object.entries(
    expenses.reduce<Record<string, number>>((acc, e) => { acc[e.category] = (acc[e.category] ?? 0) + e.amount; return acc; }, {})
  ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  const filtered = typeFilter === "ALL"
    ? [...entries].sort((a, b) => b.date.localeCompare(a.date))
    : [...entries].filter((e) => e.type.toUpperCase() === typeFilter).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">Budget</h1>
        <button onClick={() => setShowNew((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
            showNew ? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}>
          {showNew ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Entry</>}
        </button>
      </div>

      {showNew && <NewEntryForm onDone={() => setShowNew(false)} />}
      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Income",   value: fmt(totalIncome),   color: "text-green-500" },
          { label: "Total Expenses", value: fmt(totalExpenses), color: "text-red-500"   },
          { label: "Total Assets",   value: fmt(totalAssets),   color: "text-blue-500"  },
          { label: "Net",            value: fmt(net),           color: net >= 0 ? "text-green-500" : "text-red-500" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
            <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide mb-1">{label}</div>
            <div className={`text-lg sm:text-xl font-black ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Chart + Table — stacked on mobile, side-by-side on lg */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* Pie chart */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 lg:w-80 shrink-0">
          <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">Expense Breakdown</h2>
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
          {/* Type filter */}
          <div className="flex gap-1.5 flex-wrap p-3 border-b border-gray-100 dark:border-gray-800">
            {["ALL", "EXPENSE", "INCOME", "ASSET"].map((t) => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                  typeFilter === t ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}>{t}</button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 p-4">No entries yet.</p>
          ) : (
            <>
              {/* Mobile: cards */}
              <div className="flex flex-col divide-y divide-gray-50 dark:divide-gray-800 sm:hidden overflow-y-auto max-h-[400px]">
                {filtered.map((e, i) => (
                  <div key={i} className="flex items-center justify-between p-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-900 dark:text-white">{e.category}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${TYPE_COLOR[e.type.toUpperCase()] ?? ""}`}>{e.type.toUpperCase()}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{e.date.slice(0, 10)} {e.description ? `· ${e.description}` : ""}</p>
                    </div>
                    <span className={`font-bold text-sm ${e.type.toUpperCase() === "EXPENSE" ? "text-red-500" : e.type.toUpperCase() === "INCOME" ? "text-green-500" : "text-blue-500"}`}>
                      {fmt(e.amount)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
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
                      <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{e.date.slice(0, 10)}</td>
                        <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-white">{e.category}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${TYPE_COLOR[e.type.toUpperCase()] ?? ""}`}>
                            {e.type.toUpperCase()}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 font-bold text-xs ${
                          e.type.toUpperCase() === "EXPENSE" ? "text-red-500" :
                          e.type.toUpperCase() === "INCOME"  ? "text-green-500" : "text-blue-500"
                        }`}>{fmt(e.amount)}</td>
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
