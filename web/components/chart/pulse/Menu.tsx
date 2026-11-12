"use client";
/** Small popover menu for the Pulse toolbar: closes on outside click and Escape. */
import { useEffect, useRef } from "react";
import { clsx } from "clsx";

export function Menu({ id, open, onOpen, button, children, align = "left", width = 220, title }: {
  id: string;
  open: string | null;
  onOpen: (id: string | null) => void;
  button: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  width?: number;
  title?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const isOpen = open === id;
  useEffect(() => {
    if (!isOpen) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onOpen(null); };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", down); window.removeEventListener("keydown", key); };
  }, [isOpen, onOpen]);
  return (
    <div ref={box} className="relative">
      <button type="button" title={title} aria-haspopup="menu" aria-expanded={isOpen} onClick={() => onOpen(isOpen ? null : id)}
        className={clsx("inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition hover:bg-foreground/[0.07] hover:text-foreground",
          isOpen ? "bg-foreground/[0.07] text-foreground" : "text-foreground/70")}>
        {button}
      </button>
      {isOpen && (
        <div role="menu" style={{ width }}
          className={clsx("absolute top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] p-1 shadow-[var(--shadow-float)] [scrollbar-width:thin]",
            align === "right" ? "right-0" : "left-0")}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, active, hint, disabled }: { onClick?: () => void; children: React.ReactNode; active?: boolean; hint?: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled}
      className={clsx("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition hover:bg-foreground/[0.06] disabled:opacity-40",
        active ? "font-medium text-foreground" : "text-foreground/75")}>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      {hint != null && <span className="shrink-0 font-mono text-[10.5px] text-foreground/45">{hint}</span>}
    </button>
  );
}

export const MenuLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/45 first:pt-1">{children}</p>
);
