"use client";
/**
 * Desk — the layout language for Dashboard and Hedge (owner, 2026-11-08: "no cards").
 * Full-bleed sections divided by hairlines, a left gutter label, big numerals, dense rows,
 * colored left edges for anything that needs action. No rounded boxed panels.
 */
import { clsx } from "clsx";

export function DeskPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("mx-auto w-full max-w-[1480px] px-4 pb-20 pt-5 sm:px-8", className)}>{children}</div>;
}

/** A section: hairline on top, label in a left gutter on wide screens, above on phones. */
export function DeskSection({ label, meta, children, className, id }: {
  label: string; meta?: React.ReactNode; children: React.ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={clsx("grid gap-x-8 gap-y-3 border-t border-[var(--border-strong)] py-6 lg:grid-cols-[168px_minmax(0,1fr)]", className)}>
      <header className="min-w-0">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-foreground">{label}</h2>
        {meta && <div className="mt-1 font-mono text-[11px] leading-relaxed text-foreground/45">{meta}</div>}
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** A big inline figure; put several in a DeskFigures row (they divide with vertical rules). */
export function DeskFigure({ label, value, sub, tone, size = "md", sensitive = false }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; size?: "lg" | "md";
  /** Hidden in privacy mode. */
  sensitive?: boolean;
}) {
  return (
    <div className="min-w-0 py-1 pr-6">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">{label}</p>
      <p className={clsx("mt-1 truncate font-mono font-medium tabular-nums tracking-[-0.03em]", sensitive && "sensitive", size === "lg" ? "text-[34px] leading-none sm:text-[44px]" : "text-[22px] leading-tight", tone ?? "text-foreground")}>{value}</p>
      {sub && <div className={clsx("mt-1 truncate font-mono text-[11.5px] text-foreground/55", sensitive && "sensitive")}>{sub}</div>}
    </div>
  );
}

export function DeskFigures({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("grid grid-cols-2 gap-y-4 sm:flex sm:flex-wrap sm:divide-x sm:divide-[var(--border)] [&>*]:sm:pl-6 [&>*:first-child]:sm:pl-0", className)}>
      {children}
    </div>
  );
}

/** One dense row; `edge` paints a 3px status bar on the left. */
export function DeskRow({ edge, children, className, onClick, active }: {
  edge?: "accent" | "gain" | "loss" | "warn" | null; children: React.ReactNode; className?: string; onClick?: () => void; active?: boolean;
}) {
  const E = { accent: "before:bg-accent", gain: "before:bg-gain", loss: "before:bg-loss", warn: "before:bg-amber-500" } as const;
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={clsx(
        "relative border-b border-[var(--border)] before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        edge ? E[edge] : "before:bg-transparent",
        onClick && "cursor-pointer transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.05] focus-visible:outline-none",
        active && "bg-foreground/[0.035]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Small uppercase tag used for signals / regimes. */
export function Tag({ tone = "neutral", children, className }: {
  tone?: "neutral" | "accent" | "gain" | "loss" | "warn" | "solid"; children: React.ReactNode; className?: string;
}) {
  const T = {
    neutral: "text-foreground/60 ring-[var(--border-strong)]",
    accent: "text-accent ring-accent/40 bg-accent/[0.08]",
    gain: "text-gain ring-gain/40 bg-gain/[0.08]",
    loss: "text-loss ring-loss/40 bg-loss/[0.08]",
    warn: "text-amber-700 dark:text-amber-300 ring-amber-500/40 bg-amber-500/[0.08]",
    solid: "text-[var(--background)] bg-foreground ring-foreground",
  } as const;
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] px-1.5 py-[1px] font-mono text-[10px] font-medium uppercase tracking-[0.12em] ring-1 ring-inset", T[tone], className)}>
      {children}
    </span>
  );
}

/** Horizontal meter on a symmetric scale with a target tick and optional "after" marker. */
export function Meter({ value, target, after, max = 1.5, width = "w-full" }: {
  value: number; target?: number | null; after?: number | null; max?: number; width?: string;
}) {
  const pos = (x: number) => `${Math.min(100, Math.max(0, ((x + max) / (2 * max)) * 100))}%`;
  const off = target != null && Math.abs(value - target) > 0.15;
  const from = Math.min(50, parseFloat(pos(value)));
  const to = Math.max(50, parseFloat(pos(value)));
  return (
    <div className={clsx("relative h-[18px]", width)} aria-label={`value ${value.toFixed(2)}`}>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--border-strong)]" />
      <div className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-[1px] bg-foreground/15" style={{ left: `${from}%`, width: `${to - from}%` }} />
      <div className="absolute left-1/2 top-[3px] h-3 w-px bg-foreground/30" />
      {target != null && <div title={`target ${target.toFixed(2)}`} className="absolute top-0 h-full w-[2px] -translate-x-1/2 bg-accent" style={{ left: pos(target) }} />}
      {after != null && <div title={`after trade ${after.toFixed(2)}`} className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-accent bg-[var(--background)]" style={{ left: pos(after) }} />}
      <div className={clsx("absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--background)] transition-[left] duration-500", off ? "bg-amber-500" : "bg-gain")} style={{ left: pos(value) }} />
    </div>
  );
}

/** Vertical price ladder: levels placed by price, spot highlighted. Same-price levels merge; close labels are pushed apart. */
export function Ladder({ levels, spot, height = 180 }: {
  levels: { label: string; price: number | null | undefined; tone: string }[]; spot: number; height?: number;
}) {
  const merged: { label: string; price: number; tone: string }[] = [];
  for (const l of levels) {
    if (l.price == null) continue;
    const hit = merged.find((m) => Math.abs(m.price - (l.price as number)) < 1e-6);
    if (hit) hit.label += ` · ${l.label}`;
    else merged.push({ label: l.label, price: l.price, tone: l.tone });
  }
  const all = [spot, ...merged.map((p) => p.price)];
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || spot * 0.02;
  const y = (p: number) => ((hi + pad - p) / (hi - lo + 2 * pad)) * height;
  const GAP = 17;
  // place spot first, then levels top→bottom, nudging any label that would overlap the one above it
  const rows = [{ label: "spot", price: spot, tone: "spot", y: y(spot) }, ...merged.map((m) => ({ ...m, y: y(m.price) }))]
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < rows.length; i++) if (rows[i].y - rows[i - 1].y < GAP) rows[i].y = rows[i - 1].y + GAP;
  const h = Math.max(height, (rows.at(-1)?.y ?? 0) + GAP);
  return (
    <div className="relative font-mono text-[11px]" style={{ height: h }}>
      <div className="absolute bottom-0 left-[64px] top-0 w-px bg-[var(--border-strong)]" />
      {rows.map((p) => p.tone === "spot" ? (
        <div key="spot" className="absolute left-0 right-0 flex items-center gap-2" style={{ top: p.y - 9 }}>
          <span className="w-[56px] text-right font-medium tabular-nums text-foreground">{p.price.toFixed(2)}</span>
          <span className="h-[2px] w-6 bg-foreground" />
          <span className="rounded-[3px] bg-foreground px-1 text-[10px] uppercase tracking-[0.1em] text-[var(--background)]">spot</span>
        </div>
      ) : (
        <div key={p.label} className="absolute left-0 right-0 flex items-center gap-2" style={{ top: p.y - 8 }}>
          <span className={clsx("w-[56px] text-right tabular-nums", p.tone)}>{p.price.toFixed(2)}</span>
          <span className={clsx("h-px w-4", p.tone.split(" ")[0].replace("text-", "bg-"))} />
          <span className="truncate text-foreground/55">{p.label}</span>
        </div>
      ))}
    </div>
  );
}
