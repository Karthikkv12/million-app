"use client";
/**
 * Shared pieces of the broker-synced Portfolio: the account filter (context,
 * remembered in localStorage), queries and formatters. Nothing here is entered
 * by hand; it all comes from the daily Robinhood sync.
 */
import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  fetchBrokerActivity, fetchBrokerHistory, fetchBrokerIncome, fetchBrokerPortfolio,
  BrokerActivity, BrokerHistoryPoint, BrokerIncome, BrokerPortfolio,
} from "@/lib/api";
import { useLivePortfolio } from "@/lib/live";

const KEY = "portfolio_account";
const Ctx = createContext<{ account: string | null; setAccount: (a: string | null) => void }>({ account: null, setAccount: () => {} });

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, set] = useState<string | null>(null);
  useEffect(() => { try { set(localStorage.getItem(KEY) || null); } catch { /* storage off */ } }, []);
  const setAccount = (a: string | null) => {
    set(a);
    try { if (a) localStorage.setItem(KEY, a); else localStorage.removeItem(KEY); } catch { /* storage off */ }
  };
  return <Ctx.Provider value={{ account, setAccount }}>{children}</Ctx.Provider>;
}
export const useAccount = () => useContext(Ctx);

/** The synced portfolio, re-priced every second from the live stream (lib/live.tsx). */
export function usePortfolio() {
  const { account } = useAccount();
  const q = useQuery<BrokerPortfolio>({ queryKey: ["broker", "portfolio", account], queryFn: () => fetchBrokerPortfolio(account), refetchInterval: 30_000 });
  const data = useLivePortfolio(q.data);
  return { ...q, data };
}
export function useHistory(days = 365) {
  const { account } = useAccount();
  return useQuery<BrokerHistoryPoint[]>({ queryKey: ["broker", "history", account, days], queryFn: () => fetchBrokerHistory(account, days) });
}
export function useIncome() {
  const { account } = useAccount();
  return useQuery<BrokerIncome>({ queryKey: ["broker", "income", account], queryFn: () => fetchBrokerIncome(account) });
}
export function useActivity() {
  const { account } = useAccount();
  return useQuery<BrokerActivity[]>({ queryKey: ["broker", "activity", account], queryFn: () => fetchBrokerActivity(account) });
}

/** Account chips; the list always comes from the unfiltered portfolio. */
export function AccountFilter() {
  const { account, setAccount } = useAccount();
  const { data } = useQuery<BrokerPortfolio>({ queryKey: ["broker", "portfolio", null], queryFn: () => fetchBrokerPortfolio(null), refetchInterval: 60_000 });
  const names = (data?.accounts ?? []).map((a) => a.account);
  if (names.length < 2) return null;
  const chip = (label: string, value: string | null) => (
    <button key={label} onClick={() => setAccount(value)} aria-pressed={account === value}
      className={clsx("h-8 whitespace-nowrap rounded-full border px-3 text-[12px] font-medium transition",
        account === value ? "border-foreground bg-foreground text-[var(--background)]" : "border-[var(--border)] text-foreground/60 hover:text-foreground")}>
      {label}
    </button>
  );
  return <div className="flex flex-wrap gap-1.5">{chip("All accounts", null)}{names.map((n) => chip(n, n))}</div>;
}

// ── Formatting ────────────────────────────────────────────────────────────────
export const usd = (v?: number | null, d = 2) =>
  v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const signedUsd = (v?: number | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${usd(v, d)}`);
export const compactUsd = (v?: number | null) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}K` : `${s}$${a.toFixed(0)}`;
};
export const pct = (v?: number | null, d = 2) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
export const tone = (v?: number | null) => (v == null || v === 0 ? "text-foreground/60" : v > 0 ? "text-gain" : "text-loss");
export const ago = (iso?: string | null) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
export const shortDate = (iso: string) => new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function Metric({ label, value, sub, className, sensitive = true }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string; sensitive?: boolean }) {
  return (
    <div className={clsx("min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4", className)}>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/50">{label}</p>
      <p className={clsx("mt-1.5 truncate font-mono text-[22px] font-medium tabular-nums tracking-tight text-foreground", sensitive && "sensitive")}>{value}</p>
      {sub && <div className={clsx("mt-0.5 truncate font-mono text-[12px] text-foreground/55", sensitive && "sensitive")}>{sub}</div>}
    </div>
  );
}

export function NoData({ what = "positions" }: { what?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--border-strong)] px-6 py-14 text-center">
      <p className="text-[15px] font-medium text-foreground">No {what} synced yet</p>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] text-foreground/55">Everything here comes from Robinhood automatically. It syncs every hour while the market is open and again in the evening; your accounts, positions and trade history appear after the first run.</p>
    </div>
  );
}

export const TH = "px-3 py-2.5 text-left font-mono text-[10.5px] font-normal uppercase tracking-[0.12em] text-foreground/50";
export const TD = "px-3 py-2.5 font-mono text-[13px] tabular-nums";
