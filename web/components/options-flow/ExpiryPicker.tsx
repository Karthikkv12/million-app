"use client";
/**
 * ExpiryPicker — the expiry dropdown above one Flow table. Tick up to MAX_EXPIRIES of the expiries the board has;
 * each tick applies at once (no Apply button). "Nearest 6" resets to the default.
 */
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { MAX_EXPIRIES, pickExpiries } from "./GexHeatmap";

const label = (exp: string) => {
  const d = new Date(`${exp}T12:00:00`);
  return Number.isNaN(d.getTime()) ? exp : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const days = (exp: string) => Math.max(0, Math.round((new Date(`${exp}T16:00:00`).getTime() - Date.now()) / 86_400_000));

export function ExpiryPicker({ available, chosen, onChange, compact = false }: {
  available: string[];
  /** Narrow column: hide the word "Expiries" (kept for screen readers), show the icon and count. */
  compact?: boolean;
  /** Saved choice (null = default: the nearest MAX_EXPIRIES). */
  chosen: string[] | null | undefined;
  onChange: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = pickExpiries(available, chosen);
  const isDefault = !chosen?.some((e) => available.includes(e));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const toggle = (exp: string) => {
    const on = shown.includes(exp);
    if (on && shown.length === 1) return;                       // keep at least one column
    if (!on && shown.length >= MAX_EXPIRIES) return;
    onChange(on ? shown.filter((e) => e !== exp) : [...shown, exp]);
  };

  if (!available.length) return null;
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        title="Choose which expiries this table shows"
        className={clsx("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono uppercase tracking-[0.12em] hover:bg-foreground/[0.06] hover:text-foreground",
          open ? "bg-foreground/[0.06] text-foreground" : "text-foreground/60")}>
        <CalendarDays size={12} /><span className={compact ? "sr-only" : undefined}>Expiries</span> <span className="tabular-nums text-foreground/45">{shown.length}/{available.length}</span>
        <ChevronDown size={12} className={clsx("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable aria-label="Expiries"
          className="absolute right-0 z-40 mt-1 w-[230px] border border-[var(--border-strong)] bg-[var(--background)] py-1 shadow-xl">
          <p className="px-3 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45">
            Up to {MAX_EXPIRIES} · {shown.length} chosen
          </p>
          {available.map((exp) => {
            const on = shown.includes(exp);
            const blocked = !on && shown.length >= MAX_EXPIRIES;
            return (
              <button key={exp} type="button" role="option" aria-selected={on} disabled={blocked} onClick={() => toggle(exp)}
                title={blocked ? `Up to ${MAX_EXPIRIES}: untick one first` : undefined}
                className={clsx("flex w-full items-center gap-2.5 px-3 py-1.5 text-left font-mono text-[12px] tabular-nums transition",
                  blocked ? "cursor-not-allowed text-foreground/30" : "text-foreground hover:bg-foreground/[0.05]")}>
                <span className={clsx("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                  on ? "border-foreground bg-foreground text-[var(--background)]" : "border-foreground/30")}>
                  {on && <Check size={10} strokeWidth={3} />}
                </span>
                <span className="flex-1">{label(exp)}</span>
                <span className="text-[11px] text-foreground/45">{days(exp)}d</span>
              </button>
            );
          })}
          <div className="mt-1 border-t border-[var(--border)] px-3 pt-1.5">
            <button type="button" onClick={() => onChange(null)} disabled={isDefault}
              className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent hover:underline disabled:cursor-default disabled:text-foreground/30 disabled:no-underline">
              Nearest {MAX_EXPIRIES}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
