"use client";
/**
 * Theory — a small "Theory" button that opens the explanation behind a Hedge tool in a pop-up.
 * The theory stays hidden until asked for; the page itself only shows numbers and what to do.
 * Text helpers (H, P, Formula, Terms) keep every theory pop-up in the same voice and layout.
 */
import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Dialog } from "@/components/portfolio/kit";

export function Theory({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/70 transition hover:border-foreground/50 hover:text-foreground">
        <BookOpen size={13} /> Theory
      </button>
      {open && (
        <Dialog title={title} onClose={() => setOpen(false)} wide>
          <div className="space-y-4 text-[13.5px] leading-relaxed text-foreground/75">{children}</div>
        </Dialog>
      )}
    </>
  );
}

export const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="pt-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-foreground/55">{children}</h3>
);
export const P = ({ children }: { children: React.ReactNode }) => <p>{children}</p>;
export const Formula = ({ children }: { children: React.ReactNode }) => (
  <p className="overflow-x-auto border-l-[3px] border-accent bg-foreground/[0.04] px-3 py-2 font-mono text-[13px] text-foreground">{children}</p>
);
export function Terms({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="font-mono text-[12.5px] text-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** While the server prices the book with live option greeks (the first load can take ~20 s). */
export function Computing({ what }: { what: string }) {
  return (
    <div className="border-t border-[var(--border-strong)] py-10" role="status" aria-live="polite">
      <div className="h-1 w-40 overflow-hidden rounded-full bg-foreground/[0.08]">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
      </div>
      <p className="mt-3 text-[14px] text-foreground/75">Computing {what}…</p>
      <p className="mt-1 text-[12.5px] text-foreground/50">Pricing every option you hold with live greeks and loading years of daily prices. The first load can take up to 20 seconds; after that it&apos;s quick for a minute.</p>
    </div>
  );
}
