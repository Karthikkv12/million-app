"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchOrders, Order, api } from "@/lib/api";
import { clsx } from "clsx";

const STATUS_COLOR: Record<string, string> = {
  PENDING:   "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  FILLED:    "bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-400",
  CANCELLED: "bg-gray-100   text-gray-500   dark:bg-gray-800      dark:text-gray-400",
  REJECTED:  "bg-red-100    text-red-600    dark:bg-red-900/30    dark:text-red-400",
};

function Badge({ status }: { status: string }) {
  const s = status?.toUpperCase() ?? "";
  return (
    <span className={clsx("text-[10px] font-bold px-2 py-0.5 rounded-full uppercase", STATUS_COLOR[s] ?? "bg-gray-100 text-gray-500")}>
      {s}
    </span>
  );
}

// ── New Order form ────────────────────────────────────────────────────────────
function NewOrderForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [sym, setSym]       = useState("");
  const [action, setAction] = useState("BUY");
  const [qty, setQty]       = useState("1");
  const [limitPx, setLimitPx] = useState("");
  const [strat, setStrat]   = useState("Swing Trade");
  const [err, setErr]       = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api.post("/orders", {
        symbol:    sym.toUpperCase(),
        instrument: "STOCK",
        action,
        strategy:  strat,
        qty:       parseInt(qty),
        limit_price: limitPx ? parseFloat(limitPx) : null,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 mb-4">
      <h3 className="font-bold text-gray-900 dark:text-white mb-4">New Order</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Symbol</label>
          <input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="SPY"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Action</label>
          <select value={action} onChange={(e) => setAction(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <option>BUY</option><option>SELL</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Strategy</label>
          <select value={strat} onChange={(e) => setStrat(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <option>Day Trade</option><option>Swing Trade</option><option>Buy &amp; Hold</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Quantity</label>
          <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Limit Price (optional)</label>
          <input type="number" step="0.01" value={limitPx} onChange={(e) => setLimitPx(e.target.value)} placeholder="market"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
      </div>
      {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
      <div className="flex gap-2">
        <button onClick={() => mut.mutate()} disabled={mut.isPending || !sym}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
          {mut.isPending ? "Placing…" : "Place Order"}
        </button>
        <button onClick={onDone} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Fill modal ────────────────────────────────────────────────────────────────
function FillModal({ order, onDone }: { order: Order; onDone: () => void }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState(order.limit_price?.toFixed(2) ?? "");
  const [err, setErr]     = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api.post(`/orders/${order.id}/fill`, {
        filled_price: parseFloat(price),
        filled_at: new Date().toISOString(),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/cancel`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-80 shadow-xl border border-gray-200 dark:border-gray-700">
        <h3 className="font-bold text-gray-900 dark:text-white mb-1">
          Order #{order.id} — {order.symbol}
        </h3>
        <p className="text-xs text-gray-400 mb-4">{order.action} × {order.quantity}</p>
        <label className="block text-xs text-gray-500 mb-1">Fill Price ($)</label>
        <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm mb-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <div className="flex flex-col gap-2">
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className="py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition">
            {mut.isPending ? "Filling…" : "Mark Filled"}
          </button>
          <button onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}
            className="py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 text-sm font-semibold hover:bg-red-100 transition">
            {cancelMut.isPending ? "Cancelling…" : "Cancel Order"}
          </button>
          <button onClick={onDone} className="py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const { data: orders = [], isLoading } = useQuery({ queryKey: ["orders"], queryFn: fetchOrders, staleTime: 20_000 });
  const [showNew, setShowNew]   = useState(false);
  const [filling, setFilling]   = useState<Order | null>(null);
  const [filter, setFilter]     = useState<string>("ALL");

  const statuses = ["ALL", ...Array.from(new Set(orders.map((o) => o.status?.toUpperCase()))).sort()];
  const shown = filter === "ALL" ? orders : orders.filter((o) => o.status?.toUpperCase() === filter);

  return (
    <div className="p-4 max-w-screen-xl mx-auto">
      {filling && <FillModal order={filling} onDone={() => setFilling(null)} />}

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">Orders</h1>
        <button onClick={() => setShowNew((v) => !v)}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition">
          {showNew ? "Cancel" : "+ New Order"}
        </button>
      </div>

      {showNew && <NewOrderForm onDone={() => setShowNew(false)} />}

      {/* Status filter chips */}
      <div className="flex gap-2 flex-wrap mb-4">
        {statuses.map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={clsx("px-3 py-1 rounded-full text-xs font-semibold border transition",
              filter === s ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 dark:border-gray-700 text-gray-500 hover:border-blue-400")}>
            {s}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!isLoading && shown.length === 0 && <p className="text-sm text-gray-400">No orders.</p>}

      {shown.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 uppercase tracking-wide">
                {["ID", "Date", "Symbol", "Action", "Qty", "Limit", "Status", "Filled At", "Fill Price", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...shown].reverse().map((o) => (
                <tr key={o.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-gray-400 font-mono text-xs">#{o.id}</td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{String(o.created_at ?? "").slice(0, 10)}</td>
                  <td className="px-3 py-2 font-bold text-gray-900 dark:text-white">{o.symbol}</td>
                  <td className="px-3 py-2 font-semibold" style={{ color: o.action?.toUpperCase() === "BUY" ? "#00cc44" : "#ff4444" }}>{o.action}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{o.quantity}</td>
                  <td className="px-3 py-2 text-gray-500">{o.limit_price != null ? `$${o.limit_price.toFixed(2)}` : "—"}</td>
                  <td className="px-3 py-2"><Badge status={o.status} /></td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{o.filled_at ? String(o.filled_at).slice(0, 10) : "—"}</td>
                  <td className="px-3 py-2 text-gray-500">{o.filled_price != null ? `$${o.filled_price.toFixed(2)}` : "—"}</td>
                  <td className="px-3 py-2">
                    {o.status?.toUpperCase() === "PENDING" && (
                      <button onClick={() => setFilling(o)}
                        className="text-xs px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-semibold hover:bg-blue-100 transition whitespace-nowrap">
                        Fill / Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
