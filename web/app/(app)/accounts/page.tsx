"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAccounts, fetchCashBalance, Account, api } from "@/lib/api";

interface Holding {
  id: number;
  account_id: number;
  symbol: string;
  quantity: number;
  avg_cost?: number;
  updated_at?: string;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useHoldings(accountId: number | null) {
  return useQuery<Holding[]>({
    queryKey: ["holdings", accountId],
    queryFn: () => api.get(`/accounts/${accountId}/holdings`),
    enabled: accountId != null,
    staleTime: 30_000,
  });
}

// ── Account card ──────────────────────────────────────────────────────────────
function AccountCard({ account, selected, onClick }: { account: Account; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all ${
        selected
          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
          : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-blue-300"
      }`}
    >
      <div className="font-bold text-gray-900 dark:text-white text-sm">{account.name}</div>
      <div className="text-xs text-gray-400 mt-0.5">{account.broker ?? "No broker"} · {account.currency}</div>
    </button>
  );
}

// ── New Account form ──────────────────────────────────────────────────────────
function NewAccountForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName]       = useState("");
  const [broker, setBroker]   = useState("");
  const [currency, setCurrency] = useState("USD");
  const [err, setErr]         = useState("");

  const mut = useMutation({
    mutationFn: () => api.post("/accounts", { name, broker: broker || null, currency }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4">
      <h3 className="font-bold text-gray-900 dark:text-white mb-3 text-sm">Add Account</h3>
      <div className="grid grid-cols-3 gap-3 mb-3">
        {[
          { label: "Name", val: name, set: setName, ph: "My Brokerage" },
          { label: "Broker", val: broker, set: setBroker, ph: "Optional" },
          { label: "Currency", val: currency, set: setCurrency, ph: "USD" },
        ].map(({ label, val, set, ph }) => (
          <div key={label}>
            <label className="text-xs text-gray-400 block mb-1">{label}</label>
            <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
          </div>
        ))}
      </div>
      {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
      <div className="flex gap-2">
        <button onClick={() => mut.mutate()} disabled={mut.isPending || !name}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
          {mut.isPending ? "Creating…" : "Create"}
        </button>
        <button onClick={onDone} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Upsert Holding form ───────────────────────────────────────────────────────
function UpsertHoldingForm({ accountId, onDone }: { accountId: number; onDone: () => void }) {
  const qc = useQueryClient();
  const [sym, setSym]     = useState("");
  const [qty, setQty]     = useState("0");
  const [cost, setCost]   = useState("");
  const [err, setErr]     = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api.put(`/accounts/${accountId}/holdings`, {
        symbol: sym.toUpperCase(),
        quantity: parseFloat(qty),
        avg_cost: cost ? parseFloat(cost) : null,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["holdings", accountId] }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mt-4">
      <h3 className="font-bold text-gray-900 dark:text-white mb-3 text-sm">Add / Update Holding</h3>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Symbol</label>
          <input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="AAPL"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Quantity</label>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Avg Cost (opt.)</label>
          <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="—"
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
        </div>
      </div>
      {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
      <div className="flex gap-2">
        <button onClick={() => mut.mutate()} disabled={mut.isPending || !sym}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
          {mut.isPending ? "Saving…" : "Save Holding"}
        </button>
        <button onClick={onDone} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AccountsPage() {
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery<Account[]>({
    queryKey: ["accounts"],
    queryFn: fetchAccounts,
    staleTime: 30_000,
  });
  const cashQ = useQuery({ queryKey: ["cash-balance"], queryFn: () => fetchCashBalance(), staleTime: 30_000 });

  const [selected, setSelected]   = useState<number | null>(null);
  const [showNew, setShowNew]     = useState(false);
  const [showHolding, setShowHolding] = useState(false);

  const accountId = selected ?? (accounts[0]?.id ?? null);
  const { data: holdings = [] } = useHoldings(accountId);

  const deleteHolding = useMutation({
    mutationFn: (id: number) => api.del(`/holdings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holdings", accountId] }),
  });

  return (
    <div className="p-4 max-w-screen-xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">Accounts</h1>
        <div className="flex items-center gap-3">
          {cashQ.data && (
            <span className="text-sm text-gray-500">
              Cash: <span className="font-bold text-gray-900 dark:text-white">${cashQ.data.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
            </span>
          )}
          <button onClick={() => setShowNew((v) => !v)}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition">
            {showNew ? "Cancel" : "+ New Account"}
          </button>
        </div>
      </div>

      {showNew && <NewAccountForm onDone={() => setShowNew(false)} />}

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {/* Account cards */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              selected={a.id === accountId}
              onClick={() => setSelected(a.id)}
            />
          ))}
        </div>
      )}

      {/* Holdings for selected account */}
      {accountId && (
        <>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wide">
              Holdings — {accounts.find((a) => a.id === accountId)?.name ?? `Account ${accountId}`}
            </h2>
            <button onClick={() => setShowHolding((v) => !v)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
              {showHolding ? "Cancel" : "+ Add Holding"}
            </button>
          </div>

          {holdings.length === 0 && !showHolding && (
            <p className="text-sm text-gray-400">No holdings in this account.</p>
          )}

          {holdings.length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 uppercase tracking-wide">
                    {["Symbol", "Quantity", "Avg Cost", "Updated", ""].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => (
                    <tr key={h.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-3 py-2 font-bold text-gray-900 dark:text-white">{h.symbol}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{h.quantity}</td>
                      <td className="px-3 py-2 text-gray-500">{h.avg_cost != null ? `$${h.avg_cost.toFixed(2)}` : "—"}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs">{String(h.updated_at ?? "").slice(0, 10)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => deleteHolding.mutate(h.id)}
                          className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition">
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showHolding && <UpsertHoldingForm accountId={accountId} onDone={() => setShowHolding(false)} />}
        </>
      )}
    </div>
  );
}
