"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGex, GexResult } from "@/lib/api";
import GexStrikeTable from "@/components/gex/GexStrikeTable";
import { fmtGex as fmtGexUtil } from "@/lib/gex";
import { Search, TrendingUp } from "lucide-react";
import { PageHeader, SkeletonStatGrid, ErrorBanner } from "@/components/ui";

const STRIKE_OPTIONS = [10, 20, 30, 40, 50] as const;

export default function OptionsFlowPage() {
  const [ticker, setTicker]       = useState("SPY");
  const [input, setInput]         = useState("SPY");
  const [nStrikes, setNStrikes]   = useState<number>(20);
  const [expiryFilter, setExpiry] = useState<string[] | null>(null);

  const { data, isLoading, isError } = useQuery<GexResult>({
    queryKey: ["gex", ticker],
    queryFn:  () => fetchGex(ticker),
    staleTime: 30_000,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim().toUpperCase();
    if (t) { setTicker(t); setExpiry(null); }
  };

  const expiryDates: string[] = data
    ? Array.from(new Set(data.heatmap_expiries ?? [])).sort()
    : [];

  const summaryItems = data ? [
    { label: "Net GEX",     value: fmtGexUtil(data.net_gex),           pos: (data.net_gex ?? 0) >= 0 },
    { label: "Zero Gamma",  value: data.zero_gamma  != null ? `$${data.zero_gamma.toFixed(2)}`  : "—", pos: null },
    { label: "Spot",        value: data.spot        != null ? `$${data.spot.toFixed(2)}`        : "—", pos: null },
    { label: "Call Wall",   value: data.max_call_wall != null ? `$${data.max_call_wall.toFixed(2)}` : "—", pos: true  },
    { label: "Put Wall",    value: data.max_put_wall  != null ? `$${data.max_put_wall.toFixed(2)}`  : "—", pos: false },
    { label: "Max GEX",     value: data.max_gex_strike != null ? `$${data.max_gex_strike.toFixed(2)}` : "—", pos: true },
  ] : [];

  const toggleExpiry = (d: string) => {
    setExpiry((prev) => {
      if (!prev) return [d];
      const has = prev.includes(d);
      const next = has ? prev.filter((x) => x !== d) : [...prev, d];
      return next.length === 0 ? null : next;
    });
  };

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader title="Options Flow" sub={`GEX analysis — ${ticker}`} />

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Ticker search — pill style */}
        <form onSubmit={handleSearch} className="flex flex-1 items-center gap-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm focus-within:ring-2 focus-within:ring-purple-500 focus-within:border-purple-500 transition">
          <span className="pl-4 pr-2 text-gray-400 shrink-0">
            <Search size={15} />
          </span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="SPY, QQQ, AAPL…"
            className="flex-1 py-2.5 text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
          />
          <button
            type="submit"
            className="m-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white text-xs font-bold tracking-wide transition flex items-center gap-1.5 shrink-0"
          >
            <TrendingUp size={13} />
            Load
          </button>
        </form>

        {/* Strikes — segmented pill group */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide shrink-0">Strikes</span>
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl p-0.5 gap-0.5">
            {STRIKE_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setNStrikes(n)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  nStrikes === n
                    ? "bg-white dark:bg-gray-700 text-purple-700 dark:text-purple-300 shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* States */}
      {isLoading && <SkeletonStatGrid count={6} />}
      {isError && (
        <ErrorBanner message={`Failed to load GEX data. Make sure the backend is running and ${ticker} is a valid symbol.`} />
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {summaryItems.map(({ label, value, pos }) => (
              <div key={label} className="card-hover bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-3.5">
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className={`text-lg font-black ${
                  pos === null
                    ? "text-gray-900 dark:text-white"
                    : pos
                      ? "text-green-500"
                      : "text-red-500"
                }`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Expiry filter chips */}
          {expiryDates.length > 1 && (
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-2">Filter by expiry</p>
              <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setExpiry(null)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition shrink-0 ${
                    expiryFilter === null
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}>
                  All
                </button>
                {expiryDates.map((d) => (
                  <button
                    key={d}
                    onClick={() => toggleExpiry(d)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition shrink-0 ${
                      expiryFilter?.includes(d)
                        ? "bg-purple-600 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Strike table */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Strike-Level GEX — {ticker}</h2>
            </div>
            <div className="overflow-x-auto">
              <GexStrikeTable data={data} nStrikes={nStrikes} expiryFilter={expiryFilter} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
