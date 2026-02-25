"use client";
import { useState, useCallback, useEffect } from "react";
import { watchSymbols } from "@/lib/api";
import { Activity, X, Plus } from "lucide-react";
import {
  TickerPanelWithQuery,
  makeSlot,
  STRIKE_OPTIONS,
} from "@/components/options-flow";
import type { Slot } from "@/components/options-flow";

const MAX_TICKERS = 3;
const ACCENTS = ["#a855f7", "#f59e0b", "#22d3ee"] as const;
const DEFAULT_TICKERS = ["SPY", "QQQ", "AAPL"];

// ── Persistence helpers ───────────────────────────────────────────────────────
const STORAGE_KEY = "optionsflow_layout";
interface PersistedLayout { slots: Slot[]; nStrikes: number; }

function loadLayout(): PersistedLayout {
  if (typeof window === "undefined") return { slots: [makeSlot("SPY")], nStrikes: 20 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { slots: [makeSlot("SPY")], nStrikes: 20 };
    const parsed = JSON.parse(raw) as PersistedLayout;
    if (!Array.isArray(parsed.slots) || parsed.slots.length === 0) throw new Error();
    const slots = parsed.slots
      .filter((s) => typeof s.ticker === "string" && s.ticker.length > 0)
      .map((s) => ({ ticker: s.ticker, input: s.ticker, expiryFilter: Array.isArray(s.expiryFilter) ? s.expiryFilter : null }));
    if (!slots.length) throw new Error();
    slots.splice(MAX_TICKERS);
    const nStrikes = STRIKE_OPTIONS.includes(parsed.nStrikes as (typeof STRIKE_OPTIONS)[number]) ? parsed.nStrikes : 20;
    return { slots, nStrikes };
  } catch {
    return { slots: [makeSlot("SPY")], nStrikes: 20 };
  }
}

function saveLayout(slots: Slot[], nStrikes: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      slots: slots.map((s) => ({ ticker: s.ticker, input: s.ticker, expiryFilter: s.expiryFilter })),
      nStrikes,
    }));
  } catch { /* ignore */ }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OptionsFlowPage() {
  const [slots, setSlots] = useState<Slot[]>(() => loadLayout().slots);
  const [nStrikes, setNStrikes] = useState<number>(() => loadLayout().nStrikes);

  // Handle ?ticker=XYZ deep-link from dashboard search
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const t = (params.get("ticker") ?? "").trim().toUpperCase();
    if (t) {
      setSlots([makeSlot(t)]);
      const url = new URL(window.location.href);
      url.searchParams.delete("ticker");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => { saveLayout(slots, nStrikes); }, [slots, nStrikes]);

  useEffect(() => {
    const symbols = slots.map((s) => s.ticker);
    watchSymbols(symbols).catch(() => {});
    const id = setInterval(() => watchSymbols(symbols).catch(() => {}), 60_000);
    return () => clearInterval(id);
  }, [slots]);

  const addSlot = () => {
    if (slots.length >= MAX_TICKERS) return;
    const next = DEFAULT_TICKERS.find((t) => !slots.some((s) => s.ticker === t)) ?? "AAPL";
    setSlots((prev) => [...prev, makeSlot(next)]);
  };

  const removeSlot = (idx: number) => setSlots((prev) => prev.filter((_, i) => i !== idx));

  const updateSlot = useCallback((idx: number, patch: Partial<Slot>) => {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }, []);

  const gridClass =
    slots.length === 1 ? "grid-cols-1" :
    slots.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
                         "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="min-h-screen bg-[var(--background)]">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="w-full px-4 sm:px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">

            {/* Title */}
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-lg"
                style={{
                  background: "linear-gradient(135deg, #a855f7 0%, #6366f1 50%, #3b82f6 100%)",
                  boxShadow: "0 4px 14px rgba(168,85,247,0.3)",
                }}
              >
                <Activity size={16} className="text-white" />
              </div>
              <div>
                <h1 className="text-[15px] font-black text-white leading-none tracking-tight">
                  Options Flow
                </h1>
                <p className="text-[10px] text-foreground/70 mt-0.5 font-semibold tracking-wide">
                  GEX · Net Premium · Strike Levels
                </p>
              </div>
            </div>

            <div className="w-px h-8 bg-[var(--border)] hidden sm:block" />

            {/* Active ticker pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {slots.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border"
                  style={{
                    borderColor: `${ACCENTS[i]}55`,
                    color: ACCENTS[i],
                    background: `${ACCENTS[i]}12`,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: ACCENTS[i] }}
                  />
                  {s.ticker}
                  {slots.length > 1 && (
                    <button
                      onClick={() => removeSlot(i)}
                      className="opacity-50 hover:opacity-100 transition ml-0.5"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
              {slots.length < MAX_TICKERS && (
                <button
                  onClick={addSlot}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold text-foreground/70 border border-dashed border-[var(--border)] hover:border-purple-400 hover:text-purple-500 transition"
                >
                  <Plus size={11} /> Add
                </button>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* ── Ticker panels grid ───────────────────────────────────────────── */}
      <div className="w-full px-4 sm:px-6 py-6">
        <div className={`grid gap-5 ${gridClass}`}>
          {slots.map((slot, i) => (
            <TickerPanelWithQuery
              key={slot.ticker + i}
              slot={slot}
              accentColor={ACCENTS[i]}
              nStrikes={nStrikes}
              onSetNStrikes={setNStrikes}
              enabled={true}
              onInputChange={(v) => updateSlot(i, { input: v })}
              onSelect={(sym) => {
                const t = sym.trim().toUpperCase();
                if (t) updateSlot(i, { ticker: t, input: t, expiryFilter: null });
              }}
              onToggleExpiry={(d) =>
                updateSlot(i, {
                  expiryFilter: slot.expiryFilter
                    ? slot.expiryFilter.includes(d)
                      ? slot.expiryFilter.filter((x) => x !== d).length === 0
                        ? null
                        : slot.expiryFilter.filter((x) => x !== d)
                      : [...slot.expiryFilter, d]
                    : [d],
                })
              }
              onClearExpiry={() => updateSlot(i, { expiryFilter: null })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
