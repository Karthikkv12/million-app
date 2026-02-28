"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAccounts, fetchCashBalance, Account, api } from "@/lib/api";
import { Plus, X, Wallet, TrendingUp, DollarSign } from "lucide-react";
import { PageHeader, EmptyState, RefreshButton, Tabs } from "@/components/ui";

interface Holding {
  id: number; account_id: number; symbol: string;
  quantity: number; avg_cost?: number; updated_at?: string;
}

function CashModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount]   = useState("");
  const [type, setType]       = useState<"deposit" | "withdrawal">("deposit");
  const [account, setAccount] = useState("");
  const [err, setErr]         = useState("");

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<{id:number;name:string}[]>("/accounts"), staleTime: 30_000 });

  const mut = useMutation({
    mutationFn: () => api.post("/cash/add", { amount: parseFloat(amount), type, account_id: account ? parseInt(account) : null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cash-balance"] }); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  const inputCls = "w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--surface)] text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-[var(--surface)] rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-sm shadow-2xl border border-[var(--border)]">
        <div className="w-10 h-1 rounded-full bg-[var(--surface-2)] mx-auto mb-5 sm:hidden" />
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-foreground text-lg">Cash Transaction</h3>
          <button onClick={onClose} className="p-1.5 rounded-xl text-foreground/70 hover:bg-[var(--surface-2)] transition"><X size={16} /></button>
        </div>
        <Tabs
          tabs={[
            { key: "deposit",    label: "Deposit"    },
            { key: "withdrawal", label: "Withdrawal" },
          ]}
          active={type}
          onChange={(k) => setType(k as "deposit" | "withdrawal")}
          className="w-full mb-4 [&>button]:flex-1"
        />
        <label className="block text-xs text-foreground/70 mb-1">Amount ($)</label>
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${inputCls} mb-3`} />
        <label className="block text-xs text-foreground/70 mb-1">Account (optional)</label>
        <select value={account} onChange={(e) => setAccount(e.target.value)} className={`${inputCls} mb-4`}>
          <option value="">— Any —</option>
          {(accountsQ.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <button onClick={() => mut.mutate()} disabled={mut.isPending || !amount}
          className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
          {mut.isPending ? "Processing…" : `Confirm ${type}`}
        </button>
      </div>
    </div>
  );
}

function useHoldings(accountId: number | null) {
  return useQuery<Holding[]>({
    queryKey: ["holdings", accountId],
    queryFn: () => api.get(`/accounts/${accountId}/holdings`),
    enabled: accountId != null,
    staleTime: 30_000,
  });
}

const inp = "w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--surface)] text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500";

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
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-foreground">Add Account</h3>
        <button onClick={onDone} className="p-1.5 rounded-xl text-foreground/70 hover:bg-[var(--surface-2)] transition"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {[
          { label: "Name", val: name, set: setName, ph: "My Brokerage" },
          { label: "Broker (opt.)", val: broker, set: setBroker, ph: "e.g. Fidelity" },
          { label: "Currency", val: currency, set: setCurrency, ph: "USD" },
        ].map(({ label, val, set, ph }) => (
          <div key={label}>
            <label className="text-xs text-foreground/70 block mb-1">{label}</label>
            <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph} className={inp} />
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
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-foreground text-sm">Add / Update Holding</h3>
        <button onClick={onDone} className="p-1.5 rounded-xl text-foreground/70 hover:bg-[var(--surface-2)] transition"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {[
          { label: "Symbol",           type: "text",   val: sym,  set: (v: string) => setSym(v.toUpperCase()), ph: "AAPL" },
          { label: "Quantity",         type: "number", val: qty,  set: setQty,  ph: "" },
          { label: "Avg Cost (opt.)",  type: "number", val: cost, set: setCost, ph: "—" },
        ].map(({ label, type, val, set, ph }) => (
          <div key={label}>
            <label className="text-xs text-foreground/70 block mb-1">{label}</label>
            <input type={type} step={type === "number" ? "0.01" : undefined} value={val}
              onChange={(e) => set(e.target.value)} placeholder={ph} className={inp} />
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

export default function AccountsPage() {
  const qc = useQueryClient();
  const { data: accounts = [], isLoading, refetch, isFetching } = useQuery<Account[]>({ queryKey: ["accounts"], queryFn: fetchAccounts, staleTime: 30_000 });
  const cashQ = useQuery({ queryKey: ["cash-balance"], queryFn: () => fetchCashBalance(), staleTime: 30_000 });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAddAcct, setShowAddAcct] = useState(false);
  const [showHolding, setShowHolding] = useState(false);
  const [showCash,    setShowCash]    = useState(false);

  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0] ?? null;
  const activeId = selectedId ?? selected?.id ?? null;

  const holdingsQ = useHoldings(activeId);
  const holdings  = holdingsQ.data ?? [];

  const handleRefresh = () => { refetch(); cashQ.refetch(); holdingsQ.refetch(); };
  const isRefreshing  = isFetching || cashQ.isFetching;

  const deleteHolding = useMutation({
    mutationFn: (id: number) => api.del(`/holdings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holdings", activeId] }),
  });

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto w-full overflow-x-hidden">
      {showCash && <CashModal onClose={() => setShowCash(false)} />}
      <PageHeader
        title="Accounts"
        sub={cashQ.data?.balance != null ? `Cash balance: $${cashQ.data.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : undefined}
        action={
          <div className="flex items-center gap-2">
            <RefreshButton onRefresh={handleRefresh} isRefreshing={isRefreshing} />
            <button onClick={() => setShowCash(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 active:scale-95 transition shadow-sm">
              <DollarSign size={14} strokeWidth={2.5} />
              <span>Cash</span>
            </button>
            <button onClick={() => setShowAddAcct((v) => !v)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${showAddAcct ? "bg-[var(--surface-2)] text-foreground" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
              {showAddAcct ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add Account</>}
            </button>
          </div>
        }
      />

      {showAddAcct && <NewAccountForm onDone={() => setShowAddAcct(false)} />}

      {/* Account selector chips */}
      {isLoading ? (
        <div className="flex gap-2 mb-5">
          {[1,2,3].map(i => <div key={i} className="skeleton h-9 w-28 rounded-xl" />)}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState icon={Wallet} title="No accounts yet" body="Create your first brokerage account to track holdings." />
      ) : (
        <>
          <div className="flex gap-2 flex-wrap mb-5">
            {accounts.map((a) => (
              <button key={a.id} onClick={() => setSelectedId(a.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition ${
                  (selectedId === a.id) || (!selectedId && a.id === accounts[0]?.id)
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-[var(--surface)] border-[var(--border)] text-foreground hover:border-blue-400"
                }`}>
                <Wallet size={13} />
                {a.name}
                {a.broker && <span className="opacity-60 text-xs">· {a.broker}</span>}
              </button>
            ))}
          </div>

          {/* Holdings for selected account */}
          {activeId != null && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <div>
                  <h2 className="font-bold text-foreground text-sm">{selected?.name ?? "Holdings"}</h2>
                  <p className="text-xs text-foreground/70">{holdings.length} position{holdings.length !== 1 ? "s" : ""}</p>
                </div>
                <button onClick={() => setShowHolding((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${showHolding ? "bg-[var(--surface-2)] text-foreground/70" : "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100"}`}>
                  {showHolding ? <><X size={12} /> Cancel</> : <><Plus size={12} /> Add Holding</>}
                </button>
              </div>

              {showHolding && activeId != null && (
                <div className="px-4 pb-4">
                  <UpsertHoldingForm accountId={activeId} onDone={() => setShowHolding(false)} />
                </div>
              )}

              {holdingsQ.isLoading && (
                <div className="p-4 space-y-2">
                  {[1,2,3].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}
                </div>
              )}

              {!holdingsQ.isLoading && holdings.length === 0 && (
                <EmptyState icon={TrendingUp} title="No holdings" body="Add your first position using the button above." />
              )}

              {holdings.length > 0 && (
                <>
                  {/* Mobile */}
                  <div className="flex flex-col divide-y divide-[var(--border)] md:hidden">
                    {holdings.map((h) => (
                      <div key={h.id} className="flex items-center justify-between p-4">
                        <div>
                          <p className="font-bold text-foreground">{h.symbol}</p>
                          <p className="text-xs text-foreground/70 mt-0.5">
                            {h.quantity} shares{h.avg_cost != null ? ` · avg $${h.avg_cost.toFixed(2)}` : ""}
                          </p>
                        </div>
                        <button onClick={() => deleteHolding.mutate(h.id)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition">
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Desktop */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-[11px] text-foreground/70 uppercase tracking-wide bg-[var(--surface-2)]">
                          {["Symbol", "Qty", "Avg Cost", "Last Updated", ""].map((h) => (
                            <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {holdings.map((h) => (
                          <tr key={h.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                            <td className="px-4 py-3 font-bold text-foreground">{h.symbol}</td>
                            <td className="px-4 py-3 text-foreground">{h.quantity}</td>
                            <td className="px-4 py-3 text-foreground/70">{h.avg_cost != null ? `$${h.avg_cost.toFixed(2)}` : "—"}</td>
                            <td className="px-4 py-3 text-foreground/70 text-xs">{h.updated_at ? String(h.updated_at).slice(0, 10) : "—"}</td>
                            <td className="px-4 py-3">
                              <button onClick={() => deleteHolding.mutate(h.id)}
                                className="text-xs px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition">
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
