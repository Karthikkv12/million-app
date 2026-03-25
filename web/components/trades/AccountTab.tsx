"use client";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPortfolioSummary,
  fetchBrokerAccounts,
  fetchAccountBalances,
  fetchAccountBalanceYears,
  upsertAccountBalance,
  deleteAccountBalance,
  createBrokerAccount,
  updateBrokerAccount,
  getOrCreateWeek,
  BrokerAccount,
} from "@/lib/api";
import { EmptyState, SkeletonCard } from "@/components/ui";
import { TrendingUp, Activity, Plus, X, ChevronDown } from "lucide-react";

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, ReferenceLine,
} from "recharts";

/** All Fridays in a given year up to (and including) a cutoff date */
function fridaysInYear(year: number, cutoff?: string): string[] {
  const result: string[] = [];
  const d = new Date(year, 0, 1);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  while (d.getFullYear() === year) {
    const iso = d.toISOString().slice(0, 10);
    if (cutoff && iso > cutoff) break;
    result.push(iso);
    d.setDate(d.getDate() + 7);
  }
  return result;
}

/** The next Friday on or after the given date (defaults to today) */
function nextFriday(from?: Date): string {
  const d = from ? new Date(from) : new Date();
  d.setHours(0, 0, 0, 0);
  const diff = (5 - d.getDay() + 7) % 7; // 0 if already Friday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

const HIDDEN_ACCOUNTS_KEY  = "optionflow_hidden_accounts";
const AREA_RANGE_KEY       = "optionflow_acct_area_range";
const WOW_RANGE_KEY        = "optionflow_acct_wow_range";

type ChartRange = "1M" | "3M" | "1Y" | "5Y" | "MAX";
const RANGE_LABELS: ChartRange[] = ["1M", "3M", "1Y", "5Y", "MAX"];

export function AccountTab() {
  const qc = useQueryClient();
  const { data: s, isLoading: summaryLoading } = useQuery({
    queryKey: ["portfolioSummary"],
    queryFn: fetchPortfolioSummary,
    staleTime: 60_000,
  });
  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["brokerAccounts"],
    queryFn: fetchBrokerAccounts,
    staleTime: 60_000,
  });

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const { data: availableYearsList = [currentYear] } = useQuery({
    queryKey: ["accountBalanceYears"],
    queryFn: fetchAccountBalanceYears,
    staleTime: 60_000,
  });

  const { data: balances = [], isLoading: balancesLoading } = useQuery({
    queryKey: ["accountBalances", selectedYear],
    queryFn: () => fetchAccountBalances(selectedYear),
    staleTime: 30_000,
  });

  // Per-account visibility (persisted in localStorage). Stored as a Set of account IDs that are hidden.
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem(HIDDEN_ACCOUNTS_KEY);
      return stored ? new Set(JSON.parse(stored) as number[]) : new Set();
    } catch { return new Set(); }
  });

  function toggleHidden(id: number) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(HIDDEN_ACCOUNTS_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  // Inline cell editing state
  const [editCell, setEditCell] = useState<{ accountId: number; weekDate: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // New account form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAcctName, setNewAcctName] = useState("");
  const [showAccountsPanel, setShowAccountsPanel] = useState(false);

  // Chart time-range selectors (independent, persisted)
  const VALID_RANGES: ChartRange[] = ["1M", "3M", "1Y", "5Y", "MAX"];
  const [areaRange, setAreaRange] = useState<ChartRange>(() => {
    if (typeof window === "undefined") return "MAX";
    const v = localStorage.getItem(AREA_RANGE_KEY);
    return (v && VALID_RANGES.includes(v as ChartRange) ? v as ChartRange : "MAX");
  });
  const [wowRange, setWowRange] = useState<ChartRange>(() => {
    if (typeof window === "undefined") return "MAX";
    const v = localStorage.getItem(WOW_RANGE_KEY);
    return (v && VALID_RANGES.includes(v as ChartRange) ? v as ChartRange : "MAX");
  });

  // Auto-create the upcoming Friday's week on mount
  const ensureWeekMut = useMutation({
    mutationFn: () => getOrCreateWeek(nextFriday()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolioSummary"] }),
  });
  useEffect(() => { ensureWeekMut.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const upsertMut = useMutation({
    mutationFn: upsertAccountBalance,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accountBalances", selectedYear] });
      qc.invalidateQueries({ queryKey: ["portfolioSummary"] });
      setEditCell(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: ({ account_id, week_date }: { account_id: number; week_date: string }) =>
      deleteAccountBalance(account_id, week_date),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accountBalances", selectedYear] });
      qc.invalidateQueries({ queryKey: ["portfolioSummary"] });
    },
  });

  const createAcctMut = useMutation({
    mutationFn: createBrokerAccount,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brokerAccounts"] });
      setShowAddForm(false);
      setNewAcctName("");
    },
  });

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      updateBrokerAccount(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brokerAccounts"] }),
  });

  function startEdit(accountId: number, weekDate: string) {
    const existing = balances.find((b) => b.account_id === accountId && b.week_date === weekDate);
    setEditVal(existing ? String(existing.balance) : "");
    setEditCell({ accountId, weekDate });
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  function commitEdit() {
    if (!editCell) return;
    const v = parseFloat(editVal);
    if (isNaN(v) || editVal.trim() === "") {
      // Empty → delete the balance
      const existing = balances.find(
        (b) => b.account_id === editCell.accountId && b.week_date === editCell.weekDate
      );
      if (existing) deleteMut.mutate({ account_id: editCell.accountId, week_date: editCell.weekDate });
      setEditCell(null);
    } else {
      upsertMut.mutate({ account_id: editCell.accountId, week_date: editCell.weekDate, balance: v });
    }
  }

  const isLoading = summaryLoading || accountsLoading;
  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonCard key={i} rows={2} />)}</div>;
  if (!s) return <EmptyState icon={Activity} title="No data" body="Complete a week to start tracking." />;

  // ── Charts data ───────────────────────────────────────────────────────────
  const rows = [...(s.weeks_breakdown ?? [])];
  const chronoRows = [...(s.weeks_breakdown ?? [])].reverse();
  const withValue = chronoRows.filter((r) => r.account_value != null);

  const changes = withValue.map((r, i) => {
    const prev = i > 0 ? withValue[i - 1].account_value! : null;
    const chg  = prev != null ? r.account_value! - prev : null;
    return { ...r, chg };
  });

  const latest         = changes[changes.length - 1];
  const totalGrowth    = changes.length >= 2 ? changes[changes.length - 1].account_value! - changes[0].account_value! : null;
  const totalGrowthPct = changes.length >= 2 && changes[0].account_value!
    ? (totalGrowth! / changes[0].account_value!) * 100 : null;

  // ── Broker accounts table data ────────────────────────────────────────────
  // All accounts (active + inactive) shown in legend so user can toggle visibility
  const allAccounts = [...accounts].sort((a, b) => a.sort_order - b.sort_order);
  // Columns shown in table = active accounts that are not locally hidden
  const visibleAccounts = allAccounts.filter((a) => a.is_active && !hiddenIds.has(a.id));

  // Build a lookup: weekDate → accountId → balance
  const balMap = new Map<string, Map<number, number>>();
  for (const b of balances) {
    if (!balMap.has(b.week_date)) balMap.set(b.week_date, new Map());
    balMap.get(b.week_date)!.set(b.account_id, b.balance);
  }

  // Show Fridays up through the next upcoming Friday for the current year,
  // or all Fridays for past years.
  const cutoffFriday = selectedYear === currentYear ? nextFriday() : undefined;
  const allFridaysThisYear = fridaysInYear(selectedYear, cutoffFriday);

  // ── Charts: all-time running data (not scoped to selectedYear) ───────────
  // withValue is already sorted chronologically from weeks_breakdown
  const valueMap = new Map<string, number>();
  for (const r of withValue) valueMap.set(r.week_end, r.account_value!);

  // Build a contiguous scaffold from max(first data point, 5Y ago) to today
  // so range buttons always have enough weeks to show even when data is sparse
  const today = new Date();
  const allChartFridays: string[] = [];
  if (withValue.length > 0) {
    const fiveYearsAgo = new Date(today); fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const dataStart = new Date(withValue[0].week_end + "T00:00:00");
    // Snap dataStart back to Friday
    while (dataStart.getDay() !== 5) dataStart.setDate(dataStart.getDate() - 1);
    // Use whichever is earlier: dataStart or 5Y ago (snapped to Friday)
    while (fiveYearsAgo.getDay() !== 5) fiveYearsAgo.setDate(fiveYearsAgo.getDate() - 1);
    const start = dataStart < fiveYearsAgo ? dataStart : fiveYearsAgo;
    const cur = new Date(start);
    while (cur <= today) {
      allChartFridays.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 7);
    }
  }

  // ── Range cutoff ─────────────────────────────────────────────────────────
  function rangeCutoff(range: string): string | null {
    const d = new Date(today);
    if (range === "MAX") return null;
    if (range === "1M")  { d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); }
    if (range === "3M")  { d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); }
    if (range === "1Y")  { d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); }
    if (range === "5Y")  { d.setFullYear(d.getFullYear() - 5); return d.toISOString().slice(0, 10); }
    return null;
  }
  const areaCutoff   = rangeCutoff(areaRange);
  const wowCutoff    = rangeCutoff(wowRange);
  const areaFridays  = areaCutoff ? allChartFridays.filter((iso) => iso >= areaCutoff!) : allChartFridays;
  const wowFridays   = wowCutoff  ? allChartFridays.filter((iso) => iso >= wowCutoff!)  : allChartFridays;

  const MONTH_LETTER = ["J","F","M","A","M","J","J","A","S","O","N","D"];
  const QUARTER_MONTHS = new Set([0, 3, 6, 9]);

  // Tick label strategy — range-aware
  function makeTick(iso: string, prevIso: string | undefined, totalVisible: number, range: ChartRange): string {
    const d = new Date(iso + "T00:00:00");
    const mo = d.getMonth();
    const yr2 = `'${String(d.getFullYear()).slice(2)}`; // "'26"
    const yearChanged  = !prevIso || prevIso.slice(0, 4) !== iso.slice(0, 4);
    const monthChanged = !prevIso || prevIso.slice(5, 7) !== iso.slice(5, 7);

    if (range === "MAX") {
      // Quarterly data points, label = 2-digit year on year change only
      if (!monthChanged || !QUARTER_MONTHS.has(mo)) return "";
      return yearChanged ? yr2 : "";
    }
    if (range === "5Y") {
      // Monthly data points, label = 2-digit year on year change only
      if (!monthChanged) return "";
      return yearChanged ? yr2 : "";
    }
    // Sub-year ranges — original behaviour
    if (totalVisible <= 8) {
      return `${MONTH_LETTER[mo]}${d.getDate()}`;
    } else if (totalVisible <= 26) {
      return monthChanged
        ? (yearChanged ? `${MONTH_LETTER[mo]}${yr2}` : MONTH_LETTER[mo])
        : "";
    } else {
      return (monthChanged && QUARTER_MONTHS.has(mo))
        ? (yearChanged ? `${MONTH_LETTER[mo]}${yr2}` : MONTH_LETTER[mo])
        : "";
    }
  }

  const chartData = areaFridays.map((iso, i) => ({
    label: iso,
    tick: makeTick(iso, areaFridays[i - 1], areaFridays.length, areaRange),
    value: valueMap.get(iso) ?? null,
  }));

  const hasArea = chartData.some((d) => d.value != null);
  const hasWoW  = changes.length >= 2;

  const fmtAxis = (v: number) =>
    v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}k`
    : `$${v}`;

  const chgMap = new Map(changes.filter((c) => c.chg != null).map((c) => [c.week_end, c.chg!]));
  const wowData = wowFridays.map((iso, i) => ({
    label: iso,
    tick: makeTick(iso, wowFridays[i - 1], wowFridays.length, wowRange),
    chg: chgMap.get(iso) ?? null,
  }));

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

      {/* ── Charts row ── */}
      {(hasArea || hasWoW) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Account Value */}
          {hasArea && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp size={13} className="text-green-500" />
                <h3 className="text-sm font-bold text-foreground">Account Value</h3>
                <span className="ml-auto text-[10px] text-foreground/40">{chartData.filter(d => d.value != null).length} wks</span>
              </div>
              <div className="flex items-center gap-1 mb-3">
                {RANGE_LABELS.map((r) => (
                  <button
                    key={r}
                    onClick={() => { setAreaRange(r); try { localStorage.setItem(AREA_RANGE_KEY, r); } catch {} }}
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-colors ${
                      areaRange === r
                        ? "bg-green-500/20 text-green-400 border border-green-500/40"
                        : "text-foreground/40 hover:text-foreground/70"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <defs>
                    <linearGradient id="acctGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="tick" tick={{ fontSize: 10, fill: "var(--foreground)", opacity: 0.45 }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: "var(--foreground)", opacity: 0.4 }} axisLine={false} tickLine={false} width={48}
                    domain={[(dataMin: number) => Math.floor((dataMin - 1000) / 1000) * 1000, (dataMax: number) => Math.ceil((dataMax + 1000) / 1000) * 1000]}
                  />
                  <Tooltip
                    formatter={(v: unknown) => v == null ? ["—", "Value"] : [`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "Value"]}
                    labelFormatter={(_l: unknown, payload?: ReadonlyArray<{ payload?: { label?: string } }>) => {
                      const iso = payload?.[0]?.payload?.label;
                      if (iso) return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                      return String(_l);
                    }}
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }}
                    itemStyle={{ color: "#22c55e" }}
                    labelStyle={{ color: "var(--foreground)", marginBottom: 2 }}
                  />
                  <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fill="url(#acctGrad)" connectNulls={false}
                    dot={(props) => {
                      const { cx, cy, payload } = props;
                      if (payload.value == null) return <g key={props.key} />;
                      return <circle key={props.key} cx={cx} cy={cy} r={2.5} fill="#22c55e" strokeWidth={0} />;
                    }}
                    activeDot={{ r: 4, fill: "#22c55e", strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Week-over-Week change */}
          {hasWoW && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity size={13} className="text-blue-400" />
                <h3 className="text-sm font-bold text-foreground">Week-over-Week</h3>
                <span className="ml-auto text-[10px] text-foreground/40">{wowData.filter(d => d.chg != null).length} wks</span>
              </div>
              <div className="flex items-center gap-1 mb-3">
                {RANGE_LABELS.map((r) => (
                  <button
                    key={r}
                    onClick={() => { setWowRange(r); try { localStorage.setItem(WOW_RANGE_KEY, r); } catch {} }}
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-colors ${
                      wowRange === r
                        ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                        : "text-foreground/40 hover:text-foreground/70"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={wowData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }} barCategoryGap="10%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="tick" tick={{ fontSize: 10, fill: "var(--foreground)", opacity: 0.45 }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tickFormatter={(v) => v === 0 ? "$0" : `${v > 0 ? "+" : ""}${fmtAxis(v)}`} tick={{ fontSize: 10, fill: "var(--foreground)", opacity: 0.4 }} axisLine={false} tickLine={false} width={48} />
                  <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
                  <Tooltip
                    formatter={(v: unknown) => v == null ? ["—", "Change"] : [`${Number(v) >= 0 ? "+" : ""}$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, "Change"]}
                    labelFormatter={(_l: unknown, payload?: ReadonlyArray<{ payload?: { label?: string } }>) => {
                      const iso = payload?.[0]?.payload?.label;
                      if (iso) return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                      return String(_l);
                    }}
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }}
                    itemStyle={{ color: "var(--foreground)" }}
                    labelStyle={{ color: "var(--foreground)", marginBottom: 2 }}
                  />
                  <Bar dataKey="chg" radius={[2, 2, 0, 0]} maxBarSize={12}>
                    {wowData.map((d, i) => (
                      <Cell key={i} fill={d.chg == null ? "transparent" : d.chg > 0 ? "#22c55e" : d.chg < 0 ? "#f87171" : "#64748b"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 pt-2 border-t border-[var(--border)] mt-1">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-green-500" /><span className="text-[10px] text-foreground/50">Gain</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-red-400" /><span className="text-[10px] text-foreground/50">Loss</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-slate-500" /><span className="text-[10px] text-foreground/50">Flat</span></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Broker Account Balances Table ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">

        {/* Header row */}
        <div className="px-5 py-3 border-b border-[var(--border)] flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-bold text-foreground flex-1">Account Balances by Week</h3>

          {/* Year selector */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-foreground focus:outline-none focus:border-blue-500"
          >
            {availableYearsList.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {/* Accounts visibility toggle */}
          <button
            onClick={() => setShowAccountsPanel((v) => !v)}
            className={`flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5 font-semibold border transition-colors ${
              showAccountsPanel
                ? "bg-[var(--surface-2)] border-blue-500 text-blue-400"
                : "bg-[var(--surface-2)] border-[var(--border)] text-foreground/60 hover:text-foreground"
            }`}
          >
            Accounts <ChevronDown size={11} className={`transition-transform ${showAccountsPanel ? "rotate-180" : ""}`} />
          </button>

          {/* Add account button */}
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="flex items-center gap-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-2.5 py-1.5 font-semibold transition-colors"
          >
            <Plus size={12} /> Add Account
          </button>
        </div>

        {/* Add account inline form */}
        {showAddForm && (
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Account name (e.g. ROB Kar)"
              value={newAcctName}
              onChange={(e) => setNewAcctName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newAcctName.trim()) {
                  createAcctMut.mutate({ name: newAcctName.trim(), sort_order: accounts.length + 1 });
                }
                if (e.key === "Escape") { setShowAddForm(false); setNewAcctName(""); }
              }}
              className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs bg-[var(--surface)] text-foreground focus:outline-none focus:border-blue-500 w-56"
              autoFocus
            />
            <button
              disabled={!newAcctName.trim() || createAcctMut.isPending}
              onClick={() => createAcctMut.mutate({ name: newAcctName.trim(), sort_order: accounts.length + 1 })}
              className="text-xs px-3 py-1.5 bg-blue-500 text-white rounded-lg font-semibold disabled:opacity-50"
            >
              {createAcctMut.isPending ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setShowAddForm(false); setNewAcctName(""); }} className="text-xs px-2 py-1.5 text-foreground/50 hover:text-foreground">
              <X size={13} />
            </button>
            <p className="text-[10px] text-foreground/40 w-full">Press Enter to save, Esc to cancel</p>
          </div>
        )}

        {/* Account visibility — pill panel (shown when dropdown is open) */}
        {allAccounts.length > 0 && showAccountsPanel && (
          <div className="px-5 py-2 border-b border-[var(--border)] flex flex-wrap items-center gap-1.5">
            <div className="flex flex-wrap gap-1.5">
              {allAccounts.filter((a) => a.is_active).map((a) => {
                const isHidden = hiddenIds.has(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => toggleHidden(a.id)}
                    title={isHidden ? "Show column" : "Hide column"}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                      isHidden
                        ? "bg-[var(--surface-2)] text-foreground/35 border-[var(--border)] line-through"
                        : "bg-[var(--surface)] text-foreground/80 border-[var(--border)] hover:border-blue-500"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-sm flex-shrink-0"
                      style={{ background: isHidden ? "#475569" : (a.color ?? "#64748b") }}
                    />
                    {a.name}
                  </button>
                );
              })}
              {allAccounts.filter((a) => !a.is_active).map((a) => (
                <button
                  key={a.id}
                  onClick={() => toggleActiveMut.mutate({ id: a.id, is_active: true })}
                  title="Re-activate account"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-dashed border-[var(--border)] text-foreground/30 hover:text-green-500 hover:border-green-500 transition-colors"
                >
                  <span className="w-2 h-2 rounded-sm flex-shrink-0 bg-slate-600" />
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Table */}
        {balancesLoading ? (
          <div className="p-6 space-y-2">{[1,2,3,4].map((i) => <div key={i} className="h-8 bg-[var(--surface-2)] rounded animate-pulse" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse table-fixed">
              <colgroup>
                {/* Friday col: fixed narrow; remaining cols share space equally */}
                <col className="w-[80px]" />
                {visibleAccounts.map((a) => <col key={a.id} />)}
                <col />{/* Total */}
                <col />{/* Δ */}
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                  <th className="px-3 py-2.5 text-left font-semibold sticky left-0 bg-[var(--surface-2)] z-10 whitespace-nowrap">
                    Friday
                  </th>
                  {visibleAccounts.map((a) => (
                    <th key={a.id} className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                      <span style={{ color: a.color ?? undefined }}>{a.name}</span>
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap bg-[var(--surface-2)]">Total</th>
                  <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {allFridaysThisYear.map((iso, idx) => {
                  const weekBalances = balMap.get(iso);
                  const total = weekBalances
                    ? Array.from(weekBalances.values()).reduce((s, v) => s + v, 0)
                    : null;

                  // Previous friday with a total
                  let prevTotal: number | null = null;
                  for (let i = idx - 1; i >= 0; i--) {
                    const prevIso = allFridaysThisYear[i];
                    const prevWk = balMap.get(prevIso);
                    if (prevWk) {
                      prevTotal = Array.from(prevWk.values()).reduce((s, v) => s + v, 0);
                      break;
                    }
                  }
                  const delta = total != null && prevTotal != null ? total - prevTotal : null;

                  const d = new Date(iso + "T00:00:00");
                  const isCurrentWeek = iso === allFridaysThisYear.find(
                    (f) => new Date(f + "T00:00:00") >= new Date()
                  );
                  const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

                  const isEmpty = !weekBalances || weekBalances.size === 0;

                  return (
                    <tr
                      key={iso}
                      className={`hover:bg-[var(--surface-2)] transition-colors group ${isCurrentWeek ? "bg-blue-500/5 border-l-2 border-blue-500" : ""}`}
                    >
                      {/* Date column */}
                      <td className={`px-3 py-2 whitespace-nowrap sticky left-0 z-10 ${isCurrentWeek ? "bg-blue-500/5" : "bg-[var(--surface)]"} group-hover:bg-[var(--surface-2)]`}>
                        <span className={`text-xs font-medium ${isEmpty ? "text-foreground/35" : "text-foreground/80"}`}>
                          {dateLabel}
                        </span>
                      </td>

                      {/* Per-account cells */}
                      {visibleAccounts.map((acct) => {
                        const bal = weekBalances?.get(acct.id) ?? null;
                        const isEditing = editCell?.accountId === acct.id && editCell?.weekDate === iso;

                        return (
                          <td key={acct.id} className="px-3 py-1.5 text-right">
                            {isEditing ? (
                              <input
                                ref={inputRef}
                                type="number"
                                step="1"
                                value={editVal}
                                onChange={(e) => setEditVal(e.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitEdit();
                                  if (e.key === "Escape") setEditCell(null);
                                  if (e.key === "Tab") { e.preventDefault(); commitEdit(); }
                                }}
                                className="w-24 text-right border border-blue-500 rounded-md px-2 py-0.5 text-xs bg-[var(--surface)] text-foreground focus:outline-none"
                                placeholder="0"
                              />
                            ) : (
                              <button
                                onClick={() => startEdit(acct.id, iso)}
                                className={`text-xs tabular-nums rounded px-1 py-0.5 transition-colors ${
                                  bal != null
                                    ? "font-semibold hover:bg-[var(--border)]"
                                    : "text-foreground/20 hover:text-foreground/50 hover:bg-[var(--border)]"
                                }`}
                                style={bal != null ? { color: acct.color ?? undefined } : undefined}
                              >
                                {bal != null ? `$${bal.toLocaleString()}` : "—"}
                              </button>
                            )}
                          </td>
                        );
                      })}

                      {/* Total */}
                      <td className="px-3 py-2 text-right">
                        {total != null ? (
                          <span className="text-xs font-bold text-foreground tabular-nums">
                            ${total.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[10px] text-foreground/25">—</span>
                        )}
                      </td>

                      {/* Delta */}
                      <td className="px-3 py-2 text-right">
                        {delta != null ? (
                          <span className={`text-[11px] font-semibold tabular-nums ${delta > 0 ? "text-green-500" : delta < 0 ? "text-red-400" : "text-foreground/40"}`}>
                            {delta > 0 ? "+" : ""}{delta.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[10px] text-foreground/25">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {allFridaysThisYear.length === 0 && (
              <p className="text-center text-foreground/40 py-10 text-sm">No Fridays found for {selectedYear}.</p>
            )}
          </div>
        )}

        <div className="px-5 py-2.5 border-t border-[var(--border)] text-[10px] text-foreground/35">
          Click any cell to edit · Enter to save · Esc to cancel · Empty value removes entry
        </div>
      </div>

    </div>
  );
}

