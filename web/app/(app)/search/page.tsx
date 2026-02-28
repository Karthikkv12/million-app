"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Cell, ComposedChart, Line,
} from "recharts";
import {
  fetchStockInfo, fetchStockHistory, fetchNetFlowHistory, fetchGex,
  StockInfo, FlowSnapshot, GexResult,
} from "@/lib/api";
import TickerSearchInput from "@/components/TickerSearchInput";
import { isToday } from "@/lib/gex";
import TradingChart from "@/components/chart/TradingChart";
import {
  TrendingUp, TrendingDown, Activity, BarChart2, Zap,
  Globe, Users, DollarSign, Shield, ArrowUpRight, ArrowDownRight,
  RefreshCw, ExternalLink, AlertCircle, ChevronRight, Calendar,
  Package, Percent, Eye, BookOpen, Target, Clock,
} from "lucide-react";

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt$(v: number | undefined | null, dp = 2): string {
  if (v == null) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtPct(v: number | undefined | null, dp = 2): string {
  if (v == null) return "—";
  return (v * 100).toFixed(dp) + "%";
}
function fmtNum(v: number | undefined | null, dp = 0): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtBig(v: number | undefined | null): string {
  if (v == null) return "—";
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (v >= 1e9)  return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6)  return "$" + (v / 1e6).toFixed(2) + "M";
  return "$" + v.toFixed(0);
}
function fmtVol(v: number | undefined | null): string {
  if (v == null) return "—";
  if (v >= 1e9)  return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6)  return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3)  return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}

const TABS = ["Overview", "Price Chart", "Options Flow", "Fundamentals"] as const;
type Tab = (typeof TABS)[number];

// ─── subcomponents ────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, color,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
      <div className="flex items-center gap-1.5 text-foreground/70">
        {icon}
        <span className="text-[10px] uppercase tracking-widest font-semibold">{label}</span>
      </div>
      <span className={`text-base font-black tabular-nums leading-none ${color ?? "text-foreground"}`}>{value}</span>
      {sub && <span className="text-[10px] text-foreground/70">{sub}</span>}
    </div>
  );
}

function SectionHeader({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-[var(--surface-2)]">
        <span className="text-foreground/70">{icon}</span>
      </div>
      <div>
        <h3 className="text-sm font-bold text-foreground leading-none">{title}</h3>
        {sub && <p className="text-[10px] text-foreground/70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── price chart panel — delegates to TradingChart ───────────────────────────

function PriceChartPanel({
  symbol,
  earningsDate,
  gexLevels,
}: {
  symbol: string;
  earningsDate?: number | null;
  gexLevels?: { callWall?: number; putWall?: number; zeroGamma?: number };
}) {
  return (
    <TradingChart
      symbol={symbol}
      earningsDate={earningsDate}
      gexLevels={gexLevels}
      initialPeriod="1D"
    />
  );
}

// ─── key levels ruler ─────────────────────────────────────────────────────────

function KeyLevelsRuler({ gex }: { gex: GexResult }) {
  const { spot, zero_gamma, max_call_wall, max_put_wall } = gex;

  const levels: { label: string; value: number; color: string }[] = [];
  if (max_put_wall  != null) levels.push({ label: "Put Wall",   value: max_put_wall,  color: "#ef4444" });
  if (zero_gamma    != null) levels.push({ label: "Zero Γ",     value: zero_gamma,    color: "#f59e0b" });
  if (spot          != null) levels.push({ label: "SPOT",        value: spot,          color: "#f59e0b" });
  if (max_call_wall != null) levels.push({ label: "Call Wall",   value: max_call_wall, color: "#22c55e" });
  levels.sort((a, b) => a.value - b.value);

  if (levels.length < 2) return null;

  const lo = levels[0].value;
  const hi = levels[levels.length - 1].value;
  const range = hi - lo || 1;
  const pct = (v: number) => ((v - lo) / range) * 100;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <SectionHeader icon={<Target size={13} />} title="Key Levels Ruler" sub="Price context — put wall → spot → call wall" />
      <div className="relative h-10 mt-2 mb-6">
        {/* track */}
        <div className="absolute top-1/2 left-0 right-0 h-1.5 -translate-y-1/2 rounded-full bg-[var(--surface-2)] overflow-hidden">
          {/* fill from put-wall to call-wall */}
          {max_put_wall != null && max_call_wall != null && (
            <div
              className="absolute h-full rounded-full"
              style={{
                left:  `${pct(max_put_wall)}%`,
                width: `${pct(max_call_wall) - pct(max_put_wall)}%`,
                background: "linear-gradient(90deg, #ef4444, #22c55e)",
                opacity: 0.25,
              }}
            />
          )}
        </div>
        {/* level markers */}
        {levels.map((lv) => (
          <div
            key={lv.label}
            className="absolute -translate-x-1/2"
            style={{ left: `${pct(lv.value)}%`, top: 0 }}
          >
            <div
              className="w-3 h-3 rounded-full border-2 border-[var(--surface)] mx-auto"
              style={{ background: lv.color }}
            />
            <div className="text-center mt-1" style={{ color: lv.color }}>
              <p className="text-[9px] font-bold whitespace-nowrap">{lv.label}</p>
              <p className="text-[10px] font-black tabular-nums">{fmt$(lv.value)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── gex profile bar chart ────────────────────────────────────────────────────

function GexProfileChart({ gex, accentColor }: { gex: GexResult; accentColor: string }) {
  const strikes = gex.strikes ?? [];
  const rows = strikes
    .map((s) => ({
      strike: s,
      call: (gex.call_gex_by_strike?.[String(s)] ?? 0) / 1e9,
      put:  -(gex.put_gex_by_strike?.[String(s)]  ?? 0) / 1e9,
      net:  (gex.gex_by_strike?.[String(s)] ?? 0) / 1e9,
    }))
    .filter((r) => Math.abs(r.net) > 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 20)
    .sort((a, b) => a.strike - b.strike);

  if (!rows.length) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <SectionHeader icon={<BarChart2 size={13} />} title="GEX Profile" sub="Call (green) vs Put (red) gamma exposure by strike" />
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 20, left: 50, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number" tick={{ fontSize: 9, fill: "#9ca3af" }} tickLine={false} axisLine={false}
            tickFormatter={(v) => `${v.toFixed(1)}B`}
          />
          <YAxis
            dataKey="strike" type="category" width={50}
            tick={{ fontSize: 9, fill: "#9ca3af" }} tickLine={false} axisLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [`${Number(v).toFixed(3)}B`, name === "call" ? "Call GEX" : "Put GEX"]}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 11 }}
          />
          <ReferenceLine x={0} stroke="var(--border)" strokeWidth={2} />
          {gex.spot != null && (
            <ReferenceLine
              y={gex.spot} stroke={accentColor} strokeDasharray="4 2" strokeWidth={1.5}
              label={{ value: "SPOT", position: "insideTopRight", fontSize: 9, fill: accentColor }}
            />
          )}
          <Bar dataKey="call" fill="#22c55e" radius={[0, 3, 3, 0]} maxBarSize={14} />
          <Bar dataKey="put"  fill="#ef4444" radius={[3, 0, 0, 3]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── IV distribution (heatmap values per strike) ──────────────────────────────

function IVDistributionChart({ gex }: { gex: GexResult }) {
  // Sum absolute GEX across all expiries per strike → proxy for "importance" at each strike
  const strikeWeights = (gex.heatmap_strikes ?? []).map((strike, si) => {
    const totalAbs = (gex.heatmap_values ?? []).reduce((acc, row) => {
      return acc + Math.abs(row[si] ?? 0);
    }, 0);
    return { strike, weight: totalAbs / 1e9 };
  }).filter((r) => r.weight > 0)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 16)
    .sort((a, b) => a.strike - b.strike);

  if (!strikeWeights.length) return null;

  const max = Math.max(...strikeWeights.map((r) => r.weight), 1);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <SectionHeader icon={<Activity size={13} />} title="Gamma Concentration" sub="Total absolute GEX across all expiries per strike" />
      <div className="flex flex-col gap-1.5 mt-2">
        {strikeWeights.map((r) => {
          const isSpot = gex.spot != null && Math.abs(r.strike - gex.spot) < 1;
          const pct = (r.weight / max) * 100;
          return (
            <div key={r.strike} className="flex items-center gap-3">
              <span className={`text-[10px] font-bold tabular-nums w-14 text-right shrink-0 ${isSpot ? "text-amber-400" : "text-foreground"}`}>
                ${r.strike}
              </span>
              <div className="flex-1 h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: isSpot ? "#f59e0b" : "var(--foreground)",
                    opacity: isSpot ? 1 : 0.5,
                  }}
                />
              </div>
              <span className="text-[10px] text-foreground/70 tabular-nums w-16 shrink-0">{r.weight.toFixed(2)}B</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── net flow history chart ───────────────────────────────────────────────────

const FLOW_DAYS = [1, 3, 7, 14] as const;

function FlowMomentumChart({ symbol }: { symbol: string }) {
  const [days, setDays] = useState<number>(1);

  const { data: snapshots = [], isLoading } = useQuery<FlowSnapshot[]>({
    queryKey: ["netFlowHistory", symbol, days],
    queryFn: () => fetchNetFlowHistory(symbol, days),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const chartData = snapshots.map((s) => ({
    ts:       s.ts,
    net:      s.net_flow / 1e6,
    call:     s.call_prem / 1e6,
    put:      -(s.put_prem / 1e6),
    price:    s.price,
    volume:   s.volume,
  }));

  const hasData = chartData.length > 1;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <SectionHeader icon={<Zap size={13} />} title="Flow Momentum" sub="Net options premium over time" />
        <div className="flex items-center gap-1">
          {FLOW_DAYS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                d === days ? "bg-[var(--foreground)] text-[var(--background)]" : "bg-[var(--surface-2)] text-foreground/70 hover:text-foreground"
              }`}
            >{d}D</button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-44 rounded-xl bg-[var(--surface-2)] animate-pulse" />
      ) : !hasData ? (
        <div className="h-44 flex flex-col items-center justify-center gap-2 text-foreground/70">
          <Clock size={24} className="opacity-30" />
          <p className="text-sm">Flow data accumulates as the market is open</p>
          <p className="text-xs text-foreground/70">Keep the app open — snapshots refresh every 10s</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="ts" tick={{ fontSize: 8, fill: "#9ca3af" }} tickLine={false}
              interval={Math.floor(chartData.length / 6)}
              tickFormatter={(v: string) => v.slice(11, 16)}
            />
            <YAxis tick={{ fontSize: 9, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `${v.toFixed(0)}M`} />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any, name: any) => [`$${Number(v).toFixed(1)}M`, name === "net" ? "Net Flow" : name === "call" ? "Call Prem" : "Put Prem"]}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 11 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              labelFormatter={(v: any) => String(v).slice(0, 19).replace("T", " ")}
            />
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
            <Bar dataKey="call" fill="#22c55e60" maxBarSize={6} name="call" />
            <Bar dataKey="put"  fill="#ef444460" maxBarSize={6} name="put" />
            <Line type="monotone" dataKey="net" stroke="var(--foreground)" strokeWidth={2} dot={false} name="net" />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─── dealer positioning narrative ────────────────────────────────────────────

function DealerNarrative({ gex }: { gex: GexResult }) {
  const { net_gex, spot, zero_gamma, max_call_wall, max_put_wall, call_premium, put_premium, net_flow } = gex;

  const regime    = (net_gex ?? 0) >= 0 ? "long gamma" : "short gamma";
  const regimeCol = (net_gex ?? 0) >= 0 ? "text-emerald-500" : "text-red-400";
  const netGexB   = ((net_gex ?? 0) / 1e9).toFixed(2);
  const pcRatio   = call_premium > 0 ? (put_premium / call_premium).toFixed(2) : "N/A";
  const flowBias  = net_flow >= 0 ? "bullish (call-heavy)" : "bearish (put-heavy)";
  const flowCol   = net_flow >= 0 ? "text-emerald-500" : "text-red-400";

  const aboveZeroG = zero_gamma != null && spot != null && spot > zero_gamma;
  const nearCallWall = max_call_wall != null && spot != null && (max_call_wall - spot) / spot < 0.02;
  const nearPutWall  = max_put_wall  != null && spot != null && (spot - max_put_wall)  / spot < 0.02;

  const lines: { text: string; highlight?: string; color?: string }[] = [
    {
      text: `Dealers are currently in `,
      highlight: regime,
      color: regimeCol,
    },
    ...(net_gex != null ? [{
      text: ` positioning with ${Math.abs(Number(netGexB))}B net GEX. ${(net_gex ?? 0) >= 0
        ? "In long gamma, dealers hedge by selling rallies and buying dips — acting as a market stabiliser."
        : "In short gamma, dealers amplify directional moves — buy rallies, sell dips — increasing volatility."}`
    }] : []),
    ...(zero_gamma != null && spot != null ? [{
      text: `The zero-gamma level is ${fmt$(zero_gamma)} (spot is ${aboveZeroG ? "above" : "below"} it). ${aboveZeroG
        ? "Above zero-gamma, dealer hedging creates a dampening effect on price swings."
        : "Below zero-gamma, dealer hedging can amplify price moves — treat support/resistance with caution."}`
    }] : []),
    ...(max_call_wall != null ? [{
      text: `The call wall at ${fmt$(max_call_wall)} acts as a ceiling — the heaviest call OI creates resistance as dealers short delta there. ${nearCallWall ? "⚠️ Spot is approaching this wall." : ""}`
    }] : []),
    ...(max_put_wall != null ? [{
      text: `The put wall at ${fmt$(max_put_wall)} acts as a floor — concentrated put OI creates a support zone as dealers go long delta there. ${nearPutWall ? "⚠️ Spot is near this support." : ""}`
    }] : []),
    {
      text: `Overall flow today is `,
      highlight: flowBias,
      color: flowCol,
    },
    ...(call_premium > 0 || put_premium > 0 ? [{
      text: ` with $${(call_premium / 1e6).toFixed(1)}M in calls vs $${(put_premium / 1e6).toFixed(1)}M in puts (P/C ratio: ${pcRatio}).`
    }] : []),
  ];

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <SectionHeader icon={<BookOpen size={13} />} title="Dealer Positioning Narrative" sub="AI-generated interpretation of GEX data" />
      <div className="space-y-2">
        {lines.map((ln, i) => (
          <p key={i} className="text-sm text-foreground leading-relaxed">
            {ln.text}{ln.highlight && <span className={`font-bold ${ln.color ?? ""}`}>{ln.highlight}</span>}
          </p>
        ))}
      </div>
    </div>
  );
}

// ─── top flow strikes activity ────────────────────────────────────────────────

function TopStrikesActivity({ gex }: { gex: GexResult }) {
  const top = [...(gex.top_flow_strikes ?? [])].sort((a, b) => (b.call_prem + b.put_prem) - (a.call_prem + a.put_prem)).slice(0, 10);
  if (!top.length) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <SectionHeader icon={<Eye size={13} />} title="Options Activity" sub="Top strikes by total premium (calls + puts)" />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-foreground/70 text-[10px] uppercase tracking-widest border-b border-[var(--border)]">
              <th className="text-left py-2 pr-3 font-semibold">Strike</th>
              <th className="text-right py-2 px-3 font-semibold text-emerald-500">Calls $M</th>
              <th className="text-right py-2 px-3 font-semibold text-red-400">Puts $M</th>
              <th className="text-right py-2 px-3 font-semibold">Net $M</th>
              <th className="text-center py-2 pl-3 font-semibold">Bias</th>
              <th className="py-2 pl-3 font-semibold hidden sm:table-cell">Mix</th>
            </tr>
          </thead>
          <tbody>
            {top.map((tf) => {
              const total   = Math.max(tf.call_prem + tf.put_prem, 1);
              const callPct = Math.round((tf.call_prem / total) * 100);
              const netM    = tf.net / 1e6;
              const isCall  = tf.bias === "call";
              return (
                <tr key={tf.strike} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)] transition">
                  <td className="py-2 pr-3 font-black tabular-nums text-foreground">${tf.strike.toFixed(0)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-emerald-500 font-bold">{(tf.call_prem / 1e6).toFixed(1)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-red-400 font-bold">{(tf.put_prem / 1e6).toFixed(1)}</td>
                  <td className={`py-2 px-3 text-right tabular-nums font-bold ${netM >= 0 ? "text-emerald-500" : "text-red-400"}`}>
                    {netM >= 0 ? "+" : ""}{netM.toFixed(1)}
                  </td>
                  <td className="py-2 pl-3 text-center">
                    <span className={`inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                      isCall ? "bg-emerald-500/15 text-emerald-500" : "bg-red-400/15 text-red-400"
                    }`}>
                      {isCall ? <ArrowUpRight size={8} /> : <ArrowDownRight size={8} />}
                      {isCall ? "CALL" : "PUT"}
                    </span>
                  </td>
                  <td className="py-2 pl-3 hidden sm:table-cell">
                    <div className="flex items-center gap-1.5 min-w-[80px]">
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-[var(--border)]">
                        <div className="h-full bg-emerald-500 rounded-l-full" style={{ width: `${callPct}%` }} />
                      </div>
                      <span className="text-[9px] text-foreground/70 w-8 tabular-nums">{callPct}%C</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── flow by expiry chart ─────────────────────────────────────────────────────

function FlowByExpiryChart({ gex }: { gex: GexResult }) {
  const data = [...(gex.flow_by_expiry ?? [])]
    .sort((a, b) => a.expiry.localeCompare(b.expiry))
    .slice(0, 12)
    .map((f) => ({
      exp:  isToday(f.expiry) ? "⚡0DTE" : f.expiry.slice(5),
      call: f.call_prem / 1e6,
      put:  -(f.put_prem / 1e6),
      net:  f.net / 1e6,
    }));

  if (!data.length) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <SectionHeader icon={<Calendar size={13} />} title="Flow by Expiry" sub="Net premium per expiration date ($M)" />
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="exp" tick={{ fontSize: 9, fill: "#9ca3af" }} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={42} tickFormatter={(v) => `${v.toFixed(0)}M`} />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [`$${Math.abs(Number(v)).toFixed(1)}M`, name === "call" ? "Calls" : name === "put" ? "Puts" : "Net"]}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 11 }}
          />
          <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
          <Bar dataKey="call" fill="#22c55e80" maxBarSize={18} />
          <Bar dataKey="put"  fill="#ef444480" maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── fundamentals panel ───────────────────────────────────────────────────────

function FundamentalsPanel({ info }: { info: StockInfo }) {
  const sections: { title: string; icon: React.ReactNode; rows: { label: string; value: string }[] }[] = [
    {
      title: "Valuation",
      icon: <DollarSign size={13} />,
      rows: [
        { label: "Market Cap",    value: fmtBig(info.market_cap) },
        { label: "Enterprise Val", value: fmtBig(info.enterprise_value) },
        { label: "P/E (TTM)",     value: info.pe_ratio != null ? info.pe_ratio.toFixed(2) : "—" },
        { label: "Fwd P/E",       value: info.forward_pe != null ? info.forward_pe.toFixed(2) : "—" },
        { label: "P/B",           value: info.pb_ratio != null ? info.pb_ratio.toFixed(2) : "—" },
        { label: "P/S",           value: info.ps_ratio != null ? info.ps_ratio.toFixed(2) : "—" },
        { label: "PEG Ratio",     value: info.peg_ratio != null ? info.peg_ratio.toFixed(2) : "—" },
        { label: "EV/EBITDA",     value: info.ev_ebitda != null ? info.ev_ebitda.toFixed(2) : "—" },
      ],
    },
    {
      title: "Financials",
      icon: <BarChart2 size={13} />,
      rows: [
        { label: "Revenue (TTM)",  value: fmtBig(info.revenue_ttm) },
        { label: "Free Cash Flow", value: fmtBig(info.free_cash_flow) },
        { label: "EPS (TTM)",      value: info.eps_ttm != null ? fmt$(info.eps_ttm) : "—" },
        { label: "EPS (Fwd)",      value: info.eps_forward != null ? fmt$(info.eps_forward) : "—" },
        { label: "Gross Margin",   value: fmtPct(info.gross_margin) },
        { label: "Profit Margin",  value: fmtPct(info.profit_margin) },
        { label: "Oper. Margin",   value: fmtPct(info.operating_margin) },
        { label: "ROE",            value: fmtPct(info.return_on_equity) },
        { label: "ROA",            value: fmtPct(info.return_on_assets) },
        { label: "Debt/Equity",    value: info.debt_to_equity != null ? info.debt_to_equity.toFixed(2) : "—" },
      ],
    },
    {
      title: "Dividends & Risk",
      icon: <Percent size={13} />,
      rows: [
        { label: "Div. Yield",     value: fmtPct(info.dividend_yield) },
        { label: "Div. Rate",      value: info.dividend_rate != null ? fmt$(info.dividend_rate) : "—" },
        { label: "Payout Ratio",   value: fmtPct(info.payout_ratio) },
        { label: "Beta",           value: info.beta != null ? info.beta.toFixed(2) : "—" },
        { label: "Short Ratio",    value: info.short_ratio != null ? info.short_ratio.toFixed(2) : "—" },
        { label: "Short % Float",  value: fmtPct(info.short_pct_float) },
      ],
    },
    {
      title: "Trading Data",
      icon: <Activity size={13} />,
      rows: [
        { label: "Avg Volume",     value: fmtVol(info.avg_volume) },
        { label: "Avg Vol 10D",    value: fmtVol(info.avg_volume_10d) },
        { label: "Shares Out.",    value: fmtVol(info.shares_outstanding) },
        { label: "Float",          value: fmtVol(info.float_shares) },
        { label: "52W High",       value: fmt$(info.week_52_high) },
        { label: "52W Low",        value: fmt$(info.week_52_low) },
        { label: "50D MA",         value: fmt$(info.fifty_day_avg) },
        { label: "200D MA",        value: fmt$(info.two_hundred_day_avg) },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      {/* company description */}
      {info.description && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <SectionHeader icon={<Package size={13} />} title="About" sub={info.sector && info.industry ? `${info.sector} · ${info.industry}` : undefined} />
          <p className="text-sm text-foreground leading-relaxed line-clamp-5">{info.description}</p>
          <div className="flex flex-wrap gap-4 mt-4 text-xs text-foreground/70">
            {info.country    && <span className="flex items-center gap-1"><Globe size={11} /> {info.country}</span>}
            {info.employees  && <span className="flex items-center gap-1"><Users size={11} /> {fmtNum(info.employees)} employees</span>}
            {info.website    && (
              <a href={info.website} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-foreground/70 hover:text-foreground hover:underline">
                <ExternalLink size={11} /> Website
              </a>
            )}
          </div>
        </div>
      )}

      {/* 52-week range visualiser */}
      {info.week_52_high != null && info.week_52_low != null && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <SectionHeader icon={<TrendingUp size={13} />} title="52-Week Range" />
          {(() => {
            const lo = info.week_52_low!;
            const hi = info.week_52_high!;
            const range = hi - lo || 1;
            const spotPct = info.day_high != null ? Math.min(100, Math.max(0, ((info.day_high - lo) / range) * 100)) : null;
            const ma50Pct  = info.fifty_day_avg != null ? Math.min(100, Math.max(0, ((info.fifty_day_avg - lo) / range) * 100)) : null;
            const ma200Pct = info.two_hundred_day_avg != null ? Math.min(100, Math.max(0, ((info.two_hundred_day_avg - lo) / range) * 100)) : null;
            return (
              <div>
                <div className="relative h-4 mt-2 mb-4">
                  <div className="absolute top-1/2 left-0 right-0 h-2 -translate-y-1/2 rounded-full bg-[var(--surface-2)]" />
                  <div className="absolute top-1/2 left-0 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-red-400 via-yellow-400 to-emerald-500"
                    style={{ width: spotPct != null ? `${spotPct}%` : "50%" }} />
                  {ma50Pct  != null && <div className="absolute top-0 w-0.5 h-4 bg-blue-400 rounded" style={{ left: `${ma50Pct}%` }} title="50D MA" />}
                  {ma200Pct != null && <div className="absolute top-0 w-0.5 h-4 bg-orange-400 rounded" style={{ left: `${ma200Pct}%` }} title="200D MA" />}
                </div>
                <div className="flex justify-between text-[10px] text-foreground/70">
                  <span>{fmt$(lo)} <span className="text-red-400 font-bold">52W Low</span></span>
                  <div className="flex gap-3">
                    <span className="text-blue-400">── 50D MA</span>
                    <span className="text-orange-400">── 200D MA</span>
                  </div>
                  <span><span className="text-emerald-500 font-bold">52W High</span> {fmt$(hi)}</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* fundamental stat grids */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {sections.map((sec) => (
          <div key={sec.title} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
            <SectionHeader icon={sec.icon} title={sec.title} />
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {sec.rows.filter((r) => r.value !== "—").map((r) => (
                <div key={r.label} className="flex flex-col">
                  <span className="text-[9px] text-foreground/70 uppercase tracking-wide font-semibold">{r.label}</span>
                  <span className="text-sm font-bold text-foreground tabular-nums">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── quick links bar ──────────────────────────────────────────────────────────

function QuickLinks({ symbol }: { symbol: string }) {
  const links = [
    { label: "TradingView Chart", url: `https://www.tradingview.com/chart/?symbol=${symbol}` },
    { label: "Options Chain",     url: `https://finance.yahoo.com/quote/${symbol}/options/` },
    { label: "Yahoo Finance",     url: `https://finance.yahoo.com/quote/${symbol}/` },
    { label: "Finviz",            url: `https://finviz.com/quote.ashx?t=${symbol}` },
    { label: "SEC Filings",       url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${symbol}&type=10-K` },
    { label: "News",              url: `https://finance.yahoo.com/quote/${symbol}/news/` },
  ];

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <SectionHeader icon={<ExternalLink size={13} />} title="Quick Links" sub="External research resources" />
      <div className="flex flex-wrap gap-2">
        {links.map((lk) => (
          <a
            key={lk.label}
            href={lk.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-xs font-semibold text-foreground hover:border-[var(--foreground)]/40 hover:text-foreground transition"
          >
            {lk.label} <ChevronRight size={11} className="opacity-50" />
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ symbol, info, gex }: { symbol: string; info?: StockInfo; gex?: GexResult }) {
  const price = info ? undefined : gex?.spot;

  // live quote
  const { data: history } = useQuery({
    queryKey: ["stockHistory", symbol, "1d", "5m"],
    queryFn: () => fetchStockHistory(symbol, "1d", "5m"),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const bars   = history?.bars ?? [];
  const last   = bars[bars.length - 1];
  const first  = bars[0];
  const livePrice = last?.close ?? gex?.spot;
  const change    = (last && first) ? last.close - first.close : null;
  const changePct = (change != null && first?.close) ? (change / first.close) * 100 : null;
  const up        = (change ?? 0) >= 0;

  return (
    <div className="space-y-5">
      {/* hero stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <StatCard
          icon={<DollarSign size={11} />}
          label="Price"
          value={fmt$(livePrice)}
          sub={changePct != null ? `${up ? "▲" : "▼"} ${Math.abs(changePct).toFixed(2)}% today` : undefined}
          color={up ? "text-emerald-500" : "text-red-500"}
        />
        {gex && (
          <>
            <StatCard icon={<Target size={11} />} label="Call Wall"  value={fmt$(gex.max_call_wall)} color="text-emerald-500" />
            <StatCard icon={<Target size={11} />} label="Put Wall"   value={fmt$(gex.max_put_wall)}  color="text-red-400" />
            <StatCard icon={<Zap size={11} />}    label="Zero Gamma" value={fmt$(gex.zero_gamma)}    color="text-yellow-500" />
            <StatCard
              icon={<BarChart2 size={11} />} label="Net GEX"
              value={gex.net_gex != null ? `${(gex.net_gex / 1e9).toFixed(2)}B` : "—"}
              color={(gex.net_gex ?? 0) >= 0 ? "text-emerald-500" : "text-red-400"}
              sub={(gex.net_gex ?? 0) >= 0 ? "Long γ" : "Short γ"}
            />
            <StatCard
              icon={<Activity size={11} />} label="P/C Ratio"
              value={gex.call_premium > 0 ? (gex.put_premium / gex.call_premium).toFixed(2) : "—"}
              color={(gex.put_premium / Math.max(gex.call_premium, 1)) > 1 ? "text-red-400" : "text-emerald-500"}
            />
          </>
        )}
        {info && (
          <>
            {gex == null && <StatCard icon={<Package size={11} />} label="Market Cap" value={fmtBig(info.market_cap)} />}
            <StatCard icon={<Shield size={11} />} label="Beta" value={info.beta != null ? info.beta.toFixed(2) : "—"} />
            <StatCard icon={<BarChart2 size={11} />} label="P/E (TTM)" value={info.pe_ratio != null ? info.pe_ratio.toFixed(1) : "—"} />
          </>
        )}
      </div>

      {/* earnings date banner */}
      {info?.earnings_date && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5">
          <Calendar size={13} className="text-amber-400 shrink-0" />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wide">Next Earnings</span>
            <span className="text-sm font-black text-foreground tabular-nums">
              {new Date(info.earnings_date * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <span className="text-[10px] text-foreground/50">
              {(() => {
                const days = Math.round((info.earnings_date * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
                if (days < 0) return "passed";
                if (days === 0) return "today";
                if (days === 1) return "tomorrow";
                return `in ${days} days`;
              })()}
            </span>
          </div>
        </div>
      )}

      {/* mini chart */}
      {bars.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-widest font-bold text-foreground/70">Today&apos;s Price Action</span>
            {livePrice != null && (
              <span className={`text-sm font-black tabular-nums ${up ? "text-emerald-500" : "text-red-500"}`}>
                {fmt$(livePrice)}
                {changePct != null && <span className="text-[11px] ml-1">({up ? "▲" : "▼"}{Math.abs(changePct).toFixed(2)}%)</span>}
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={bars} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="miniGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={up ? "#22c55e" : "#ef4444"} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={up ? "#22c55e" : "#ef4444"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={["auto", "auto"]} hide />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => [fmt$(Number(v)), "Price"]}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 10 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                labelFormatter={(v: any) => String(v).slice(11, 16)}
              />
              <Area type="monotone" dataKey="close" stroke={up ? "#22c55e" : "#ef4444"} strokeWidth={1.5} fill="url(#miniGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* key levels + gex */}
      {gex && (
        <>
          <KeyLevelsRuler gex={gex} />
          <GexProfileChart gex={gex} accentColor="var(--foreground)" />
          <IVDistributionChart gex={gex} />
          <FlowMomentumChart symbol={symbol} />
          <DealerNarrative gex={gex} />
          {gex.top_flow_strikes?.length > 0 && <TopStrikesActivity gex={gex} />}
          <FlowByExpiryChart gex={gex} />
        </>
      )}

      <QuickLinks symbol={symbol} />
    </div>
  );
}

// ─── options flow tab ─────────────────────────────────────────────────────────

function OptionsFlowTab({ symbol }: { symbol: string }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col items-center gap-4">
      <div className="w-12 h-12 rounded-2xl bg-[var(--surface-2)] flex items-center justify-center">
        <Activity size={24} className="text-foreground/70" />
      </div>
      <div className="text-center">
        <h3 className="text-base font-bold text-foreground mb-1">Full Options Flow</h3>
        <p className="text-sm text-foreground/70 max-w-md">
          View the complete GEX strike table, net flow panel, and live heatmap for <strong>{symbol}</strong> on the dedicated Options Flow page.
        </p>
      </div>
      <a
        href={`/options-flow?ticker=${symbol}`}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--foreground)] text-[var(--background)] text-sm font-bold hover:opacity-90 transition"
      >
        Open Options Flow <ChevronRight size={14} />
      </a>
    </div>
  );
}

// ─── main ticker detail component ────────────────────────────────────────────

function TickerDetail({ symbol }: { symbol: string }) {
  const [tab, setTab] = useState<Tab>("Overview");

  const { data: info, isLoading: infoLoading } = useQuery<StockInfo>({
    queryKey: ["stockInfo", symbol],
    queryFn:  () => fetchStockInfo(symbol),
    staleTime: 300_000,
    retry: false,
  });

  const { data: gex, isLoading: gexLoading, isFetching: gexFetching } = useQuery<GexResult>({
    queryKey: ["gex", symbol],
    queryFn:  () => fetchGex(symbol),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const isLoading = infoLoading && gexLoading;

  // Price from GEX or info
  const spot  = gex?.spot ?? info?.week_52_high;

  // live quote
  const { data: history } = useQuery({
    queryKey: ["stockHistory", symbol, "1d", "5m"],
    queryFn:  () => fetchStockHistory(symbol, "1d", "5m"),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const bars       = history?.bars ?? [];
  const livePrice  = bars[bars.length - 1]?.close ?? gex?.spot;
  const firstClose = bars[0]?.close;
  const change     = (livePrice != null && firstClose != null) ? livePrice - firstClose : null;
  const changePct  = (change != null && firstClose) ? (change / firstClose) * 100 : null;
  const up         = (change ?? 0) >= 0;

  if (isLoading) {
    return (
      <div className="space-y-4 mt-4">
        <div className="h-24 rounded-2xl bg-[var(--surface-2)] animate-pulse" />
        <div className="h-64 rounded-2xl bg-[var(--surface-2)] animate-pulse" />
        <div className="h-40 rounded-2xl bg-[var(--surface-2)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-5">
      {/* ticker hero header */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-3xl font-black text-foreground">{symbol}</h2>
              {info?.name && <span className="text-base text-foreground/70 font-medium">{info.name}</span>}
              {info?.quote_type && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-foreground/70 border border-[var(--border)]">
                  {info.quote_type}
                </span>
              )}
              {gex && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  (gex.net_gex ?? 0) >= 0
                    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-500"
                    : "bg-red-500/10 border-red-500/25 text-red-400"
                }`}>
                  <Shield size={8} className="inline mr-0.5 -mt-0.5" />
                  {(gex.net_gex ?? 0) >= 0 ? "Long γ" : "Short γ"}
                </span>
              )}
              {gexFetching && <RefreshCw size={11} className="text-foreground/70 animate-spin" />}
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {info?.sector   && <span className="text-xs text-foreground/70">{info.sector}</span>}
              {info?.industry && <span className="text-xs text-foreground/70">· {info.industry}</span>}
              {info?.exchange && <span className="text-xs text-foreground/70">· {info.exchange}</span>}
            </div>
          </div>
          <div className="text-right">
            <p className={`text-4xl font-black tabular-nums leading-none ${up ? "text-emerald-500" : "text-red-500"}`}>
              {fmt$(livePrice)}
            </p>
            {change != null && changePct != null && (
              <div className={`flex items-center justify-end gap-1 mt-1 text-sm font-bold ${up ? "text-emerald-500" : "text-red-500"}`}>
                {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {up ? "+" : ""}{fmt$(change, 2)} ({Math.abs(changePct).toFixed(2)}%)
                <span className="text-xs font-normal text-foreground/70 ml-1">today</span>
              </div>
            )}
            {info?.market_cap && (
              <p className="text-xs text-foreground/70 mt-1">Mkt Cap: {fmtBig(info.market_cap)}</p>
            )}
          </div>
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition ${
              t === tab
                ? "bg-[var(--foreground)] text-[var(--background)] shadow-sm"
                : "bg-[var(--surface)] border border-[var(--border)] text-foreground/70 hover:text-foreground"
            }`}
          >{t}</button>
        ))}
      </div>

      {/* tab content */}
      {tab === "Overview"     && <OverviewTab symbol={symbol} info={info} gex={gex} />}
      {tab === "Price Chart"  && (
        <PriceChartPanel
          symbol={symbol}
          earningsDate={info?.earnings_date ?? null}
          gexLevels={gex ? {
            callWall:  gex.max_call_wall  ?? undefined,
            putWall:   gex.max_put_wall   ?? undefined,
            zeroGamma: gex.zero_gamma     ?? undefined,
          } : undefined}
        />
      )}
      {tab === "Options Flow" && <OptionsFlowTab symbol={symbol} />}
      {tab === "Fundamentals" && (info ? <FundamentalsPanel info={info} /> : (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 text-center text-foreground/70">
          <AlertCircle size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Fundamental data not available for {symbol}</p>
        </div>
      ))}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [symbol, setSymbol] = useState<string | null>(
    searchParams.get("q")?.trim().toUpperCase() || null
  );
  const [inputVal, setInputVal] = useState(searchParams.get("q")?.trim().toUpperCase() || "");

  // handle ?q= deep link on mount
  useEffect(() => {
    const q = searchParams.get("q")?.trim().toUpperCase();
    if (q) { setSymbol(q); setInputVal(q); }
  }, [searchParams]);

  const handleSelect = (sym: string) => {
    const s = sym.trim().toUpperCase();
    router.push(`/stocks/${s}`);
  };

  return (
    <div className="min-h-screen bg-[var(--background)] w-full overflow-x-hidden">
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)] backdrop-blur">
        <div className="w-full px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-[var(--surface-2)] border border-[var(--border)]">
                <TrendingUp size={14} className="text-foreground/70" />
              </div>
              <span className="font-bold text-sm text-foreground hidden sm:block">Ticker Research</span>
            </div>
            <div className="flex-1 max-w-xl">
              <TickerSearchInput
                value={inputVal}
                onChange={setInputVal}
                onSelect={handleSelect}
                placeholder="Search ticker or company name…"
              />
            </div>
            {symbol && (
              <a
                href={`/options-flow?ticker=${symbol}`}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-xs font-bold text-foreground hover:border-[var(--foreground)]/40 transition shrink-0"
              >
                <Activity size={12} />
                Options Flow
              </a>
            )}
          </div>
        </div>
      </div>

      {/* body */}
      <div className="w-full px-4 sm:px-6 py-5">
        {!symbol ? (
          <div className="flex flex-col items-center justify-center gap-4 pt-24 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-[var(--surface-2)] border border-[var(--border)]">
              <TrendingUp size={28} className="text-foreground/50" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Ticker Research</h2>
            <p className="text-sm text-foreground/70 max-w-md">
              Search any US stock, ETF, or index — get price charts, GEX analysis,
              options flow, fundamentals, key levels, and dealer positioning in one place.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {["SPY", "QQQ", "AAPL", "TSLA", "NVDA", "META", "AMZN", "MSFT"].map((s) => (
                <button
                  key={s}
                  onClick={() => router.push(`/stocks/${s}`)}
                  className="px-3 py-1.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-sm font-bold text-foreground hover:border-[var(--foreground)]/40 hover:text-foreground transition"
                >{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <TickerDetail symbol={symbol} />
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <RefreshCw size={24} className="text-foreground/40 animate-spin" />
      </div>
    }>
      <SearchContent />
    </Suspense>
  );
}
