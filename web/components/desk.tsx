"use client";
/**
 * Desk — the layout language for Dashboard and Hedge (owner, 2026-11-08: "no cards").
 * Full-bleed sections divided by hairlines, a left gutter label, big numerals, dense rows,
 * colored left edges for anything that needs action. No rounded boxed panels.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const E = { accent: "before:bg-accent", gain: "before:bg-gain", loss: "before:bg-loss", warn: "before:bg-warn" } as const;
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
    warn: "text-warn ring-warn/40 bg-warn/[0.08]",
    solid: "text-[var(--background)] bg-foreground ring-foreground",
  } as const;
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] px-1.5 py-[1px] font-mono text-[10px] font-medium uppercase tracking-[0.12em] ring-1 ring-inset", T[tone], className)}>
      {children}
    </span>
  );
}

export type MeterTips = { value?: string; target?: string; after?: string; zero?: string };

/** Popover state shared by Meter and Scale: one tip at a time, closes on outside tap or after 4 s. */
function useTip() {
  const [tip, setTip] = useState<{ key: string; text: string; at: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tip) return;
    const t = setTimeout(() => setTip(null), 4000);
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setTip(null); };
    document.addEventListener("pointerdown", away);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", away); };
  }, [tip]);
  const show = (key: string, text: string, at: number) => (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();                     // a marker tap must not toggle the row it sits in
    e.preventDefault();                      // …or follow a link around it (Dashboard scales link to /hedge)
    setTip((cur) => (cur?.key === key ? null : { key, text, at }));
  };
  return { tip, show, ref };
}

/** A tappable marker: a 24px hit area centred on the visual. */
function Mark({ at, label, onShow, children, top = "50%" }: {
  at: number; label: string; onShow: (e: React.MouseEvent | React.KeyboardEvent) => void; children: React.ReactNode; top?: string;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onShow}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onShow(e); } }}
      className="absolute z-[1] flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-[left] duration-500 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      style={{ left: `${at}%`, top }}>
      {children}
    </button>
  );
}

function Bubble({ at, text }: { at: number; text: string }) {
  // Centred on the marker, then nudged so it stays inside the screen with an 8px margin (long labels near either edge).
  const ref = useRef<HTMLSpanElement>(null);
  const [dx, setDx] = useState(0);
  const cur = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = r.left - cur.current, right = r.right - cur.current;      // where it sits without any nudge
    const vw = document.documentElement.clientWidth;
    const next = left < 8 ? 8 - left : right > vw - 8 ? vw - 8 - right : 0;
    cur.current = next;
    setDx(next);
  }, [at, text]);
  return (
    <span ref={ref} role="status"
      className="pointer-events-none absolute bottom-full z-20 mb-1.5 w-max max-w-[min(300px,calc(100vw-16px))] rounded-[4px] bg-foreground px-2 py-1 text-center font-mono text-[11px] leading-snug text-[var(--background)] shadow-lg"
      style={{ left: `${at}%`, transform: `translateX(calc(-50% + ${dx}px))` }}>
      {text}
    </span>
  );
}

/** Horizontal meter with a zero tick, a reference/target tick and an optional "after" marker. Tap a marker to see what it is. */
export function Meter({ value, target, after, max = 1.5, min = -max, width = "w-full", dot, tips }: {
  value: number; target?: number | null; after?: number | null; max?: number; min?: number; width?: string;
  /** Dot color class; default: green on target, amber off it. */
  dot?: string;
  /** Text shown when a marker is tapped; sensible defaults otherwise. */
  tips?: MeterTips;
}) {
  const p = (x: number) => Math.min(100, Math.max(0, ((x - min) / (max - min)) * 100));
  const off = target != null && Math.abs(value - target) > 0.15;
  const zero = p(0);
  const from = Math.min(zero, p(value));
  const to = Math.max(zero, p(value));
  const f = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;
  const { tip, show, ref } = useTip();
  return (
    <div ref={ref} className={clsx("relative h-[18px]", width)} aria-label={`value ${value.toFixed(2)}`}>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--border-strong)]" />
      <div className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-[1px] bg-foreground/15" style={{ left: `${from}%`, width: `${to - from}%` }} />
      <Mark at={zero} label="zero" onShow={show("zero", tips?.zero ?? "0 = delta-neutral", zero)}>
        <span className="h-3 w-px bg-foreground/30" />
      </Mark>
      {target != null && (
        <Mark at={p(target)} label="reference" onShow={show("target", tips?.target ?? `Reference ${f(target)}`, p(target))}>
          <span className="h-[18px] w-[2px] bg-accent" />
        </Mark>
      )}
      {after != null && (
        <Mark at={p(after)} label="after the suggested trade" onShow={show("after", tips?.after ?? `After the suggested trade ${f(after)}`, p(after))}>
          <span className="h-2 w-2 rotate-45 border border-accent bg-[var(--background)]" />
        </Mark>
      )}
      <Mark at={p(value)} label="now" onShow={show("value", tips?.value ?? `Now ${f(value)}`, p(value))}>
        <span className={clsx("h-3 w-3 rounded-full ring-2 ring-[var(--background)]", dot ?? (off ? "bg-warn" : "bg-gain"))} />
      </Mark>
      {tip && <Bubble at={tip.at} text={tip.text} />}
    </div>
  );
}

/** Vertical price ladder: levels placed by price, spot highlighted. Same-price levels merge; close labels are pushed apart. */
export function Ladder({ levels, spot, height = 180 }: {
  /** `strong`: draw the label in the level's tone (a trade idea worth noticing) instead of muted. */
  levels: { label: string; price: number | null | undefined; tone: string; strong?: boolean }[]; spot: number; height?: number;
}) {
  if (spot == null || !Number.isFinite(spot)) return null;
  type Part = { label: string; tone: string; strong?: boolean };
  const merged: { label: string; price: number; tone: string; parts: Part[] }[] = [];
  for (const l of levels) {
    if (l.price == null) continue;
    const part = { label: l.label, tone: l.tone, strong: l.strong };
    const hit = merged.find((m) => Math.abs(m.price - (l.price as number)) < 1e-6);
    if (hit) { hit.label += ` · ${l.label}`; hit.parts.push(part); }
    else merged.push({ label: l.label, price: l.price, tone: l.tone, parts: [part] });
  }
  const all = [spot, ...merged.map((p) => p.price)];
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || spot * 0.02;
  const y = (p: number) => ((hi + pad - p) / (hi - lo + 2 * pad)) * height;
  const GAP = 17;
  // place spot first, then levels top→bottom, nudging any label that would overlap the one above it
  const rows = [{ label: "spot", price: spot, tone: "spot", parts: [] as Part[], y: y(spot) }, ...merged.map((m) => ({ ...m, y: y(m.price) }))]
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
        <div key={p.label} className="absolute left-0 right-0 flex items-center gap-2" style={{ top: p.y - 8 }} title={`${p.price.toFixed(2)} · ${p.label}`}>
          <span className={clsx("w-[56px] shrink-0 text-right tabular-nums", p.tone)}>{p.price.toFixed(2)}</span>
          <span className={clsx("h-px w-4 shrink-0 bg-current", p.tone)} />
          <span className="truncate text-foreground/55">
            {p.parts.map((part, i) => (
              <span key={part.label}>{i > 0 && " · "}<span className={part.strong ? clsx("font-medium", part.tone) : undefined}>{part.label}</span></span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A labelled scale ("where do I stand"): coloured zones, tick marks with labels underneath,
 * a pin with the value above, and an optional hollow "after" marker. Values outside the range
 * clamp to the edge with an arrow.
 */
export function Scale({ min, max, value, after, marks, zones, label, pin, tips }: {
  min: number; max: number; value: number | null | undefined; after?: number | null;
  marks: { at: number; label: string; strong?: boolean }[];
  zones?: { from: number; to: number; cls: string; label?: string }[];
  /** Text on the pin, e.g. "+0.57". */
  label?: string;
  /** Pin colour class. */
  pin?: string;
  /** Text shown when the dot / after marker / a tick is tapped. */
  tips?: { value?: string; after?: string };
}) {
  const p = (x: number) => Math.min(100, Math.max(0, ((x - min) / (max - min)) * 100));
  const { tip, show, ref } = useTip();
  const out = value != null && (value < min ? "◂ " : value > max ? " ▸" : "");
  return (
    <div ref={ref} className="relative mb-2 pb-9 pt-7">
      {value != null && (
        <div className="absolute top-0 -translate-x-1/2 transition-[left] duration-500" style={{ left: `${Math.min(94, Math.max(6, p(value)))}%` }}>
          <span className={clsx("whitespace-nowrap rounded-[3px] px-1.5 py-[1px] font-mono text-[11px] font-medium tabular-nums text-[var(--background)]", pin ?? "bg-foreground")}>
            {value < min && out}{label ?? value.toFixed(2)}{value > max && out}
          </span>
        </div>
      )}
      <div className="relative h-2.5 overflow-hidden rounded-full bg-foreground/[0.07]">
        {zones?.map((z) => (
          <div key={z.from} title={z.label} className={clsx("absolute inset-y-0", z.cls)} style={{ left: `${p(z.from)}%`, width: `${p(z.to) - p(z.from)}%` }} />
        ))}
      </div>
      {marks.map((m) => (
        <div key={m.at} className="absolute top-[26px] -translate-x-1/2" style={{ left: `${p(m.at)}%` }}>
          <div className={clsx("mx-auto h-[14px] w-px", m.strong ? "bg-foreground/70" : "bg-foreground/25")} />
          <p className={clsx("mt-1 whitespace-nowrap text-center font-mono text-[10px]",
            p(m.at) <= 2 && "translate-x-[45%]", p(m.at) >= 98 && "-translate-x-[45%]",
            m.strong ? "text-foreground/75" : "text-foreground/40")}>{m.label}</p>
        </div>
      ))}
      {after != null && (
        <Mark at={p(after)} top="36px" label="after the suggested trades" onShow={show("after", tips?.after ?? `After the suggested trades ${after.toFixed(2)}`, p(after))}>
          <span className="h-3 w-3 rotate-45 border-2 border-accent bg-[var(--background)]" />
        </Mark>
      )}
      {value != null && (
        <Mark at={p(value)} top="35px" label="now" onShow={show("value", tips?.value ?? `Now ${label ?? value.toFixed(2)}`, p(value))}>
          <span className={clsx("h-4 w-4 rounded-full ring-[3px] ring-[var(--background)]", pin ?? "bg-foreground")} />
        </Mark>
      )}
      {tip && <span className="absolute inset-x-0 top-[34px]"><Bubble at={tip.at} text={tip.text} /></span>}
    </div>
  );
}
