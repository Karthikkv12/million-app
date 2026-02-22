"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { api } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuoteBar {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

interface StockHistory {
  symbol: string;
  name?: string;
  bars: QuoteBar[];
  current_price?: number;
  error?: string;
}

// ── Backend fetch ─────────────────────────────────────────────────────────────

const fetchHistory = (sym: string) =>
  api.get<StockHistory>(`/stocks/${sym.toUpperCase()}/history?period=6mo`);

// ── Tiny price chart ──────────────────────────────────────────────────────────

function PriceChart({ bars }: { bars: QuoteBar[] }) {
  if (!bars.length) return null;
  const first = bars[0].close;
  const last = bars[bars.length - 1].close;
  const up = last >= first;
  const color = up ? "#22c55e" : "#ef4444";

  const fmt = (v: number) =>
    `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={bars} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb22" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#9ca3af" }}
          tickLine={false}
          interval={Math.floor(bars.length / 6)}
          tickFormatter={(d: string) => d.slice(5)} // MM-DD
        />
        <YAxis
          domain={["auto", "auto"]}
          tick={{ fontSize: 10, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={fmt}
        />
        <Tooltip
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any) => [fmt(Number(v)), "Close"]}
          contentStyle={{ background: "#1f2937", border: "none", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#9ca3af", fontSize: 11 }}
        />
        <Line
          type="monotone"
          dataKey="close"
          dot={false}
          stroke={color}
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Order form ────────────────────────────────────────────────────────────────

const ACTIONS   = ["BUY", "SELL"] as const;
const STRATEGIES = ["Day Trade", "Swing Trade", "Buy & Hold"] as const;
const INSTRUMENTS = ["STOCK", "OPTION", "ETF", "CRYPTO"] as const;

function OrderForm({ symbol, onDone }: { symbol: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [action, setAction]       = useState<string>("BUY");
  const [qty, setQty]             = useState("1");
  const [limit, setLimit]         = useState("");
  const [strategy, setStrategy]   = useState<string>("Swing Trade");
  const [instrument, setInstrument] = useState<string>("STOCK");
  const [err, setErr]             = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api.post("/orders", {
        symbol,
        action,
        quantity: parseInt(qty, 10),
        limit_price: limit ? parseFloat(limit) : null,
        strategy,
        instrument,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      onDone();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mt-4">
      <h3 className="font-bold text-gray-900 dark:text-white mb-3 text-sm">Place Order — {symbol}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Side</label>
          <select value={action} onChange={(e) => setAction(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            {ACTIONS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Qty</label>
          <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Limit Price (opt.)</label>
          <input type="number" step="0.01" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Market"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Instrument</label>
          <select value={instrument} onChange={(e) => setInstrument(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            {INSTRUMENTS.map((i) => <option key={i}>{i}</option>)}
          </select>
        </div>
      </div>
      <div className="mb-3">
        <label className="text-xs text-gray-400 block mb-1">Strategy</label>
        <select value={strategy} onChange={(e) => setStrategy(e.target.value)}
          className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
          {STRATEGIES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
      <div className="flex gap-2">
        <button onClick={() => mut.mutate()} disabled={mut.isPending || !qty}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
          {mut.isPending ? "Submitting…" : "Submit Order"}
        </button>
        <button onClick={onDone} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Stock detail pane ─────────────────────────────────────────────────────────

function StockDetail({ symbol }: { symbol: string }) {
  const [showOrder, setShowOrder] = useState(false);
  const { data, isLoading, isError } = useQuery<StockHistory>({
    queryKey: ["history", symbol],
    queryFn: () => fetchHistory(symbol),
    staleTime: 60_000,
    retry: false,
  });

  if (isLoading) return <p className="text-sm text-gray-400 mt-6">Loading {symbol}…</p>;

  if (isError || !data) {
    return (
      <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-800 dark:text-yellow-200">
        Market data for <strong>{symbol}</strong> is not available via the backend.<br />
        You can still place orders manually from the <a href="/orders" className="underline">Orders</a> page.
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
        {data.error}
      </div>
    );
  }

  const last = data.bars.length ? data.bars[data.bars.length - 1].close : null;
  const prev = data.bars.length > 1 ? data.bars[data.bars.length - 2].close : null;
  const change = last && prev ? last - prev : null;
  const changePct = change && prev ? (change / prev) * 100 : null;
  const up = (change ?? 0) >= 0;

  return (
    <div className="mt-4">
      <div className="flex items-end gap-4 mb-4">
        <div>
          <div className="text-3xl font-black text-gray-900 dark:text-white">
            {last != null ? `$${last.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}
          </div>
          {change != null && changePct != null && (
            <div className={`text-sm font-semibold ${up ? "text-green-500" : "text-red-500"}`}>
              {up ? "▲" : "▼"} ${Math.abs(change).toFixed(2)} ({changePct.toFixed(2)}%)
            </div>
          )}
        </div>
        <div className="ml-auto">
          <button onClick={() => setShowOrder((v) => !v)}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition">
            {showOrder ? "Cancel" : "Trade"}
          </button>
        </div>
      </div>

      <PriceChart bars={data.bars} />

      {showOrder && (
        <OrderForm symbol={symbol} onDone={() => setShowOrder(false)} />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SearchPage() {
  const [query, setQuery]     = useState("");
  const [chosen, setChosen]   = useState<string | null>(null);

  const trimmed = query.trim().toUpperCase();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (trimmed) setChosen(trimmed);
  };

  return (
    <div className="p-4 max-w-screen-md mx-auto">
      <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-4">Search</h1>

      <form onSubmit={handleSearch} className="flex gap-2 mb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ticker — e.g. AAPL, SPY, TSLA"
          className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" disabled={!trimmed}
          className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
          View
        </button>
      </form>

      {chosen && (
        <>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mt-2">{chosen}</h2>
          <StockDetail symbol={chosen} />
        </>
      )}
    </div>
  );
}
