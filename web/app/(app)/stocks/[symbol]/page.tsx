"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area,
  YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  fetchStockInfo, fetchStockHistory,
  StockInfo,
} from "@/lib/api";
import TickerSearchInput from "@/components/TickerSearchInput";
import TradingChart from "@/components/chart/TradingChart";
import {
  TrendingUp, Activity, BarChart2,
  Globe, Users, DollarSign, Shield,
  ExternalLink, AlertCircle, ChevronRight, Calendar,
  Package, Percent,
  ArrowLeft,
} from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────

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

const TABS = ["Overview", "Price Chart", "Fundamentals"] as const;
type Tab = (typeof TABS)[number];

// ─── sub-components ───────────────────────────────────────────────────────────

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

// ─── price chart ─────────────────────────────────────────────────────────────

function PriceChartPanel({
  symbol, earningsDate,
}: {
  symbol: string;
  earningsDate?: number | null;
}) {
  return (
    <TradingChart
      symbol={symbol}
      earningsDate={earningsDate}
      initialPeriod="1D"
    />
  );
}

// ─── fundamentals panel ───────────────────────────────────────────────────────

function FundamentalsPanel({ info }: { info: StockInfo }) {
  const sections: { title: string; icon: React.ReactNode; rows: { label: string; value: string }[] }[] = [
    {
      title: "Valuation",
      icon: <DollarSign size={13} />,
      rows: [
        { label: "Market Cap",     value: fmtBig(info.market_cap) },
        { label: "Enterprise Val", value: fmtBig(info.enterprise_value) },
        { label: "P/E (TTM)",      value: info.pe_ratio != null ? info.pe_ratio.toFixed(2) : "—" },
        { label: "Fwd P/E",        value: info.forward_pe != null ? info.forward_pe.toFixed(2) : "—" },
        { label: "P/B",            value: info.pb_ratio != null ? info.pb_ratio.toFixed(2) : "—" },
        { label: "P/S",            value: info.ps_ratio != null ? info.ps_ratio.toFixed(2) : "—" },
        { label: "PEG Ratio",      value: info.peg_ratio != null ? info.peg_ratio.toFixed(2) : "—" },
        { label: "EV/EBITDA",      value: info.ev_ebitda != null ? info.ev_ebitda.toFixed(2) : "—" },
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
        { label: "Div. Yield",    value: fmtPct(info.dividend_yield) },
        { label: "Div. Rate",     value: info.dividend_rate != null ? fmt$(info.dividend_rate) : "—" },
        { label: "Payout Ratio",  value: fmtPct(info.payout_ratio) },
        { label: "Beta",          value: info.beta != null ? info.beta.toFixed(2) : "—" },
        { label: "Short Ratio",   value: info.short_ratio != null ? info.short_ratio.toFixed(2) : "—" },
        { label: "Short % Float", value: fmtPct(info.short_pct_float) },
      ],
    },
    {
      title: "Trading Data",
      icon: <Activity size={13} />,
      rows: [
        { label: "Avg Volume",   value: fmtVol(info.avg_volume) },
        { label: "Avg Vol 10D",  value: fmtVol(info.avg_volume_10d) },
        { label: "Shares Out.",  value: fmtVol(info.shares_outstanding) },
        { label: "Float",        value: fmtVol(info.float_shares) },
        { label: "52W High",     value: fmt$(info.week_52_high) },
        { label: "52W Low",      value: fmt$(info.week_52_low) },
        { label: "50D MA",       value: fmt$(info.fifty_day_avg) },
        { label: "200D MA",      value: fmt$(info.two_hundred_day_avg) },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      {info.description && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <SectionHeader icon={<Package size={13} />} title="About"
            sub={info.sector && info.industry ? `${info.sector} · ${info.industry}` : undefined} />
          <p className="text-sm text-foreground leading-relaxed line-clamp-5">{info.description}</p>
          <div className="flex flex-wrap gap-4 mt-4 text-xs text-foreground/70">
            {info.country   && <span className="flex items-center gap-1"><Globe size={11} /> {info.country}</span>}
            {info.employees && <span className="flex items-center gap-1"><Users size={11} /> {fmtNum(info.employees)} employees</span>}
            {info.website   && (
              <a href={info.website} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-foreground/70 hover:text-foreground hover:underline">
                <ExternalLink size={11} /> Website
              </a>
            )}
          </div>
        </div>
      )}

      {info.week_52_high != null && info.week_52_low != null && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
          <SectionHeader icon={<TrendingUp size={13} />} title="52-Week Range" />
          {(() => {
            const lo = info.week_52_low!;
            const hi = info.week_52_high!;
            const range = hi - lo || 1;
            const spotPct  = info.day_high != null ? Math.min(100, Math.max(0, ((info.day_high - lo) / range) * 100)) : null;
            const ma50Pct  = info.fifty_day_avg != null ? Math.min(100, Math.max(0, ((info.fifty_day_avg - lo) / range) * 100)) : null;
            const ma200Pct = info.two_hundred_day_avg != null ? Math.min(100, Math.max(0, ((info.two_hundred_day_avg - lo) / range) * 100)) : null;
            return (
              <div>
                <div className="relative h-4 mt-2 mb-4">
                  <div className="absolute top-1/2 left-0 right-0 h-2 -translate-y-1/2 rounded-full bg-[var(--surface-2)]" />
                  <div className="absolute top-1/2 left-0 h-2 -translate-y-1/2 rounded-full bg-gradient-to-r from-red-400 via-yellow-400 to-emerald-500"
                    style={{ width: spotPct != null ? `${spotPct}%` : "50%" }} />
                  {ma50Pct  != null && <div className="absolute top-0 w-0.5 h-4 bg-blue-400 rounded" style={{ left: `${ma50Pct}%` }} />}
                  {ma200Pct != null && <div className="absolute top-0 w-0.5 h-4 bg-orange-400 rounded" style={{ left: `${ma200Pct}%` }} />}
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

// ─── quick links ──────────────────────────────────────────────────────────────

function QuickLinks({ symbol }: { symbol: string }) {
  const links = [
    { label: "TradingView",  url: `https://www.tradingview.com/chart/?symbol=${symbol}` },
    { label: "Yahoo Finance", url: `https://finance.yahoo.com/quote/${symbol}/` },
    { label: "Finviz",       url: `https://finviz.com/quote.ashx?t=${symbol}` },
    { label: "SEC Filings",  url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${symbol}&type=10-K` },
    { label: "News",         url: `https://finance.yahoo.com/quote/${symbol}/news/` },
  ];
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <SectionHeader icon={<ExternalLink size={13} />} title="Quick Links" sub="External research resources" />
      <div className="flex flex-wrap gap-2">
        {links.map((lk) => (
          <a key={lk.label} href={lk.url} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-xs font-semibold text-foreground hover:border-[var(--foreground)]/40 hover:text-foreground transition">
            {lk.label} <ChevronRight size={11} className="opacity-50" />
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ symbol, info }: { symbol: string; info?: StockInfo }) {
  const { data: history } = useQuery({
    queryKey: ["stockHistory", symbol, "1d", "5m"],
    queryFn:  () => fetchStockHistory(symbol, "1d", "5m"),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const bars      = history?.bars ?? [];
  const last      = bars[bars.length - 1];
  const first     = bars[0];
  const livePrice = last?.close;
  const change    = (last && first) ? last.close - first.close : null;
  const changePct = (change != null && first?.close) ? (change / first.close) * 100 : null;
  const up        = (change ?? 0) >= 0;

  return (
    <div className="space-y-5">
      {/* hero stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <StatCard
          icon={<DollarSign size={11} />} label="Price" value={fmt$(livePrice)}
          sub={changePct != null ? `${up ? "▲" : "▼"} ${Math.abs(changePct).toFixed(2)}% today` : undefined}
          color={up ? "text-emerald-500" : "text-red-500"}
        />
        {info && (
          <>
            <StatCard icon={<Package size={11} />}   label="Market Cap" value={fmtBig(info.market_cap)} />
            <StatCard icon={<Shield size={11} />}    label="Beta"       value={info.beta != null ? info.beta.toFixed(2) : "—"} />
            <StatCard icon={<BarChart2 size={11} />} label="P/E (TTM)"  value={info.pe_ratio != null ? info.pe_ratio.toFixed(1) : "—"} />
            <StatCard icon={<Activity size={11} />}  label="Avg Volume" value={fmtVol(info.avg_volume)} />
          </>
        )}
      </div>

      {/* earnings banner */}
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

      {/* today mini chart */}
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

      <QuickLinks symbol={symbol} />
    </div>
  );
}

// ─── ticker detail body ───────────────────────────────────────────────────────

function TickerDetail({ symbol }: { symbol: string }) {
  const [tab, setTab] = useState<Tab>("Overview");

  const { data: info, isLoading } = useQuery<StockInfo>({
    queryKey: ["stockInfo", symbol],
    queryFn:  () => fetchStockInfo(symbol),
    staleTime: 300_000,
    retry: false,
  });

  return (
    <div className="space-y-4">
      {/* stock header */}
      <div className="flex items-start gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black text-foreground">{symbol}</h1>
            {info?.name && (
              <span className="text-base font-semibold text-foreground/70">{info.name}</span>
            )}
          </div>
          {info?.sector && (
            <p className="text-[11px] text-foreground/50 mt-0.5">
              {info.sector}{info.industry ? ` · ${info.industry}` : ""}
              {info.exchange ? ` · ${info.exchange}` : ""}
            </p>
          )}
        </div>
      </div>

      {/* tab bar */}
      <div className="flex gap-1 border-b border-[var(--border)] pb-0">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-bold rounded-t-lg transition border-b-2 ${
              t === tab
                ? "border-[var(--foreground)] text-foreground"
                : "border-transparent text-foreground/50 hover:text-foreground hover:border-[var(--foreground)]/30"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* tab content */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 rounded-2xl bg-[var(--surface)] border border-[var(--border)] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {tab === "Overview"    && <OverviewTab symbol={symbol} info={info} />}
          {tab === "Price Chart" && <PriceChartPanel symbol={symbol} earningsDate={info?.earnings_date ?? null} />}
          {tab === "Fundamentals" && (info ? <FundamentalsPanel info={info} /> : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 text-center text-foreground/70">
              <AlertCircle size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Fundamental data not available for {symbol}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function StockPage({ params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();
  const router = useRouter();
  const [searchVal, setSearchVal] = useState(symbol);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* sticky top bar */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="w-full px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            {/* back button */}
            <button
              onClick={() => router.back()}
              className="p-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-foreground/70 hover:text-foreground hover:border-[var(--foreground)]/30 transition shrink-0"
              aria-label="Go back"
            >
              <ArrowLeft size={14} />
            </button>

            {/* ticker badge */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="px-2.5 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm font-black text-foreground">
                {symbol}
              </span>
            </div>

            {/* search another ticker */}
            <div className="flex-1 max-w-md">
              <TickerSearchInput
                value={searchVal}
                onChange={setSearchVal}
                onSelect={(sym) => {
                  const s = sym.trim().toUpperCase();
                  router.push(`/stocks/${s}`);
                }}
                placeholder="Search another ticker…"
              />
            </div>
          </div>
        </div>
      </div>

      {/* body */}
      <div className="w-full px-4 sm:px-6 py-5">
        <TickerDetail symbol={symbol} />
      </div>
    </div>
  );
}
