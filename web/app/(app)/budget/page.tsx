"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchBudget, saveBudget, updateBudget, deleteBudget,
  BudgetEntry, BudgetEntryType, BudgetRecurrence,
} from "@/lib/api";
import {
  Plus, X, PiggyBank, ChevronLeft, ChevronRight, Edit2, Trash2,
  Repeat, Zap, Check,
} from "lucide-react";
import { PageHeader, SectionLabel, EmptyState, SkeletonStatGrid, Badge } from "@/components/ui";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

// ── constants ────────────────────────────────────────────────────────────────
const PIE_COLORS = ["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#84cc16","#f97316","#ec4899","#14b8a6"];

const CATEGORIES = [
  "Food & Dining","Transport","Entertainment","Shopping",
  "Utilities","Insurance","Healthcare","Education",
  "Subscriptions","Housing","Travel","Savings","Investment","Tax","Other",
];

const RECURRENCE_MONTHS: Record<BudgetRecurrence, number> = {
  MONTHLY: 1,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

const RECURRENCE_LABEL: Record<BudgetRecurrence, string> = {
  MONTHLY: "Monthly",
  SEMI_ANNUAL: "Every 6 months",
  ANNUAL: "Annual",
};

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inp = "w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--surface)] text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500";

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Monthly prorated amount for a recurring entry */
function proratedMonthly(entry: BudgetEntry): number {
  const rec = (entry.recurrence ?? "ANNUAL") as BudgetRecurrence;
  return entry.amount / RECURRENCE_MONTHS[rec];
}

/** Returns which months this recurring entry "touches" (up to 24 into the past/future) */
function recurringMonths(entry: BudgetEntry): string[] {
  const rec = (entry.recurrence ?? "ANNUAL") as BudgetRecurrence;
  const period = RECURRENCE_MONTHS[rec];
  const base = new Date(entry.date + "T00:00:00");
  const keys: string[] = [];
  // spread backward 2 years and forward 2 years from base
  for (let i = -24; i <= 24; i++) {
    const d = new Date(base);
    d.setMonth(d.getMonth() + i * period);
    // Normalize to start-of-month
    for (let m = 0; m < period; m++) {
      const t = new Date(d);
      t.setMonth(t.getMonth() + m);
      keys.push(monthKey(t));
    }
  }
  return Array.from(new Set(keys));
}

/** Check if a recurring entry applies to the given YYYY-MM */
function recurringAppliesToMonth(entry: BudgetEntry, targetKey: string): boolean {
  const rec = (entry.recurrence ?? "ANNUAL") as BudgetRecurrence;
  const period = RECURRENCE_MONTHS[rec];
  const base = new Date(entry.date + "T00:00:00");
  const [ty, tm] = targetKey.split("-").map(Number);

  const diffMonths = (ty - base.getFullYear()) * 12 + (tm - (base.getMonth() + 1));
  if (diffMonths < 0) return false;
  return diffMonths % period === 0;
}

// ── Entry Form ────────────────────────────────────────────────────────────────
interface FormState {
  category: string;
  type: string;
  entry_type: BudgetEntryType;
  recurrence: BudgetRecurrence;
  amount: string;
  date: string;
  description: string;
}

function defaultForm(month: string): FormState {
  return {
    category: "",
    type: "EXPENSE",
    entry_type: "FLOATING",
    recurrence: "ANNUAL",
    amount: "",
    date: `${month}-01`,
    description: "",
  };
}

function EntryForm({
  initial,
  editId,
  onDone,
  defaultMonth,
}: {
  initial?: FormState;
  editId?: number;
  onDone: () => void;
  defaultMonth: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(initial ?? defaultForm(defaultMonth));
  const [err, setErr] = useState("");

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: () => {
      const body: Omit<BudgetEntry, "id"> = {
        category: form.category,
        type: form.type,
        entry_type: form.entry_type,
        recurrence: form.entry_type === "RECURRING" ? form.recurrence : undefined,
        amount: parseFloat(form.amount),
        date: form.date,
        description: form.description || undefined,
      };
      return editId ? updateBudget(editId, body) : saveBudget(body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budget"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-foreground">{editId ? "Edit Entry" : "New Entry"}</h3>
        <button onClick={onDone} className="p-1.5 rounded-xl text-foreground/70 hover:bg-[var(--surface-2)] transition"><X size={16} /></button>
      </div>

      {/* Entry type toggle */}
      <div className="flex gap-2 mb-4">
        {(["FLOATING", "RECURRING"] as BudgetEntryType[]).map((et) => (
          <button
            key={et}
            onClick={() => set("entry_type", et)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              form.entry_type === et
                ? "bg-blue-600 text-white"
                : "bg-[var(--surface-2)] text-foreground/70 hover:bg-[var(--border)]"
            }`}
          >
            {et === "FLOATING" ? <Zap size={12} /> : <Repeat size={12} />}
            {et === "FLOATING" ? "One-off / Floating" : "Recurring"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-xs text-foreground/70 block mb-1">Category</label>
          <select value={form.category} onChange={(e) => set("category", e.target.value)} className={inp}>
            <option value="">— select —</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-foreground/70 block mb-1">Type</label>
          <select value={form.type} onChange={(e) => set("type", e.target.value)} className={inp}>
            <option>EXPENSE</option>
            <option>INCOME</option>
            <option>ASSET</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-foreground/70 block mb-1">Amount ($)</label>
          <input type="number" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} className={inp} placeholder="0.00" />
        </div>
        <div>
          <label className="text-xs text-foreground/70 block mb-1">Date</label>
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={inp} />
        </div>
        {form.entry_type === "RECURRING" && (
          <div>
            <label className="text-xs text-foreground/70 block mb-1">Recurrence</label>
            <select value={form.recurrence} onChange={(e) => set("recurrence", e.target.value as BudgetRecurrence)} className={inp}>
              <option value="MONTHLY">Monthly</option>
              <option value="SEMI_ANNUAL">Every 6 months</option>
              <option value="ANNUAL">Annual (yearly)</option>
            </select>
          </div>
        )}
        <div className={form.entry_type === "RECURRING" ? "" : "sm:col-span-1"}>
          <label className="text-xs text-foreground/70 block mb-1">Description (opt.)</label>
          <input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional note…" className={inp} />
        </div>
      </div>

      {form.entry_type === "RECURRING" && form.amount && (
        <p className="text-xs text-blue-400 mb-3 bg-blue-500/10 rounded-xl px-3 py-2">
          💡 This {RECURRENCE_LABEL[form.recurrence]} payment of {fmt(parseFloat(form.amount) || 0)} will show as{" "}
          <strong>{fmt((parseFloat(form.amount) || 0) / RECURRENCE_MONTHS[form.recurrence])}/month</strong> in each applicable month.
        </p>
      )}

      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      <button
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !form.category || !form.amount}
        className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
      >
        {mut.isPending ? "Saving…" : editId ? "Save Changes" : "Add Entry"}
      </button>
    </div>
  );
}

// ── Delete confirm inline ─────────────────────────────────────────────────────
function DeleteConfirm({ onConfirm, onCancel, loading }: { onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-red-400">Delete?</span>
      <button onClick={onConfirm} disabled={loading} className="text-xs px-2 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition">
        {loading ? "…" : <Check size={12} />}
      </button>
      <button onClick={onCancel} className="text-xs px-2 py-1 rounded-lg bg-[var(--surface-2)] text-foreground hover:bg-[var(--border)] transition">
        <X size={12} />
      </button>
    </div>
  );
}

// ── Entry Row ─────────────────────────────────────────────────────────────────
function EntryRow({
  entry,
  displayAmount,
  onEdit,
  isRecurring,
}: {
  entry: BudgetEntry;
  displayAmount: number;
  onEdit: (e: BudgetEntry) => void;
  isRecurring: boolean;
}) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const delMut = useMutation({
    mutationFn: () => deleteBudget(entry.id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget"] }),
  });

  const amtColor = entry.type.toUpperCase() === "EXPENSE"
    ? "text-red-500" : entry.type.toUpperCase() === "INCOME"
    ? "text-green-500" : "text-blue-500";

  return (
    <tr className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors group">
      <td className="px-4 py-2.5 text-foreground/70 text-xs whitespace-nowrap">{entry.date.slice(0, 10)}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm text-foreground">{entry.category}</span>
          {isRecurring && (
            <span className="text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
              <Repeat size={9} /> {RECURRENCE_LABEL[(entry.recurrence ?? "ANNUAL") as BudgetRecurrence]}
            </span>
          )}
        </div>
        {entry.description && <p className="text-xs text-foreground/50 mt-0.5">{entry.description}</p>}
      </td>
      <td className="px-4 py-2.5">
        <Badge variant={entry.type.toUpperCase() === "EXPENSE" ? "danger" : entry.type.toUpperCase() === "INCOME" ? "success" : "info"}>
          {entry.type.toUpperCase()}
        </Badge>
      </td>
      <td className={`px-4 py-2.5 font-bold text-sm ${amtColor} whitespace-nowrap`}>
        {fmt(displayAmount)}
        {isRecurring && displayAmount !== entry.amount && (
          <span className="text-[10px] font-normal text-foreground/40 ml-1">({fmt(entry.amount)} total)</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {confirmDelete ? (
          <DeleteConfirm onConfirm={() => delMut.mutate()} onCancel={() => setConfirmDelete(false)} loading={delMut.isPending} />
        ) : (
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
            <button onClick={() => onEdit(entry)} className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition text-foreground/60 hover:text-blue-400">
              <Edit2 size={13} />
            </button>
            <button onClick={() => setConfirmDelete(true)} className="p-1.5 rounded-lg hover:bg-[var(--surface)] transition text-foreground/60 hover:text-red-400">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Mobile Entry Card ─────────────────────────────────────────────────────────
function EntryCard({
  entry,
  displayAmount,
  onEdit,
  isRecurring,
}: {
  entry: BudgetEntry;
  displayAmount: number;
  onEdit: (e: BudgetEntry) => void;
  isRecurring: boolean;
}) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const delMut = useMutation({
    mutationFn: () => deleteBudget(entry.id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget"] }),
  });

  const amtColor = entry.type.toUpperCase() === "EXPENSE"
    ? "text-red-500" : entry.type.toUpperCase() === "INCOME"
    ? "text-green-500" : "text-blue-500";

  return (
    <div className="flex items-start justify-between p-3 border-b border-[var(--border)]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-foreground">{entry.category}</span>
          <Badge variant={entry.type.toUpperCase() === "EXPENSE" ? "danger" : entry.type.toUpperCase() === "INCOME" ? "success" : "info"}>
            {entry.type.toUpperCase()}
          </Badge>
          {isRecurring && (
            <span className="text-[10px] bg-purple-500/15 text-purple-400 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
              <Repeat size={9} /> {RECURRENCE_LABEL[(entry.recurrence ?? "ANNUAL") as BudgetRecurrence]}
            </span>
          )}
        </div>
        <p className="text-xs text-foreground/50 mt-0.5">{entry.date.slice(0, 10)}{entry.description ? ` · ${entry.description}` : ""}</p>
      </div>
      <div className="flex items-center gap-2 ml-3 shrink-0">
        <div className="text-right">
          <span className={`font-bold text-sm ${amtColor}`}>{fmt(displayAmount)}</span>
          {isRecurring && displayAmount !== entry.amount && (
            <p className="text-[10px] text-foreground/40">{fmt(entry.amount)} total</p>
          )}
        </div>
        {confirmDelete ? (
          <DeleteConfirm onConfirm={() => delMut.mutate()} onCancel={() => setConfirmDelete(false)} loading={delMut.isPending} />
        ) : (
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(entry)} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition text-foreground/60 hover:text-blue-400">
              <Edit2 size={13} />
            </button>
            <button onClick={() => setConfirmDelete(true)} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition text-foreground/60 hover:text-red-400">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section (Floating or Recurring) ──────────────────────────────────────────
function BudgetSection({
  title,
  icon,
  color,
  entries,
  isRecurring,
  onEdit,
  totalLabel,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  entries: { entry: BudgetEntry; displayAmount: number }[];
  isRecurring: boolean;
  onEdit: (e: BudgetEntry) => void;
  totalLabel: string;
}) {
  const total = entries.reduce((s, { displayAmount }) => s + displayAmount, 0);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      {/* Section header */}
      <div className={`px-4 py-3 border-b border-[var(--border)] flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className={color}>{icon}</span>
          <span className="font-bold text-foreground">{title}</span>
          <span className="text-xs bg-[var(--surface-2)] text-foreground/60 px-2 py-0.5 rounded-full">{entries.length}</span>
        </div>
        <span className={`font-bold text-sm ${color}`}>{totalLabel}: {fmt(total)}</span>
      </div>

      {entries.length === 0 ? (
        <div className="p-6 text-center text-sm text-foreground/50">No {title.toLowerCase()} entries this month</div>
      ) : (
        <>
          {/* Mobile */}
          <div className="sm:hidden divide-y divide-[var(--border)]">
            {entries.map(({ entry, displayAmount }) => (
              <EntryCard key={entry.id} entry={entry} displayAmount={displayAmount} onEdit={onEdit} isRecurring={isRecurring} />
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] text-foreground/60 uppercase tracking-wide bg-[var(--surface)]">
                  {["Date", "Category", "Type", "Amount", ""].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(({ entry, displayAmount }) => (
                  <EntryRow key={entry.id} entry={entry} displayAmount={displayAmount} onEdit={onEdit} isRecurring={isRecurring} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BudgetPage() {
  const { data: allEntries = [], isLoading } = useQuery<BudgetEntry[]>({
    queryKey: ["budget"],
    queryFn: fetchBudget,
    staleTime: 30_000,
  });

  // Month navigation
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(monthKey(today));
  const prevMonth = () => {
    const [y, m] = currentMonth.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    setCurrentMonth(monthKey(d));
  };
  const nextMonth = () => {
    const [y, m] = currentMonth.split("-").map(Number);
    const d = new Date(y, m, 1);
    setCurrentMonth(monthKey(d));
  };

  // Form / edit state
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState<BudgetEntry | null>(null);

  const handleEdit = (e: BudgetEntry) => {
    setEditEntry(e);
    setShowForm(false);
  };
  const closeForm = () => { setShowForm(false); setEditEntry(null); };

  // Split entries for this month
  const { floating, recurring } = useMemo(() => {
    const floating: { entry: BudgetEntry; displayAmount: number }[] = [];
    const recurring: { entry: BudgetEntry; displayAmount: number }[] = [];

    for (const entry of allEntries) {
      const et = entry.entry_type ?? "FLOATING";
      if (et === "FLOATING") {
        // One-off: show if it falls in this month
        if (entry.date.startsWith(currentMonth)) {
          floating.push({ entry, displayAmount: entry.amount });
        }
      } else {
        // Recurring: show if this month is an applicable period
        if (recurringAppliesToMonth(entry, currentMonth)) {
          recurring.push({ entry, displayAmount: proratedMonthly(entry) });
        }
      }
    }
    return { floating, recurring };
  }, [allEntries, currentMonth]);

  // Stats
  const stats = useMemo(() => {
    const all = [...floating, ...recurring];
    const expense  = all.filter((e) => e.entry.type.toUpperCase() === "EXPENSE").reduce((s, e) => s + e.displayAmount, 0);
    const income   = all.filter((e) => e.entry.type.toUpperCase() === "INCOME").reduce((s, e) => s + e.displayAmount, 0);
    const asset    = all.filter((e) => e.entry.type.toUpperCase() === "ASSET").reduce((s, e) => s + e.displayAmount, 0);
    const recurExp = recurring.filter((e) => e.entry.type.toUpperCase() === "EXPENSE").reduce((s, e) => s + e.displayAmount, 0);
    return { expense, income, asset, net: income - expense, recurExp };
  }, [floating, recurring]);

  // Pie – expense breakdown for this month
  const pieData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const { entry, displayAmount } of [...floating, ...recurring]) {
      if (entry.type.toUpperCase() === "EXPENSE") {
        map[entry.category] = (map[entry.category] ?? 0) + displayAmount;
      }
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [floating, recurring]);

  // Build edit form initial state
  const editInitial = editEntry
    ? {
        category: editEntry.category,
        type: editEntry.type,
        entry_type: (editEntry.entry_type ?? "FLOATING") as BudgetEntryType,
        recurrence: (editEntry.recurrence ?? "ANNUAL") as BudgetRecurrence,
        amount: String(editEntry.amount),
        date: editEntry.date.slice(0, 10),
        description: editEntry.description ?? "",
      }
    : undefined;

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto w-full overflow-x-hidden">
      <PageHeader
        title="Budget"
        action={
          <button
            onClick={() => { setEditEntry(null); setShowForm((v) => !v); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
              showForm ? "bg-[var(--surface-2)] text-foreground" : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {showForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Entry</>}
          </button>
        }
      />

      {/* Add / Edit form */}
      {(showForm || editEntry) && (
        <EntryForm
          key={editEntry?.id ?? "new"}
          initial={editInitial}
          editId={editEntry?.id}
          onDone={closeForm}
          defaultMonth={currentMonth}
        />
      )}

      {/* Month navigator */}
      <div className="flex items-center justify-between mb-5 bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-2.5">
        <button onClick={prevMonth} className="p-1.5 rounded-xl hover:bg-[var(--surface-2)] transition text-foreground/70">
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <p className="font-bold text-foreground">{monthLabel(currentMonth)}</p>
          <p className="text-xs text-foreground/50">{floating.length + recurring.length} entries</p>
        </div>
        <button onClick={nextMonth} className="p-1.5 rounded-xl hover:bg-[var(--surface-2)] transition text-foreground/70">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Stats */}
      {isLoading ? (
        <div className="mb-6"><SkeletonStatGrid count={4} /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {[
            { label: "Income",       value: fmt(stats.income),   cls: "text-green-500" },
            { label: "Expenses",     value: fmt(stats.expense),  cls: "text-red-500" },
            { label: "Fixed/Month",  value: fmt(stats.recurExp), cls: "text-purple-400" },
            { label: "Net",          value: fmt(stats.net),      cls: stats.net >= 0 ? "text-green-500" : "text-red-500" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 card-hover">
              <p className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wide mb-1">{label}</p>
              <p className={`text-xl sm:text-2xl font-black ${cls}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Chart + Sections */}
      <div className="flex flex-col xl:flex-row gap-4">
        {/* Pie */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 xl:w-72 shrink-0">
          <SectionLabel>Expense Breakdown</SectionLabel>
          {pieData.length === 0 ? (
            <p className="text-sm text-foreground/50 mt-4">No expenses this month.</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tooltip formatter={(v: any) => [fmt(Number(v)), "Amount"]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "inherit" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Two sections */}
        <div className="flex-1 flex flex-col gap-4">
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
          ) : (
            <>
              <BudgetSection
                title="Floating Expenses"
                icon={<Zap size={15} />}
                color="text-amber-400"
                entries={floating}
                isRecurring={false}
                onEdit={handleEdit}
                totalLabel="Total"
              />
              <BudgetSection
                title="Recurring / Fixed"
                icon={<Repeat size={15} />}
                color="text-purple-400"
                entries={recurring}
                isRecurring={true}
                onEdit={handleEdit}
                totalLabel="Monthly share"
              />
            </>
          )}

          {!isLoading && floating.length === 0 && recurring.length === 0 && (
            <EmptyState icon={PiggyBank} title="No entries for this month" body="Add a new entry above or navigate to another month." />
          )}
        </div>
      </div>
    </div>
  );
}
