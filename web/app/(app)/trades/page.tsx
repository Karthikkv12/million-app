"use client";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchWeeks, getOrCreateWeek, completeWeek, reopenWeek,
  fetchPositions, createPosition, updatePosition, deletePosition,
  createAssignment, fetchAssignment, updateAssignment,
  fetchPortfolioSummary, fetchSymbolSummary, fetchStockHistory,
  fetchHoldings, createHolding, updateHolding, deleteHolding, fetchHoldingEvents,
  seedHoldingsFromPositions, recalculateHoldings, syncPremiumLedger,
  fetchPremiumDashboard, updateWeek,
  WeeklySnapshot, OptionPosition, StockAssignment, PositionStatus, WeekBreakdown,
  StockHolding, HoldingEvent, PremiumDashboard, PremiumSymbolRow, PremiumWeekRow,
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
  status: PositionStatus;
}

const emptyForm = (): PosFormState => ({
  symbol: "", contracts: "1", strike: "", option_type: "CALL",
  sold_date: new Date().toISOString().slice(0, 10),
  expiry_date: "", buy_date: "", premium_in: "", premium_out: "",
  is_roll: false, margin: "", notes: "", holding_id: "",
  status: "ACTIVE",
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
    status: p.status,
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
      {/* Prem Out — shown for closed/rolled/expired/assigned positions and rolls */}
      {(f.is_roll || ["CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"].includes(f.status)) && (() => {
        const premIn  = parseFloat(f.premium_in)  || 0;
        const premOut = parseFloat(f.premium_out) || 0;   // negative = buyback debit
        const contracts = parseInt(f.contracts) || 1;
        const netTotal  = (premIn + premOut) * contracts * 100; // premOut is negative
        const isLoss    = premOut !== 0 && Math.abs(premOut) > premIn;
        return (
          <div className="mb-3">
            <label className="text-xs text-foreground/70 block mb-1">
              Prem Out ($) <span className="text-foreground/40">— buyback/close cost (enter as negative, e.g. −0.45)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number" step="0.01" value={f.premium_out}
                onChange={(e) => set("premium_out", e.target.value)}
                placeholder={f.is_roll ? "Roll credit (+) or debit (−)" : "e.g. −0.45"}
                className={`${inp} flex-1 ${isLoss ? "border-red-400 dark:border-red-600" : ""}`}
              />
              {f.premium_out !== "" && (
                <div className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${
                  isLoss
                    ? "bg-red-50 dark:bg-red-900/30 text-red-500"
                    : "bg-green-50 dark:bg-green-900/20 text-green-600"
                }`}>
                  Net: {netTotal >= 0 ? "+" : ""}${netTotal.toFixed(2)}
                  {isLoss && <span className="ml-1.5 text-[10px] font-bold">LOSS — adj basis unaffected</span>}
                </div>
              )}
            </div>
            {isLoss && (
              <p className="mt-1.5 text-[11px] text-red-500/80">
                ⚠ Buyback cost exceeds premium collected. This is a realized loss. Adj basis will <span className="font-bold">not</span> be reduced.
              </p>
            )}
          </div>
        );
      })()}
      <div className="flex items-center gap-3 mb-3">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-foreground">
          <input
            type="checkbox" checked={f.is_roll}
            onChange={(e) => set("is_roll", e.target.checked)}
            className="rounded accent-purple-500"
          />
          This is a roll
        </label>
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
                {h.symbol}{h.company_name ? ` · ${h.company_name.slice(0, 25)}` : ""} · {h.shares.toLocaleString()} shares · live adj basis ${(h.live_adj_basis ?? h.adjusted_cost_basis).toFixed(2)}
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

// ── Status Quick-Edit (with inline Prem Out when closing) ────────────────────

const PREM_OUT_STATUSES: PositionStatus[] = ["CLOSED", "EXPIRED", "ROLLED"];

function StatusSelect({ pos }: { pos: OptionPosition }) {
  const qc = useQueryClient();
  // Track a pending status change before we confirm with prem out
  const [pendingStatus, setPendingStatus] = useState<PositionStatus | null>(null);
  const [premOut, setPremOut] = useState(
    pos.premium_out != null ? String(pos.premium_out) : ""
  );
  const [err, setErr] = useState("");

  const needsPremOut = (s: PositionStatus) => PREM_OUT_STATUSES.includes(s);

  const saveMut = useMutation({
    mutationFn: (body: { status: PositionStatus; premium_out?: number | null }) =>
      updatePosition(pos.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions", pos.week_id] });
      setPendingStatus(null);
      setErr("");
    },
    onError: (e: Error) => setErr(e.message),
  });

  function handleStatusChange(newStatus: PositionStatus) {
    if (needsPremOut(newStatus)) {
      // Show inline prem-out input before committing
      setPendingStatus(newStatus);
      setPremOut(pos.premium_out != null ? String(pos.premium_out) : "");
    } else {
      // ACTIVE / ASSIGNED → save immediately, no prem out needed
      saveMut.mutate({ status: newStatus, premium_out: null });
    }
  }

  function handleConfirm() {
    if (!pendingStatus) return;
    const parsed = premOut !== "" ? parseFloat(premOut) : null;
    saveMut.mutate({ status: pendingStatus, premium_out: parsed });
  }

  const isClosed = needsPremOut(pendingStatus ?? pos.status);
  const premIn   = pos.premium_in ?? 0;
  const premOutV = parseFloat(premOut) || 0;
  const isLoss   = premOut !== "" && Math.abs(premOutV) > premIn;
  const netPL    = premOut !== "" ? (premIn + premOutV) * pos.contracts * 100 : null;

  const displayStatus = pendingStatus ?? pos.status;

  return (
    <div className="flex flex-col gap-1.5 min-w-[110px]">
      {/* Status dropdown */}
      <select
        value={displayStatus}
        onChange={(e) => handleStatusChange(e.target.value as PositionStatus)}
        disabled={saveMut.isPending}
        className="text-[11px] border border-[var(--border)] rounded-lg px-2 py-1 bg-[var(--surface)] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {(["ACTIVE", "CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"] as PositionStatus[]).map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      {/* Inline prem-out entry — only when status is CLOSED/EXPIRED/ROLLED */}
      {pendingStatus && needsPremOut(pendingStatus) && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              value={premOut}
              onChange={(e) => setPremOut(e.target.value)}
              placeholder="Prem Out (e.g. −0.45)"
              autoFocus
              className={`w-full text-[11px] border rounded-lg px-2 py-1 bg-[var(--surface)] text-foreground focus:outline-none focus:ring-1 ${
                isLoss ? "border-red-400 focus:ring-red-400" : "border-[var(--border)] focus:ring-green-500"
              }`}
            />
            <button
              onClick={handleConfirm}
              disabled={saveMut.isPending}
              className="shrink-0 text-[10px] px-2 py-1 rounded-lg bg-green-600 text-white font-bold hover:bg-green-700 disabled:opacity-50 transition"
            >
              {saveMut.isPending ? "…" : "✓"}
            </button>
            <button
              onClick={() => { setPendingStatus(null); setErr(""); }}
              className="shrink-0 text-[10px] px-1.5 py-1 rounded-lg border border-[var(--border)] text-foreground/60 hover:bg-[var(--surface-2)] transition"
            >
              ✕
            </button>
          </div>
          {netPL !== null && (
            <span className={`text-[10px] font-semibold ${isLoss ? "text-red-500" : "text-green-500"}`}>
              net {netPL >= 0 ? "+" : ""}${netPL.toFixed(0)}
              {isLoss && <span className="ml-1 text-[9px] bg-red-100 dark:bg-red-900/40 px-1 rounded">LOSS</span>}
            </span>
          )}
          {err && <span className="text-[10px] text-red-500">{err}</span>}
        </div>
      )}
    </div>
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

  const premOutCell = (() => {
    const isClosed = ["CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"].includes(pos.status);
    const showPremOut = pos.premium_out != null && (isClosed || pos.is_roll);
    if (!showPremOut) return null;
    const premIn  = pos.premium_in  ?? 0;
    const premOut = pos.premium_out!;
    const isLoss  = Math.abs(premOut) > premIn;
    const netPL   = (premIn + premOut) * pos.contracts * 100;
    return { premOut, isLoss, netPL, isClosed };
  })();

  return (
    <>
      {/* ── Mobile card (< sm) ── */}
      <div className={`sm:hidden border-b border-[var(--border)] px-3 py-3 ${isCarriedForward ? "opacity-90" : ""}`}>
        {/* Row 1: Symbol + badges + status */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-foreground text-base">{pos.symbol}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${pos.option_type === "PUT" ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-green-100 dark:bg-green-900/30 text-green-600"}`}>
                {pos.option_type}
              </span>
              {isCarriedForward && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 font-semibold">↳ {pos.origin_week_label ?? "prior wk"}</span>
              )}
              {!isCarriedForward && isCarried && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-500 font-semibold">↩ rolled</span>
              )}
            </div>
            <div className="text-sm text-foreground/70">
              ${pos.strike.toFixed(2)} · {pos.contracts} ct{pos.contracts !== 1 ? "s" : ""}
            </div>
          </div>
          {/* Status select — right side */}
          <StatusSelect pos={pos} />
        </div>

        {/* Row 2: Dates */}
        <div className="flex items-center gap-3 text-[11px] text-foreground/50 mb-2">
          {pos.sold_date && <span>Sold {fmtDate(pos.sold_date)}</span>}
          {pos.expiry_date && <span>Exp {fmtDate(pos.expiry_date)}</span>}
        </div>

        {/* Row 3: Premium In / Out */}
        <div className="flex items-center gap-4 mb-2">
          <div>
            <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Prem In</span>
            <span className="text-sm font-semibold text-green-600">{pos.premium_in != null ? `$${pos.premium_in.toFixed(2)}` : "—"}</span>
          </div>
          {premOutCell && (
            <div>
              <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Prem Out</span>
              <div className="flex flex-col gap-0.5">
                <span className={premOutCell.isLoss ? "text-red-500 font-semibold text-sm" : "text-orange-400 text-sm"}>
                  {premOutCell.premOut >= 0 ? "+" : ""}${premOutCell.premOut.toFixed(2)}
                  {pos.is_roll && <span className="ml-1 text-[9px] text-purple-400">roll</span>}
                </span>
                {premOutCell.isClosed && (
                  <span className={`text-[10px] font-semibold ${premOutCell.isLoss ? "text-red-500" : "text-green-500"}`}>
                    net {premOutCell.netPL >= 0 ? "+" : ""}${premOutCell.netPL.toFixed(0)}
                    {premOutCell.isLoss && <span className="ml-1 px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-[9px]">LOSS</span>}
                  </span>
                )}
              </div>
            </div>
          )}
          {pos.margin != null && (
            <div>
              <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Margin</span>
              <span className="text-sm text-foreground/60">${pos.margin.toFixed(0)}</span>
            </div>
          )}
        </div>

        {/* Row 4: Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {pos.status === "ASSIGNED" && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[10px] px-2.5 py-1.5 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 font-semibold hover:bg-yellow-200 transition flex items-center gap-1"
            >
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />} Stock
            </button>
          )}
          <button onClick={onEdit} className="text-[10px] px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-semibold hover:bg-blue-100 transition">Edit</button>
          <button
            onClick={() => { if (window.confirm(`Delete ${pos.symbol} $${pos.strike} ${pos.option_type}?`)) onDelete(); }}
            className="text-[10px] px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition"
          >Delete</button>
        </div>

        {/* Assignment panel (mobile) */}
        {expanded && pos.status === "ASSIGNED" && (
          <div className="mt-2">
            <AssignmentPanel pos={pos} />
          </div>
        )}
      </div>

      {/* ── Desktop table row (≥ sm) ── */}
      <tr className={`hidden sm:table-row border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors ${isCarriedForward ? "opacity-90" : ""}`}>
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
          {(() => {
            const isClosed = ["CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"].includes(pos.status);
            const showPremOut = pos.premium_out != null && (isClosed || pos.is_roll);
            if (!showPremOut) return <span className="text-foreground/30">—</span>;
            const premIn  = pos.premium_in  ?? 0;
            const premOut = pos.premium_out!;   // negative debit
            const isLoss  = Math.abs(premOut) > premIn;  // paid more to close than collected
            const netPL   = (premIn + premOut) * pos.contracts * 100;
            return (
              <div className="flex flex-col gap-0.5">
                <span className={isLoss ? "text-red-500 font-semibold" : "text-orange-400"}>
                  {premOut >= 0 ? "+" : ""}${premOut.toFixed(2)}
                  {pos.is_roll && <span className="ml-1 text-[9px] text-purple-400">roll</span>}
                </span>
                {isClosed && (
                  <span className={`text-[10px] font-semibold ${
                    isLoss ? "text-red-500" : "text-green-500"
                  }`}>
                    net {netPL >= 0 ? "+" : ""}${netPL.toFixed(0)}
                    {isLoss && (
                      <span className="ml-1 px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-[9px]">LOSS</span>
                    )}
                  </span>
                )}
              </div>
            );
          })()}
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
        <tr className="hidden sm:table-row border-b border-[var(--border)] bg-yellow-50/30 dark:bg-yellow-900/5">
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

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
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
              <CheckCircle2 size={12} /> <span className="hidden sm:inline">Mark Week Complete</span><span className="sm:hidden">Complete</span>
            </button>
          )}
        </div>
        {week.is_complete && (
          <div className="flex items-center gap-2 flex-wrap">
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
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
              {/* Mobile cards */}
              <div className="sm:hidden divide-y divide-[var(--border)]">
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
              </div>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                      {["Symbol", "Cts", "Strike", "P/C", "Sold", "Expiry", "Prem In", "Prem Out", "Status", "Margin", "Actions"].map((h) => (
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
            </div>
          )}

          {/* Carried-forward positions from prior weeks */}
          {carriedPositions.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">↳ Carried from prior weeks</span>
                <span className="text-[10px] text-foreground/40 hidden sm:inline">— still open, P&amp;L realises when you close them</span>
              </div>
              <div className="bg-[var(--surface)] border border-amber-200 dark:border-amber-800/50 rounded-2xl overflow-hidden">
                {/* Mobile cards */}
                <div className="sm:hidden divide-y divide-[var(--border)]">
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
                </div>
                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-amber-50/60 dark:bg-amber-900/10">
                        {["Symbol", "Cts", "Strike", "P/C", "Sold", "Expiry", "Prem In", "Prem Out", "Status", "Margin", "Actions"].map((h) => (
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
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-[var(--border)]">
            {filtered.map((s) => (
              <div key={s.symbol} className="px-3 py-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-foreground text-base">{s.symbol}</span>
                  <span className={`text-sm font-bold ${s.realized_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(s.realized_pnl)}</span>
                </div>
                <div className="flex items-center gap-4 text-sm mb-1">
                  <div>
                    <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Total Prem</span>
                    <span className="text-green-500 font-semibold">${s.total_premium.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Active</span>
                    <span className="text-blue-500 font-semibold">{s.active}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-foreground/60">
                  <span>Closed: <span className="text-green-600 font-semibold">{s.closed}</span></span>
                  <span>Expired: <span className="text-foreground/50 font-semibold">{s.expired}</span></span>
                  <span>Assigned: <span className="text-yellow-500 font-semibold">{s.assigned}</span></span>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
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
        </div>
      )}
    </div>
  );
}

// ── Year Summary Tab ─────────────────────────────────────────────────────────
type MonthEntry = [string, number] | null;
type CumEntry = { label: string; cumulative: number; weekly: number };

function YearTab() {
  const { data: s, isLoading: summaryLoading } = useQuery({
    queryKey: ["portfolioSummary"],
    queryFn: fetchPortfolioSummary,
    staleTime: 60_000,
  });
  const { data: premDash, isLoading: premLoading } = useQuery({
    queryKey: ["premiumDashboard"],
    queryFn: fetchPremiumDashboard,
    staleTime: 60_000,
  });
  const { data: holdings = [] } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
    staleTime: 60_000,
  });

  const isLoading = summaryLoading || premLoading;
  if (isLoading) return <div className="space-y-3">{[1,2,3,4].map(i => <SkeletonCard key={i} rows={2} />)}</div>;
  if (!s) return <EmptyState icon={BarChart2} title="No data yet" body="Complete a week to see your performance summary." />;

  const weeksBreakdown = (s.weeks_breakdown ?? []) as WeekBreakdown[];
  const monthlyPremium = (s.monthly_premium ?? {}) as Record<string, number>;
  const winRate = s.win_rate ?? 0;
  const completeWeeks = s.complete_weeks ?? 0;

  // ── Extra derived metrics (computed once here, used in JSX below) ─────────

  // Weekly premium std-dev → consistency score (0–100, higher = more consistent)
  const completedPremiums = [...weeksBreakdown].filter(w => w.is_complete && w.premium > 0).map(w => w.premium);
  const weeklyMean = completedPremiums.length > 0 ? completedPremiums.reduce((a, b) => a + b, 0) / completedPremiums.length : 0;
  const weeklyStdDev = completedPremiums.length > 1
    ? Math.sqrt(completedPremiums.reduce((a, b) => a + Math.pow(b - weeklyMean, 2), 0) / completedPremiums.length)
    : 0;
  const consistencyScore = weeklyMean > 0 ? Math.max(0, Math.min(100, 100 - (weeklyStdDev / weeklyMean) * 100)) : 0;

  // Current win streak (consecutive profitable complete weeks, newest first)
  const completedWeeks = weeksBreakdown.filter(w => w.is_complete);
  const streakBreak = completedWeeks.findIndex(w => w.premium <= 0);
  const currentStreak = streakBreak === -1 ? completedWeeks.length : streakBreak;

  // Avg positions per week
  const avgPositionsPerWeek = completeWeeks > 0
    ? weeksBreakdown.filter(w => w.is_complete).reduce((a, w) => a + w.position_count, 0) / completeWeeks
    : 0;

  // Best and worst month
  const monthlyEntries2 = Object.entries(monthlyPremium).sort((a, b) => a[0].localeCompare(b[0]));
  const bestMonth = monthlyEntries2.reduce((best, cur) => !best || cur[1] > best[1] ? cur : best, null as MonthEntry);
  const worstMonth = monthlyEntries2.filter(entry => entry[1] > 0).reduce((worst, cur) => !worst || cur[1] < worst[1] ? cur : worst, null as MonthEntry);

  // Realized vs in-flight from premium dashboard
  const realizedPrem   = premDash?.grand_total.realized_premium ?? 0;
  const inFlightPrem   = premDash?.grand_total.unrealized_premium ?? 0;
  const totalPremForSplit = realizedPrem + inFlightPrem;
  const realizedPct    = totalPremForSplit > 0 ? (realizedPrem / totalPremForSplit) * 100 : 0;

  const monthNames: Record<string, string> = {
    "01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun",
    "07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec",
  };

  // ── Derived analytics ────────────────────────────────────────────────────

  // Cumulative premium over weeks (chronological)
  const chronoWeeks = [...weeksBreakdown].reverse(); // API returns newest-first
  const cumulativeData = (chronoWeeks.reduce((acc, w) => {
    const prev = acc[acc.length - 1]?.cumulative ?? 0;
    const label = new Date(w.week_end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    acc.push({ label, cumulative: prev + w.premium, weekly: w.premium });
    return acc;
  }, [] as CumEntry[]) as CumEntry[]);

  // Weekly premium run rate & projection
  const activePremWeeks = chronoWeeks.filter(w => w.premium > 0);
  const avgWeeklyPremium = activePremWeeks.length > 0
    ? activePremWeeks.reduce((acc, w) => acc + w.premium, 0) / activePremWeeks.length
    : 0;
  const annualProjection = avgWeeklyPremium * 52;
  const monthlyProjection = avgWeeklyPremium * 4.33;

  // Weeks to break even per holding (basis fully offset by premium at current rate)
  const holdingProjections = holdings
    .filter(h => h.status === "ACTIVE" && h.shares > 0)
    .map(h => {
      const remaining = Math.max(0, (h.live_adj_basis ?? h.cost_basis) * h.shares);
      const weeklyRate = avgWeeklyPremium > 0
        ? (premDash?.by_symbol.find(r => r.symbol === h.symbol)?.total_premium_sold ?? 0) /
          Math.max(1, activePremWeeks.length)
        : 0;
      const weeksToZero = weeklyRate > 0 ? Math.ceil(remaining / weeklyRate) : null;
      const pctReduced = h.cost_basis > 0
        ? ((h.cost_basis - (h.live_adj_basis ?? h.cost_basis)) / h.cost_basis) * 100
        : 0;
      return { symbol: h.symbol, cost_basis: h.cost_basis, live_adj: h.live_adj_basis ?? h.cost_basis,
               pctReduced, weeksToZero, shares: h.shares, totalCost: h.cost_basis * h.shares,
               premiumSold: premDash?.by_symbol.find(r => r.symbol === h.symbol)?.total_premium_sold ?? 0 };
    })
    .sort((a, b) => b.premiumSold - a.premiumSold);

  // Monthly bar data
  const monthlyEntries = Object.entries(monthlyPremium).sort((a, b) => a[0].localeCompare(b[0]));
  const maxMonthlyPremium = Math.max(...monthlyEntries.map(e => e[1]), 1);

  // Max weekly for bar scaling
  const maxWeekly = Math.max(...cumulativeData.map(d => d.weekly), 1);

  // Efficiency: premium as % of total cost basis
  const totalCostBasis = holdings.reduce((acc, h) => acc + h.cost_basis * h.shares, 0);
  const premiumEfficiency = totalCostBasis > 0
    ? ((premDash?.grand_total.total_premium_sold ?? 0) / totalCostBasis) * 100
    : 0;

  // Projection: weeks to cover total position cost at current rate
  const totalPremCollected = premDash?.grand_total.total_premium_sold ?? s.total_premium_collected;
  const weeksToFullCover = avgWeeklyPremium > 0 ? Math.ceil(totalCostBasis / avgWeeklyPremium) : null;

  return (
    <div className="space-y-6">

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Total Collected</p>
          <p className="text-xl font-black text-green-500">${totalPremCollected.toFixed(2)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">{completeWeeks} weeks logged</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Avg / Week</p>
          <p className="text-xl font-black text-blue-500">${avgWeeklyPremium.toFixed(2)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">from {activePremWeeks.length} active weeks</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Annual Run Rate</p>
          <p className="text-xl font-black text-purple-500">${annualProjection.toFixed(0)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">${monthlyProjection.toFixed(0)}/mo projected</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Yield on Cost</p>
          <p className="text-xl font-black text-orange-400">{premiumEfficiency.toFixed(2)}%</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">premium ÷ total cost basis</p>
        </div>
      </div>

      {/* ── Row 2: Win rate + projection ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Win Rate</p>
          <div>
            <p className="text-3xl font-black text-blue-500">{winRate.toFixed(0)}%</p>
            <p className="text-xs text-foreground/50 mt-1">{completeWeeks}/{s.total_weeks} weeks profitable</p>
          </div>
          {/* Mini progress bar */}
          <div className="mt-3 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${winRate}%` }} />
          </div>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Cost Basis Coverage</p>
          <div>
            <p className="text-3xl font-black text-foreground">
              {totalCostBasis > 0 ? ((totalPremCollected / totalCostBasis) * 100).toFixed(2) : "0.00"}%
            </p>
            <p className="text-xs text-foreground/50 mt-1">
              ${totalPremCollected.toFixed(0)} of ${totalCostBasis.toFixed(0)} total cost
            </p>
          </div>
          <div className="mt-3 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, totalCostBasis > 0 ? (totalPremCollected / totalCostBasis) * 100 : 0)}%` }}
            />
          </div>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Est. Tax ({(s.cap_gains_tax_rate*100).toFixed(0)}%)</p>
          <div>
            <p className="text-3xl font-black text-orange-400">${s.estimated_tax.toFixed(2)}</p>
            <p className="text-xs text-foreground/50 mt-1">on ${s.realized_pnl.toFixed(2)} realized P/L</p>
          </div>
          {weeksToFullCover && (
            <p className="mt-3 text-[10px] text-foreground/40">
              ~{weeksToFullCover} weeks to fully cover cost basis at current rate
            </p>
          )}
        </div>
      </div>

      {/* ── Cumulative premium curve + weekly bars ── */}
      {cumulativeData.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-green-500" />
              <h3 className="text-sm font-bold text-foreground">Premium Accumulation</h3>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-foreground/50">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 bg-green-500 rounded" />Weekly</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 bg-blue-400 rounded" />Cumulative</span>
            </div>
          </div>

          {/* Dual chart: bars (weekly) + line (cumulative) overlaid */}
          <div className="relative h-40">
            {/* Bar chart layer */}
            <div className="absolute inset-0 flex items-end gap-1 px-1">
              {cumulativeData.map((d, i) => {
                const barPct = Math.max(2, Math.round((d.weekly / maxWeekly) * 75));
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className="w-full rounded-t bg-green-500/30 border border-green-500/50"
                      style={{ height: `${barPct}%` }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Cumulative line layer (SVG) */}
            <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
              {(() => {
                const maxCum = Math.max(...cumulativeData.map(d => d.cumulative), 1);
                const n = cumulativeData.length;
                if (n < 2) return null;
                const pts = cumulativeData.map((d, i) => {
                  const x = (i / (n - 1)) * 100;
                  const y = 100 - (d.cumulative / maxCum) * 85;
                  return `${x},${y}`;
                });
                const areaPath = `M${pts[0]} L${pts.join(" L")} L100,100 L0,100 Z`;
                return (
                  <>
                    <defs>
                      <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={areaPath} fill="url(#cumGrad)" />
                    <polyline
                      points={pts.join(" ")}
                      fill="none"
                      stroke="#60a5fa"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                    {cumulativeData.map((d, i) => {
                      const x = (i / (n - 1)) * 100;
                      const y = 100 - (d.cumulative / maxCum) * 85;
                      return <circle key={i} cx={`${x}%`} cy={`${y}%`} r="3" fill="#60a5fa" />;
                    })}
                  </>
                );
              })()}
            </svg>
          </div>

          {/* X-axis labels */}
          <div className="flex mt-2 px-1">
            {cumulativeData.map((d, i) => (
              <div key={i} className="flex-1 text-center">
                <span className="text-[9px] text-foreground/50">{d.label}</span>
              </div>
            ))}
          </div>

          {/* Cumulative total callout */}
          <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between">
            <span className="text-xs text-foreground/50">Running total</span>
            <span className="text-sm font-black text-blue-400">
              ${(cumulativeData[cumulativeData.length - 1]?.cumulative ?? 0).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* ── Annual projection ── */}
      {avgWeeklyPremium > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-purple-500" />
            <h3 className="text-sm font-bold text-foreground">Annual Projection</h3>
            <span className="ml-auto text-[10px] text-foreground/40">based on ${avgWeeklyPremium.toFixed(2)}/wk avg</span>
          </div>

          {/* 12-month projection bars */}
          <div className="space-y-2">
            {[3,6,9,12].map(months => {
              const proj = avgWeeklyPremium * months * 4.33;
              const pct = Math.min(100, (proj / (annualProjection * 1.1)) * 100);
              const label = months === 12 ? "12 mo (full year)" : `${months} mo`;
              return (
                <div key={months} className="flex items-center gap-3">
                  <span className="text-[11px] text-foreground/60 w-24 shrink-0">{label}</span>
                  <div className="flex-1 h-5 bg-[var(--surface-2)] rounded-lg overflow-hidden">
                    <div
                      className="h-full bg-purple-500/70 rounded-lg flex items-center px-2 transition-all"
                      style={{ width: `${pct}%` }}
                    >
                      {pct > 20 && <span className="text-[10px] font-bold text-white">${proj.toFixed(0)}</span>}
                    </div>
                  </div>
                  {pct <= 20 && <span className="text-[11px] font-bold text-purple-400">${proj.toFixed(0)}</span>}
                </div>
              );
            })}
          </div>

          {/* Monthly projection note */}
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="bg-[var(--surface-2)] rounded-lg p-2">
              <p className="text-[9px] text-foreground/50 uppercase tracking-wide">Monthly</p>
              <p className="text-sm font-black text-purple-400">${monthlyProjection.toFixed(0)}</p>
            </div>
            <div className="bg-[var(--surface-2)] rounded-lg p-2">
              <p className="text-[9px] text-foreground/50 uppercase tracking-wide">Quarterly</p>
              <p className="text-sm font-black text-purple-400">${(monthlyProjection * 3).toFixed(0)}</p>
            </div>
            <div className="bg-[var(--surface-2)] rounded-lg p-2">
              <p className="text-[9px] text-foreground/50 uppercase tracking-wide">Annual</p>
              <p className="text-sm font-black text-purple-400">${annualProjection.toFixed(0)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Basis reduction by holding ── */}
      {holdingProjections.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown size={14} className="text-green-500" />
            <h3 className="text-sm font-bold text-foreground">Cost Basis Reduction by Holding</h3>
            <span className="ml-auto text-[10px] text-foreground/40">live adj vs original cost</span>
          </div>
          <div className="space-y-3">
            {holdingProjections.map(h => {
              const reduction = h.cost_basis - h.live_adj;
              const reductionPct = h.cost_basis > 0 ? (reduction / h.cost_basis) * 100 : 0;
              return (
                <div key={h.symbol}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{h.symbol}</span>
                      <span className="text-[10px] text-foreground/50">{h.shares} shares</span>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <span className="text-[11px] text-foreground/50">
                        ${h.cost_basis.toFixed(2)} → <span className="text-green-500 font-semibold">${h.live_adj.toFixed(2)}</span>
                      </span>
                      <span className="text-[11px] font-bold text-green-500 w-12 text-right">
                        -{reductionPct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  {/* Stacked bar: reduction (green) over original cost */}
                  <div className="h-4 bg-[var(--surface-2)] rounded-lg overflow-hidden relative">
                    <div
                      className="h-full bg-green-500/25 rounded-lg"
                      style={{ width: "100%" }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 bg-green-500 rounded-lg"
                      style={{ width: `${Math.min(100, reductionPct)}%` }}
                    />
                    {h.weeksToZero && (
                      <span className="absolute right-2 inset-y-0 flex items-center text-[9px] text-foreground/40">
                        ~{h.weeksToZero}w to break even
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] text-foreground/40">${h.premiumSold.toFixed(2)} collected</span>
                    <span className="text-[9px] text-foreground/40">${(h.cost_basis * h.shares).toFixed(2)} total position</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Consistency + Streak + Avg Positions ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Consistency score */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Consistency</p>
          <div>
            <p className="text-3xl font-black" style={{ color: consistencyScore >= 70 ? "#22c55e" : consistencyScore >= 40 ? "#f59e0b" : "#ef4444" }}>
              {consistencyScore.toFixed(0)}<span className="text-lg font-semibold text-foreground/40">/100</span>
            </p>
            <p className="text-xs text-foreground/50 mt-1">
              σ ${weeklyStdDev.toFixed(2)} · avg ${weeklyMean.toFixed(2)}/wk
            </p>
          </div>
          <div className="mt-3 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${consistencyScore}%`,
                background: consistencyScore >= 70 ? "#22c55e" : consistencyScore >= 40 ? "#f59e0b" : "#ef4444"
              }}
            />
          </div>
        </div>

        {/* Win streak */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Current Streak</p>
          <div>
            <p className="text-3xl font-black text-yellow-400">
              {currentStreak}<span className="text-lg font-semibold text-foreground/40"> wks</span>
            </p>
            <p className="text-xs text-foreground/50 mt-1">consecutive profitable weeks</p>
          </div>
          <div className="mt-3 flex gap-1">
            {Array.from({ length: Math.min(8, completeWeeks) }).map((_, i) => {
              const w = [...weeksBreakdown].filter(w => w.is_complete)[i];
              return (
                <div
                  key={i}
                  className="flex-1 h-2 rounded-full"
                  style={{ background: w ? (w.premium > 0 ? "#facc15" : "#ef4444") : "var(--surface-2)" }}
                />
              );
            })}
          </div>
        </div>

        {/* Avg positions per week */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-2">Avg Positions / Week</p>
          <div>
            <p className="text-3xl font-black text-blue-400">{avgPositionsPerWeek.toFixed(1)}</p>
            <p className="text-xs text-foreground/50 mt-1">across {completeWeeks} complete weeks</p>
          </div>
          <p className="mt-3 text-[10px] text-foreground/40">
            ${avgPositionsPerWeek > 0 ? (weeklyMean / avgPositionsPerWeek).toFixed(2) : "0.00"} avg per position deployed
          </p>
        </div>
      </div>

      {/* ── Realized vs In-flight split + Best/Worst month ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* Realized vs in-flight */}
        {totalPremForSplit > 0 && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-3">Realized vs In-Flight</p>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-xl font-black text-blue-500">${realizedPrem.toFixed(0)}</span>
              <span className="text-sm text-foreground/40 mb-0.5">locked in</span>
              <span className="ml-auto text-xl font-black text-orange-400">${inFlightPrem.toFixed(0)}</span>
              <span className="text-sm text-foreground/40 mb-0.5">active</span>
            </div>
            {/* Stacked bar */}
            <div className="h-3 bg-[var(--surface-2)] rounded-full overflow-hidden flex">
              <div className="h-full bg-blue-500 rounded-l-full transition-all" style={{ width: `${realizedPct}%` }} />
              <div className="h-full bg-orange-400 flex-1 rounded-r-full" />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-foreground/40">
              <span>{realizedPct.toFixed(0)}% realized</span>
              <span>{(100 - realizedPct).toFixed(0)}% in-flight</span>
            </div>
          </div>
        )}

        {/* Best & worst month */}
        {(bestMonth || worstMonth) && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-3">Best / Worst Month</p>
            <div className="flex gap-4">
              {bestMonth && (
                <div className="flex-1">
                  <p className="text-[10px] text-green-500 font-semibold uppercase mb-1">Best</p>
                  <p className="text-lg font-black text-green-500">${bestMonth[1].toFixed(0)}</p>
                  <p className="text-xs text-foreground/50">{monthNames[bestMonth[0].split("-")[1]] ?? bestMonth[0]}</p>
                </div>
              )}
              {worstMonth && (
                <div className="flex-1">
                  <p className="text-[10px] text-orange-400 font-semibold uppercase mb-1">Lightest</p>
                  <p className="text-lg font-black text-orange-400">${worstMonth[1].toFixed(0)}</p>
                  <p className="text-xs text-foreground/50">{monthNames[worstMonth[0].split("-")[1]] ?? worstMonth[0]}</p>
                </div>
              )}
              {bestMonth && worstMonth && bestMonth[0] !== worstMonth[0] && (
                <div className="flex-1">
                  <p className="text-[10px] text-foreground/40 font-semibold uppercase mb-1">Range</p>
                  <p className="text-lg font-black text-foreground/60">${(bestMonth[1] - worstMonth[1]).toFixed(0)}</p>
                  <p className="text-xs text-foreground/50">spread</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Best / Worst week ── */}
      {(s.best_week || s.worst_week) && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-3">Best / Weakest Week</p>
          <div className="flex gap-4">
            {s.best_week && s.best_week.premium > 0 && (
              <div className="flex-1">
                <p className="text-[10px] text-green-500 font-semibold uppercase mb-1">Best</p>
                <p className="text-lg font-black text-green-500">${s.best_week.premium.toFixed(0)}</p>
                <p className="text-xs text-foreground/50">{s.best_week.week_end}</p>
                <p className="text-[10px] text-foreground/40">{s.best_week.position_count} positions</p>
              </div>
            )}
            {s.worst_week && s.worst_week.id !== s.best_week?.id && (
              <div className="flex-1">
                <p className="text-[10px] text-orange-400 font-semibold uppercase mb-1">Weakest</p>
                <p className={`text-lg font-black ${s.worst_week.premium >= 0 ? "text-orange-400" : "text-red-500"}`}>
                  {fmt$(s.worst_week.premium)}
                </p>
                <p className="text-xs text-foreground/50">{s.worst_week.week_end}</p>
                <p className="text-[10px] text-foreground/40">{s.worst_week.position_count} positions</p>
              </div>
            )}
            {s.best_week && s.worst_week && s.best_week.premium > 0 && s.worst_week.id !== s.best_week?.id && (
              <div className="flex-1">
                <p className="text-[10px] text-foreground/40 font-semibold uppercase mb-1">Range</p>
                <p className="text-lg font-black text-foreground/60">${(s.best_week.premium - s.worst_week.premium).toFixed(0)}</p>
                <p className="text-xs text-foreground/50">spread</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Monthly chart + Week-by-week side by side ── */}
      {(monthlyEntries.length > 0 || weeksBreakdown.length > 0) && (
        <div className="flex flex-col sm:flex-row gap-4 items-start">

          {/* Monthly bar chart */}
          {monthlyEntries.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 w-full sm:shrink-0 sm:w-auto" style={{ minWidth: 0 }}>
              <div className="flex items-center gap-2 mb-4">
                <Calendar size={14} className="text-green-500" />
                <h3 className="text-sm font-bold text-foreground">Monthly Premium</h3>
              </div>
              {/* tall narrow bar chart */}
              <div className="flex items-end gap-1.5 h-56 overflow-x-auto">
                {monthlyEntries.map(entry => {
                  const ym = entry[0]; const val = entry[1];
                  const [, month] = ym.split("-");
                  const pct = Math.max(3, Math.round((val / maxMonthlyPremium) * 100));
                  const hasData = val > 0;
                  return (
                    <div key={ym} className="flex flex-col items-center gap-1 h-full justify-end" style={{ minWidth: "28px", flex: "1 1 0" }}>
                      <span className="text-[9px] text-foreground/70 font-semibold leading-none mb-0.5 whitespace-nowrap">
                        {hasData ? (val >= 1000 ? "$"+(val/1000).toFixed(1)+"k" : "$"+val.toFixed(0)) : ""}
                      </span>
                      <div
                        className={`w-full rounded-t ${hasData ? "bg-green-500" : "bg-[var(--surface-2)]"}`}
                        style={{ height: `${pct}%` }}
                      />
                      <span className="text-[9px] text-foreground/50 leading-none mt-0.5 whitespace-nowrap">
                        {monthNames[month] ?? month}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Week-by-week table */}
          {weeksBreakdown.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden w-full sm:flex-1 sm:min-w-0">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <h3 className="text-sm font-bold text-foreground">Week-by-Week</h3>
              </div>
              {/* Mobile card list */}
              <div className="sm:hidden divide-y divide-[var(--border)]">
                {weeksBreakdown.map(w => {
                  const vsAvg = avgWeeklyPremium > 0 ? ((w.premium - avgWeeklyPremium) / avgWeeklyPremium) * 100 : null;
                  return (
                    <div key={w.id} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-foreground">{w.week_end}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${w.is_complete ? "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300" : "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300"}`}>
                          {w.is_complete ? "Complete" : "Active"}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm flex-wrap">
                        <span className={`font-semibold ${w.premium >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(w.premium)}</span>
                        {vsAvg !== null && w.is_complete && (
                          <span className={`text-xs font-semibold ${vsAvg >= 0 ? "text-green-500" : "text-red-400"}`}>
                            {vsAvg >= 0 ? "▲" : "▼"} {Math.abs(vsAvg).toFixed(0)}% vs avg
                          </span>
                        )}
                        <span className={`text-xs font-semibold ${w.realized_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>{fmt$(w.realized_pnl)}</span>
                        <span className="text-xs text-foreground/50">{w.position_count} pos</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                      {["Week Ending","Status","Positions","Premium","vs Avg","Realized P/L","Account Value"].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weeksBreakdown.map(w => {
                      const vsAvg = avgWeeklyPremium > 0 ? ((w.premium - avgWeeklyPremium) / avgWeeklyPremium) * 100 : null;
                      return (
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
                          <td className="px-4 py-2.5">
                            {vsAvg !== null && w.is_complete ? (
                              <span className={`text-xs font-semibold ${vsAvg >= 0 ? "text-green-500" : "text-red-400"}`}>
                                {vsAvg >= 0 ? "▲" : "▼"} {Math.abs(vsAvg).toFixed(0)}%
                              </span>
                            ) : <span className="text-foreground/30">—</span>}
                          </td>
                          <td className={`px-4 py-2.5 font-semibold ${w.realized_pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {fmt$(w.realized_pnl)}
                          </td>
                          <td className="px-4 py-2.5 text-foreground/70">
                            {w.account_value != null ? `$${w.account_value.toLocaleString()}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}

      {weeksBreakdown.length === 0 && (
        <EmptyState icon={Calendar} title="No completed weeks yet" body="Mark a week complete to populate your performance summary." />
      )}
    </div>
  );
}



function PremiumTab() {
  const qc = useQueryClient();
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [syncing, setSyncing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["premiumDashboard"],
    queryFn: fetchPremiumDashboard,
    staleTime: 30_000,
  });
  const { data: holdings = [] } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
    staleTime: 60_000,
  });

  const toggleWeek = (weekId: number) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      next.has(weekId) ? next.delete(weekId) : next.add(weekId);
      return next;
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncPremiumLedger();
      await refetch();
      qc.invalidateQueries({ queryKey: ["holdings"] });
    } finally {
      setSyncing(false);
    }
  };

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <SkeletonCard key={i} rows={3} />)}</div>;
  if (!data) return <EmptyState icon={DollarSign} title="No premium data" body="Add holdings and positions to track collected premium." />;

  const { by_symbol, by_week, grand_total } = data;
  const pctRealized = grand_total.total_premium_sold > 0
    ? (grand_total.realized_premium / grand_total.total_premium_sold) * 100
    : 0;

  return (
    <div className="space-y-6">

      {/* ── 3 stat cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Total Collected</p>
          <p className="text-2xl font-black text-green-500">${grand_total.total_premium_sold.toFixed(2)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">gross premium ever sold</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Realized (Locked In)</p>
          <p className="text-2xl font-black text-blue-500">${grand_total.realized_premium.toFixed(2)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">{pctRealized.toFixed(1)}% of total collected</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">In-Flight (Active)</p>
          <p className="text-2xl font-black text-orange-400">${grand_total.unrealized_premium.toFixed(2)}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">locks in when options close/expire</p>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-3 text-[11px] text-foreground/60">
        <span><span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />Realized = closed/expired, permanently reduces cost basis</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-1" />In-Flight = active positions, reduces live adj basis until settled</span>
      </div>

      {/* ── By-symbol table ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold text-foreground">By Symbol</h3>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-blue-500 text-white font-semibold hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {syncing ? "Syncing…" : "Sync Ledger"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                {["Symbol","Avg Cost","Adj Basis","Live Adj","Sold $","Realized $","In-Flight $","# Pos"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-right first:text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {by_symbol.map((row: PremiumSymbolRow) => (
                <tr key={row.holding_id} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                  <td className="px-4 py-3 font-bold text-foreground">{row.symbol}</td>
                  <td className="px-4 py-3 text-right text-foreground/70">${row.cost_basis.toFixed(4)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={row.adj_basis_stored < row.cost_basis ? "text-blue-500 font-semibold" : "text-foreground/70"}>
                      ${row.adj_basis_stored.toFixed(4)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={row.live_adj_basis < row.cost_basis ? "text-green-500 font-semibold" : "text-foreground/70"}>
                      ${row.live_adj_basis.toFixed(4)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-green-500">${row.total_premium_sold.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">
                    {row.realized_premium > 0
                      ? <span className="text-blue-500 font-semibold">${row.realized_premium.toFixed(2)}</span>
                      : <span className="text-foreground/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.unrealized_premium > 0
                      ? <span className="text-orange-400 font-semibold">${row.unrealized_premium.toFixed(2)}</span>
                      : <span className="text-foreground/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground/60">{row.positions}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2)] font-bold">
                <td className="px-4 py-3 text-foreground text-[11px] uppercase tracking-wide">Total</td>
                <td colSpan={3} />
                <td className="px-4 py-3 text-right text-green-500">${grand_total.total_premium_sold.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-blue-500">
                  {grand_total.realized_premium > 0 ? `$${grand_total.realized_premium.toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-3 text-right text-orange-400">
                  {grand_total.unrealized_premium > 0 ? `$${grand_total.unrealized_premium.toFixed(2)}` : "—"}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── By-week breakdown ── */}
      {by_week.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-foreground px-1">By Week</h3>
          {by_week.map((week: PremiumWeekRow) => (
            <div key={week.week_id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-2)] transition-colors"
                onClick={() => toggleWeek(week.week_id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-foreground">Week {week.week_id}</span>
                  <span className="text-xs text-foreground/50">{week.week_label}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold text-green-500">${week.total_premium_sold.toFixed(2)}</span>
                  {week.realized_premium > 0 && (
                    <span className="text-xs text-blue-500 font-semibold">${week.realized_premium.toFixed(2)} realized</span>
                  )}
                  {week.unrealized_premium > 0 && (
                    <span className="text-xs text-orange-400 font-semibold">${week.unrealized_premium.toFixed(2)} in-flight</span>
                  )}
                  {expandedWeeks.has(week.week_id)
                    ? <ChevronUp size={14} className="text-foreground/40" />
                    : <ChevronDown size={14} className="text-foreground/40" />}
                </div>
              </button>

              {expandedWeeks.has(week.week_id) && (
                <div className="border-t border-[var(--border)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] text-foreground/50 uppercase tracking-wide bg-[var(--surface-2)]">
                        {["Symbol","Sold $","Realized $","In-Flight $"].map(h => (
                          <th key={h} className="px-4 py-2 text-right first:text-left font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {week.symbols.map(sym => (
                        <tr key={sym.symbol} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]">
                          <td className="px-4 py-2 font-semibold text-foreground">{sym.symbol}</td>
                          <td className="px-4 py-2 text-right text-green-500 font-semibold">${sym.sold.toFixed(2)}</td>
                          <td className="px-4 py-2 text-right">
                            {sym.realized > 0
                              ? <span className="text-blue-500 font-semibold">${sym.realized.toFixed(2)}</span>
                              : <span className="text-foreground/30">—</span>}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {sym.unrealized > 0
                              ? <span className="text-orange-400 font-semibold">${sym.unrealized.toFixed(2)}</span>
                              : <span className="text-foreground/30">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Premium per share ── */}
      {(() => {
        const rows = by_symbol
          .map(r => {
            const h = holdings.find(h => h.symbol === r.symbol);
            const shares = h?.shares ?? 0;
            return { symbol: r.symbol, shares, sold: r.total_premium_sold, perShare: shares > 0 ? r.total_premium_sold / shares : 0 };
          })
          .filter(r => r.perShare > 0)
          .sort((a, b) => b.perShare - a.perShare);
        const maxPs = Math.max(...rows.map(r => r.perShare), 1);
        if (rows.length === 0) return null;
        return (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 size={14} className="text-blue-500" />
              <h3 className="text-sm font-bold text-foreground">Premium per Share</h3>
              <span className="ml-auto text-[10px] text-foreground/40">how hard each holding is working</span>
            </div>
            <div className="space-y-2.5">
              {rows.map(r => {
                const barPct = Math.max(4, (r.perShare / maxPs) * 100);
                return (
                  <div key={r.symbol} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-foreground w-12 shrink-0">{r.symbol}</span>
                    <div className="flex-1 h-5 bg-[var(--surface-2)] rounded-lg overflow-hidden">
                      <div
                        className="h-full bg-blue-500/70 rounded-lg flex items-center px-2 transition-all"
                        style={{ width: `${barPct}%` }}
                      >
                        {barPct > 25 && <span className="text-[10px] font-bold text-white">${r.perShare.toFixed(2)}/sh</span>}
                      </div>
                    </div>
                    {barPct <= 25 && <span className="text-[10px] font-semibold text-blue-400 shrink-0">${r.perShare.toFixed(2)}/sh</span>}
                    <span className="text-[10px] text-foreground/40 w-16 text-right shrink-0">{r.shares} shares</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Notation key ── */}
      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 text-[11px] text-foreground/60 space-y-2">
        <p className="text-[11px] font-bold text-foreground/80 uppercase tracking-wide mb-2">Notation</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
          <div><span className="font-semibold text-foreground/80">Avg Cost</span> — original purchase price per share (never changes)</div>
          <div><span className="font-semibold text-foreground/80">Adj Basis</span> — cost basis permanently reduced by <span className="text-blue-400">realized</span> premium only (locked-in closes/expiries)</div>
          <div><span className="font-semibold text-foreground/80">Live Adj</span> — true current breakeven = Adj Basis − in-flight premium/share (updates as options move)</div>
          <div><span className="font-semibold text-foreground/80">BE (Breakeven)</span> — same as Live Adj; the price below which you start losing money today</div>
          <div><span className="font-semibold text-foreground/80">CC (Covered Call)</span> — sell a call against shares you own; premium collected reduces basis, shares called away if assigned above strike</div>
          <div><span className="font-semibold text-foreground/80">CSP (Cash-Secured Put)</span> — sell a put holding cash; if assigned, shares are put to you at the strike price</div>
          <div><span className="font-semibold text-blue-400">Realized $</span> — premium permanently locked in from <span className="font-semibold">closed or expired</span> positions; permanently lowers Adj Basis</div>
          <div><span className="font-semibold text-orange-400">In-Flight $</span> — premium from <span className="font-semibold">still-active</span> positions; lowers Live Adj only until the option closes/expires</div>
          <div><span className="font-semibold text-foreground/80"># Pos</span> — number of original option positions logged against this holding (carry-forwards not counted)</div>
          <div><span className="font-semibold text-foreground/80">Sold $</span> — gross premium ever collected (realized + in-flight combined)</div>
        </div>
      </div>

    </div>
  );
}

// ── Account Value Tab ───────────────────────────────────────────────────────

function AccountTab() {
  const qc = useQueryClient();
  const { data: s, isLoading } = useQuery({
    queryKey: ["portfolioSummary"],
    queryFn: fetchPortfolioSummary,
    staleTime: 60_000,
  });
  const [editing, setEditing] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");

  const updateMut = useMutation({
    mutationFn: ({ id, value }: { id: number; value: number }) =>
      updateWeek(id, { account_value: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolioSummary"] });
      qc.invalidateQueries({ queryKey: ["weeks"] });
      setEditing(null);
    },
  });

  if (isLoading) return <div className="space-y-3">{[1,2,3].map(i => <SkeletonCard key={i} rows={2} />)}</div>;
  if (!s) return <EmptyState icon={Activity} title="No data" body="Complete a week to start tracking." />;

  const rows = [...(s.weeks_breakdown ?? [])].reverse(); // chronological
  const withValue = rows.filter(r => r.account_value != null);
  const maxVal = Math.max(...withValue.map(r => r.account_value!), 1);
  const minVal = Math.min(...withValue.map(r => r.account_value!), maxVal);
  const range = maxVal - minVal || 1;

  // week-over-week change series
  const changes = withValue.map((r, i) => {
    const prev = i > 0 ? withValue[i - 1].account_value! : null;
    const chg = prev != null ? r.account_value! - prev : null;
    return { ...r, chg };
  });

  const latest = changes[changes.length - 1];
  const totalGrowth = changes.length >= 2
    ? changes[changes.length - 1].account_value! - changes[0].account_value!
    : null;
  const totalGrowthPct = changes.length >= 2 && changes[0].account_value!
    ? (totalGrowth! / changes[0].account_value!) * 100
    : null;

  return (
    <div className="space-y-6">

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Latest Value</p>
          <p className="text-xl font-black text-green-500">
            {latest ? `$${latest.account_value!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          </p>
          <p className="text-[10px] text-foreground/50 mt-0.5">{latest?.week_end ?? ""}</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Last Week Δ</p>
          <p className={`text-xl font-black ${latest?.chg == null ? "text-foreground/40" : latest.chg >= 0 ? "text-green-500" : "text-red-500"}`}>
            {latest?.chg != null ? `${latest.chg >= 0 ? "+" : ""}$${latest.chg.toFixed(0)}` : "—"}
          </p>
          <p className="text-[10px] text-foreground/50 mt-0.5">vs prior Friday</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Total Growth</p>
          <p className={`text-xl font-black ${totalGrowth == null ? "text-foreground/40" : totalGrowth >= 0 ? "text-blue-500" : "text-red-500"}`}>
            {totalGrowth != null ? `${totalGrowth >= 0 ? "+" : ""}$${totalGrowth.toFixed(0)}` : "—"}
          </p>
          <p className="text-[10px] text-foreground/50 mt-0.5">
            {totalGrowthPct != null ? `${totalGrowthPct >= 0 ? "+" : ""}${totalGrowthPct.toFixed(1)}%` : "since first entry"}
          </p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wide mb-1">Weeks Logged</p>
          <p className="text-xl font-black text-purple-400">{withValue.length}</p>
          <p className="text-[10px] text-foreground/50 mt-0.5">of {rows.length} total weeks</p>
        </div>
      </div>

      {/* ── Line chart ── */}
      {withValue.length >= 2 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-green-500" />
            <h3 className="text-sm font-bold text-foreground">Account Value Over Time</h3>
          </div>
          <div className="relative h-48">
            {/* Area + line SVG */}
            <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
              {(() => {
                const n = withValue.length;
                const pts = withValue.map((r, i) => {
                  const x = n === 1 ? 50 : (i / (n - 1)) * 100;
                  const y = 100 - ((r.account_value! - minVal) / range) * 80 - 10;
                  return { x, y, r };
                });
                const linePts = pts.map(p => `${p.x},${p.y}`).join(" ");
                const areaPath = `M${pts[0].x},${pts[0].y} L${linePts.split(" ").slice(1).join(" L")} L${pts[n-1].x},100 L${pts[0].x},100 Z`;
                return (
                  <>
                    <defs>
                      <linearGradient id="acctGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={areaPath} fill="url(#acctGrad)" />
                    <polyline points={linePts} fill="none" stroke="#22c55e" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    {pts.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r="1.5" fill="#22c55e" vectorEffect="non-scaling-stroke" />
                    ))}
                  </>
                );
              })()}
            </svg>
            {/* Y-axis labels */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              <span className="text-[9px] text-foreground/40">${maxVal.toLocaleString(undefined, {maximumFractionDigits:0})}</span>
              <span className="text-[9px] text-foreground/40">${minVal.toLocaleString(undefined, {maximumFractionDigits:0})}</span>
            </div>
          </div>
          {/* X-axis */}
          <div className="flex justify-between mt-2">
            {withValue.length <= 8
              ? withValue.map(r => (
                  <span key={r.id} className="text-[9px] text-foreground/40">
                    {new Date(r.week_end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                ))
              : [withValue[0], withValue[Math.floor(withValue.length / 2)], withValue[withValue.length - 1]].map(r => (
                  <span key={r.id} className="text-[9px] text-foreground/40">
                    {new Date(r.week_end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                ))
            }
          </div>
        </div>
      )}

      {/* ── Week-over-week delta bars ── */}
      {changes.length >= 2 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-blue-400" />
            <h3 className="text-sm font-bold text-foreground">Week-over-Week Change</h3>
          </div>
          <div className="flex items-end gap-1 h-24">
            {changes.map((r, i) => {
              if (r.chg == null) return <div key={i} className="flex-1" />;
              const maxChg = Math.max(...changes.filter(c => c.chg != null).map(c => Math.abs(c.chg!)), 1);
              const pct = Math.max(4, Math.round((Math.abs(r.chg) / maxChg) * 100));
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-0.5">
                  {r.chg >= 0 ? (
                    <>
                      <span className="text-[8px] text-green-500 font-semibold whitespace-nowrap">+{r.chg.toFixed(0)}</span>
                      <div className="w-full rounded-t bg-green-500" style={{ height: `${pct}%` }} />
                    </>
                  ) : (
                    <>
                      <span className="text-[8px] text-red-400 font-semibold whitespace-nowrap">{r.chg.toFixed(0)}</span>
                      <div className="w-full rounded-t bg-red-400" style={{ height: `${pct}%` }} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1">
            {changes.length <= 8
              ? changes.map(r => (
                  <span key={r.id} className="flex-1 text-center text-[8px] text-foreground/40">
                    {new Date(r.week_end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                ))
              : <span className="text-[9px] text-foreground/40">{changes.length} weeks</span>
            }
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Friday Account Values</h3>
          <p className="text-[10px] text-foreground/40 hidden sm:block">Click a value to edit</p>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-[var(--border)]">
          {rows.map(r => {
            const idx = changes.findIndex(c => c.id === r.id);
            const chg = idx >= 0 ? changes[idx].chg : null;
            const isEdit = editing === r.id;
            return (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground/80">
                    {new Date(r.week_end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    r.is_complete ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                  }`}>
                    {r.is_complete ? "Complete" : "Active"}
                  </span>
                </div>
                {isEdit ? (
                  <form
                    className="flex items-center gap-2 mb-1"
                    onSubmit={e => {
                      e.preventDefault();
                      const v = parseFloat(editVal);
                      if (!isNaN(v)) updateMut.mutate({ id: r.id, value: v });
                    }}
                  >
                    <input
                      autoFocus type="number" step="0.01" value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      className="w-32 border border-blue-500 rounded-lg px-2 py-1 text-sm bg-[var(--surface)] text-foreground focus:outline-none"
                    />
                    <button type="submit" className="text-[11px] px-2 py-1 bg-blue-500 text-white rounded-lg font-semibold">
                      {updateMut.isPending ? "…" : "Save"}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="text-[11px] px-2 py-1 bg-[var(--surface-2)] text-foreground/60 rounded-lg">✕</button>
                  </form>
                ) : (
                  <button
                    onClick={() => { setEditing(r.id); setEditVal(r.account_value?.toFixed(2) ?? ""); }}
                    className="text-lg font-bold text-green-500 hover:underline block mb-1"
                  >
                    {r.account_value != null ? `$${r.account_value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : <span className="text-foreground/30 font-normal text-sm">tap to add value</span>}
                  </button>
                )}
                <div className="flex items-center gap-4 text-xs">
                  {chg != null && (
                    <span className={`font-semibold ${chg >= 0 ? "text-green-500" : "text-red-400"}`}>
                      Δ {chg >= 0 ? "+" : ""}{chg.toFixed(0)}
                    </span>
                  )}
                  {r.premium > 0 && <span className="text-green-500">Prem ${r.premium.toFixed(2)}</span>}
                  <span className={r.realized_pnl >= 0 ? "text-green-500" : "text-red-400"}>{fmt$(r.realized_pnl)}</span>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="text-center text-foreground/40 py-10 text-sm">No weeks yet.</p>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                {["Week Ending (Friday)", "Account Value", "Δ vs Prior", "Premium", "Realized P/L", "Status"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map(r => {
                const idx = changes.findIndex(c => c.id === r.id);
                const chg = idx >= 0 ? changes[idx].chg : null;
                const isEdit = editing === r.id;
                return (
                  <tr key={r.id} className="hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-3 text-foreground/80 font-medium whitespace-nowrap">
                      {new Date(r.week_end + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      {isEdit ? (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={e => {
                            e.preventDefault();
                            const v = parseFloat(editVal);
                            if (!isNaN(v)) updateMut.mutate({ id: r.id, value: v });
                          }}
                        >
                          <input
                            autoFocus
                            type="number"
                            step="0.01"
                            value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            className="w-32 border border-blue-500 rounded-lg px-2 py-1 text-sm bg-[var(--surface)] text-foreground focus:outline-none"
                          />
                          <button type="submit" className="text-[11px] px-2 py-1 bg-blue-500 text-white rounded-lg font-semibold">
                            {updateMut.isPending ? "…" : "Save"}
                          </button>
                          <button type="button" onClick={() => setEditing(null)} className="text-[11px] px-2 py-1 bg-[var(--surface-2)] text-foreground/60 rounded-lg">
                            ✕
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={() => { setEditing(r.id); setEditVal(r.account_value?.toFixed(2) ?? ""); }}
                          className="font-semibold text-green-500 hover:underline"
                        >
                          {r.account_value != null ? `$${r.account_value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : <span className="text-foreground/30 font-normal">— tap to add</span>}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {chg != null ? (
                        <span className={`font-semibold ${chg >= 0 ? "text-green-500" : "text-red-400"}`}>
                          {chg >= 0 ? "+" : ""}{chg.toFixed(0)}
                        </span>
                      ) : <span className="text-foreground/30">—</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground/80">
                      {r.premium > 0 ? <span className="text-green-500 font-medium">${r.premium.toFixed(2)}</span> : <span className="text-foreground/30">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={r.realized_pnl >= 0 ? "text-green-500" : "text-red-400"}>
                        {fmt$(r.realized_pnl)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        r.is_complete ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                      }`}>
                        {r.is_complete ? "Complete" : "Active"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="text-center text-foreground/40 py-10 text-sm">No weeks yet.</p>
          )}
        </div>
      </div>

    </div>
  );
}

// ── Holdings Tab ─────────────────────────────────────────────────────────────

function HoldingRow({ h, onEdit, onDelete }: { h: StockHolding; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const liveAdj          = h.live_adj_basis         ?? h.adjusted_cost_basis;
  const storedAdj        = h.adjusted_cost_basis;
  const downsideBasis    = h.downside_basis          ?? liveAdj;
  const upsideBasis      = h.upside_basis            ?? null;
  const realizedPrem     = h.realized_premium        ?? 0;
  const unrealizedPrem   = h.unrealized_premium      ?? 0;
  const totalPremSold    = h.total_premium_sold      ?? 0;
  const basisReduction   = h.basis_reduction         ?? 0;

  const realizedPerShare   = h.shares > 0 ? realizedPrem   / h.shares : 0;
  const unrealizedPerShare = h.shares > 0 ? unrealizedPrem / h.shares : 0;

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["holdingEvents", h.id],
    queryFn: () => fetchHoldingEvents(h.id),
    enabled: expanded,
    staleTime: 30_000,
  });

  const expandedHistory = expanded && (
    <div className="px-3 pb-3 pt-2 bg-[var(--surface-2)]/40">
      {totalPremSold > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-2 px-3 py-2 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 text-xs">
          <span className="font-semibold text-foreground/70">Premium for {h.symbol}:</span>
          <span className="text-foreground/60">Total: <span className="font-bold text-foreground">${totalPremSold.toFixed(2)}</span></span>
          <span className="text-green-600 dark:text-green-400">Realized: <span className="font-bold">${realizedPrem.toFixed(2)}</span></span>
          <span className="text-amber-600 dark:text-amber-400">In-flight: <span className="font-bold">${unrealizedPrem.toFixed(2)}</span></span>
        </div>
      )}
      {eventsLoading ? (
        <p className="text-xs text-foreground/50">Loading history…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-foreground/50">No events yet.</p>
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
    </div>
  );

  return (
    <>
      {/* ── Mobile card (< sm) ── */}
      <div className="sm:hidden border-b border-[var(--border)]">
        <div className="px-3 py-3">
          {/* Row 1: Symbol + status badge + actions */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-foreground text-base">{h.symbol}</span>
                {h.status === "CLOSED" && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 font-semibold">CLOSED</span>
                )}
              </div>
              {h.company_name && <div className="text-[10px] text-foreground/50">{h.company_name}</div>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setExpanded(v => !v)}
                className="text-[10px] px-2 py-1 rounded-lg bg-[var(--surface-2)] text-foreground/70 font-semibold flex items-center gap-1"
              >
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
              <button onClick={onEdit} className="text-[10px] px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-500 font-semibold">Edit</button>
              <button
                onClick={() => { if (window.confirm(`Delete ${h.symbol} holding (${h.shares} shares)?`)) onDelete(); }}
                className="text-[10px] px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold"
              >Del</button>
            </div>
          </div>

          {/* Row 2: Shares + Avg Cost */}
          <div className="flex items-center gap-4 mb-1.5 text-sm">
            <div>
              <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Shares</span>
              <span className="font-semibold text-foreground">{h.shares.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Avg Cost</span>
              <span className="text-foreground/70">${h.cost_basis.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-[10px] text-foreground/40 uppercase tracking-wide block">Live Adj</span>
              <span className="font-bold text-blue-500">${liveAdj.toFixed(2)}</span>
            </div>
          </div>

          {/* Row 3: Premium badges */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            {realizedPrem > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-semibold">
                ✓ -${realizedPerShare.toFixed(2)}/sh realized
              </span>
            )}
            {unrealizedPrem > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-semibold">
                ⏳ -${unrealizedPerShare.toFixed(2)}/sh in-flight
              </span>
            )}
            {basisReduction > 0 && (
              <span className="text-[9px] text-green-500 font-semibold">↓ ${basisReduction.toFixed(2)} saved</span>
            )}
          </div>

          {/* Row 4: BE prices + live P&L */}
          <div className="flex items-center gap-4 text-[11px]">
            <span className="text-foreground/50">▼ BE: <span className="text-red-400 font-semibold">${downsideBasis.toFixed(2)}</span></span>
            {upsideBasis != null && <span className="text-foreground/50">▲ CC: <span className="text-green-500 font-semibold">${upsideBasis.toFixed(2)}</span></span>}
            <HoldingLivePriceMobile symbol={h.symbol} liveAdjBasis={liveAdj} shares={h.shares} />
          </div>
        </div>
        {expanded && expandedHistory}
      </div>

      {/* ── Desktop table row (≥ sm) ── */}
      <tr className="hidden sm:table-row border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
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
        {/* Adj basis — full breakdown */}
        <td className="px-3 py-2.5 text-sm">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-blue-500">${liveAdj.toFixed(2)}</span>
            <span className="text-[9px] text-foreground/40 font-normal">live</span>
            {storedAdj !== liveAdj && (
              <span className="text-[9px] text-foreground/40" title="Stored adj basis (unrealized premium not yet locked in)">(stored: ${storedAdj.toFixed(2)})</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {realizedPrem > 0 && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-semibold"
                title={`Realized premium locked in — reduces stored adj basis. Per share: -$${realizedPerShare.toFixed(4)}`}
              >
                ✓ -${realizedPerShare.toFixed(2)}/sh realized
              </span>
            )}
            {unrealizedPrem > 0 && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-semibold"
                title={`Unrealized premium in-flight (active options). Will lock in when position closes. Per share: -$${unrealizedPerShare.toFixed(4)}`}
              >
                ⏳ -${unrealizedPerShare.toFixed(2)}/sh in-flight
              </span>
            )}
          </div>
          {basisReduction > 0 && (
            <div className="text-[9px] text-green-500 font-semibold mt-0.5">↓ ${basisReduction.toFixed(2)} total saved</div>
          )}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[9px] text-foreground/50" title="Breakeven if stock goes to zero">▼ BE: <span className="text-red-400 font-semibold">${downsideBasis.toFixed(2)}</span></span>
            {upsideBasis != null && (
              <span className="text-[9px] text-foreground/50" title="Lowest active covered call strike — shares get called away here">▲ CC: <span className="text-green-500 font-semibold">${upsideBasis.toFixed(2)}</span></span>
            )}
          </div>
        </td>
        {/* Live price + unrealized P&L */}
        <HoldingLivePrice symbol={h.symbol} liveAdjBasis={liveAdj} shares={h.shares} />
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
        <tr className="hidden sm:table-row border-b border-[var(--border)] bg-[var(--surface-2)]/40">
          <td colSpan={6} className="px-4 pb-3 pt-2">
            {totalPremSold > 0 && (
              <div className="flex items-center gap-4 mb-2 px-3 py-2 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 text-xs">
                <span className="font-semibold text-foreground/70">Premium history for {h.symbol}:</span>
                <span className="text-foreground/60">Total sold: <span className="font-bold text-foreground">${totalPremSold.toFixed(2)}</span></span>
                <span className="text-green-600 dark:text-green-400">Realized: <span className="font-bold">${realizedPrem.toFixed(2)}</span></span>
                <span className="text-amber-600 dark:text-amber-400">In-flight: <span className="font-bold">${unrealizedPrem.toFixed(2)}</span></span>
              </div>
            )}
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

// Inline live price for mobile card (no table cell wrapper)
function HoldingLivePriceMobile({ symbol, liveAdjBasis, shares }: { symbol: string; liveAdjBasis: number; shares: number }) {
  const { data } = useQuery({
    queryKey: ["stockHistory", symbol, "1d"],
    queryFn: () => fetchStockHistory(symbol, "1d", "5m"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const price = data?.current_price;
  if (price == null) return null;
  const unrealized = (price - liveAdjBasis) * shares;
  return (
    <span className={`font-semibold ${unrealized >= 0 ? "text-green-500" : "text-red-500"}`}>
      ${price.toFixed(2)} · {unrealized >= 0 ? "+" : ""}${unrealized.toFixed(0)}
    </span>
  );
}

interface HoldingFormState {
  symbol: string; company_name: string; shares: string; cost_basis: string; acquired_date: string; notes: string;
}

function HoldingLivePrice({ symbol, liveAdjBasis, shares }: { symbol: string; liveAdjBasis: number; shares: number }) {
  const { data } = useQuery({
    queryKey: ["stockHistory", symbol, "1d"],
    queryFn: () => fetchStockHistory(symbol, "1d", "5m"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const price = data?.current_price;
  if (price == null) return <td className="px-3 py-2.5 text-foreground/40 text-xs">—</td>;
  const unrealized = (price - liveAdjBasis) * shares;
  return (
    <td className="px-3 py-2.5 text-sm">
      <div className="font-semibold text-foreground">${price.toFixed(2)}</div>
      <div className={`text-[10px] font-bold ${unrealized >= 0 ? "text-green-500" : "text-red-500"}`}>
        {unrealized >= 0 ? "+" : ""}${unrealized.toFixed(0)}
        <span className="ml-1 font-normal text-foreground/40">
          ({((price - liveAdjBasis) / liveAdjBasis * 100).toFixed(1)}%)
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

  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);
  const recalcMut = useMutation({
    mutationFn: recalculateHoldings,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["holdings"] });
      setRecalcMsg(
        res.updated > 0
          ? `✓ Recalculated ${res.updated} holding${res.updated > 1 ? "s" : ""} — adj basis now matches cost basis.`
          : `✓ All adj bases already correct.`
      );
      setTimeout(() => setRecalcMsg(null), 5000);
    },
  });

  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const syncMut = useMutation({
    mutationFn: syncPremiumLedger,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["holdings"] });
      setSyncMsg(`✓ Synced ${res.synced_rows} premium rows, updated ${res.updated_holdings} holding${res.updated_holdings !== 1 ? "s" : ""}.`);
      setTimeout(() => setSyncMsg(null), 5000);
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

      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search symbol or company…" className={`${inp} pl-8`} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
            title="Sync premium ledger from all linked positions — rebuilds realized/unrealized premium and re-derives adj basis"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-foreground/70 text-xs font-semibold hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <DollarSign size={12} /> <span className="hidden sm:inline">{syncMut.isPending ? "Syncing…" : "Sync Ledger"}</span><span className="sm:hidden">Sync</span>
          </button>
          <button
            onClick={() => seedMut.mutate()}
            disabled={seedMut.isPending}
            title="Create holdings from existing positions using strike as avg cost"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-foreground/70 text-xs font-semibold hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <TrendingUp size={12} /> <span className="hidden sm:inline">{seedMut.isPending ? "Importing…" : "Import from Positions"}</span><span className="sm:hidden">Import</span>
          </button>
          <button
            onClick={() => { setEditing(null); resetForm(); setShowForm(v => !v); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {seedMsg && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 text-xs font-semibold">
          {seedMsg}
        </div>
      )}
      {recalcMsg && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400 text-xs font-semibold">
          {recalcMsg}
        </div>
      )}
      {syncMsg && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-600 dark:text-purple-400 text-xs font-semibold">
          {syncMsg}
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
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-[var(--border)]">
            {filtered.map(h => (
              <HoldingRow
                key={h.id}
                h={h}
                onEdit={() => startEdit(h)}
                onDelete={() => deleteMut.mutate(h.id)}
              />
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
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
      <div className="relative flex-1 sm:flex-none">
        <select
          value={selectedId ?? ""}
          onChange={(e) => onSelect(Number(e.target.value))}
          className="appearance-none border border-[var(--border)] rounded-xl px-3 py-2 pr-8 text-sm bg-[var(--surface)] text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold w-full sm:min-w-[220px]"
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
        className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-foreground hover:bg-[var(--surface-2)] transition"
      >
        <Plus size={12} /> <span className="hidden xs:inline">New Week</span><span className="xs:hidden">New</span>
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
  const [tab, setTab] = useState<"account" | "holdings" | "positions" | "symbols" | "premium" | "year">("account");
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
        title="Portfolio"
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
            onChange={(k) => setTab(k as "account" | "holdings" | "positions" | "symbols" | "premium" | "year")}
            tabs={[
              { key: "account",   label: "Account"     },
              { key: "holdings",  label: "Holdings"    },
              { key: "positions", label: "Positions"   },
              { key: "symbols",   label: "Activity"    },
              { key: "premium",   label: "Premium"     },
              { key: "year",      label: "Performance" },
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

      {tab === "symbols"  && <SymbolsTab />}
      {tab === "year"     && <YearTab />}
      {tab === "premium"  && <PremiumTab />}
      {tab === "account"  && <AccountTab />}
    </div>
  );
}
