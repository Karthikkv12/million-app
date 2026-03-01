"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchBudget, saveBudget, updateBudget, deleteBudget,
  BudgetEntry, BudgetEntryType, BudgetRecurrence,
  fetchCCWeeks, saveCCWeek, updateCCWeek, deleteCCWeek, CreditCardWeek,
} from "@/lib/api";
import {
  Plus, ChevronLeft, ChevronRight, Trash2, Check, X, Repeat, Zap, PencilLine, CreditCard,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

// ── constants ─────────────────────────────────────────────────────────────────
const PIE_COLORS = [
  "#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444",
  "#06b6d4","#84cc16","#f97316","#ec4899","#14b8a6",
  "#6366f1","#f43f5e","#22d3ee","#a3e635","#fb923c",
];

const CATEGORIES = [
  "Food & Dining","Groceries","Transport","Gas","Entertainment",
  "Shopping","Utilities","Insurance","Healthcare","Education",
  "Subscriptions","Housing","Travel","Savings","Investment","Tax",
  "Personal Care","Pets","Gifts","Other",
];

const RECURRENCE_MONTHS: Record<BudgetRecurrence, number> = {
  MONTHLY: 1, SEMI_ANNUAL: 6, ANNUAL: 12,
};
const RECURRENCE_LABEL: Record<BudgetRecurrence, string> = {
  MONTHLY: "Monthly", SEMI_ANNUAL: "Every 6 mo", ANNUAL: "Yearly",
};

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtK = (v: number) => v >= 1000 ? "$" + (v / 1000).toFixed(1) + "k" : "$" + Math.round(v);

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", {
    month: "long", year: "numeric",
  });
}
function proratedMonthly(entry: BudgetEntry): number {
  const months = RECURRENCE_MONTHS[(entry.recurrence ?? "ANNUAL") as BudgetRecurrence];
  return entry.amount / months;
}
function recurringAppliesToMonth(entry: BudgetEntry, targetKey: string): boolean {
  const period = RECURRENCE_MONTHS[(entry.recurrence ?? "ANNUAL") as BudgetRecurrence];
  const base = new Date(entry.date.slice(0, 10) + "T00:00:00");
  const [ty, tm] = targetKey.split("-").map(Number);
  const diff = (ty - base.getFullYear()) * 12 + (tm - (base.getMonth() + 1));
  return diff >= 0 && diff % period === 0;
}

// ── draft row type ────────────────────────────────────────────────────────────
interface DraftRow {
  id?: number;
  category: string;
  type: "EXPENSE" | "INCOME" | "ASSET";
  entry_type: BudgetEntryType;
  recurrence: BudgetRecurrence;
  amount: string;
  date: string;
  description: string;
}

function blankDraft(month: string, isRecurring: boolean): DraftRow {
  return {
    category: "",
    type: "EXPENSE",
    entry_type: isRecurring ? "RECURRING" : "FLOATING",
    recurrence: "MONTHLY",
    amount: "",
    date: `${month}-01`,
    description: "",
  };
}

// ── shared input styles ───────────────────────────────────────────────────────
const cellCls = "w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground/25 focus:bg-blue-500/10 rounded px-1 py-0.5";
const selCls  = "w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-sm text-foreground px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500";

// ── EditableRow ───────────────────────────────────────────────────────────────
function EditableRow({
  draft, isRecurring, onChange, onSave, onCancel, saving,
}: {
  draft: DraftRow;
  isRecurring: boolean;
  onChange: (d: DraftRow) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const firstRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof DraftRow, v: string) => onChange({ ...draft, [k]: v });

  useEffect(() => { firstRef.current?.focus(); }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter")  onSave();
    if (e.key === "Escape") onCancel();
  };

  return (
    <tr className="bg-blue-500/5 border-b border-blue-500/20" onKeyDown={onKey}>
      <td className="px-2 py-1.5 w-[115px]">
        <input
          ref={firstRef}
          type="date" value={draft.date}
          onChange={(e) => set("date", e.target.value)}
          className={cellCls + " w-[105px]"}
        />
      </td>
      <td className="px-2 py-1.5">
        <select value={draft.category} onChange={(e) => set("category", e.target.value)} className={selCls}>
          <option value="">— category —</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5 w-[110px]">
        <select value={draft.type} onChange={(e) => set("type", e.target.value as DraftRow["type"])} className={selCls}>
          <option value="EXPENSE">Expense</option>
          <option value="INCOME">Income</option>
          <option value="ASSET">Asset</option>
        </select>
      </td>
      {isRecurring && (
        <td className="px-2 py-1.5 w-[120px]">
          <select
            value={draft.recurrence}
            onChange={(e) => set("recurrence", e.target.value as BudgetRecurrence)}
            className={selCls}
          >
            <option value="MONTHLY">Monthly</option>
            <option value="SEMI_ANNUAL">Every 6 mo</option>
            <option value="ANNUAL">Yearly</option>
          </select>
        </td>
      )}
      <td className="px-2 py-1.5 w-[120px]">
        <input
          type="number" step="0.01" min="0"
          value={draft.amount}
          onChange={(e) => set("amount", e.target.value)}
          placeholder="0.00"
          className={cellCls + " text-right"}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Note (optional)"
          className={cellCls}
        />
      </td>
      <td className="px-2 py-1.5 w-[70px]">
        <div className="flex items-center gap-1">
          <button
            onClick={onSave}
            disabled={saving || !draft.category || !draft.amount}
            title="Save (Enter)"
            className="p-1.5 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/40 disabled:opacity-30 transition"
          >
            {saving ? <span className="text-[10px]">...</span> : <Check size={13} />}
          </button>
          <button
            onClick={onCancel}
            title="Cancel (Esc)"
            className="p-1.5 rounded-lg bg-[var(--surface-2)] text-foreground/50 hover:bg-[var(--border)] transition"
          >
            <X size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── ReadRow ───────────────────────────────────────────────────────────────────
function ReadRow({
  entry, displayAmount, isRecurring, onEdit,
}: {
  entry: BudgetEntry;
  displayAmount: number;
  isRecurring: boolean;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState(false);
  const del = useMutation({
    mutationFn: () => deleteBudget(entry.id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget"] }),
  });

  const typeUp = entry.type?.toUpperCase();
  const isExpense = typeUp === "EXPENSE";
  const isIncome  = typeUp === "INCOME";
  const amtCls = isExpense ? "text-red-400" : isIncome ? "text-emerald-400" : "text-blue-400";

  return (
    <tr className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors group">
      <td className="px-3 py-2.5 text-xs text-foreground/50 whitespace-nowrap">
        {entry.date.slice(0, 10)}
      </td>
      <td className="px-3 py-2.5 text-sm font-medium text-foreground">
        {entry.category || "---"}
      </td>
      <td className="px-3 py-2.5">
        <span className={"inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full " + (
          isExpense ? "bg-red-500/15 text-red-400"
          : isIncome ? "bg-emerald-500/15 text-emerald-400"
          : "bg-blue-500/15 text-blue-400"
        )}>
          {entry.type}
        </span>
      </td>
      {isRecurring && (
        <td className="px-3 py-2.5 text-xs text-foreground/50">
          {RECURRENCE_LABEL[(entry.recurrence ?? "ANNUAL") as BudgetRecurrence]}
        </td>
      )}
      <td className={"px-3 py-2.5 text-sm font-bold text-right whitespace-nowrap " + amtCls}>
        {fmt(displayAmount)}
        {isRecurring && displayAmount !== entry.amount && (
          <span className="ml-1 text-[10px] font-normal text-foreground/30">
            ({fmt(entry.amount)})
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-foreground/40 max-w-[160px] truncate">
        {entry.description ?? ""}
      </td>
      <td className="px-3 py-2.5 w-[80px]" onClick={(e) => e.stopPropagation()}>
        {confirmDel ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="text-[11px] px-2 py-0.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {del.isPending ? "..." : "Yes"}
            </button>
            <button
              onClick={() => setConfirmDel(false)}
              className="text-[11px] px-2 py-0.5 rounded-lg bg-[var(--surface-2)] text-foreground/70"
            >
              No
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={onEdit}
              title="Edit"
              className="p-1.5 rounded-lg text-foreground/40 hover:text-blue-400 hover:bg-blue-500/10 transition"
            >
              <PencilLine size={13} />
            </button>
            <button
              onClick={() => setConfirmDel(true)}
              title="Delete"
              className="p-1.5 rounded-lg text-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────
function Section({
  title, icon, accentCls, rows, isRecurring, currentMonth,
}: {
  title: string;
  icon: React.ReactNode;
  accentCls: string;
  rows: { entry: BudgetEntry; displayAmount: number }[];
  isRecurring: boolean;
  currentMonth: string;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts]       = useState<DraftRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow | null>(null);

  const mut = useMutation({
    mutationFn: (d: DraftRow) => {
      const body: Omit<BudgetEntry, "id"> = {
        category: d.category,
        type: d.type,
        entry_type: d.entry_type,
        recurrence: d.entry_type === "RECURRING" ? d.recurrence : undefined,
        amount: parseFloat(d.amount),
        date: d.date,
        description: d.description || undefined,
      };
      return d.id ? updateBudget(d.id, body) : saveBudget(body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget"] }),
  });

  const addRow = () => setDrafts((p) => [...p, blankDraft(currentMonth, isRecurring)]);

  const saveDraft = async (idx: number) => {
    const d = drafts[idx];
    if (!d.category || !d.amount) return;
    await mut.mutateAsync(d);
    setDrafts((p) => p.filter((_, i) => i !== idx));
  };

  const startEdit = (entry: BudgetEntry) => {
    setEditingId(entry.id!);
    setEditDraft({
      id: entry.id,
      category: entry.category,
      type: (entry.type?.toUpperCase() as DraftRow["type"]) ?? "EXPENSE",
      entry_type: (entry.entry_type ?? (isRecurring ? "RECURRING" : "FLOATING")) as BudgetEntryType,
      recurrence: (entry.recurrence ?? "MONTHLY") as BudgetRecurrence,
      amount: String(entry.amount),
      date: entry.date.slice(0, 10),
      description: entry.description ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editDraft?.category || !editDraft.amount) return;
    await mut.mutateAsync(editDraft);
    setEditingId(null);
    setEditDraft(null);
  };

  const total = rows.reduce((s, r) => s + r.displayAmount, 0);
  const colSpan = isRecurring ? 7 : 6;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/40">
        <div className="flex items-center gap-2">
          <span className={accentCls}>{icon}</span>
          <span className="font-bold text-sm text-foreground">{title}</span>
          <span className="text-xs bg-[var(--surface-2)] text-foreground/50 px-2 py-0.5 rounded-full border border-[var(--border)]">
            {rows.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={"text-sm font-bold " + accentCls}>{fmt(total)}</span>
          <button
            onClick={addRow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition"
          >
            <Plus size={12} /> Add row
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-semibold text-foreground/40 uppercase tracking-wider border-b border-[var(--border)]">
              <th className="px-3 py-2 text-left w-[115px]">Date</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left w-[110px]">Type</th>
              {isRecurring && <th className="px-3 py-2 text-left w-[120px]">Frequency</th>}
              <th className="px-3 py-2 text-right w-[120px]">Amount</th>
              <th className="px-3 py-2 text-left">Note</th>
              <th className="px-3 py-2 w-[80px]"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entry, displayAmount }) =>
              editingId === entry.id && editDraft ? (
                <EditableRow
                  key={entry.id}
                  draft={editDraft}
                  isRecurring={isRecurring}
                  onChange={setEditDraft}
                  onSave={saveEdit}
                  onCancel={() => { setEditingId(null); setEditDraft(null); }}
                  saving={mut.isPending}
                />
              ) : (
                <ReadRow
                  key={entry.id}
                  entry={entry}
                  displayAmount={displayAmount}
                  isRecurring={isRecurring}
                  onEdit={() => startEdit(entry)}
                />
              )
            )}

            {drafts.map((d, idx) => (
              <EditableRow
                key={"new-" + idx}
                draft={d}
                isRecurring={isRecurring}
                onChange={(nd) => setDrafts((p) => p.map((r, i) => i === idx ? nd : r))}
                onSave={() => saveDraft(idx)}
                onCancel={() => setDrafts((p) => p.filter((_, i) => i !== idx))}
                saving={mut.isPending}
              />
            ))}

            {rows.length === 0 && drafts.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-foreground/30">
                  No entries yet — click <strong className="text-foreground/50">Add row</strong> to get started
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── computeMonthStats ────────────────────────────────────────────────────────
function computeMonthStats(entries: BudgetEntry[], key: string) {
  let income = 0, expense = 0;
  for (const e of entries) {
    const et = (e.entry_type ?? "FLOATING").toUpperCase();
    const isIncome = e.type?.toUpperCase() === "INCOME";
    const isExpense = e.type?.toUpperCase() === "EXPENSE";
    if (et !== "RECURRING") {
      if (e.date.slice(0, 7) === key) {
        if (isIncome)  income  += e.amount;
        if (isExpense) expense += e.amount;
      }
    } else {
      if (recurringAppliesToMonth(e, key)) {
        const m = RECURRENCE_MONTHS[(e.recurrence ?? "ANNUAL") as BudgetRecurrence];
        const prorated = e.amount / m;
        if (isIncome)  income  += prorated;
        if (isExpense) expense += prorated;
      }
    }
  }
  return { income, expense, net: income - expense };
}

// ── TrendChart ────────────────────────────────────────────────────────────────
function TrendChart({ entries }: { entries: BudgetEntry[] }) {
  const data = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const { income, expense } = computeMonthStats(entries, key);
      return { month: SHORT_MONTHS[d.getMonth()], Income: Math.round(income), Expenses: Math.round(expense) };
    });
  }, [entries]);

  const hasData = data.some((d) => d.Income > 0 || d.Expenses > 0);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
      <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wide mb-3">12-Month Trend</p>
      {!hasData ? (
        <div className="h-[180px] flex items-center justify-center text-sm text-foreground/30">
          No data yet — add entries to see trends
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} barGap={2} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: "var(--foreground)", opacity: 0.5 }} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              formatter={(v: unknown, name: string) => [fmt(Number(v)), name]}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="Income"   fill="#10b981" radius={[3,3,0,0]} />
            <Bar dataKey="Expenses" fill="#ef4444" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── SavingsRate ───────────────────────────────────────────────────────────────
function SavingsRate({ income, net }: { income: number; net: number }) {
  const rate = income > 0 ? Math.round((net / income) * 100) : 0;
  const color = rate < 10 ? "bg-red-500" : rate < 20 ? "bg-amber-400" : "bg-emerald-500";
  const hint  = rate < 10 ? "Below target" : rate < 20 ? "Getting there" : "On track";
  const textColor = rate < 10 ? "text-red-400" : rate < 20 ? "text-amber-400" : "text-emerald-400";
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
      <p className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wide mb-1">Savings Rate</p>
      <p className={"text-2xl font-black " + textColor}>{rate}%</p>
      <div className="mt-2 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
        <div className={"h-full rounded-full transition-all " + color} style={{ width: Math.min(Math.max(rate, 0), 100) + "%" }} />
      </div>
      <p className="text-[11px] text-foreground/40 mt-1">{hint}</p>
    </div>
  );
}

// ── AnnualSummary ─────────────────────────────────────────────────────────────
function AnnualSummary({ entries, year }: { entries: BudgetEntry[]; year: number }) {
  const rows = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month: SHORT_MONTHS[i], key, ...computeMonthStats(entries, key) };
  }), [entries, year]);

  const totals = rows.reduce((acc, r) => ({ income: acc.income + r.income, expense: acc.expense + r.expense, net: acc.net + r.net }), { income: 0, expense: 0, net: 0 });
  const avgRate = totals.income > 0 ? Math.round((totals.net / totals.income) * 100) : 0;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/40">
        <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wide">{year} Annual Summary</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-semibold text-foreground/40 uppercase tracking-wider border-b border-[var(--border)]">
              <th className="px-3 py-2 text-left">Month</th>
              <th className="px-3 py-2 text-right">Income</th>
              <th className="px-3 py-2 text-right">Expenses</th>
              <th className="px-3 py-2 text-right">Net</th>
              <th className="px-3 py-2 text-left w-[140px]">Savings Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rate = r.income > 0 ? Math.round((r.net / r.income) * 100) : 0;
              const color = rate < 10 ? "bg-red-500" : rate < 20 ? "bg-amber-400" : "bg-emerald-500";
              const empty = r.income === 0 && r.expense === 0;
              return (
                <tr key={r.key} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                  <td className="px-3 py-2 font-medium text-foreground/70">{r.month}</td>
                  <td className="px-3 py-2 text-right text-emerald-400 font-semibold">{empty ? "—" : fmt(r.income)}</td>
                  <td className="px-3 py-2 text-right text-red-400 font-semibold">{empty ? "—" : fmt(r.expense)}</td>
                  <td className={"px-3 py-2 text-right font-bold " + (r.net >= 0 ? "text-emerald-400" : "text-red-400")}>{empty ? "—" : fmt(r.net)}</td>
                  <td className="px-3 py-2">
                    {empty ? <span className="text-foreground/30">—</span> : (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                          <div className={"h-full rounded-full " + color} style={{ width: Math.min(Math.max(rate, 0), 100) + "%" }} />
                        </div>
                        <span className="text-[11px] text-foreground/50 w-8 text-right">{rate}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2)]/40 font-bold">
              <td className="px-3 py-2 text-foreground/60 text-xs uppercase">Total</td>
              <td className="px-3 py-2 text-right text-emerald-400">{fmt(totals.income)}</td>
              <td className="px-3 py-2 text-right text-red-400">{fmt(totals.expense)}</td>
              <td className={"px-3 py-2 text-right " + (totals.net >= 0 ? "text-emerald-400" : "text-red-400")}>{fmt(totals.net)}</td>
              <td className="px-3 py-2 text-[11px] text-foreground/50">Avg {avgRate}% saved</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── TopCategoriesBar ────────────────────────────────────────────────────────────
function TopCategoriesBar({ pieData }: { pieData: { name: string; value: number }[] }) {
  const top = pieData.slice(0, 7);
  const total = top.reduce((s, d) => s + d.value, 0);
  if (top.length === 0) return null;
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
      <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wide mb-3">Top Spending Categories</p>
      <div className="flex flex-col gap-2">
        {top.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          return (
            <div key={d.name} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="text-xs text-foreground/70 w-28 truncate shrink-0">{d.name}</span>
              <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: pct + "%", background: PIE_COLORS[i % PIE_COLORS.length] }} />
              </div>
              <span className="text-xs font-semibold text-foreground/70 w-16 text-right shrink-0">{fmt(d.value)}</span>
              <span className="text-[11px] text-foreground/35 w-8 text-right shrink-0">{Math.round(pct)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── IncomeExpenseSplit ──────────────────────────────────────────────────────────
function IncomeExpenseSplit({
  income, expense, fixedExp, floatExp,
}: { income: number; expense: number; fixedExp: number; floatExp: number }) {
  const data = [
    { name: "Income",   value: Math.round(income),   fill: "#10b981" },
    { name: "Expenses", value: Math.round(expense),  fill: "#ef4444" },
    { name: "Fixed",    value: Math.round(fixedExp), fill: "#8b5cf6" },
    { name: "Variable", value: Math.round(floatExp), fill: "#f59e0b" },
  ];
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
      <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wide mb-3">Income vs Expenses</p>
      <div className="flex flex-col gap-3">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2">
            <span className="text-xs text-foreground/60 w-16 shrink-0">{d.name}</span>
            <div className="flex-1 h-5 rounded-lg bg-[var(--surface-2)] overflow-hidden">
              <div
                className="h-full rounded-lg flex items-center justify-end pr-2 transition-all"
                style={{ width: Math.max((d.value / max) * 100, d.value > 0 ? 4 : 0) + "%", background: d.fill }}
              >
                {d.value > 0 && <span className="text-[11px] font-bold text-white whitespace-nowrap">{fmtK(d.value)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between">
        <span className="text-xs text-foreground/40">Fixed vs Variable expenses</span>
        <span className="text-xs font-semibold text-foreground/60">
          {expense > 0 ? Math.round((fixedExp / expense) * 100) : 0}% fixed
        </span>
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────
function getMondayISO(d: Date): string {
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon.toISOString().slice(0, 10);
}

function fmt$(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Robinhood Credit Card Section ─────────────────────────────────────────────
function CreditCardSection() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery<CreditCardWeek[]>({
    queryKey: ["cc-weeks"],
    queryFn: fetchCCWeeks,
    staleTime: 30_000,
  });

  // draft for new / edit row
  const emptyDraft = (): Omit<CreditCardWeek, "id"> => ({
    week_start: getMondayISO(new Date()),
    balance: 0,
    squared_off: false,
    paid_amount: null,
    note: "",
  });

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Omit<CreditCardWeek, "id">>(emptyDraft());
  const [editId, setEditId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Omit<CreditCardWeek, "id">>(emptyDraft());

  const saveMut = useMutation({
    mutationFn: (body: Omit<CreditCardWeek, "id">) => saveCCWeek(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-weeks"] }); setAdding(false); setDraft(emptyDraft()); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Omit<CreditCardWeek, "id"> }) => updateCCWeek(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cc-weeks"] }); setEditId(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteCCWeek(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cc-weeks"] }),
  });

  // quick toggle squared_off without opening edit mode
  const toggleSquared = (row: CreditCardWeek) => {
    if (!row.id) return;
    updateMut.mutate({
      id: row.id,
      body: { week_start: row.week_start, balance: row.balance, squared_off: !row.squared_off, paid_amount: row.paid_amount ?? null, note: row.note ?? "" },
    });
  };

  const outstanding = rows.filter((r) => !r.squared_off).reduce((s, r) => s + r.balance, 0);
  const pendingCount = rows.filter((r) => !r.squared_off).length;

  function startEdit(row: CreditCardWeek) {
    if (!row.id) return;
    setEditId(row.id);
    setEditDraft({ week_start: row.week_start.slice(0, 10), balance: row.balance, squared_off: row.squared_off, paid_amount: row.paid_amount ?? null, note: row.note ?? "" });
  }

  const inputCls = "bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-full";

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-4">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-rose-400" />
          <span className="text-sm font-semibold">Robinhood Credit Card</span>
          <span className="text-xs text-foreground/40">weekly tracker</span>
        </div>
        <button
          onClick={() => { setAdding(true); setDraft(emptyDraft()); }}
          className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 transition-colors"
        >
          <Plus size={12} /> Add Week
        </button>
      </div>

      {/* summary bar */}
      {rows.length > 0 && (
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-foreground/50">Outstanding:</span>
            <span className={outstanding > 0 ? "font-bold text-rose-400" : "font-bold text-emerald-400"}>{fmt$(outstanding)}</span>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
              <span className="text-foreground/50">{pendingCount} week{pendingCount > 1 ? "s" : ""} pending</span>
            </div>
          )}
          {pendingCount === 0 && rows.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400 font-medium">All squared off!</span>
            </div>
          )}
        </div>
      )}

      {/* table */}
      {isLoading ? (
        <p className="text-xs text-foreground/40 py-4 text-center">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-foreground/40 text-left border-b border-[var(--border)]">
                <th className="pb-2 pr-3 font-medium">Week (Mon)</th>
                <th className="pb-2 pr-3 font-medium">Card Balance</th>
                <th className="pb-2 pr-3 font-medium">Paid from Trading</th>
                <th className="pb-2 pr-3 font-medium">Squared Off?</th>
                <th className="pb-2 pr-3 font-medium">Note</th>
                <th className="pb-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* add row */}
              {adding && (
                <tr className="border-b border-[var(--border)] bg-blue-950/20">
                  <td className="py-2 pr-3"><input type="date" className={inputCls} value={draft.week_start} onChange={(e) => setDraft({ ...draft, week_start: e.target.value })} /></td>
                  <td className="py-2 pr-3"><input type="number" className={inputCls} placeholder="0.00" value={draft.balance || ""} onChange={(e) => setDraft({ ...draft, balance: parseFloat(e.target.value) || 0 })} /></td>
                  <td className="py-2 pr-3"><input type="number" className={inputCls} placeholder="0.00" value={draft.paid_amount ?? ""} onChange={(e) => setDraft({ ...draft, paid_amount: e.target.value ? parseFloat(e.target.value) : null })} /></td>
                  <td className="py-2 pr-3">
                    <button onClick={() => setDraft({ ...draft, squared_off: !draft.squared_off })} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${draft.squared_off ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                      {draft.squared_off ? "✓ Paid" : "● Pending"}
                    </button>
                  </td>
                  <td className="py-2 pr-3"><input type="text" className={inputCls} placeholder="optional note" value={draft.note ?? ""} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></td>
                  <td className="py-2 text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => saveMut.mutate(draft)} className="p-1 rounded text-emerald-400 hover:bg-emerald-500/20 transition-colors"><Check size={13} /></button>
                      <button onClick={() => { setAdding(false); setDraft(emptyDraft()); }} className="p-1 rounded text-foreground/40 hover:bg-foreground/10 transition-colors"><X size={13} /></button>
                    </div>
                  </td>
                </tr>
              )}
              {rows.length === 0 && !adding && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-foreground/30 text-xs">No entries yet — click "Add Week" to start tracking</td>
                </tr>
              )}
              {rows.map((row) =>
                editId === row.id ? (
                  <tr key={row.id} className="border-b border-[var(--border)] bg-blue-950/20">
                    <td className="py-2 pr-3"><input type="date" className={inputCls} value={editDraft.week_start} onChange={(e) => setEditDraft({ ...editDraft, week_start: e.target.value })} /></td>
                    <td className="py-2 pr-3"><input type="number" className={inputCls} value={editDraft.balance || ""} onChange={(e) => setEditDraft({ ...editDraft, balance: parseFloat(e.target.value) || 0 })} /></td>
                    <td className="py-2 pr-3"><input type="number" className={inputCls} value={editDraft.paid_amount ?? ""} onChange={(e) => setEditDraft({ ...editDraft, paid_amount: e.target.value ? parseFloat(e.target.value) : null })} /></td>
                    <td className="py-2 pr-3">
                      <button onClick={() => setEditDraft({ ...editDraft, squared_off: !editDraft.squared_off })} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${editDraft.squared_off ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                        {editDraft.squared_off ? "✓ Paid" : "● Pending"}
                      </button>
                    </td>
                    <td className="py-2 pr-3"><input type="text" className={inputCls} value={editDraft.note ?? ""} onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })} /></td>
                    <td className="py-2 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => updateMut.mutate({ id: row.id!, body: editDraft })} className="p-1 rounded text-emerald-400 hover:bg-emerald-500/20 transition-colors"><Check size={13} /></button>
                        <button onClick={() => setEditId(null)} className="p-1 rounded text-foreground/40 hover:bg-foreground/10 transition-colors"><X size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id} className="border-b border-[var(--border)] hover:bg-foreground/5 transition-colors group">
                    <td className="py-2.5 pr-3 font-medium tabular-nums">{row.week_start.slice(0, 10)}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-rose-400 font-semibold">{fmt$(row.balance)}</td>
                    <td className="py-2.5 pr-3 tabular-nums text-emerald-400">{fmt$(row.paid_amount)}</td>
                    <td className="py-2.5 pr-3">
                      <button onClick={() => toggleSquared(row)} title="Click to toggle" className={`px-2 py-0.5 rounded-full text-xs font-semibold transition-colors ${row.squared_off ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" : "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"}`}>
                        {row.squared_off ? "✓ Paid" : "● Pending"}
                      </button>
                    </td>
                    <td className="py-2.5 pr-3 text-foreground/60 max-w-[160px] truncate">{row.note || "—"}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => startEdit(row)} className="p-1 rounded text-blue-400 hover:bg-blue-500/20 transition-colors opacity-0 group-hover:opacity-100"><PencilLine size={13} /></button>
                        <button onClick={() => row.id && deleteMut.mutate(row.id)} className="p-1 rounded text-rose-400 hover:bg-rose-500/20 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
      <p className="text-[11px] font-semibold text-foreground/50 uppercase tracking-wide mb-1">{label}</p>
      <p className={"text-2xl font-black " + cls}>{value}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BudgetPage() {
  const { data: allEntries = [], isLoading } = useQuery<BudgetEntry[]>({
    queryKey: ["budget"],
    queryFn: fetchBudget,
    staleTime: 30_000,
  });

  const [currentMonth, setCurrentMonth] = useState(() => monthKey(new Date()));

  const prev = () => {
    const [y, m] = currentMonth.split("-").map(Number);
    setCurrentMonth(monthKey(new Date(y, m - 2, 1)));
  };
  const next = () => {
    const [y, m] = currentMonth.split("-").map(Number);
    setCurrentMonth(monthKey(new Date(y, m, 1)));
  };

  const { floating, recurring } = useMemo(() => {
    const floating: { entry: BudgetEntry; displayAmount: number }[] = [];
    const recurring: { entry: BudgetEntry; displayAmount: number }[] = [];
    for (const entry of allEntries) {
      const et = (entry.entry_type ?? "FLOATING").toUpperCase();
      if (et !== "RECURRING") {
        if (entry.date.slice(0, 7) === currentMonth)
          floating.push({ entry, displayAmount: entry.amount });
      } else {
        if (recurringAppliesToMonth(entry, currentMonth))
          recurring.push({ entry, displayAmount: proratedMonthly(entry) });
      }
    }
    return { floating, recurring };
  }, [allEntries, currentMonth]);

  const stats = useMemo(() => {
    const all = [...floating, ...recurring];
    const expense  = all.filter((r) => r.entry.type?.toUpperCase() === "EXPENSE").reduce((s, r) => s + r.displayAmount, 0);
    const income   = all.filter((r) => r.entry.type?.toUpperCase() === "INCOME").reduce((s, r) => s + r.displayAmount, 0);
    const fixedExp = recurring.filter((r) => r.entry.type?.toUpperCase() === "EXPENSE").reduce((s, r) => s + r.displayAmount, 0);
    return { expense, income, fixedExp, net: income - expense };
  }, [floating, recurring]);

  const pieData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const { entry, displayAmount } of [...floating, ...recurring]) {
      if (entry.type?.toUpperCase() === "EXPENSE")
        map[entry.category] = (map[entry.category] ?? 0) + displayAmount;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
  }, [floating, recurring]);

  const totalEntries = floating.length + recurring.length;
  const [activeTab, setActiveTab] = useState<"monthly" | "annual">("monthly");
  const currentYear = Number(currentMonth.split("-")[0]);

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto w-full">

      {/* Header + tabs */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-foreground">Budget</h1>
        <div className="flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-1">
          <button
            onClick={() => setActiveTab("monthly")}
            className={"px-4 py-1.5 rounded-lg text-sm font-semibold transition " +
              (activeTab === "monthly"
                ? "bg-blue-600 text-white shadow"
                : "text-foreground/50 hover:text-foreground")}
          >
            Monthly
          </button>
          <button
            onClick={() => setActiveTab("annual")}
            className={"px-4 py-1.5 rounded-lg text-sm font-semibold transition " +
              (activeTab === "annual"
                ? "bg-blue-600 text-white shadow"
                : "text-foreground/50 hover:text-foreground")}
          >
            Annual Summary
          </button>
        </div>
      </div>

      {/* Month navigator — shown on both tabs */}
      <div className="flex items-center justify-between bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-2.5 mb-5">
        <button
          onClick={prev}
          className="p-1.5 rounded-xl hover:bg-[var(--surface-2)] transition text-foreground/60 hover:text-foreground"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          {activeTab === "monthly" ? (
            <>
              <p className="font-bold text-foreground">{monthLabel(currentMonth)}</p>
              <p className="text-xs text-foreground/40 mt-0.5">
                {isLoading ? "Loading..." : totalEntries + " entr" + (totalEntries === 1 ? "y" : "ies")}
              </p>
            </>
          ) : (
            <>
              <p className="font-bold text-foreground">{currentYear}</p>
              <p className="text-xs text-foreground/40 mt-0.5">Annual view</p>
            </>
          )}
        </div>
        <button
          onClick={next}
          className="p-1.5 rounded-xl hover:bg-[var(--surface-2)] transition text-foreground/60 hover:text-foreground"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ── MONTHLY TAB ─────────────────────────────────────────────────────── */}
      {activeTab === "monthly" && (
        <>
          {/* stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
            <StatCard label="Income"      value={fmt(stats.income)}   cls="text-emerald-400" />
            <StatCard label="Expenses"    value={fmt(stats.expense)}  cls="text-red-400" />
            <StatCard label="Fixed/Month" value={fmt(stats.fixedExp)} cls="text-purple-400" />
            <StatCard label="Net"         value={fmt(stats.net)}      cls={stats.net >= 0 ? "text-emerald-400" : "text-red-400"} />
            <SavingsRate income={stats.income} net={stats.net} />
          </div>

          {/* charts row — 3 equal columns */}
          {pieData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">

              {/* Donut pie */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
                <p className="text-xs font-semibold text-foreground/50 uppercase tracking-wide mb-1">Expense Mix</p>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%" cy="46%"
                      innerRadius={50}
                      outerRadius={78}
                      paddingAngle={2}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: unknown) => [fmt(Number(v)), "Amount"]}
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--foreground)",
                      }}
                      itemStyle={{ color: "var(--foreground)" }}
                      labelStyle={{ color: "var(--foreground)" }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={7}
                      wrapperStyle={{ fontSize: 10, paddingTop: 4, color: "var(--foreground)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Top categories */}
              <TopCategoriesBar pieData={pieData} />

              {/* Income vs expense split */}
              <IncomeExpenseSplit
                income={stats.income}
                expense={stats.expense}
                fixedExp={stats.fixedExp}
                floatExp={stats.expense - stats.fixedExp}
              />
            </div>
          )}

          {/* tables */}
          <div className="flex flex-col gap-5">
            <Section
              title="One-off / Floating"
              icon={<Zap size={14} />}
              accentCls="text-amber-400"
              rows={floating}
              isRecurring={false}
              currentMonth={currentMonth}
            />
            <Section
              title="Recurring / Fixed"
              icon={<Repeat size={14} />}
              accentCls="text-purple-400"
              rows={recurring}
              isRecurring={true}
              currentMonth={currentMonth}
            />
          </div>

          {/* Robinhood Credit Card tracker */}
          <CreditCardSection />
        </>
      )}

      {/* ── ANNUAL SUMMARY TAB ───────────────────────────────────────────────── */}
      {activeTab === "annual" && (
        <div className="flex flex-col gap-5">
          <TrendChart entries={allEntries} />
          <AnnualSummary entries={allEntries} year={currentYear} />
        </div>
      )}
    </div>
  );
}
