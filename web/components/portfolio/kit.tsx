"use client";
// Shared pieces for the Portfolio and Money screens: dialog, form fields, stat tiles, formatters.
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { clsx } from "clsx";

// ── Formatters ────────────────────────────────────────────────────────────────

/** $1,234.56 (or −$1,234.56). `digits` defaults to 2; null → "—". */
export function usd(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (v < 0 ? "−$" : "$") + s;
}

/** Signed dollars: +$12.00 / −$4.50 / $0.00. */
export function usdSigned(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return (v > 0 ? "+" : "") + usd(v, digits);
}

/** Compact dollars for tiles: $12.3K, $1.25M. */
export function usdCompact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return usd(v, 0);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

/** "2026-03-06T00:00:00" → "Mar 6". `year` adds ", 2026". */
export function shortDate(iso: string | null | undefined, year = false): string {
  if (!iso) return "—";
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
}

/** "2026-03-06T00:00:00" → "2026-03-06" for <input type="date">. */
export const isoDay = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

export const toneOf = (v: number | null | undefined) =>
  v == null || v === 0 ? "text-foreground" : v > 0 ? "text-gain" : "text-loss";

// ── Stat tiles ────────────────────────────────────────────────────────────────

export function StatTile({ label, value, sub, tone }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <p className="truncate font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/55">{label}</p>
      <p className={clsx("mt-1 truncate font-mono text-xl font-medium tabular-nums sm:text-2xl", tone ?? "text-foreground")}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] text-foreground/55">{sub}</p>}
    </div>
  );
}

export function StatRow({ children, cols = 4 }: { children: React.ReactNode; cols?: 3 | 4 | 5 | 6 }) {
  const lg = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[cols];
  return <div className={clsx("mb-6 grid grid-cols-2 gap-3", lg)}>{children}</div>;
}

// ── Dialog ────────────────────────────────────────────────────────────────────

export function Dialog({ title, onClose, children, wide = false }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}
        className={clsx("flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-float)] sm:rounded-2xl", wide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-foreground/50 transition hover:bg-[var(--surface-2)] hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Confirm dialog with a destructive action. */
export function ConfirmDialog({ title, body, confirm, onConfirm, onClose, busy, error }: {
  title: string; body: React.ReactNode; confirm: string; onConfirm: () => void; onClose: () => void; busy?: boolean; error?: string;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="text-sm leading-relaxed text-foreground/70">{body}</div>
      {error && <p className="mt-3 text-sm text-loss">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost h-9 px-4 text-sm">Cancel</button>
        <button onClick={onConfirm} disabled={busy} className="btn h-9 bg-loss px-4 text-sm text-white hover:bg-loss/85 disabled:opacity-50">
          {busy ? "Working…" : confirm}
        </button>
      </div>
    </Dialog>
  );
}

// ── Form fields ───────────────────────────────────────────────────────────────

export const inputCls =
  "h-10 w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-foreground outline-none transition placeholder:text-foreground/35 focus:border-foreground/40 focus:ring-2 focus:ring-accent/20";

export function Field({ label, hint, children, className }: {
  label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={clsx("grid min-w-0 gap-1.5", className)}>
      <span className="text-[12px] font-medium text-foreground/65">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-foreground/50">{hint}</span>}
    </label>
  );
}

export function FormActions({ onCancel, busy, label, disabled, error }: {
  onCancel: () => void; busy?: boolean; label: string; disabled?: boolean; error?: string;
}) {
  return (
    <>
      {error && <p className="mt-4 text-sm text-loss">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost h-9 px-4 text-sm">Cancel</button>
        <button type="submit" disabled={busy || disabled} className="btn-primary h-9 px-4 text-sm disabled:opacity-50">
          {busy ? "Saving…" : label}
        </button>
      </div>
    </>
  );
}

/** Parse an optional numeric input: "" → null. */
export const num = (s: string): number | null => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

// ── Table bits ────────────────────────────────────────────────────────────────

export const thCls = "px-3 py-2.5 font-normal whitespace-nowrap";
export const theadCls =
  "sticky top-0 z-10 bg-[var(--surface)] text-left font-mono text-[11px] uppercase tracking-[0.1em] text-foreground/50 shadow-[0_1px_0_var(--border)]";

/** Small icon button used in table rows. */
export function RowButton({ label, onClick, children, danger }: {
  label: string; onClick: () => void; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={clsx("rounded-md p-1.5 text-foreground/45 transition hover:bg-[var(--surface-2)]", danger ? "hover:text-loss" : "hover:text-foreground")}>
      {children}
    </button>
  );
}
