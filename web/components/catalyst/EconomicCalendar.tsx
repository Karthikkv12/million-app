"use client";
/**
 * EconomicCalendar — TradingView economic calendar, US events only.
 * The importance filter persists in localStorage.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useTheme } from "@/lib/theme";
import { Panel } from "@/components/ui";

// ─── constants ────────────────────────────────────────────────────────────────
// US events only (owner, 2026-11-08). Only importance is user-selectable.
const STORAGE_KEY = "econ_cal_filters";
const COUNTRY_FILTER = "us";

interface Filters {
  importance: string[];   // e.g. ["-1","0","1"]
}

const DEFAULT_FILTERS: Filters = { importance: ["0", "1"] };

const IMPORTANCE_OPTIONS = [
  { value: "-1", label: "Low"    },
  { value:  "0", label: "Medium" },
  { value:  "1", label: "High"   },
];

// ─── helpers ──────────────────────────────────────────────────────────────────
function loadFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<Filters>;   // older saves also had `countries`: ignored
    return { importance: Array.isArray(parsed.importance) ? parsed.importance : DEFAULT_FILTERS.importance };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(f: Filters) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

// ─── component ────────────────────────────────────────────────────────────────
export default function EconomicCalendar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [filters, setFiltersRaw] = useState<Filters>(loadFilters);
  const { theme } = useTheme();

  const setFilters = useCallback((f: Filters) => {
    setFiltersRaw(f);
    saveFilters(f);
  }, []);

  // Re-inject the TradingView widget whenever filters change
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const importanceFilter = filters.importance.join(",") || "-1,0,1";
    const countryFilter    = COUNTRY_FILTER;

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      colorTheme:       theme === "dark" ? "dark" : "light",
      isTransparent:    theme !== "dark",   // the widget only paints a dark background when it is not transparent
      width:            "100%",
      height:           "560",
      locale:           "en",
      importanceFilter,
      countryFilter,
    });

    containerRef.current.appendChild(script);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters), theme]);

  const pill = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-[12px] transition select-none ${
      on ? "border-foreground bg-foreground text-background" : "border-[var(--border-strong)] text-foreground/60 hover:text-foreground"
    }`;

  return (
    <Panel
      title="US economic calendar"
      sub="Fed, CPI, jobs, GDP… · TradingView · times in your timezone"
      padded={false}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Importance</span>
          {IMPORTANCE_OPTIONS.map(({ value, label }) => (
            <button key={value} aria-pressed={filters.importance.includes(value)}
              onClick={() => setFilters({ ...filters, importance: toggle(filters.importance, value) })}
              className={pill(filters.importance.includes(value))}>{label}</button>
          ))}
        </div>
      </div>
      <div className="tradingview-widget-container min-h-[560px]" ref={containerRef}>
        <div className="tradingview-widget-container__widget" />
      </div>
    </Panel>
  );
}
