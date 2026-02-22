"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchTrades, Trade, api } from "@/lib/api";
import { BarChart2, X } from "lucide-react";
import { PageHeader, EmptyState, SkeletonCard, Tabs } from "@/components/ui";

function isOpen(t: Trade) { return t.exit_price == null; }

function calcPnl(t: Trade) {
  if (t.exit_price == null) return null;
  const d = t.action?.toUpperCase() === "SELL" ? t.price - t.exit_price : t.exit_price - t.price;
  return d * t.qty;
}

function CloseModal({ trade, onDone }: { trade: Trade; onDone: () => void }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState(trade.price?.toFixed(2) ?? "");
  const [date, setDate]   = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr]     = useState("");

  const mut = useMutation({
    mutationFn: () => api.post(`/trades/${trade.id}/close`, { exit_price: parseFloat(price), exit_date: date }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trades"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  const inp = "w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--surface)] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-[var(--surface)] rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-sm shadow-2xl border border-[var(--border)]">
        <div className="w-10 h-1 rounded-full bg-[var(--surface-2)] mx-auto mb-5 sm:hidden" />
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white text-lg">Close {trade.symbol}</h3>
            <p className="text-xs text-gray-400">{trade.qty} shares · entry ${trade.price?.toFixed(2)}</p>
          </div>
          <button onClick={onDone} className="p-1.5 rounded-xl text-gray-400 hover:bg-[var(--surface-2)] transition"><X size={16} /></button>
        </div>
        <label className="block text-xs text-gray-500 mb-1">Exit Price ($)</label>
        <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={`${inp} mb-3`} />
        <label className="block text-xs text-gray-500 mb-1">Exit Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inp} mb-4`} />
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
            {mut.isPending ? "Closing…" : "Confirm Close"}
          </button>
          <button onClick={onDone}
            className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-gray-600 dark:text-gray-300 hover:bg-[var(--surface-2)] transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function useDeleteTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/trades/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trades"] }),
  });
}

function TradeCard({ t, onClose, onDelete }: { t: Trade; onClose: () => void; onDelete: () => void }) {
  const pnl = calcPnl(t);
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 transition hover:border-blue-200 dark:hover:border-blue-900/50">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-black text-gray-900 dark:text-white text-base">{t.symbol}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.action?.toUpperCase() === "BUY" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"}`}>{t.action}</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{t.strategy ?? "—"} · {String(t.date ?? "").slice(0, 10)}</p>
        </div>
        <div className={`text-base font-black ${pnl == null ? "" : pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
          {pnl == null
            ? <span className="text-xs px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-full">Open</span>
            : `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`}
        </div>
      </div>
      <div className="flex gap-3 text-xs text-gray-400 mb-3">
        <span>{t.qty} shares</span><span>·</span>
        <span>Entry ${t.price?.toFixed(2)}</span>
        {t.exit_price != null && <><span>·</span><span>Exit ${t.exit_price.toFixed(2)}</span></>}
      </div>
      <div className="flex gap-2">
        {isOpen(t) && (
          <button onClick={onClose}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition">
            Close trade
          </button>
        )}
        <button onClick={onDelete}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 transition">
          Delete
        </button>
      </div>
    </div>
  );
}

export default function TradesPage() {
  const { data: trades = [], isLoading } = useQuery({ queryKey: ["trades"], queryFn: fetchTrades, staleTime: 30_000 });
  const [closing, setClosing] = useState<Trade | null>(null);
  const [tab, setTab]         = useState<"open" | "closed">("open");
  const deleteMut = useDeleteTrade();

  const open   = trades.filter(isOpen);
  const closed = trades.filter((t) => !isOpen(t));
  const shown  = tab === "open" ? open : closed;
  const totalPnl = closed.reduce((s, t) => s + (calcPnl(t) ?? 0), 0);

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      {closing && <CloseModal trade={closing} onDone={() => setClosing(null)} />}

      <PageHeader
        title="Trades"
        sub={closed.length > 0 ? `Realized P/L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}` : undefined}
      />

      {/* Tabs */}
      <div className="mb-5">
        <Tabs
          active={tab}
          onChange={(k) => setTab(k as "open" | "closed")}
          tabs={[
            { key: "open",   label: <span>Open <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300">{open.length}</span></span> },
            { key: "closed", label: <span>Closed <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface-2)] text-gray-500">{closed.length}</span></span> },
          ]}
        />
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1,2,3].map(i => <SkeletonCard key={i} rows={2} />)}
        </div>
      )}
      {!isLoading && shown.length === 0 && (
        <EmptyState icon={BarChart2} title={`No ${tab} trades`}
          body={tab === "open" ? "Open positions will appear here." : "Closed trades and P/L will show here."} />
      )}

      {shown.length > 0 && (
        <>
          {/* Mobile */}
          <div className="flex flex-col gap-3 md:hidden">
            {shown.map((t) => (
              <TradeCard key={t.id} t={t} onClose={() => setClosing(t)} onDelete={() => deleteMut.mutate(t.id)} />
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden md:block bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] text-gray-400 uppercase tracking-wide bg-[var(--surface-2)]">
                  {["Date", "Symbol", "Action", "Strategy", "Qty", "Entry", "Exit", "P/L", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const pnl = calcPnl(t);
                  return (
                    <tr key={t.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{String(t.date ?? "").slice(0, 10)}</td>
                      <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{t.symbol}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.action?.toUpperCase() === "BUY" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"}`}>{t.action}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{t.strategy ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{t.qty}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">${t.price?.toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-400">{t.exit_price != null ? `$${t.exit_price.toFixed(2)}` : "—"}</td>
                      <td className={`px-4 py-3 font-bold ${pnl == null ? "text-gray-400" : pnl >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {isOpen(t) && (
                            <button onClick={() => setClosing(t)}
                              className="text-xs px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-semibold hover:bg-blue-100 transition whitespace-nowrap">
                              Close
                            </button>
                          )}
                          <button onClick={() => deleteMut.mutate(t.id)}
                            className="text-xs px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
