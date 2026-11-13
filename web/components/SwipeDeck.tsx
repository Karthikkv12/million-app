"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";

/**
 * Cards side by side in one slot: swipe (touch, trackpad) or use the tabs to move between them.
 * The deck takes the height of the card on show, so a short card doesn't leave a gap under it.
 * `slideClassName` lets a caller cap each card's height so it scrolls on its own.
 */
export function SwipeDeck({ slides, label, className, slideClassName }: {
  slides: { key: string; label: React.ReactNode; node: React.ReactNode }[];
  label: string;
  className?: string;
  slideClassName?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState<number>();

  const go = useCallback((i: number) => {
    const el = row.current;
    if (!el) return;
    const n = Math.max(0, Math.min(slides.length - 1, i));
    el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
    setActive(n);
  }, [slides.length]);

  const onScroll = () => {
    const el = row.current;
    if (!el || !el.clientWidth) return;
    setActive(Math.max(0, Math.min(slides.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
  };

  // Follow the height of the card on show, including when it grows (data loads, a section opens).
  useLayoutEffect(() => {
    const el = items.current[active];
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  // Keep the shown card in place when the deck is resized (rotation, window resize).
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    // Only on a width change: the row's height animates on every switch, and re-aligning then would cut a smooth
    // tab-click scroll short.
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      el.scrollLeft = active * width;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

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
      <div ref={row} onScroll={onScroll}
        style={height ? { height } : undefined}
        className="flex snap-x snap-mandatory items-start overflow-x-auto overscroll-x-contain transition-[height] duration-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {slides.map((s, i) => (
          <div key={s.key} ref={(el) => { items.current[i] = el; }} id={`deck-slide-${s.key}`}
            role="tabpanel" aria-labelledby={`deck-tab-${s.key}`}
            className={clsx("w-full min-w-0 shrink-0 snap-start snap-always", slideClassName)}>
            {s.node}
          </div>
        ))}
      </div>
    </section>
  );
}
