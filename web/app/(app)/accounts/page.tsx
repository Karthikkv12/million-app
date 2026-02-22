"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAccounts, fetchCashBalance, Account, api } from "@/lib/api";
import { Plus, X, Wallet } from "lucide-react";

interface Holding {
  id: number; account_id: number; symbol: string;
  quantity: number; avg_cost?: number; updated_at?: string;
}

function useHoldings(accountId: number | null) {
  return useQuery<Holding[]>({
    queryKey: ["holdings", accountId],
    queryFn: () => api.get(`/accounts/${accountId}/holdings`),
    enabled: accountId != null,
    staleTime: 30_000,
  });
}

// ── New Account form ──────────────────────────────────────────────────────────
function NewAccountForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName]         = useState("");
  const [broker, setBroker]     = useState("");
  const [currency, setCurrency] = useState("USD");
  const [err, setErr]           = useState("");

  const mut = useMutation({
    mutationFn: () => api.post("/accounts", { name, broker: broker || null, currency }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 dark:text-white">Add Account</h3>
        <button onClick={onDone} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {[
          { label: "Name", val: name, set: setName, ph: "My Brokerage" },
          { label: "Broker (opt.)", val: broker, set: setBroker, ph: "e.g. Fidelity" },
          { label: "Currency", val: currency, set: setCurrency, ph: "USD" },
        ].map(({ label, val, set, ph }) => (
          <div key={label}>
            <label className="text-xs text-gray-400 block mb-1">{label}</label>
            <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        ))}
      </div>
      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      <button onClick={() => mut.mutate()} disabled={mut.isPending || !name}
        className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
        {mut.isPending ? "Creating…" : "Create Account"}
      </button>
    </div>
  );
}

// ── Upsert Holding form ───────────────────────────────────────────────────────
function UpsertHoldingForm({ accountId, onDone }: { accountId: number; onDone: () => void }) {
  const qc = useQueryClient();
  const [sym, setSym]   = useState("");
  const [qty, setQty]   = useState("0");
  const [cost, setCost] = useState("");
  const [err, setErr]   = useState("");

  const mut = useMutation({
    mutationFn: () => api.put(`/accounts/${accountId}/holdings`, {
      symbol: sym.toUpperCase(), quantity: parseFloat(qty), avg_cost: cost ? parseFloat(cost) : null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["holdings", accountId] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 dark:text-white text-sm">Add / Update Holding</h3>
        <button onClick={onDone} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {[
          { label: "Symbol",     type: "text",   val: sym,  set: (v: string) => setSym(v.toUpperCase()), ph: "AAPL" },
          { label: "Quantity",   type: "number", val: qty,  set: setQty,  ph: "" },
          { label: "Avg Cost (opt.)", type: "number", val: cost, set: setCost, ph: "—" },
        ].map(({ label, type, val, set, ph }) => (
          <div key={label}>
            <label className="text-xs text-gray-400 block mb-1">{label}</label>
            <input type={type} step={type === "number" ? "0.01" : undefined} value={val}
              onChange={(e) => set(e.target.value)} placeholder={ph}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        ))}
      </div>
      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      <button onClick={() => mut.mutate()} disabled={mut.isPending || !sym}
        className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
        {mut.isPending ? "Saving…" : "Save Holding"}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AccountsPage() {
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery<Account[]>({ queryKey: ["accounts"], queryFn: fetchAccounts, staleTime: 30_000 });
  const cashQ = useQuery({ queryKey: ["cash-balance"], queryFn: () => fetchCashBalance(), staleTime: 30_000 });

  const [selected, setSelected]     = useState<number | null>(null);
  const [showNew, setShowNew]       = useState(false);
  const [showHolding, setShowHolding] = useState(false);

  const accountId = selected ?? (accounts[0]?.id ?? null);
  const { data: holdings = [] } = useHoldings(accountId);

  const deleteHolding = useMutation({
    mutationFn: (id: number) => api.del(`/holdings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holdings", accountId] }),
  });

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white">Accounts</h1>
          {cashQ.data && (
            <p className="text-sm text-gray-400 mt-0.5">
              Cash balance: <span className="font-bold text-gray-900 dark:text-white">
                ${cashQ.data.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </p>
          )}
        </div>
        <button onClick={() => setShowNew((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
            showNew ? "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}>
          {showNew ? <><X size={14} /> Cancel</> : <><Plus size={14} /> New Account</>}
        </button>
      </div>

      {showNew && <NewAccountForm onDone={() => setShowNew(false)} />}
      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {/* Account selector chips */}
      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {accounts.map((a) => (
            <button key={a.id} onClick={() => setSelected(a.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition ${
                a.id === accountId
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                  : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:border-blue-300"
              }`}>
              <Wallet size={14} />
              {a.name}
              <span className="text-[10px] text-gray-400">{a.currency}</span>
            </button>
          ))}
        </div>
      )}

      {/* Holdings */}
      {accountId && (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              Holdings — {accounts.find((a) => a.id === accountId)?.name ?? `Account ${accountId}`}
            </h2>
            <button onClick={() => setShowHolding((v) => !v)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
              {showHolding ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Add Holding</>}
            </button>
          </div>

          {holdings.length === 0 && !showHolding && (
            <p className="text-sm text-gray-400">No holdings in this account.</p>
          )}

          {holdings.length > 0 && (
            <>
              {/* Mobile: cards */}
              <div className="flex flex-col gap-3 md:hidden mb-4">
                {holdings.map((h) => (
                  <div key={h.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <p className="font-black text-gray-900 dark:text-white">{h.symbol}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{h.quantity} shares · avg {h.avg_cost != null ? `$${h.avg_cost.toFixed(2)}` : "—"}</p>
                      <p className="text-[10px] text-gray-400">{String(h.updated_at ?? "").slice(0, 10)}</p>
                    </div>
                    <button onClick={() => deleteHolding.mutate(h.id)}
                      className="text-xs px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition">
                      Delete
                    </button>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 uppercase tracking-wide">
                      {["Symbol", "Quantity", "Avg Cost", "Updated", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h) => (
                      <tr key={h.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{h.symbol}</td>
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{h.quantity}</td>
                        <td className="px-4 py-3 text-gray-500">{h.avg_cost != null ? `$${h.avg_cost.toFixed(2)}` : "—"}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{String(h.updated_at ?? "").slice(0, 10)}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => deleteHolding.mutate(h.id)}
                            className="text-xs px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition">
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {showHolding && <UpsertHoldingForm accountId={accountId} onDone={() => setShowHolding(false)} />}
        </>
      )}
    </div>
  );
}
