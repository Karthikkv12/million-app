"use client";
import React, { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchGex } from "@/lib/api";
import { fmtGex } from "@/lib/gex";
import GexStrikeTable from "@/components/gex/GexStrikeTable";

const STRIKE_OPTIONS = [10, 20, 30, 40, 50] as const;

export default function OptionsFlowPage() {
  const [tickerInput, setTickerInput] = useState("SPY");
  const [ticker, setTicker] = useState("SPY");
  const [nStrikes, setNStrikes] = useState(20);
  const [selectedExpiries, setSelectedExpiries] = useState<string[]>([]);

  const { data, isFetching, error } = useQuery({
    queryKey: ["gex", ticker],
    queryFn: () => fetchGex(ticker),
    staleTime: 60_000,
    retry: 1,
  });

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const t = tickerInput.trim().toUpperCase();
      if (t) { setTicker(t); setSelectedExpiries([]); }
    },
    [tickerInput],
  );

  const toggleExpiry = (exp: string) => {
    setSelectedExpiries((prev) =>
      prev.includes(exp) ? prev.filter((e) => e !== exp) : [...prev, exp],
    );
  };

  const expiryFilter = selectedExpiries.length ? selectedExpiries : null;

  return (
    <div className="p-4 max-w-screen-xl mx-auto">
      <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100 mb-4">
        Options Flow <span className="text-gray-400 font-normal text-base">(GEX)</span>
      </h1>

      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Ticker search */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            placeholder="Ticker (e.g. SPY)"
            className="border border-gray-300 dark:border-gray-600 rounded px-3 py-1.5 text-sm font-mono bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-sm font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            Load
          </button>
        </form>

        {/* N Strikes */}
        <select
          value={nStrikes}
          onChange={(e) => setNStrikes(Number(e.target.value))}
          className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
        >
          {STRIKE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400">±{Math.floor(nStrikes / 2)} around spot</span>
      </div>

      {/* ── Expiry chips ── */}
      {data?.heatmap_expiries && data.heatmap_expiries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {data.heatmap_expiries.map((exp) => (
            <button
              key={exp}
              onClick={() => toggleExpiry(exp)}
              className={`px-2 py-0.5 text-xs font-semibold rounded-full border transition ${
                selectedExpiries.includes(exp)
                  ? "bg-green-500 text-white border-green-500"
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-green-400"
              }`}
            >
              {exp}
              {selectedExpiries.includes(exp) && (
                <span className="ml-1 text-white/80">×</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Summary cards ── */}
      {data && !data.error && (
        <div className="flex flex-wrap gap-3 mb-4">
          {[
            { label: "Spot", value: `$${data.spot.toFixed(2)}`, color: "#f59e0b" },
            {
              label: "Net GEX",
              value: fmtGex(data.net_gex),
              color: (data.net_gex ?? 0) >= 0 ? "#00cc44" : "#ff4444",
            },
            {
              label: "Regime",
              value: (data.net_gex ?? 0) >= 0 ? "Long γ" : "Short γ",
              color: (data.net_gex ?? 0) >= 0 ? "#00cc44" : "#ff4444",
            },
            {
              label: "Zero γ",
              value: data.zero_gamma ? `$${data.zero_gamma.toFixed(2)}` : "—",
              color: "#6b7280",
            },
            {
              label: "Call Wall",
              value: data.max_call_wall ? `$${data.max_call_wall.toFixed(0)}` : "—",
              color: "#00cc44",
            },
            {
              label: "Put Wall",
              value: data.max_put_wall ? `$${data.max_put_wall.toFixed(0)}` : "—",
              color: "#ff4444",
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="flex flex-col px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 min-w-[90px]"
            >
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                {label}
              </span>
              <span className="text-[15px] font-extrabold mt-0.5" style={{ color }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── State messages ── */}
      {isFetching && (
        <p className="text-sm text-gray-400 mb-3 animate-pulse">Loading {ticker}…</p>
      )}
      {error && (
        <p className="text-sm text-red-500 mb-3">
          Error: {(error as Error).message}
        </p>
      )}
      {data?.error && (
        <p className="text-sm text-red-500 mb-3">API error: {data.error}</p>
      )}

      {/* ── Strike table ── */}
      {data && !data.error && (
        <GexStrikeTable
          data={data}
          nStrikes={nStrikes}
          expiryFilter={expiryFilter}
        />
      )}
    </div>
  );
}
