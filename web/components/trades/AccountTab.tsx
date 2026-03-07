"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPortfolioSummary, updateWeek } from "@/lib/api";
import { EmptyState, SkeletonCard } from "@/components/ui";
import { TrendingUp, Activity } from "lucide-react";
import { fmt$ } from "./TradesHelpers";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell, ReferenceLine,
} from "recharts";

export function AccountTab() {
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

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonCard key={i} rows={2} />)}</div>;
  if (!s) return <EmptyState icon={Activity} title="No data" body="Complete a week to start tracking." />;

  const rows = [...(s.weeks_breakdown ?? [])]; // newest first (API default)
  // chronological for chart + delta calculation
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

      {/* ── Charts row ── */}
      {(() => {
        // Build 52-Friday scaffold for current year
        const year = new Date().getFullYear();
        const jan1 = new Date(year, 0, 1);
        const firstFriday = new Date(jan1);
        firstFriday.setDate(jan1.getDate() + ((5 - jan1.getDay() + 7) % 7));

        const valueMap = new Map<string, number>();
        for (const r of withValue) valueMap.set(r.week_end, r.account_value!);

        const allFridays: { label: string; tick: string; value: number | null }[] = [];
        for (let i = 0; i < 52; i++) {
          const d = new Date(firstFriday);
          d.setDate(firstFriday.getDate() + i * 7);
          if (d.getFullYear() !== year) break;
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const isFirstOfMonth = i === 0 || allFridays[allFridays.length - 1]?.label.slice(5, 7) !== key.slice(5, 7);
          allFridays.push({
            label: key,
            tick: isFirstOfMonth ? d.toLocaleDateString("en-US", { month: "short" }) : "",
            value: valueMap.get(key) ?? null,
          });
        }

        const hasArea = allFridays.some((d) => d.value != null);
        const hasWoW  = changes.length >= 2;
        if (!hasArea && !hasWoW) return null;

        const fmtAxis = (v: number) =>
          v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
          : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}k`
          : `$${v}`;

        // WoW bar data — same 52-week scaffold
        const chgMap = new Map(changes.filter((c) => c.chg != null).map((c) => [c.week_end, c.chg!]));
        const wowData = allFridays.map((f) => ({ label: f.label, tick: f.tick, chg: chgMap.get(f.label) ?? null }));

        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Account Value */}
            {hasArea && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={13} className="text-green-500" />
                  <h3 className="text-sm font-bold text-foreground">Account Value — {year}</h3>
                  <span className="ml-auto text-[10px] text-foreground/40">{withValue.length}/52 wks</span>
                </div>
                <ResponsiveContainer width="100%" height={190}>
                  <AreaChart data={allFridays} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
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
                      ticks={(() => {
                        const vals = withValue.map((r) => r.account_value!);
                        if (vals.length === 0) return [];
                        const lo = Math.floor((Math.min(...vals) - 1000) / 1000) * 1000;
                        const hi = Math.ceil((Math.max(...vals) + 1000) / 1000) * 1000;
                        const result = [];
                        for (let v = lo; v <= hi; v += 1000) result.push(v);
                        return result;
                      })()}
                    />
                    <Tooltip
                      formatter={(v: unknown) => v == null ? ["—", "Value"] : [`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "Value"]}
                      labelFormatter={(_l: unknown, payload?: Array<{ payload?: { label?: string } }>) => {
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
                <div className="flex items-center gap-2 mb-3">
                  <Activity size={13} className="text-blue-400" />
                  <h3 className="text-sm font-bold text-foreground">Week-over-Week Δ</h3>
                  <span className="ml-auto text-[10px] text-foreground/40">{changes.filter((c) => c.chg != null).length} wks</span>
                </div>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={wowData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }} barCategoryGap="10%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="tick" tick={{ fontSize: 10, fill: "var(--foreground)", opacity: 0.45 }} axisLine={false} tickLine={false} interval={0} />
                    <YAxis tickFormatter={(v) => v === 0 ? "$0" : `${v > 0 ? "+" : ""}${fmtAxis(v)}`} tick={{ fontSize: 10, fill: "var(--foreground)", opacity: 0.4 }} axisLine={false} tickLine={false} width={48} />
                    <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
                    <Tooltip
                      formatter={(v: unknown) => v == null ? ["—", "Change"] : [`${Number(v) >= 0 ? "+" : ""}$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, "Change"]}
                      labelFormatter={(_l: unknown, payload?: Array<{ payload?: { label?: string } }>) => {
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
        );
      })()}

      {/* ── Table ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Friday Account Values</h3>
          <p className="text-[10px] text-foreground/40 hidden sm:block">Click a value to edit</p>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-[var(--border)]">
          {rows.map((r) => {
            const idx  = changes.findIndex((c) => c.id === r.id);
            const chg  = idx >= 0 ? changes[idx].chg : null;
            const isEdit = editing === r.id;
            return (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground/80">
                    {new Date(r.week_end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${r.is_complete ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"}`}>
                    {r.is_complete ? "Complete" : "Active"}
                  </span>
                </div>
                {isEdit ? (
                  <form className="flex items-center gap-2 mb-1" onSubmit={(e) => { e.preventDefault(); const v = parseFloat(editVal); if (!isNaN(v)) updateMut.mutate({ id: r.id, value: v }); }}>
                    <input autoFocus type="number" step="0.01" value={editVal} onChange={(e) => setEditVal(e.target.value)}
                      className="w-32 border border-blue-500 rounded-lg px-2 py-1 text-sm bg-[var(--surface)] text-foreground focus:outline-none" />
                    <button type="submit" className="text-[11px] px-2 py-1 bg-blue-500 text-white rounded-lg font-semibold">{updateMut.isPending ? "…" : "Save"}</button>
                    <button type="button" onClick={() => setEditing(null)} className="text-[11px] px-2 py-1 bg-[var(--surface-2)] text-foreground/60 rounded-lg">✕</button>
                  </form>
                ) : (
                  <button onClick={() => { setEditing(r.id); setEditVal(r.account_value?.toFixed(2) ?? ""); }} className="text-lg font-bold text-green-500 hover:underline block mb-1">
                    {r.account_value != null ? `$${r.account_value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : <span className="text-foreground/30 font-normal text-sm">tap to add value</span>}
                  </button>
                )}
                <div className="flex items-center gap-4 text-xs">
                  {chg != null && <span className={`font-semibold ${chg >= 0 ? "text-green-500" : "text-red-400"}`}>Δ {chg >= 0 ? "+" : "-"}${Math.abs(chg).toFixed(0)}</span>}
                  {r.premium > 0 && <span className="text-green-500">Prem ${r.premium.toFixed(2)}</span>}
                  <span className={r.realized_pnl >= 0 ? "text-green-500" : "text-red-400"}>{fmt$(r.realized_pnl)}</span>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <p className="text-center text-foreground/40 py-10 text-sm">No weeks yet.</p>}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                {["Week Ending (Friday)", "Account Value", "Δ vs Prior", "Premium", "Realized P/L", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r) => {
                const idx  = changes.findIndex((c) => c.id === r.id);
                const chg  = idx >= 0 ? changes[idx].chg : null;
                const isEdit = editing === r.id;
                return (
                  <tr key={r.id} className="hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-3 text-foreground/80 font-medium whitespace-nowrap">
                      {new Date(r.week_end + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      {isEdit ? (
                        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const v = parseFloat(editVal); if (!isNaN(v)) updateMut.mutate({ id: r.id, value: v }); }}>
                          <input autoFocus type="number" step="0.01" value={editVal} onChange={(e) => setEditVal(e.target.value)}
                            className="w-32 border border-blue-500 rounded-lg px-2 py-1 text-sm bg-[var(--surface)] text-foreground focus:outline-none" />
                          <button type="submit" className="text-[11px] px-2 py-1 bg-blue-500 text-white rounded-lg font-semibold">{updateMut.isPending ? "…" : "Save"}</button>
                          <button type="button" onClick={() => setEditing(null)} className="text-[11px] px-2 py-1 bg-[var(--surface-2)] text-foreground/60 rounded-lg">✕</button>
                        </form>
                      ) : (
                        <button onClick={() => { setEditing(r.id); setEditVal(r.account_value?.toFixed(2) ?? ""); }} className="font-semibold text-green-500 hover:underline">
                          {r.account_value != null ? `$${r.account_value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : <span className="text-foreground/30 font-normal">— tap to add</span>}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {chg != null
                        ? <span className={`font-semibold ${chg >= 0 ? "text-green-500" : "text-red-400"}`}>{chg >= 0 ? "+" : "-"}${Math.abs(chg).toFixed(0)}</span>
                        : <span className="text-foreground/30">—</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground/80">
                      {r.premium > 0 ? <span className="text-green-500 font-medium">${r.premium.toFixed(2)}</span> : <span className="text-foreground/30">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={r.realized_pnl >= 0 ? "text-green-500" : "text-red-400"}>{fmt$(r.realized_pnl)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${r.is_complete ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"}`}>
                        {r.is_complete ? "Complete" : "Active"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="text-center text-foreground/40 py-10 text-sm">No weeks yet.</p>}
        </div>
      </div>

    </div>
  );
}
