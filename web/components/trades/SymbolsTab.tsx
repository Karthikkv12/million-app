"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSymbolSummary, SymbolSummary } from "@/lib/api";
import { EmptyState, SkeletonCard } from "@/components/ui";
import { Search, TrendingUp, Award, BarChart2 } from "lucide-react";
import { inp, fmt$ } from "./TradesHelpers";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  PieChart, Pie,
} from "recharts";

// ── helpers ───────────────────────────────────────────────────────────────────
const BAR_COLORS = ["#22c55e","#3b82f6","#f59e0b","#a855f7","#ef4444","#06b6d4","#f97316","#ec4899","#14b8a6","#8b5cf6","#e11d48","#84cc16"];

function pct(part: number, total: number) {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

// ── Metrics panel (right side) ────────────────────────────────────────────────
function MetricsPanel({ symbols, selected }: { symbols: SymbolSummary[]; selected: SymbolSummary | null }) {
  const totalPrem  = symbols.reduce((a, s) => a + s.total_premium, 0);
  const totalReal  = symbols.reduce((a, s) => a + s.realized_pnl,  0);
  const winners    = symbols.filter((s) => s.realized_pnl > 0).length;
  const best       = [...symbols].sort((a, b) => b.realized_pnl - a.realized_pnl)[0];
  const mostPrem   = [...symbols].sort((a, b) => b.total_premium - a.total_premium)[0];

  // Bar chart data — top 8 by total premium
  const barData = [...symbols]
    .sort((a, b) => b.total_premium - a.total_premium)
    .slice(0, 8)
    .map((s) => ({ name: s.symbol, prem: s.total_premium, real: s.realized_pnl }));

  // Pie — share of total premium per symbol
  const pieData = [...symbols]
    .sort((a, b) => b.total_premium - a.total_premium)
    .slice(0, 6)
    .map((s) => ({ name: s.symbol, value: s.total_premium }));

  return (
    <div className="space-y-4">
      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3">
          <p className="text-[10px] text-foreground/50 uppercase tracking-wide font-semibold mb-1">Total Premium</p>
          <p className="text-xl font-black text-green-500">${totalPrem.toFixed(0)}</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3">
          <p className="text-[10px] text-foreground/50 uppercase tracking-wide font-semibold mb-1">Realized P&L</p>
          <p className={`text-xl font-black ${totalReal >= 0 ? "text-green-500" : "text-red-600"}`}>{fmt$(totalReal)}</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Award size={11} className="text-green-500" />
            <p className="text-[10px] text-foreground/50 uppercase tracking-wide font-semibold">Profitable Symbols</p>
          </div>
          <p className="text-xl font-black text-foreground">{pct(winners, symbols.length)}<span className="text-sm font-semibold text-foreground/40">%</span></p>
          <p className="text-[10px] text-foreground/40 mt-0.5">{winners}/{symbols.length} symbols profitable</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={11} className="text-green-500" />
            <p className="text-[10px] text-foreground/50 uppercase tracking-wide font-semibold">Best Symbol</p>
          </div>
          <p className="text-xl font-black text-foreground">{best?.symbol ?? "—"}</p>
          <p className="text-[10px] text-green-500 font-semibold mt-0.5">{best ? fmt$(best.realized_pnl) : ""}</p>
        </div>
      </div>

      {/* ── Selected symbol detail ── */}
      {selected && (
        <div className="bg-[var(--surface)] border border-green-500/30 rounded-2xl px-4 py-3">
          <p className="text-[10px] text-green-500 uppercase tracking-wide font-semibold mb-2">Selected — {selected.symbol}</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-[10px] text-foreground/40">Total Premium</p>
              <p className="font-bold text-green-500">${selected.total_premium.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] text-foreground/40">Realized P&L</p>
              <p className={`font-bold ${selected.realized_pnl >= 0 ? "text-green-500" : "text-red-600"}`}>{fmt$(selected.realized_pnl)}</p>
            </div>
            <div>
              <p className="text-[10px] text-foreground/40">Share of Total</p>
              <p className="font-bold text-foreground">{pct(selected.total_premium, totalPrem)}%</p>
            </div>
            <div>
              <p className="text-[10px] text-foreground/40">Premium Bar</p>
              <div className="mt-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${pct(selected.total_premium, mostPrem?.total_premium ?? 1)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bar chart: Premium by symbol ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 size={13} className="text-green-500" />
          <p className="text-xs font-bold text-foreground">Premium by Symbol</p>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={barData} margin={{ top: 2, right: 4, bottom: 2, left: -10 }} barCategoryGap="25%">
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 10, fontSize: 11, color: "#f9fafb" }}
              labelStyle={{ color: "#f9fafb" }}
              itemStyle={{ color: "#d1fae5" }}
              formatter={(v: number | undefined) => [`$${(v ?? 0).toFixed(2)}`, "Premium"]}
            />
            <Bar dataKey="prem" radius={[4, 4, 0, 0]}>
              {barData.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Pie chart: Premium share ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
        <p className="text-xs font-bold text-foreground mb-3">Premium Share (top 6)</p>
        <div className="flex items-center gap-4">
          <ResponsiveContainer width={110} height={110}>
            <PieChart>
              <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={50} paddingAngle={3}>
                {pieData.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 10, fontSize: 11, color: "#f9fafb" }}
                labelStyle={{ color: "#f9fafb" }}
                itemStyle={{ color: "#d1fae5" }}
                formatter={(v: number | undefined) => [`$${(v ?? 0).toFixed(2)}`, "Premium"]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-col gap-1.5 flex-1">
            {pieData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} />
                <span className="text-foreground/70 font-semibold w-10">{d.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct(d.value, totalPrem)}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                </div>
                <span className="text-foreground/50 w-8 text-right">{pct(d.value, totalPrem)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────
export function SymbolsTab() {
  const { data: symbols = [], isLoading } = useQuery({
    queryKey: ["symbolSummary"],
    queryFn: fetchSymbolSummary,
    staleTime: 60_000,
  });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SymbolSummary | null>(null);

  const filtered = useMemo(
    () => symbols.filter((s) => s.symbol.toLowerCase().includes(search.toLowerCase())),
    [symbols, search],
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">

      {/* ── Left: half-width table ── */}
      <div className="w-full lg:w-1/2 shrink-0">
        <div className="mb-3 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbol…"
            className={`${inp} pl-8`}
          />
        </div>

        {isLoading && <div className="space-y-2">{[1,2,3].map((i) => <SkeletonCard key={i} rows={1} />)}</div>}

        {!isLoading && filtered.length === 0 && (
          <EmptyState icon={Search} title="No symbols found" body={search ? "Try a different search." : "Your traded symbols will appear here."} />
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-[var(--border)]">
              {filtered.map((s) => (
                <div
                  key={s.symbol}
                  onClick={() => setSelected((prev) => prev?.symbol === s.symbol ? null : s)}
                  className={`px-3 py-3 flex items-center justify-between cursor-pointer transition-colors ${selected?.symbol === s.symbol ? "bg-green-500/10" : "hover:bg-[var(--surface-2)]"}`}
                >
                  <span className="font-bold text-foreground text-base">{s.symbol}</span>
                  <div className="text-right">
                    <div className="text-green-500 font-semibold text-sm">${s.total_premium.toFixed(2)}</div>
                    <div className={`text-xs font-semibold ${s.realized_pnl >= 0 ? "text-green-500" : "text-red-600"}`}>{fmt$(s.realized_pnl)} realized</div>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] text-foreground/60 uppercase tracking-wide bg-[var(--surface-2)]">
                    {["Symbol", "Total Premium", "Realized P/L"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.symbol}
                      onClick={() => setSelected((prev) => prev?.symbol === s.symbol ? null : s)}
                      className={`border-b border-[var(--border)] cursor-pointer transition-colors ${selected?.symbol === s.symbol ? "bg-green-500/10" : "hover:bg-[var(--surface-2)]"}`}
                    >
                      <td className="px-4 py-2.5 font-bold text-foreground">{s.symbol}</td>
                      <td className="px-4 py-2.5 text-green-500 font-semibold">${s.total_premium.toFixed(2)}</td>
                      <td className={`px-4 py-2.5 font-semibold ${s.realized_pnl >= 0 ? "text-green-500" : "text-red-600"}`}>
                        {fmt$(s.realized_pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: metrics + charts ── */}
      {!isLoading && symbols.length > 0 && (
        <div className="w-full lg:flex-1 min-w-0">
          <MetricsPanel symbols={symbols} selected={selected} />
        </div>
      )}
    </div>
  );
}
