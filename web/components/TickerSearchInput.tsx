"use client";
/**
 * TickerSearchInput — a search box with live autocomplete suggestions.
 *
 * Usage:
 *   <TickerSearchInput
 *     value={input}
 *     onChange={setInput}
 *     onSelect={(symbol) => doSearch(symbol)}
 *     accentColor="#6b82f8"          // optional — colours the button
 *     placeholder="Ticker…"          // optional
 *     actionLabel="LOAD"             // optional button label
 *   />
 */

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Search, Loader2 } from "lucide-react";
import { searchTickers, TickerSuggestion } from "@/lib/api";

const TYPE_COLOR: Record<string, string> = {
  Equity:  "text-foreground/70",
  ETF:     "text-gain",
  Index:   "text-foreground/50",
  Fund:    "text-orange-400",
  Crypto:  "text-yellow-400",
  Future:  "text-loss",
  Forex:   "text-cyan-400",
};

interface Props {
  value:        string;
  onChange:     (v: string) => void;
  /** Called with the chosen / confirmed symbol when user selects or submits */
  onSelect:     (symbol: string) => void;
  accentColor?: string;
  placeholder?: string;
  actionLabel?: string;
  className?:   string;
}

export default function TickerSearchInput({
  value,
  onChange,
  onSelect,
  accentColor  = "#6b82f8",
  placeholder  = "Ticker or company…",
  actionLabel  = "LOAD",
  className    = "",
}: Props) {
  const [suggestions, setSuggestions] = useState<TickerSuggestion[]>([]);
  const [loading, setLoading]         = useState(false);
  const [open, setOpen]               = useState(false);
  const [activeIdx, setActiveIdx]     = useState(-1);

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  // Set to true the moment user picks something; cleared when they type a new char.
  // Starts true so a pre-filled value (e.g. a saved ticker) doesn't pop the dropdown on load.
  const closedRef      = useRef(true);

  const closeDropdown = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    closedRef.current = true;
    setOpen(false);
    setSuggestions([]);
    setLoading(false);
    setActiveIdx(-1);
  }, []);

  // Fetch suggestions with 200 ms debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();

    if (q.length < 1) {
      closeDropdown();
      closedRef.current = false; // empty input → allow fresh suggestions
      return;
    }

    // If the user already picked a result and the value hasn't changed, stay closed
    if (closedRef.current) return;

    debounceRef.current = setTimeout(async () => {
      if (closedRef.current) return; // picked while debounce was pending
      setLoading(true);
      try {
        const res = await searchTickers(q, 12);
        if (closedRef.current) return; // picked while request was in-flight
        // Filter out raw option contracts (OCC symbols) — not useful for ticker search
        const filtered = res.filter((r) => r.type !== "Option").slice(0, 8);
        setSuggestions(filtered);
        setOpen(res.length > 0);
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pick = useCallback((sym: string) => {
    closeDropdown();          // sets closedRef.current = true, clears suggestions, closes open
    onChange(sym);
    inputRef.current?.blur();
    // Defer onSelect by one tick so React flushes the closed state before the
    // parent potentially re-renders and passes a new `value` back down
    setTimeout(() => onSelect(sym), 0);
  }, [closeDropdown, onChange, onSelect]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (open) setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && activeIdx >= 0 && suggestions[activeIdx]) {
        pick(suggestions[activeIdx].symbol);
      } else {
        const s = value.trim().toUpperCase();
        if (s) { closeDropdown(); onChange(s); inputRef.current?.blur(); setTimeout(() => onSelect(s), 0); }
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else {
      // Any other key means the user is typing something new → allow suggestions again
      closedRef.current = false;
    }
  };

  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Recalculate dropdown position whenever it opens or the window is resized/scrolled
  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    const update = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const minW = 320;
      const desiredW = Math.max(rect.width, minW);
      const vw = window.innerWidth;
      // Clamp left so the dropdown never overflows the right edge of the viewport
      const left = Math.min(rect.left, vw - desiredW - 8);
      setDropPos({ top: rect.bottom + 4, left: Math.max(left, 8), width: desiredW });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, suggestions]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    closedRef.current = false; // user typed → re-enable suggestions
    onChange(e.target.value.toUpperCase());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const s = value.trim().toUpperCase();
    if (s) { closeDropdown(); onChange(s); inputRef.current?.blur(); setTimeout(() => onSelect(s), 0); }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <form
        onSubmit={handleSubmit}
        className="flex items-stretch rounded-xl overflow-hidden border border-[var(--border-strong)] bg-[var(--surface)] transition focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-accent/20"
        data-accent={accentColor}
      >
        <span className="flex items-center pl-3 pr-1.5 text-foreground/70 shrink-0">
          {loading
            ? <Loader2 size={13} className="animate-spin text-foreground/70" />
            : <Search size={13} />}
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (!closedRef.current && suggestions.length) setOpen(true); }}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 min-w-0 py-2 text-sm font-medium bg-transparent text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
        <button
          type="submit"
          className="m-1 flex items-center justify-center rounded-lg bg-foreground px-3.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-background shrink-0 transition hover:bg-foreground/85"
        >
          {actionLabel}
        </button>
      </form>

      {/* Dropdown — rendered in a portal at fixed position to escape any overflow/z-index parent */}
      {open && suggestions.length > 0 && dropPos && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed",
            top: dropPos.top,
            left: dropPos.left,
            width: dropPos.width,
            zIndex: 9999,
            boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
          }}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
        >
          {suggestions.map((s, i) => {
            const typeColor = TYPE_COLOR[s.type] ?? "text-foreground/70";
            const isActive = i === activeIdx;
            return (
              <button
                key={s.symbol}
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(s.symbol); }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${
                  isActive ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]"
                }`}
              >
                <span className="w-16 shrink-0 font-bold text-sm text-foreground tabular-nums">
                  {s.symbol}
                </span>
                <span className="flex-1 min-w-0 text-xs text-foreground/70 truncate">
                  {s.name || "—"}
                </span>
                <div className="flex items-center gap-1 shrink-0 ml-auto">
                  {s.type && (
                    <span className={`text-[9px] font-bold uppercase ${typeColor}`}>{s.type}</span>
                  )}
                  {s.exchange && (
                    <span className="text-[9px] text-foreground/70 font-medium">· {s.exchange}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

