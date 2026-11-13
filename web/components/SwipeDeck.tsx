"use client";
import { useCallback, useRef, useState } from "react";
import clsx from "clsx";

/**
 * Cards in one slot: the tabs (or a horizontal swipe, or ← →) switch between them.
 * Only the card on show is displayed; the others stay mounted (hidden) so their data and open sections survive a
 * switch. This replaced a scroll-snap strip: on iPhone Safari a smooth scroll interrupted by the height change left
 * the strip parked between two cards, cutting both off.
 * `slideClassName` lets a caller cap each card's height so it scrolls on its own.
 */
export function SwipeDeck({ slides, label, className, slideClassName }: {
  slides: { key: string; label: React.ReactNode; node: React.ReactNode }[];
  label: string;
  className?: string;
  slideClassName?: string;
}) {
  const [active, setActive] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);

  const go = useCallback((i: number) => setActive(Math.max(0, Math.min(slides.length - 1, i))), [slides.length]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    start.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current, t = e.changedTouches[0];
    start.current = null;
    if (!s || !t) return;
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(active + (dx < 0 ? 1 : -1));
  };

  return (
    <section aria-label={label} aria-roledescription="carousel" className={clsx("min-w-0", className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div role="tablist" aria-label={label} className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
          {slides.map((s, i) => (
            <button key={s.key} type="button" role="tab" id={`deck-tab-${s.key}`} aria-selected={active === i}
              aria-controls={`deck-slide-${s.key}`} tabIndex={active === i ? 0 : -1}
              onClick={() => go(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const n = (i + (e.key === "ArrowRight" ? 1 : -1) + slides.length) % slides.length;
                  go(n);
                  (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
                }
              }}
              className={clsx(
                "rounded-md px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] transition",
                active === i ? "bg-foreground text-background" : "text-foreground/55 hover:text-foreground",
              )}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5" aria-hidden>
          {slides.map((s, i) => (
            <i key={s.key} className={clsx("h-1.5 rounded-full transition-all", active === i ? "w-4 bg-foreground/70" : "w-1.5 bg-foreground/20")} />
          ))}
        </div>
      </div>
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="min-w-0 touch-pan-y">
        {slides.map((s, i) => (
          <div key={s.key} id={`deck-slide-${s.key}`} role="tabpanel" aria-labelledby={`deck-tab-${s.key}`}
            hidden={active !== i} className={clsx("w-full min-w-0", slideClassName)}>
            {s.node}
          </div>
        ))}
      </div>
    </section>
  );
}
