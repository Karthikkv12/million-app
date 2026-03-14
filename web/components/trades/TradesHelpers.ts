import { WeeklySnapshot, PositionStatus } from "@/lib/api";

// ── Shared input styles ───────────────────────────────────────────────────────

export const inp =
  "w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--surface)] " +
  "text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500";

// Date inputs need color-scheme so the native calendar picker is visible in dark mode
export const datInp = inp + " [color-scheme:dark]";

// ── Status colours ────────────────────────────────────────────────────────────

export const STATUS_COLORS: Record<PositionStatus, string> = {
  ACTIVE:   "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300",
  CLOSED:   "bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-300",
  EXPIRED:  "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
  ASSIGNED: "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-600 dark:text-yellow-300",
  ROLLED:   "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300",
};

// ── Pure formatting helpers ───────────────────────────────────────────────────

export function fmt$(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

export function weekLabel(w: WeeklySnapshot): string {
  // Parse as local date to avoid UTC-offset "Invalid Date" / off-by-one issues.
  // week_end is "YYYY-MM-DD"; split manually so it works in all browsers.
  const [year, month, day] = w.week_end.slice(0, 10).split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

// ── Position form helpers ─────────────────────────────────────────────────────

export interface PosFormState {
  symbol: string;
  option_type: "PUT" | "CALL";
  contracts: string;
  strike: string;
  premium_in: string;
  premium_out: string;
  sold_date: string;
  expiry_date: string;
  status: PositionStatus;
  notes: string;
  margin: string;
  is_roll: boolean;
  holding_id: string;
  spot_price: string;
  buy_date: string;
}

export function emptyForm(): PosFormState {
  return {
    symbol: "", option_type: "PUT", contracts: "1", strike: "",
    premium_in: "", premium_out: "", sold_date: new Date().toISOString().slice(0, 10),
    expiry_date: "", status: "ACTIVE", notes: "", margin: "", is_roll: false,
    holding_id: "", spot_price: "", buy_date: "",
  };
}

import { OptionPosition } from "@/lib/api";

export function posToForm(p: OptionPosition): PosFormState {
  return {
    symbol:      p.symbol,
    option_type: p.option_type,
    contracts:   String(p.contracts),
    strike:      String(p.strike),
    premium_in:  p.premium_in  != null ? String(p.premium_in)  : "",
    premium_out: p.premium_out != null ? String(p.premium_out) : "",
    sold_date:   p.sold_date?.slice(0, 10)   ?? "",
    expiry_date: p.expiry_date?.slice(0, 10) ?? "",
    status:      p.status,
    notes:       p.notes ?? "",
    margin:      p.margin != null ? String(p.margin) : "",
    is_roll:     p.is_roll ?? false,
    holding_id:  p.holding_id != null ? String(p.holding_id) : "",
    spot_price:  p.spot_price != null ? String(p.spot_price)  : "",
    buy_date:    p.buy_date?.slice(0, 10) ?? "",
  };
}
