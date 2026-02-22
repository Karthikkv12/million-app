"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchOrders, Order, api } from "@/lib/api";
import { clsx } from "clsx";
import { Plus, X } from "lucide-react";

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
  const [sym, setSym]         = useState("");
  const [action, setAction]   = useState("BUY");
  const [qty, setQty]         = useState("1");
  const [limitPx, setLimitPx] = useState("");
  const [strat, setStrat]     = useState("Swing Trade");
  const [err, setErr]         = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api.post("/orders", {
        symbol: sym.toUpperCase(), instrument: "STOCK", action, strategy: strat,
        qty: parseInt(qty), limit_price: limitPx ? parseFloat(limitPx) : null,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 dark:text-white">New Order</h3>
        <button onClick={onDone} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition">
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        {[
          { label: "Symbol",   content: <input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="SPY" className="input" /> },
          { label: "Action",   content: <select value={action} onChange={(e) => setAction(e.target.value)} className="input"><option>BUY</option><option>SELL</option></select> },
          { label: "Strategy", content: <select value={strat} onChange={(e) => setStrat(e.target.value)} className="input"><option>Day Trade</option><option>Swing Trade</option><option>Buy &amp; Hold</option></select> },
          { label: "Quantity", content: <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className="input" /> },
          { label: "Limit Price (opt.)", content: <input type="number" step="0.01" value={limitPx} onChange={(e) => setLimitPx(e.target.value)} placeholder="market" className="input" /> },
        ].map(({ label, content }) => (
          <div key={label}>
            <label className="text-xs text-gray-400 block mb-1">{label}</label>
            {content}
          </div>
        ))}
      </div>
      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      <button onClick={() => mut.mutate()} disabled={mut.isPending || !sym}
        className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
        {mut.isPending ? "Placing…" : "Place Order"}
      </button>

      {/* Tailwind: define .input utility inline */}
      <style>{`.input { width: 100%; border: 1px solid #e5e7eb; border-radius: 0.75rem; padding: 0.5rem 0.75rem; font-size: 0.875rem; background: white; color: #111827; outline: none; } .input:focus { box-shadow: 0 0 0 2px #3b82f6; } @media (prefers-color-scheme: dark) { .input { background: #1f2937; border-color: #374151; color: #f9fafb; } }`}</style>
    </div>
  );
}

// ── Fill modal (bottom-sheet on mobile) ───────────────────────────────────────
function FillModal({ order, onDone }: { order: Order; onDone: () => void }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState(order.limit_price?.toFixed(2) ?? "");
  const [err, setErr]     = useState("");

  const mut = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/fill`, { filled_price: parseFloat(price), filled_at: new Date().toISOString() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });
  const cancelMut = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/cancel`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["orders"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-sm shadow-2xl border border-gray-200 dark:border-gray-700">
        <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700 mx-auto mb-5 sm:hidden" />
        <h3 className="font-bold text-gray-900 dark:text-white mb-1 text-base">Order #{order.id} — {order.symbol}</h3>
        <p className="text-xs text-gray-400 mb-4">{order.action} × {order.quantity}</p>
        <label className="block text-xs text-gray-500 mb-1">Fill Price ($)</label>
        <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm mb-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-500" />
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <div className="flex flex-col gap-2">
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className="py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition">
            {mut.isPending ? "Filling…" : "Mark Filled"}
          </button>
          <button onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}
            className="py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 text-sm font-semibold hover:bg-red-100 transition">
            {cancelMut.isPending ? "Cancelling…" : "Cancel Order"}
          </button>
          <button onClick={onDone}
            className="py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Order card (mobile) ───────────────────────────────────────────────────────
function OrderCard({ o, onFill }: { o: Order; onFill: () => void }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-black text-gray-900 dark:text-white">{o.symbol}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              o.action?.toUpperCase() === "BUY"
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
            }`}>{o.action}</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">#{o.id} · {String(o.created_at ?? "").slice(0, 10)}</p>
        </div>
        <Badge status={o.status} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
        <div><p className="text-gray-400">Qty</p><p className="font-semibold text-gray-900 dark:text-white">{o.quantity}</p></div>
        <div><p className="text-gray-400">Limit</p><p className="font-semibold text-gray-900 dark:text-white">{o.limit_price != null ? `$${o.limit_price.toFixed(2)}` : "Market"}</p></div>
        <div><p className="text-gray-400">Fill</p><p className="font-semibold text-gray-900 dark:text-white">{o.filled_price != null ? `$${o.filled_price.toFixed(2)}` : "—"}</p></div>
      </div>
      {o.status?.toUpperCase() === "PENDING" && (
        <button onClick={onFill}
          className="w-full py-1.5 rounded-xl text-xs font-semibold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition">
          Fill / Cancel
        </button>
      )}
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
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      {filling && <FillModal order={filling} onDone={() => setFilling(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">Orders</h1>
        <button onClick={() => setShowNew((v) => !v)}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition",
            showNew
              ? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
              : "bg-blue-600 text-white hover:bg-blue-700"
          )}>
          {showNew ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Order</>}
        </button>
      </div>

      {showNew && <NewOrderForm onDone={() => setShowNew(false)} />}

      {/* Status filter chips */}
      <div className="flex gap-2 flex-wrap mb-5">
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
        <>
          {/* Mobile: cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {[...shown].reverse().map((o) => (
              <OrderCard key={o.id} o={o} onFill={() => setFilling(o)} />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 uppercase tracking-wide">
                  {["ID", "Date", "Symbol", "Action", "Qty", "Limit", "Status", "Filled At", "Fill Price", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...shown].reverse().map((o) => (
                  <tr key={o.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">#{o.id}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{String(o.created_at ?? "").slice(0, 10)}</td>
                    <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{o.symbol}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        o.action?.toUpperCase() === "BUY"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                      }`}>{o.action}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{o.quantity}</td>
                    <td className="px-4 py-3 text-gray-500">{o.limit_price != null ? `$${o.limit_price.toFixed(2)}` : "Market"}</td>
                    <td className="px-4 py-3"><Badge status={o.status} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{o.filled_at ? String(o.filled_at).slice(0, 10) : "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{o.filled_price != null ? `$${o.filled_price.toFixed(2)}` : "—"}</td>
                    <td className="px-4 py-3">
                      {o.status?.toUpperCase() === "PENDING" && (
                        <button onClick={() => setFilling(o)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-semibold hover:bg-blue-100 transition whitespace-nowrap">
                          Fill / Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
