"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchWeeks, getOrCreateWeek, completeWeek, reopenWeek,
  fetchPositions, createPosition, updatePosition, deletePosition,
  createAssignment, fetchAssignment, updateAssignment,
  fetchPortfolioSummary, fetchSymbolSummary, fetchStockHistory,
  fetchHoldings, createHolding, updateHolding, deleteHolding, fetchHoldingEvents,
  seedHoldingsFromPositions,
  WeeklySnapshot, OptionPosition, StockAssignment, PositionStatus, WeekBreakdown,
  StockHolding, HoldingEvent,
} from "@/lib/api";
import {
  BarChart2, Plus, X, ChevronDown, ChevronUp, CheckCircle2, LockOpen,
  TrendingUp, DollarSign, Activity, AlertCircle, Search, Trophy, Calendar, Wallet, TrendingDown, Edit2, Trash2,
} from "lucide-react";
import { PageHeader, EmptyState, SkeletonCard, Tabs, RefreshButton } from "@/components/ui";
import TickerSearchInput from "@/components/TickerSearchInput";


// ── helpers ──────────────────────────────────────────────────────────────────

const inp =
  "w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--surface)] " +
  "text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500";

const STATUS_COLORS: Record<PositionStatus, string> = {
  ACTIVE:   "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300",
  CLOSED:   "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300",
  EXPIRED:  "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
  ASSIGNED: "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-600 dark:text-yellow-300",
  ROLLED:   "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300",
};

function fmt$(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`;
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return s.slice(0, 10);
}
function weekLabel(w: WeeklySnapshot) {
  const d = new Date(w.week_end);
  return `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

// ── Complete Week Modal ───────────────────────────────────────────────────────

function CompleteWeekModal({ week, onDone }: { week: WeeklySnapshot; onDone: () => void }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(week.account_value?.toFixed(2) ?? "");
  const [err, setErr] = useState("");
  const mut = useMutation({
    mutationFn: () => completeWeek(week.id, val ? parseFloat(val) : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weeks"] });
      qc.invalidateQueries({ queryKey: ["positions", week.id] });
      onDone();
    },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-[var(--surface)] rounded-2xl p-6 w-full sm:max-w-sm shadow-2xl border border-[var(--border)]">
        <h3 className="font-bold text-lg text-foreground mb-1">Complete Week</h3>
        <p className="text-xs text-foreground/60 mb-4">
          {weekLabel(week)} — all active positions will carry forward to next week.
        </p>
        <label className="text-xs text-foreground/70 block mb-1">Friday Account Value ($)</label>
        <input
          type="number" step="0.01" value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="100000.00"
          className={`${inp} mb-4`}
        />
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => mut.mutate()} disabled={mut.isPending}
            className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition"
          >
            {mut.isPending ? "Completing…" : "✓ Mark Complete"}
          </button>
          <button
            onClick={onDone}
            className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-foreground hover:bg-[var(--surface-2)] transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reopen Week Modal ────────────────────────────────────────────────────────

function ReopenWeekModal({ week, onDone }: { week: WeeklySnapshot; onDone: () => void }) {
  const qc = useQueryClient();
  const [err, setErr] = useState("");
  const mut = useMutation({
    mutationFn: () => reopenWeek(week.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weeks"] });
      qc.invalidateQueries({ queryKey: ["positions", week.id] });
      onDone();
    },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-[var(--surface)] rounded-2xl p-6 w-full sm:max-w-sm shadow-2xl border border-[var(--border)]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <LockOpen size={18} className="text-orange-500" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-foreground">Re-open Week</h3>
            <p className="text-xs text-foreground/60">{weekLabel(week)}</p>
          </div>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-3 mb-4">
          <p className="text-xs text-orange-700 dark:text-orange-300 font-semibold mb-1">⚠ Heads up</p>
          <p className="text-xs text-orange-600 dark:text-orange-400">
            Any positions that were carried forward into the following week from this week will be
            <strong> removed</strong> from that week. You can re-complete this week when done to carry them forward again.
          </p>
        </div>
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => mut.mutate()} disabled={mut.isPending}
            className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50 transition"
          >
            {mut.isPending ? "Re-opening…" : "✎ Re-open Week"}
          </button>
          <button
            onClick={onDone}
            className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-foreground hover:bg-[var(--surface-2)] transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add / Edit Position Form ──────────────────────────────────────────────────

interface PosFormState {
  symbol: string; contracts: string; strike: string;
  option_type: "PUT" | "CALL"; sold_date: string; expiry_date: string;
  buy_date: string; premium_in: string; premium_out: string;
  is_roll: boolean; margin: string; notes: string; holding_id: string;
}

const emptyForm = (): PosFormState => ({
  symbol: "", contracts: "1", strike: "", option_type: "CALL",
  sold_date: new Date().toISOString().slice(0, 10),
  expiry_date: "", buy_date: "", premium_in: "", premium_out: "",
  is_roll: false, margin: "", notes: "", holding_id: "",
});

function posToForm(p: OptionPosition): PosFormState {
  return {
    symbol: p.symbol, contracts: String(p.contracts), strike: String(p.strike),
    option_type: p.option_type, sold_date: p.sold_date ?? "",
    expiry_date: p.expiry_date ?? "", buy_date: p.buy_date ?? "",
    premium_in: p.premium_in != null ? String(p.premium_in) : "",
    premium_out: p.premium_out != null ? String(p.premium_out) : "",
    is_roll: p.is_roll, margin: p.margin != null ? String(p.margin) : "",
    notes: p.notes ?? "",
    holding_id: p.holding_id != null ? String(p.holding_id) : "",
  };
}

function PositionForm({
  weekId, editPos, onDone,
}: { weekId: number; editPos?: OptionPosition; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<PosFormState>(editPos ? posToForm(editPos) : emptyForm());
  const [err, setErr] = useState("");

  // Load holdings for the dropdown
  const { data: allHoldings = [] } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
    staleTime: 30_000,
  });

  // For CC: filter to holdings matching the typed symbol; for CSP: show all active
  const relevantHoldings = allHoldings.filter((h) =>
    h.status === "ACTIVE" &&
    (f.option_type === "CALL"
      ? h.symbol === f.symbol.toUpperCase()
      : true)
  );

  function set(k: keyof PosFormState, v: string | boolean) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        symbol: f.symbol.toUpperCase(),
        contracts: parseInt(f.contracts),
        strike: parseFloat(f.strike),
        option_type: f.option_type,
        sold_date: f.sold_date || null,
        expiry_date: f.expiry_date || null,
        buy_date: f.buy_date || null,
        premium_in: f.premium_in ? parseFloat(f.premium_in) : null,
        premium_out: f.premium_out ? parseFloat(f.premium_out) : null,
        is_roll: f.is_roll,
        margin: f.margin ? parseFloat(f.margin) : null,
        notes: f.notes || null,
        holding_id: f.holding_id ? parseInt(f.holding_id) : null,
      };
      return editPos
        ? updatePosition(editPos.id, body)
        : createPosition(weekId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions", weekId] });
      onDone();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const field = (label: string, el: React.ReactNode) => (
    <div>
      <label className="text-xs text-foreground/70 block mb-1">{label}</label>
      {el}
    </div>
  );

  return (
    <div className="bg-[var(--surface)] border border-blue-200 dark:border-blue-800 rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-foreground">{editPos ? "Edit Position" : "Add Position"}</h3>
        <button onClick={onDone} className="p-1.5 rounded-xl text-foreground/70 hover:bg-[var(--surface-2)] transition">
          <X size={15} />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {field("Symbol", <input value={f.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="AAPL" className={inp} />)}
        {field("Contracts", <input type="number" min="1" value={f.contracts} onChange={(e) => set("contracts", e.target.value)} className={inp} />)}
        {field("Strike ($)", <input type="number" step="0.5" value={f.strike} onChange={(e) => set("strike", e.target.value)} placeholder="150.00" className={inp} />)}
        {field("Type", (
          <select value={f.option_type} onChange={(e) => set("option_type", e.target.value as "PUT" | "CALL")} className={inp}>
            <option value="CALL">CALL (CC)</option>
            <option value="PUT">PUT (CSP)</option>
          </select>
        ))}
        {field("Sold Date", <input type="date" value={f.sold_date} onChange={(e) => set("sold_date", e.target.value)} className={inp} />)}
        {field("Expiry Date", <input type="date" value={f.expiry_date} onChange={(e) => set("expiry_date", e.target.value)} className={inp} />)}
        {field("Premium In ($)", <input type="number" step="0.01" value={f.premium_in} onChange={(e) => set("premium_in", e.target.value)} placeholder="0.00" className={inp} />)}
        {field("Margin ($)", <input type="number" step="1" value={f.margin} onChange={(e) => set("margin", e.target.value)} placeholder="optional" className={inp} />)}
      </div>
      <div className="flex items-center gap-3 mb-3">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-foreground">
          <input
            type="checkbox" checked={f.is_roll}
            onChange={(e) => set("is_roll", e.target.checked)}
            className="rounded accent-purple-500"
          />
          This is a roll
        </label>
        {f.is_roll && (
          <div className="flex-1">
            <input
              type="number" step="0.01" value={f.premium_out}
              onChange={(e) => set("premium_out", e.target.value)}
              placeholder="Roll credit (+) or debit (−)"
              className={inp}
            />
          </div>
        )}
      </div>
      <div className="mb-3">
        {field("Notes", <input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" className={inp} />)}
      </div>
      <div className="mb-3">
        {field(
          f.option_type === "CALL" ? "Link to Holding (CC)" : "Link to Holding (CSP — optional)",
          <select
            value={f.holding_id}
            onChange={(e) => {
              const val = e.target.value;
              set("holding_id", val);
              // Auto-fill symbol from the selected holding so they stay in sync
              if (val) {
                const chosen = allHoldings.find(h => String(h.id) === val);
                if (chosen) set("symbol", chosen.symbol);
              }
            }}
            className={inp}
          >
            <option value="">— No holding linked —</option>
            {relevantHoldings.map((h) => (
              <option key={h.id} value={String(h.id)}>
                {h.symbol}{h.company_name ? ` · ${h.company_name.slice(0, 25)}` : ""} · {h.shares.toLocaleString()} shares · adj basis ${h.adjusted_cost_basis.toFixed(2)}
              </option>
            ))}
            {f.option_type === "CALL" && relevantHoldings.length === 0 && (
              <option disabled value="">(no {f.symbol || ""} holdings — add one in Holdings tab)</option>
            )}
          </select>
        )}
      </div>
      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      {(!f.symbol || !f.strike) && (
        <p className="text-xs text-foreground/50 mb-2">* Symbol and Strike are required</p>
      )}
      <button
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !f.symbol || !f.strike}
        className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {mut.isPending ? "Saving…" : editPos ? "Save Changes" : "Add Position"}
      </button>
    </div>
  );
}

// ── Status Quick-Edit ─────────────────────────────────────────────────────────

function StatusSelect({ pos }: { pos: OptionPosition }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (status: PositionStatus) => updatePosition(pos.id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["positions", pos.week_id] }),
  });
  return (
    <select
      value={pos.status}
      onChange={(e) => mut.mutate(e.target.value as PositionStatus)}
      disabled={mut.isPending}
      className="text-[11px] border border-[var(--border)] rounded-lg px-2 py-1 bg-[var(--surface)] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      {(["ACTIVE", "CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"] as PositionStatus[]).map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}

// ── Assignment Panel ──────────────────────────────────────────────────────────

interface AssignFormState {
  shares_acquired: string; acquisition_price: string;
  net_option_premium: string; notes: string;
}

function AssignmentPanel({ pos }: { pos: OptionPosition }) {
  const qc = useQueryClient();
  const { data: asgn, isLoading } = useQuery({
    queryKey: ["assignment", pos.id],
    queryFn: () => fetchAssignment(pos.id),
    retry: false,
  });

  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<AssignFormState>({ shares_acquired: "", acquisition_price: "", net_option_premium: "", notes: "" });
  const [err, setErr] = useState("");

  function set(k: keyof AssignFormState, v: string) { setF((p) => ({ ...p, [k]: v })); }

  const createMut = useMutation({
    mutationFn: () => createAssignment(pos.id, {
      symbol: pos.symbol,
      shares_acquired: parseInt(f.shares_acquired),
      acquisition_price: parseFloat(f.acquisition_price),
      net_option_premium: parseFloat(f.net_option_premium) || 0,
      notes: f.notes || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assignment", pos.id] }); setEditing(false); },
    onError: (e: Error) => setErr(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updateAssignment(asgn!.id, {
      shares_acquired: parseInt(f.shares_acquired),
      acquisition_price: parseFloat(f.acquisition_price),
      net_option_premium: parseFloat(f.net_option_premium) || 0,
      notes: f.notes || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assignment", pos.id] }); setEditing(false); },
    onError: (e: Error) => setErr(e.message),
  });

  if (isLoading) return <div className="text-xs text-foreground/50 py-2">Loading assignment…</div>;

  if (!asgn && !editing) {
    return (
      <button
        onClick={() => {
          setF({ shares_acquired: "100", acquisition_price: String(pos.strike), net_option_premium: String(Math.abs(pos.net_premium ?? 0)), notes: "" });
          setEditing(true);
        }}
        className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 font-semibold hover:bg-yellow-100 transition"
      >
        + Log Stock Assignment
      </button>
    );
  }

  if (editing) {
    const fld = (label: string, el: React.ReactNode) => (
      <div><label className="text-xs text-foreground/70 block mb-1">{label}</label>{el}</div>
    );
    return (
      <div className="mt-3 bg-yellow-50/50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
        <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mb-3">Stock Assignment — {pos.symbol}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          {fld("Shares Acquired", <input type="number" min="1" value={f.shares_acquired} onChange={(e) => set("shares_acquired", e.target.value)} className={inp} />)}
          {fld("Acquisition Price ($)", <input type="number" step="0.01" value={f.acquisition_price} onChange={(e) => set("acquisition_price", e.target.value)} className={inp} />)}
          {fld("Net Option Premium ($)", <input type="number" step="0.01" value={f.net_option_premium} onChange={(e) => set("net_option_premium", e.target.value)} className={inp} />)}
        </div>
        {fld("Notes", <input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" className={`${inp} mb-3`} />)}
        {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => asgn ? updateMut.mutate() : createMut.mutate()}
            disabled={createMut.isPending || updateMut.isPending}
            className="px-4 py-2 rounded-xl bg-yellow-500 text-white text-xs font-bold hover:bg-yellow-600 disabled:opacity-50 transition"
          >
            {createMut.isPending || updateMut.isPending ? "Saving…" : "Save Assignment"}
          </button>
          <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl border border-[var(--border)] text-xs text-foreground hover:bg-[var(--surface-2)] transition">Cancel</button>
        </div>
      </div>
    );
  }

  const a = asgn!;
  const downPct = a.weighted_avg_cost > 0 ? ((a.downside_basis - a.weighted_avg_cost) / a.weighted_avg_cost * 100) : 0;
  const upPct   = a.weighted_avg_cost > 0 ? ((a.upside_basis   - a.weighted_avg_cost) / a.weighted_avg_cost * 100) : 0;

  return (
    <div className="mt-3 bg-yellow-50/50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">
          Stock Assignment — {a.symbol} · {a.total_shares} shares
        </p>
        <button
          onClick={() => { setF({ shares_acquired: String(a.shares_acquired), acquisition_price: String(a.acquisition_price), net_option_premium: String(a.net_option_premium), notes: a.notes ?? "" }); setEditing(true); }}
          className="text-[10px] px-2 py-1 rounded-lg border border-yellow-300 dark:border-yellow-700 text-yellow-600 hover:bg-yellow-100 transition"
        >
          Edit
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="bg-[var(--surface)] rounded-lg p-2">
          <p className="text-foreground/60 mb-0.5">Avg Cost</p>
          <p className="font-bold text-foreground">${a.weighted_avg_cost.toFixed(2)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-lg p-2">
          <p className="text-foreground/60 mb-0.5">Total Cost</p>
          <p className="font-bold text-foreground">${a.total_cost.toFixed(2)}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
          <p className="text-red-500/70 mb-0.5">Downside BE</p>
          <p className="font-bold text-red-500">${a.downside_basis.toFixed(2)} <span className="text-[9px] font-normal">({downPct.toFixed(1)}%)</span></p>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
          <p className="text-green-600/70 mb-0.5">Upside BE</p>
          <p className="font-bold text-green-600">${a.upside_basis.toFixed(2)} <span className="text-[9px] font-normal">({upPct.toFixed(1)}%)</span></p>
        </div>
      </div>
    </div>
  );
}

// ── Position Row ──────────────────────────────────────────────────────────────

function PositionRow({ pos, onEdit, onDelete }: { pos: OptionPosition; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const isCarried = pos.carried_from_id != null;
  const isCarriedForward = pos.carried === true;

  return (
    <>
      <tr className={`border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors ${isCarriedForward ? "opacity-90" : ""}`}>
        <td className="px-3 py-2.5 font-bold text-foreground">
          {pos.symbol}
          {isCarriedForward && (
            <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 font-semibold">↳ {pos.origin_week_label ?? "prior wk"}</span>
          )}
          {!isCarriedForward && isCarried && (
            <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-500 font-semibold">↩ rolled</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-foreground/80 text-sm text-center">{pos.contracts}</td>
        <td className="px-3 py-2.5 text-foreground text-sm">${pos.strike.toFixed(2)}</td>
        <td className="px-3 py-2.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${pos.option_type === "PUT" ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-green-100 dark:bg-green-900/30 text-green-600"}`}>
            {pos.option_type}
          </span>
        </td>
        <td className="px-3 py-2.5 text-foreground/70 text-xs whitespace-nowrap">{fmtDate(pos.sold_date)}</td>
        <td className="px-3 py-2.5 text-foreground/70 text-xs whitespace-nowrap">{fmtDate(pos.expiry_date)}</td>
        <td className="px-3 py-2.5 text-green-600 font-semibold text-sm">
          {pos.premium_in != null ? `$${pos.premium_in.toFixed(2)}` : "—"}
        </td>
        <td className="px-3 py-2.5 text-sm">
          {pos.is_roll ? (
            <span className={pos.premium_out != null && pos.premium_out >= 0 ? "text-green-500" : "text-red-500"}>
              {pos.premium_out != null ? `${pos.premium_out >= 0 ? "+" : ""}$${pos.premium_out.toFixed(2)}` : "—"}
              <span className="ml-1 text-[9px] text-purple-400">roll</span>
            </span>
          ) : (
            <span className="text-foreground/40">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <StatusSelect pos={pos} />
        </td>
        <td className="px-3 py-2.5 text-foreground/70 text-xs">
          {pos.margin != null ? `$${pos.margin.toFixed(0)}` : "—"}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {pos.status === "ASSIGNED" && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[10px] px-2 py-1 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 font-semibold hover:bg-yellow-200 transition flex items-center gap-1"
              >
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />} Stock
              </button>
            )}
            <button onClick={onEdit} className="text-[10px] px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-semibold hover:bg-blue-100 transition">Edit</button>
            <button
              onClick={() => { if (window.confirm(`Delete ${pos.symbol} $${pos.strike} ${pos.option_type}?`)) onDelete(); }}
              className="text-[10px] px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition"
            >Del</button>
          </div>
        </td>
      </tr>
      {expanded && pos.status === "ASSIGNED" && (
        <tr className="border-b border-[var(--border)] bg-yellow-50/30 dark:bg-yellow-900/5">
          <td colSpan={11} className="px-4 pb-3">
            <AssignmentPanel pos={pos} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Positions Tab ─────────────────────────────────────────────────────────────

function PositionsTab({ week }: { week: WeeklySnapshot }) {
  const qc = useQueryClient();
  const { data: positions = [], isLoading } = useQuery({
    queryKey: ["positions", week.id],
    queryFn: () => fetchPositions(week.id),
    staleTime: 30_000,
  });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OptionPosition | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [showReopen, setShowReopen] = useState(false);

  const deleteMut = useMutation({
    mutationFn: deletePosition,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["positions", week.id] }),
  });

  const thisWeekPositions = useMemo(() => positions.filter(p => !p.carried), [positions]);
  const carriedPositions   = useMemo(() => positions.filter(p => p.carried === true), [positions]);

  const bySymbol = useMemo(() => {
    const map = new Map<string, OptionPosition[]>();
    for (const p of thisWeekPositions) {
      const arr = map.get(p.symbol) ?? [];
      arr.push(p);
      map.set(p.symbol, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [thisWeekPositions]);

  const bySymbolCarried = useMemo(() => {
    const map = new Map<string, OptionPosition[]>();
    for (const p of carriedPositions) {
      const arr = map.get(p.symbol) ?? [];
      arr.push(p);
      map.set(p.symbol, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [carriedPositions]);

  const totalPremium = thisWeekPositions.reduce((s, p) => s + (p.total_premium ?? 0), 0);
  const activeCount  = positions.filter((p) => p.status === "ACTIVE").length;

  return (
    <div>
      {positions.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">This Week Premium</p>
            <p className="text-base font-black text-green-500">${totalPremium.toFixed(2)}</p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Active</p>
            <p className="text-base font-black text-blue-500">{activeCount}</p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Positions</p>
            <p className="text-base font-black text-foreground">{positions.length}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {!week.is_complete && (
            <button
              onClick={() => { setEditing(null); setShowForm((v) => !v); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition"
            >
              <Plus size={12} /> Add Position
            </button>
          )}
          {!week.is_complete && positions.length > 0 && (
            <button
              onClick={() => setShowComplete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition"
            >
              <CheckCircle2 size={12} /> Mark Week Complete
            </button>
          )}
        </div>
        {week.is_complete && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-green-600 font-semibold">
              <CheckCircle2 size={13} /> Week complete
            </span>
            <button
              onClick={() => setShowReopen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-50 dark:bg-orange-900/20 text-orange-500 dark:text-orange-400 text-xs font-semibold hover:bg-orange-100 dark:hover:bg-orange-900/40 border border-orange-200 dark:border-orange-800 transition"
            >
              <LockOpen size={11} /> Re-open Week
            </button>
          </div>
        )}
      </div>

      {showComplete && <CompleteWeekModal week={week} onDone={() => setShowComplete(false)} />}
      {showReopen && <ReopenWeekModal week={week} onDone={() => setShowReopen(false)} />}

      {(showForm && !week.is_complete) && (
        <PositionForm
          weekId={week.id}
          onDone={() => { setShowForm(false); }}
        />
      )}
      {editing && (
        <PositionForm
          weekId={week.id}
          editPos={editing}
          onDone={() => { setEditing(null); }}
        />
      )}

      {isLoading && <div className="space-y-2">{[1, 2, 3].map((i) => <SkeletonCard key={i} rows={1} />)}</div>}

      {!isLoading && positions.length === 0 && (
        <EmptyState
          icon={Activity}
          title="No positions this week"
          body="Click 'Add Position' to log your first option sell."
        />
      )}

      {!isLoading && positions.length > 0 && (
        <div className="space-y-4">
          {/* This week's positions */}
          {thisWeekPositions.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                    {["Symbol", "Cts", "Strike", "P/C", "Sold", "Expiry", "Prem In", "Roll", "Status", "Margin", "Actions"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bySymbol.map(([, rows]) =>
                    rows.map((p) => (
                      <PositionRow
                        key={p.id}
                        pos={p}
                        onEdit={() => { setEditing(p); setShowForm(false); }}
                        onDelete={() => deleteMut.mutate(p.id)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Carried-forward positions from prior weeks */}
          {carriedPositions.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">↳ Carried from prior weeks</span>
                <span className="text-[10px] text-foreground/40">— still open, P&amp;L realises when you close them</span>
              </div>
              <div className="bg-[var(--surface)] border border-amber-200 dark:border-amber-800/50 rounded-2xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-amber-50/60 dark:bg-amber-900/10">
                      {["Symbol", "Cts", "Strike", "P/C", "Sold", "Expiry", "Prem In", "Roll", "Status", "Margin", "Actions"].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bySymbolCarried.map(([, rows]) =>
                      rows.map((p) => (
                        <PositionRow
                          key={p.id}
                          pos={p}
                          onEdit={() => { setEditing(p); setShowForm(false); }}
                          onDelete={() => deleteMut.mutate(p.id)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Symbols Tab ───────────────────────────────────────────────────────────────

function SymbolsTab() {
  const { data: symbols = [], isLoading } = useQuery({
    queryKey: ["symbolSummary"],
    queryFn: fetchSymbolSummary,
    staleTime: 60_000,
  });
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => symbols.filter((s) => s.symbol.toLowerCase().includes(search.toLowerCase())),
    [symbols, search],
  );

  return (
    <div>
      <div className="mb-4 relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol…"
          className={`${inp} pl-8`}
        />
      </div>

      {isLoading && <div className="space-y-2">{[1, 2, 3].map((i) => <SkeletonCard key={i} rows={1} />)}</div>}

      {!isLoading && filtered.length === 0 && (
        <EmptyState icon={Search} title="No symbols found" body={search ? "Try a different search." : "Your traded symbols will appear here."} />
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                {["Symbol", "Total Premium", "Realized P/L", "Active", "Closed", "Expired", "Assigned"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.symbol} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                  <td className="px-4 py-2.5 font-bold text-foreground">{s.symbol}</td>
                  <td className="px-4 py-2.5 text-green-500 font-semibold">${s.total_premium.toFixed(2)}</td>
                  <td className={`px-4 py-2.5 font-semibold ${s.realized_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {fmt$(s.realized_pnl)}
                  </td>
                  <td className="px-4 py-2.5 text-blue-500 font-semibold">{s.active}</td>
                  <td className="px-4 py-2.5 text-green-600">{s.closed}</td>
                  <td className="px-4 py-2.5 text-foreground/50">{s.expired}</td>
                  <td className="px-4 py-2.5 text-yellow-500">{s.assigned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Year Summary Tab ─────────────────────────────────────────────────────────

function YearTab() {
  const { data: s, isLoading } = useQuery({
    queryKey: ["portfolioSummary"],
    queryFn: fetchPortfolioSummary,
    staleTime: 60_000,
  });

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <SkeletonCard key={i} rows={2} />)}</div>;
  if (!s) return <EmptyState icon={BarChart2} title="No data yet" body="Complete a week to see your yearly summary." />;

  // Guard: backend may be an older process without these fields yet
  const weeksBreakdown: WeekBreakdown[] = s.weeks_breakdown ?? [];
  const monthlyPremium: Record<string, number> = s.monthly_premium ?? {};
  const winRate: number = s.win_rate ?? 0;
  const completeWeeks: number = s.complete_weeks ?? 0;

  const monthNames: Record<string, string> = {
    "01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun",
    "07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec",
  };

  const monthlyEntries = Object.entries(monthlyPremium).sort(([a],[b]) => a.localeCompare(b));
  const maxMonthlyPremium = Math.max(...monthlyEntries.map(([,v]) => v), 1);

  return (
    <div className="space-y-6">

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Total Premium</p>
          <p className="text-xl font-black text-green-500">${s.total_premium_collected.toFixed(2)}</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Realized P/L</p>
          <p className={`text-xl font-black ${s.realized_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(s.realized_pnl)}</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Win Rate</p>
          <p className="text-xl font-black text-blue-500">{winRate}%</p>
          <p className="text-[10px] text-foreground/50">{completeWeeks}/{s.total_weeks} weeks</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Est. Tax ({(s.cap_gains_tax_rate*100).toFixed(0)}%)</p>
          <p className="text-xl font-black text-orange-400">${s.estimated_tax.toFixed(2)}</p>
        </div>
      </div>

      {/* ── Best / Worst week ── */}
      {(s.best_week || s.worst_week) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {s.best_week && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Trophy size={14} className="text-green-600" />
                <p className="text-xs font-bold text-green-700 dark:text-green-400">Best Week</p>
              </div>
              <p className="text-sm text-foreground/70">{s.best_week.week_end}</p>
              <p className="text-2xl font-black text-green-600">${s.best_week.premium.toFixed(2)}</p>
              <p className="text-xs text-foreground/50">{s.best_week.position_count} positions</p>
            </div>
          )}
          {s.worst_week && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={14} className="text-red-500" />
                <p className="text-xs font-bold text-red-600 dark:text-red-400">Worst Week</p>
              </div>
              <p className="text-sm text-foreground/70">{s.worst_week.week_end}</p>
              <p className={`text-2xl font-black ${s.worst_week.premium >= 0 ? "text-green-600" : "text-red-500"}`}>
                {fmt$(s.worst_week.premium)}
              </p>
              <p className="text-xs text-foreground/50">{s.worst_week.position_count} positions</p>
            </div>
          )}
        </div>
      )}

      {/* ── Monthly bar chart ── */}
      {monthlyEntries.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={14} className="text-blue-500" />
            <h3 className="text-sm font-bold text-foreground">Monthly Premium</h3>
          </div>
          <div className="flex items-end gap-2 h-28">
            {monthlyEntries.map(([ym, val]) => {
              const [year, month] = ym.split("-");
              const pct = Math.max(4, Math.round((val / maxMonthlyPremium) * 100));
              return (
                <div key={ym} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-foreground/60 font-semibold">${val >= 1000 ? (val/1000).toFixed(1)+"k" : val.toFixed(0)}</span>
                  <div
                    className={`w-full rounded-t-md ${val >= 0 ? "bg-green-500" : "bg-red-500"}`}
                    style={{ height: `${pct}%` }}
                  />
                  <span className="text-[9px] text-foreground/50">{monthNames[month] ?? month}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Week-by-week table ── */}
      {weeksBreakdown.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-x-auto">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-foreground">Week-by-Week</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                {["Week Ending","Status","Positions","Premium","Realized P/L","Account Value"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeksBreakdown.map((w: WeekBreakdown) => (
                <tr key={w.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                  <td className="px-4 py-2.5 font-semibold text-foreground">{w.week_end}</td>
                  <td className="px-4 py-2.5">
                    {w.is_complete
                      ? <span className="text-xs bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300 px-2 py-0.5 rounded-full font-semibold">Complete</span>
                      : <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full font-semibold">Active</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-foreground/70">{w.position_count}</td>
                  <td className={`px-4 py-2.5 font-semibold ${w.premium >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {fmt$(w.premium)}
                  </td>
                  <td className={`px-4 py-2.5 font-semibold ${w.realized_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {fmt$(w.realized_pnl)}
                  </td>
                  <td className="px-4 py-2.5 text-foreground/70">
                    {w.account_value != null ? `$${w.account_value.toLocaleString()}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {weeksBreakdown.length === 0 && (
        <EmptyState icon={Calendar} title="No completed weeks yet" body="Mark a week complete to populate your yearly summary." />
      )}
    </div>
  );
}

// ── Holdings Tab ─────────────────────────────────────────────────────────────

function HoldingRow({ h, onEdit, onDelete }: { h: StockHolding; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["holdingEvents", h.id],
    queryFn: () => fetchHoldingEvents(h.id),
    enabled: expanded,
    staleTime: 30_000,
  });

  return (
    <>
      <tr className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
        {/* Company / Symbol */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-foreground">{h.symbol}</span>
            {h.status === "CLOSED" && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 font-semibold">CLOSED</span>
            )}
          </div>
          {h.company_name && <div className="text-[10px] text-foreground/50 truncate max-w-[140px]">{h.company_name}</div>}
        </td>
        {/* Shares */}
        <td className="px-3 py-2.5 text-foreground font-semibold">{h.shares.toLocaleString()}</td>
        {/* Avg cost */}
        <td className="px-3 py-2.5 text-foreground/70 text-sm">${h.cost_basis.toFixed(2)}</td>
        {/* Adj basis */}
        <td className="px-3 py-2.5 text-sm">
          <span className="font-semibold text-blue-500">${h.adjusted_cost_basis.toFixed(2)}</span>
          {h.basis_reduction > 0 && (
            <div className="text-[9px] text-green-500 font-semibold">↓ ${h.basis_reduction.toFixed(2)} saved</div>
          )}
        </td>
        {/* Live price + unrealized P&L */}
        <HoldingLivePrice symbol={h.symbol} adjBasis={h.adjusted_cost_basis} shares={h.shares} />
        {/* Actions */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-[10px] px-2 py-1 rounded-lg bg-[var(--surface-2)] text-foreground/70 font-semibold hover:bg-[var(--surface-3,var(--surface-2))] transition flex items-center gap-1"
            >
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />} History
            </button>
            <button onClick={onEdit} className="text-[10px] px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-semibold hover:bg-blue-100 transition">Edit</button>
            <button
              onClick={() => { if (window.confirm(`Delete ${h.symbol} holding (${h.shares} shares)?`)) onDelete(); }}
              className="text-[10px] px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition"
            >Del</button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/40">
          <td colSpan={6} className="px-4 pb-3 pt-2">
            {eventsLoading ? (
              <p className="text-xs text-foreground/50">Loading history…</p>
            ) : events.length === 0 ? (
              <p className="text-xs text-foreground/50">No events yet — events are recorded automatically when linked option positions change status.</p>
            ) : (
              <div className="space-y-1.5">
                {events.map((ev: HoldingEvent) => (
                  <div key={ev.id} className={`flex items-start gap-3 text-xs px-3 py-2 rounded-xl border ${
                    ev.event_type === "CC_ASSIGNED"  ? "bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-800" :
                    ev.event_type === "CC_EXPIRED"   ? "bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800" :
                    ev.event_type === "CSP_ASSIGNED" ? "bg-yellow-50/50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800" :
                    "bg-[var(--surface)] border-[var(--border)]"
                  }`}>
                    <span className={`font-bold shrink-0 ${
                      ev.event_type === "CC_ASSIGNED"  ? "text-green-600" :
                      ev.event_type === "CC_EXPIRED"   ? "text-blue-500" :
                      ev.event_type === "CSP_ASSIGNED" ? "text-yellow-600" : "text-foreground/60"
                    }`}>{ev.event_type.replace("_", " ")}</span>
                    <span className="text-foreground/70 flex-1">{ev.description}</span>
                    {ev.realized_gain != null && (
                      <span className={`font-bold shrink-0 ${ev.realized_gain >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {ev.realized_gain >= 0 ? "+" : ""}{ev.realized_gain.toFixed(2)}
                      </span>
                    )}
                    <span className="text-foreground/40 shrink-0">{ev.created_at.slice(0, 10)}</span>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

interface HoldingFormState {
  symbol: string; company_name: string; shares: string; cost_basis: string; acquired_date: string; notes: string;
}

function HoldingLivePrice({ symbol, adjBasis, shares }: { symbol: string; adjBasis: number; shares: number }) {
  const { data } = useQuery({
    queryKey: ["stockHistory", symbol, "1d"],
    queryFn: () => fetchStockHistory(symbol, "1d", "5m"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const price = data?.current_price;
  if (price == null) return <td className="px-3 py-2.5 text-foreground/40 text-xs">—</td>;
  const unrealized = (price - adjBasis) * shares;
  return (
    <td className="px-3 py-2.5 text-sm">
      <div className="font-semibold text-foreground">${price.toFixed(2)}</div>
      <div className={`text-[10px] font-bold ${unrealized >= 0 ? "text-green-500" : "text-red-500"}`}>
        {unrealized >= 0 ? "+" : ""}${unrealized.toFixed(0)}
        <span className="ml-1 font-normal text-foreground/40">
          ({((price - adjBasis) / adjBasis * 100).toFixed(1)}%)
        </span>
      </div>
    </td>
  );
}

function HoldingsTab() {
  const qc = useQueryClient();
  const { data: holdings = [], isLoading } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
    staleTime: 30_000,
  });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StockHolding | null>(null);
  const [search, setSearch] = useState("");
  const emptyHoldingForm = (): HoldingFormState => ({
    symbol: "", company_name: "", shares: "", cost_basis: "",
    acquired_date: new Date().toISOString().slice(0, 10), notes: "",
  });
  const [f, setF] = useState<HoldingFormState>(emptyHoldingForm());
  const [formErr, setFormErr] = useState("");

  function resetForm() { setF(emptyHoldingForm()); setFormErr(""); }
  function setField(k: keyof HoldingFormState, v: string) { setF(p => ({ ...p, [k]: v })); }

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteHolding(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holdings"] }),
  });

  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const seedMut = useMutation({
    mutationFn: seedHoldingsFromPositions,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["holdings"] });
      qc.invalidateQueries({ queryKey: ["positions"] });
      setSeedMsg(
        res.created.length > 0
          ? `✓ Created ${res.created.length} holding${res.created.length > 1 ? "s" : ""}, linked ${res.linked} position${res.linked > 1 ? "s" : ""}.`
          : `✓ ${res.linked} position${res.linked > 1 ? "s" : ""} linked to existing holdings.`
      );
      setTimeout(() => setSeedMsg(null), 5000);
    },
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        symbol: f.symbol.toUpperCase().trim(),
        company_name: f.company_name || undefined,
        shares: parseFloat(f.shares),
        cost_basis: parseFloat(f.cost_basis),
        acquired_date: f.acquired_date || undefined,
        notes: f.notes || undefined,
      };
      if (editing) {
        return updateHolding(editing.id, {
          shares: body.shares,
          cost_basis: body.cost_basis,
          company_name: body.company_name ?? null,
          acquired_date: body.acquired_date,
          notes: body.notes,
        } as Partial<StockHolding>);
      }
      return createHolding(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["holdings"] });
      setShowForm(false); setEditing(null); resetForm();
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  function startEdit(h: StockHolding) {
    setEditing(h);
    setF({
      symbol: h.symbol,
      company_name: h.company_name ?? "",
      shares: String(h.shares),
      cost_basis: String(h.cost_basis),
      acquired_date: h.acquired_date?.slice(0, 10) ?? "",
      notes: h.notes ?? "",
    });
    setShowForm(true);
  }

  const filtered = useMemo(
    () => holdings.filter(h =>
      h.symbol.toLowerCase().includes(search.toLowerCase()) ||
      (h.company_name ?? "").toLowerCase().includes(search.toLowerCase())
    ),
    [holdings, search]
  );

  const totalAdjCost = holdings.filter(h => h.status === "ACTIVE").reduce((s, h) => s + h.total_adjusted_cost, 0);
  const totalSaved = holdings.reduce((s, h) => s + h.basis_reduction, 0);

  const fld = (label: string, el: React.ReactNode) => (
    <div><label className="text-xs text-foreground/70 block mb-1">{label}</label>{el}</div>
  );

  return (
    <div>
      {/* Summary cards */}
      {holdings.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Active Lots</p>
            <p className="text-base font-black text-foreground">{holdings.filter(h => h.status === "ACTIVE").length}</p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Total Adj Cost</p>
            <p className="text-base font-black text-blue-500">${totalAdjCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Basis Saved</p>
            <p className="text-base font-black text-green-500">${totalSaved.toFixed(2)}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search symbol or company…" className={`${inp} pl-8`} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => seedMut.mutate()}
            disabled={seedMut.isPending}
            title="Create holdings from existing positions using strike as avg cost"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-foreground/70 text-xs font-semibold hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <TrendingUp size={12} /> {seedMut.isPending ? "Importing…" : "Import from Positions"}
          </button>
          <button
            onClick={() => { setEditing(null); resetForm(); setShowForm(v => !v); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition"
          >
            <Plus size={12} /> Add Holding
          </button>
        </div>
      </div>

      {seedMsg && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 text-xs font-semibold">
          {seedMsg}
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div className="bg-[var(--surface)] border border-blue-200 dark:border-blue-800 rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-foreground">{editing ? `Edit ${editing.symbol}` : "Add Holding"}</h3>
            <button onClick={() => { setShowForm(false); setEditing(null); }} className="p-1.5 rounded-xl text-foreground/70 hover:bg-[var(--surface-2)] transition"><X size={15} /></button>
          </div>

          {/* Ticker search — only for new holdings */}
          {!editing && (
            <div className="mb-4">
              <label className="text-xs text-foreground/70 block mb-1">Search Company / Ticker</label>
              <TickerSearchInput
                value={f.symbol}
                onChange={(v) => setField("symbol", v)}
                onSelect={(sym) => setField("symbol", sym)}
                placeholder="Type AAPL, Apple, MSFT…"
                actionLabel="SELECT"
                accentColor="#2563eb"
              />
              {f.symbol && (
                <p className="mt-1.5 text-[11px] text-blue-500 font-semibold">✓ {f.symbol} selected</p>
              )}
            </div>
          )}
          {editing && (
            <div className="mb-4 p-3 bg-[var(--surface-2)] rounded-xl">
              <p className="text-xs text-foreground/60">Editing</p>
              <p className="font-black text-foreground text-lg">{editing.symbol}</p>
              {editing.company_name && <p className="text-xs text-foreground/50">{editing.company_name}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            {fld("Shares", <input type="number" min="1" step="1" value={f.shares} onChange={e => setField("shares", e.target.value)} placeholder="100" className={inp} />)}
            {fld("Avg Cost / Share ($)", <input type="number" step="0.01" value={f.cost_basis} onChange={e => setField("cost_basis", e.target.value)} placeholder="150.00" className={inp} />)}
            {fld("Acquired Date", <input type="date" value={f.acquired_date} onChange={e => setField("acquired_date", e.target.value)} className={inp} />)}
          </div>
          {fld("Notes", <input value={f.notes} onChange={e => setField("notes", e.target.value)} placeholder="optional" className={`${inp} mb-3`} />)}
          {formErr && <p className="text-xs text-red-500 mb-3">{formErr}</p>}
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !f.symbol || !f.shares || !f.cost_basis}
            className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {saveMut.isPending ? "Saving…" : editing ? "Save Changes" : "Add Holding"}
          </button>
        </div>
      )}

      {isLoading && <div className="space-y-2">{[1,2,3].map(i => <SkeletonCard key={i} rows={1} />)}</div>}

      {!isLoading && filtered.length === 0 && (
        <EmptyState icon={Wallet} title="No holdings yet" body={search ? "No holdings match your search." : "Click \"Add Holding\", search for a company, enter shares and average cost."} />
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                {["Company","Shares","Avg Cost","Adj Basis","Current Price / P&L","Actions"].map(col => (
                  <th key={col} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(h => (
                <HoldingRow
                  key={h.id}
                  h={h}
                  onEdit={() => startEdit(h)}
                  onDelete={() => deleteMut.mutate(h.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Portfolio Summary Bar ─────────────────────────────────────────────────────

function PortfolioSummaryBar() {
  const { data: summary } = useQuery({
    queryKey: ["portfolioSummary"],
    queryFn: fetchPortfolioSummary,
    staleTime: 60_000,
  });
  if (!summary) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <DollarSign size={11} className="text-green-500" />
          <p className="text-[9px] font-semibold text-foreground/60 uppercase tracking-wide">Total Premium</p>
        </div>
        <p className="text-base font-black text-green-500">${summary.total_premium_collected.toFixed(2)}</p>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <TrendingUp size={11} className="text-blue-500" />
          <p className="text-[9px] font-semibold text-foreground/60 uppercase tracking-wide">Realized P/L</p>
        </div>
        <p className={`text-base font-black ${summary.realized_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
          {fmt$(summary.realized_pnl)}
        </p>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Activity size={11} className="text-blue-400" />
          <p className="text-[9px] font-semibold text-foreground/60 uppercase tracking-wide">Active Positions</p>
        </div>
        <p className="text-base font-black text-blue-500">{summary.active_positions}</p>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <AlertCircle size={11} className="text-orange-400" />
          <p className="text-[9px] font-semibold text-foreground/60 uppercase tracking-wide">
            Est. Tax ({(summary.cap_gains_tax_rate * 100).toFixed(0)}%)
          </p>
        </div>
        <p className="text-base font-black text-orange-400">${summary.estimated_tax.toFixed(2)}</p>
      </div>
    </div>
  );
}

// ── Week Selector ─────────────────────────────────────────────────────────────

function WeekSelector({
  weeks, selectedId, onSelect, onNewWeek,
}: {
  weeks: WeeklySnapshot[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNewWeek: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <select
          value={selectedId ?? ""}
          onChange={(e) => onSelect(Number(e.target.value))}
          className="appearance-none border border-[var(--border)] rounded-xl px-3 py-2 pr-8 text-sm bg-[var(--surface)] text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold min-w-[220px]"
        >
          <option value="" disabled>Select week…</option>
          {weeks.map((w) => (
            <option key={w.id} value={w.id}>
              {weekLabel(w)}{w.is_complete ? " ✓" : ""}
              {w.account_value ? ` — $${w.account_value.toLocaleString()}` : ""}
            </option>
          ))}
        </select>
        <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground/50 pointer-events-none" />
      </div>
      <button
        onClick={onNewWeek}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-foreground hover:bg-[var(--surface-2)] transition"
      >
        <Plus size={12} /> New Week
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const qc = useQueryClient();
  const {
    data: weeks = [],
    isLoading: weeksLoading,
    refetch: refetchWeeks,
    isFetching: weeksFetching,
  } = useQuery({ queryKey: ["weeks"], queryFn: fetchWeeks, staleTime: 30_000 });

  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);
  const [tab, setTab] = useState<"holdings" | "positions" | "symbols" | "year">("holdings");
  const [autoSelected, setAutoSelected] = useState(false);

  if (!autoSelected && weeks.length > 0) {
    setSelectedWeekId(weeks[0].id);
    setAutoSelected(true);
  }

  const selectedWeek = weeks.find((w) => w.id === selectedWeekId) ?? weeks[0] ?? null;

  // Find the next Friday not yet in the weeks list, so "New Week" always
  // creates a genuinely new week rather than idempotently returning the current one.
  function nextUnusedFriday(): string {
    const existingEnds = new Set(weeks.map((w) => w.week_end.slice(0, 10)));
    // Start from today; walk forward day-by-day until we hit a Friday not in the list.
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      if (d.getDay() === 5) { // 5 = Friday
        const iso = d.toISOString().slice(0, 10);
        if (!existingEnds.has(iso)) return iso;
      }
      d.setDate(d.getDate() + 1);
    }
    // Fallback: 7 days after the latest week_end
    const latest = weeks[0]?.week_end;
    if (latest) {
      const next = new Date(latest);
      next.setDate(next.getDate() + 7);
      return next.toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  }

  const newWeekMut = useMutation({
    mutationFn: () => getOrCreateWeek(nextUnusedFriday()),
    onSuccess: (w) => {
      qc.invalidateQueries({ queryKey: ["weeks"] });
      setSelectedWeekId(w.id);
    },
    onError: (e: Error) => alert(`Could not create week: ${e.message}`),
  });

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Options Portfolio"
        sub="Weekly tracker — sell options, track premium, manage assignments"
        action={
          <RefreshButton
            onRefresh={() => { refetchWeeks(); qc.invalidateQueries({ queryKey: ["portfolioSummary"] }); }}
            isRefreshing={weeksFetching}
          />
        }
      />

      <PortfolioSummaryBar />

      <div className="mb-5">
        {weeksLoading ? (
          <div className="h-10 w-64 rounded-xl bg-[var(--surface-2)] animate-pulse" />
        ) : (
          <WeekSelector
            weeks={weeks}
            selectedId={selectedWeek?.id ?? null}
            onSelect={setSelectedWeekId}
            onNewWeek={() => newWeekMut.mutate()}
          />
        )}
      </div>

      {!weeksLoading && (
        <div className="mb-5">
          <Tabs
            active={tab}
            onChange={(k) => setTab(k as "holdings" | "positions" | "symbols" | "year")}
            tabs={[
              { key: "holdings",  label: "Holdings"  },
              { key: "positions", label: "Positions" },
              { key: "symbols",   label: "Symbols"   },
              { key: "year",      label: "Year"      },
            ]}
          />
        </div>
      )}

      {tab === "holdings" && <HoldingsTab />}

      {tab === "positions" && (
        selectedWeek
          ? <PositionsTab week={selectedWeek} />
          : !weeksLoading && (
            <EmptyState
              icon={BarChart2}
              title="No weeks yet"
              body='Click "New Week" to create your first week and start logging positions.'
            />
          )
      )}

      {tab === "symbols" && <SymbolsTab />}
      {tab === "year"    && <YearTab />}
    </div>
  );
}
