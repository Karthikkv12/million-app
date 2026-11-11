"use client";
/** Strategy dropdown: the desk's actions follow whatever is picked here. */
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { useStrategy } from "./useStrategy";

export function StrategyPicker({ align = "right" }: { align?: "left" | "right" }) {
  const { data, current, save } = useStrategy();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} disabled={!data}
        className="flex w-full items-center gap-2 border border-[var(--border-strong)] px-3 py-1.5 text-left transition hover:border-foreground/50 disabled:opacity-50 sm:w-auto">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/45">Strategy</span>
        <span className="text-[13.5px] font-medium text-foreground">{current?.name ?? "…"}</span>
        <ChevronDown size={14} className={clsx("ml-auto text-foreground/50 transition sm:ml-0", open && "rotate-180")} />
      </button>
      {open && data && (
        <ul role="listbox" aria-label="Strategy"
          className={clsx("absolute z-40 mt-1 w-[min(360px,calc(100vw-32px))] border border-[var(--border-strong)] bg-[var(--background)] py-1 shadow-xl", align === "right" ? "right-0" : "left-0")}>
          {data.strategies.map((s) => {
            const on = s.key === data.strategy;
            return (
              <li key={s.key} role="option" aria-selected={on}>
                <button type="button" disabled={save.isPending}
                  onClick={() => { if (!on) save.mutate({ strategy: s.key }); setOpen(false); }}
                  className={clsx("flex w-full gap-3 px-3 py-2.5 text-left transition hover:bg-foreground/[0.05]", on && "bg-foreground/[0.04]")}>
                  <Check size={14} className={clsx("mt-0.5 shrink-0", on ? "text-accent" : "invisible")} />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-foreground">{s.name}
                      {s.buys_options && <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.12em] text-warn">{s.sides === "call" ? "buys a call" : "buys a put"}</span>}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-foreground/55">{s.summary}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {save.isError && <p className="absolute right-0 mt-1 text-[12px] text-loss">Couldn&apos;t save. Try again.</p>}
    </div>
  );
}
