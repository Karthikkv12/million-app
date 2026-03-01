"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchBudget, saveBudget, updateBudget, deleteBudget,
  BudgetEntry, BudgetEntryType, BudgetRecurrence,
} from "@/lib/api";
import {
  Plus, ChevronLeft, ChevronRight, Trash2, Check, X, Repeat, Zap,
} from "lucide-react";
import { PageHeader, SectionLabel, SkeletonStatGrid } from "@/components/ui";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

// ── constants ─────────────────────────────────────────────────────────────────
const PIE_COLORS = ["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#84cc16","#f97316","#ec4899","#14b8a6"];

const CATEGORIES = [
  "Food & Dining","Transport","Entertainment","Shopping",
  "Utilities","Insurance","Healthcare","Education",
  "Subscriptions","Housing","Travel","Savings","Investment","Tax","Other",
];

const RECURRENCE_MONTHS: Record<BudgetRecurrence, number> = {
  MONTHLY: 1, SEMI_ANNUAL: 6, ANNUAL: 12,
};
const RECURRENCE_LABEL: Record<BudgetRecurrence, string> = {
  MONTHLY: "Monthly", SEMI_ANNUAL: "Every 6 mo", ANNUAL: "Yearly",
};

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function proratedMonthly(entry: BudgetEntry): number {
  const rec = (entry.recurrence ?? "ANNUAL") as BudgetRecurrence;
  return entry.amount / RECURRENCE_MONTHS[rec];
}
function recurringAppliesToMonth(entry: BudgetEntry, targetKey: string): boolean {
  const rec = (entry.recurrence ?? "ANNUAL") as BudgetRecurrence;
  const period = RECURRENCE_MONTHS[rec];
  const base = new Date(entry.date + "T00:00:00");
  const [ty, tm] = targetKey.split("-").map(Number);
  const diff = (ty - base.getFullYear()) * 12 + (tm - (base.getMonth() + 1));
  if (diff < 0) return false;
  return diff % period === 0;
}

// ── blank row template ────────────────────────────────────────────────────────
interface DraftRow {
  id?: number;          // set when editing existing
  category: string;
  type: string;
  entry_type: BudgetEntryType;
  recurrence: BudgetRecurrence;
  amount: string;
  date: string;
  description: string;
}
function blankDraft(month: string): DraftRow {
  return { category: "", type: "EXPENSE", entry_type: "FLOATING", recurrence: "ANNUAL", amount: "", date: `${month}-01`, description: "" };
}

// ── inline cell input styles ──────────────────────────────────────────────────
const cellInp = "w-full bg-transparent border-0 outline-none text-sm text-foreground placeholder:text-foreground/30 focus:bg-blue-500/10 rounded px-1 py-0.5";
const cellSel = "w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-foreground px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500";

// ── Inline Editable Row ───────────────────────────────────────────────────────
function EditableRow({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: DraftRow;
  onChange: (d: DraftRow) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const set = (k: keyof DraftRow, v: string) => onChange({ ...draft, [k]: v });
  const amtRef = useRef<HTMLInputElement>(null);

  // auto-focus amount when row appears
  useEffect(() => { amtRef.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onSave();
    if (e.key === "Escape") onCancel();
  };

  return (
    <tr className="bg-blue-500/5 border-b border-blue-500/30" onKeyDown={handleKeyDown}>
      {/* Date */}
      <td className="px-2 py-1.5 w-32">
        <input
          type="date" value={draft.date}
          onChange={(e) => set("date", e.target.value)}
          className={cellInp + " w-28"}
        />
      </td>
      {/* Category */}
      <td className="px-2 py-1.5">
        <select value={draft.category} onChange={(e) => set("category", e.target.value)} className={cellSel}>
          <option value="">— Category —</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </td>
      {/* Type */}
      <td className="px-2 py-1.5 w-28">
        <select value={draft.type} onChange={(e) => set("type", e.target.value)} className={cellSel}>
          <option>EXPENSE</option>
          <option>INCOME</option>
          <option>ASSET</option>
        </select>
      </td>
      {/* Entry type */}
      <td className="px-2 py-1.5 w-32">
        <select value={draft.entry_type} onChange={(e) => set("entry_type", e.target.value as BudgetEntryType)} className={cellSel}>
          <option value="FLOATING">One-off</option>
          <option value="RECURRING">Recurring</option>
        </select>
      </td>
      {/* Recurrence */}
      <td className="px-2 py-1.5 w-28">
        {draft.entry_type === "RECURRING" ? (
          <select value={draft.recurrence} onChange={(e) => set("recurrence", e.target.value as BudgetRecurrence)} className={cellSel}>
            <option value="MONTHLY">Monthly</option>
            <option value="SEMI_ANNUAL">Every 6 mo</option>
            <option value="ANNUAL">Yearly</option>
          </select>
        ) : (
          <span className="text-xs text-foreground/30 px-1">—</span>
        )}
      </td>
      {/* Amount */}
      <td className="px-2 py-1.5 w-28">
        <input
          ref={amtRef}
          type="number" step="0.01" min="0"
          value={draft.amount}
          onChange={(e) => set("amount", e.target.value)}
          placeholder="0.00"
          className={cellInp + " text-right"}
        />
      </td>
      {/* Description */}
      <td className="px-2 py-1.5">
        <input
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Note (optional)"
          className={cellInp}
        />
      </td>
      {/* Actions */}
      <td className="px-2 py-1.5 w-20 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onSave}
            disabled={saving || !draft.category || !draft.amount}
            className="p-1.5 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/40 disabled:opacity-40 transition"
            title="Save (Enter)"
          >
            {saving ? <span className="text-[10px]">…</span> : <Check size={13} />}
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg bg-[var(--surface-2)] text-foreground/60 hover:bg-[var(--border)] transition"
            title="Cancel (Esc)"
          >
            <X size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Read-only row ─────────────────────────────────────────────────────────────
function ReadRow({
  entry,
  displayAmount,
  isRecurring,
  onEdit,
}: {
  entry: BudgetEntry;
  displayAmount: number;
  isRecurring: boolean;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState(false);
  const delMut = useMutation({
    mutationFn: () => deleteBudget(entry.id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget"] }),
  });

  const amtCls = entry.type.toUpperCase() === "EXPENSE" ? "text-red-400"
    : entry.type.toUpperCase() === "INCOME" ? "text-green-400" : "text-blue-400";

  return (
    <tr
      className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer group"
      onClick={onEdit}
    >
      <td className="px-3 py-2 text-xs text-foreground/50 whitespace-nowrap">{entry.date.slice(0, 10)}</td>
      <td className="px-3 py-2 text-sm font-medium text-foreground">{entry.category || "—"}</td>
      <td className="px-3 py-2">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
          entry.type.toUpperCase() === "EXPENSE" ? "bg-red-500/15 text-red-400"
          : entry.type.toUpperCase() === "INCOME" ? "bg-green-500/15 text-green-400"
          : "bg-blue-500/15 text-blue-400"
        }`}>{entry.type}</span>
      </td>
      <td className="px-3 py-2">
        <span className={`text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 w-fit ${
          isRecurring ? "bg-purple-500/15 text-purple-400" : "bg-amber-500/15 text-amber-400"
        }`}>
          {isRecurring ? <Repeat size={9} /> : <Zap size={9} />}
          {isRecurring ? "Recurring" : "One-off"}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-foreground/50">
        {isRecurring ? RECURRENCE_LABEL[(entry.recurrence ?? "ANNUAL") as BudgetRecurrence] : "—"}
      </td>
      <td className={`px-3 py-2 text-sm font-bold text-right ${amtCls} whitespace-nowrap`}>
        {fmt(displayAmount)}
        {isRecurring && displayAmount !== entry.amount && (
          <span className="text-[10px] font-normal text-foreground/30 ml-1">({fmt(entry.amount)})</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-foreground/40 max-w-[120px] truncate">{entry.description || ""}</td>
      <td
        className="px-3 py-2 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        {confirmDel ? (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => delMut.mutate()}
              disabled={delMut.isPending}
              className="text-[11px] px-2 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {delMut.isPending ? "…" : "Yes"}
            </button>
            <button onClick={() => setConfirmDel(false)} className="text-[11px] px-2 py-1 rounded-lg bg-[var(--surface-2)] text-foreground">No</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDel(true)}
            className="p-1.5 rounded-lg text-foreground/30 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition"
          >
            <Trash2 size={13} />
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Spreadsheet section ───────────────────────────────────────────────────────
function SpreadsheetSection({
  title,
  icon,
  accentCls,
  rows,
  isRecurring,
  currentMonth,
  onSaved,
}: {
  title: string;
  icon: React.ReactNode;
  accentCls: string;
  rows: { entry: BudgetEntry; displayAmount: number }[];
  isRecurring: boolean;
  currentMonth: string;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);   // pending new rows
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow | null>(null);

  const saveMut = useMutation({
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget"] });
      onSaved();
    },
  });

  const addRow = () => {
    const et: BudgetEntryType = isRecurring ? "RECURRING" : "FLOATING";
    setDrafts((prev) => [...prev, { ...blankDraft(currentMonth), entry_type: et }]);
  };

  const saveDraft = async (idx: number) => {
    const d = drafts[idx];
    if (!d.category || !d.amount) return;
    await saveMut.mutateAsync(d);
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  };

  const startEdit = (entry: BudgetEntry) => {
    setEditingId(entry.id ?? null);
    setEditDraft({
      id: entry.id,
      category: entry.category,
      type: entry.type,
      entry_type: (entry.entry_type ?? (isRecurring ? "RECURRING" : "FLOATING")) as BudgetEntryType,
      recurrence: (entry.recurrence ?? "ANNUAL") as BudgetRecurrence,
      amount: String(entry.amount),
      date: entry.date.slice(0, 10),
      description: entry.description ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editDraft || !editDraft.category || !editDraft.amount) return;
    await saveMut.mutateAsync(editDraft);
    setEditingId(null);
    setEditDraft(null);
  };

  const total = rows.reduce((s, r) => s + r.displayAmount, 0);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className={accentCls}>{icon}</span>
          <span className="font-bold text-foreground">{title}</span>
          <span className="text-xs bg-[var(--surface-2)] text-foreground/50 px-2 py-0.5 rounded-full">{rows.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold ${accentCls}`}>{fmt(total)}</span>
          <button
            onClick={addRow}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition"
          >
            <Plus size={12} /> Add row
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-[10px] text-foreground/50 uppercase tracking-wide border-b border-[var(--border)] bg-[var(--surface)]">
              <th className="px-3 py-2 text-left font-semibold">Date</th>
              <th className="px-3 py-2 text-left font-semibold">Category</th>
              <th className="px-3 py-2 text-left font-semibold">Type</th>
              <th className="px-3 py-2 text-left font-semibold">Frequency</th>
              <th className="px-3 py-2 text-left font-semibold">Recurs</th>
              <th className="px-3 py-2 text-right font-semibold">Amount</th>
              <th className="px-3 py-2 text-left font-semibold">Note</th>
              <th className="px-3 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {/* Existing rows */}
            {rows.map(({ entry, displayAmount }) =>
              editingId === entry.id && editDraft ? (
                <EditableRow
                  key={entry.id}
                  draft={editDraft}
                  onChange={setEditDraft}
                  onSave={saveEdit}
                  onCancel={() => { setEditingId(null); setEditDraft(null); }}
                  saving={saveMut.isPending}
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

            {/* New draft rows appended at bottom */}
            {drafts.map((d, idx) => (
              <EditableRow
                key={`draft-${idx}`}
                draft={d}
                onChange={(nd) => setDrafts((prev) => prev.map((r, i) => i === idx ? nd : r))}
                onSave={() => saveDraft(idx)}
                onCancel={() => setDrafts((prev) => prev.filter((_, i) => i !== idx))}
                saving={saveMut.isPending}
              />
            ))}

            {/* Empty hint */}
            {rows.length === 0 && drafts.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-foreground/40">
                  No entries — click <strong>Add row</strong> to get started
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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

  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(monthKey(today));

  const prevMonth = () => {
    const [y, m] = currentMonth.split("-").map(Number);
    setCurrentMonth(monthKey(new Date(y, m - 2, 1)));
  };
  const nextMonth = () => {
    const [y, m] = currentMonth.split("-").map(Number);
    setCurrentMonth(monthKey(new Date(y, m, 1)));
  };

  const { floating, recurring } = useMemo(() => {
    const floating: { entry: BudgetEntry; displayAmount: number }[] = [];
    const recurring: { entry: BudgetEntry; displayAmount: number }[] = [];
    for (const entry of allEntries) {
      const et = entry.entry_type ?? "FLOATING";
      if (et === "FLOATING") {
        if (entry.date.startsWith(currentMonth))
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
    const expense  = all.filter((e) => e.entry.type.toUpperCase() === "EXPENSE").reduce((s, e) => s + e.displayAmount, 0);
    const income   = all.filter((e) => e.entry.type.toUpperCase() === "INCOME").reduce((s, e) => s + e.displayAmount, 0);
    const recurExp = recurring.filter((e) => e.entry.type.toUpperCase() === "EXPENSE").reduce((s, e) => s + e.displayAmount, 0);
    return { expense, income, recurExp, net: income - expense };
  }, [floating, recurring]);

  const pieData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const { entry, displayAmount } of [...floating, ...recurring]) {
      if (entry.type.toUpperCase() === "EXPENSE")
        map[entry.category] = (map[entry.category] ?? 0) + displayAmount;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [floating, recurring]);

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto w-full overflow-x-hidden">
      <PageHeader title="Budget" />

      {/* Month navigator */}
      <div className="flex items-center justify-between mb-5 bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-2.5">
        <button onClick={prevMonth} className="p-1.5 rounded-xl hover:bg-[var(--surface-2)] transition text-foreground/70"><ChevronLeft size={18} /></button>
        <div className="text-center">
          <p className="font-bold text-foreground">{monthLabel(currentMonth)}</p>
          <p className="text-xs text-foreground/50">{floating.length + recurring.length} entries</p>
        </div>
        <button onClick={nextMonth} className="p-1.5 rounded-xl hover:bg-[var(--surface-2)] transition text-foreground/70"><ChevronRight size={18} /></button>
      </div>

      {/* Stats */}
      {isLoading ? (
        <div className="mb-5"><SkeletonStatGrid count={4} /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: "Income",      value: fmt(stats.income),   cls: "text-green-400" },
            { label: "Expenses",    value: fmt(stats.expense),  cls: "text-red-400" },
            { label: "Fixed/Month", value: fmt(stats.recurExp), cls: "text-purple-400" },
            { label: "Net",         value: fmt(stats.net),      cls: stats.net >= 0 ? "text-green-400" : "text-red-400" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
              <p className="text-[11px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">{label}</p>
              <p className={`text-xl sm:text-2xl font-black ${cls}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Pie + tables */}
      <div className="flex flex-col xl:flex-row gap-4">
        {/* Pie */}
        {pieData.length > 0 && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 xl:w-64 shrink-0">
            <SectionLabel>Expense Breakdown</SectionLabel>
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tooltip formatter={(v: any) => [fmt(Number(v)), "Amount"]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "inherit" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Spreadsheet tables */}
        <div className="flex-1 flex flex-col gap-4">
          <SpreadsheetSection
            title="One-off / Floating"
            icon={<Zap size={14} />}
            accentCls="text-amber-400"
            rows={floating}
            isRecurring={false}
            currentMonth={currentMonth}
            onSaved={() => {}}
          />
          <SpreadsheetSection
            title="Recurring / Fixed"
            icon={<Repeat size={14} />}
            accentCls="text-purple-400"
            rows={recurring}
            isRecurring={true}
            currentMonth={currentMonth}
            onSaved={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
