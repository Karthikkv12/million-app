"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGex, GexResult } from "@/lib/api";
import GexStrikeTable from "@/components/gex/GexStrikeTable";
import { fmtGex as fmtGexUtil } from "@/lib/gex";
import { Activity, ChevronDown } from "lucide-react";

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
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <div className="w-8 h-8 rounded-xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
          <Activity size={16} className="text-purple-600 dark:text-purple-400" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">Options Flow</h1>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ticker — e.g. SPY, QQQ"
            className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <button type="submit"
            className="px-4 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition">
            Load
          </button>
        </form>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Strikes</label>
          <div className="relative">
            <select
              value={nStrikes}
              onChange={(e) => setNStrikes(parseInt(e.target.value, 10))}
              className="appearance-none border border-gray-200 dark:border-gray-700 rounded-xl pl-3 pr-8 py-2.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500">
              {STRIKE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* States */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm animate-pulse">
          Loading GEX data for {ticker}…
        </div>
      )}
      {isError && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
          Failed to load GEX data. Make sure the backend is running and {ticker} is a valid symbol.
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {summaryItems.map(({ label, value, pos }) => (
              <div key={label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-3.5">
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
