"use client";
import { useState, useCallback, useEffect } from "react";
import { watchSymbols } from "@/lib/api";
import { Plus } from "lucide-react";
import { TickerPanelWithQuery, makeSlot, STRIKE_OPTIONS, PALETTES, DEFAULT_HEAT_OPTS } from "@/components/options-flow";
import type { Slot, HeatOpts } from "@/components/options-flow";

const MAX_TICKERS = 3;
const ACCENTS = ["#a855f7", "#f59e0b", "#22d3ee"] as const;
const DEFAULT_TICKERS = ["SPY", "QQQ", "AAPL"];
const DEFAULT_STRIKES = 20;

// ── Persistence helpers ───────────────────────────────────────────────────────
const STORAGE_KEY = "optionsflow_layout";
interface PersistedLayout { slots: Slot[]; nStrikes: number; heat?: HeatOpts; }

function loadLayout(): PersistedLayout {
  const fallback = { slots: [makeSlot("SPY")], nStrikes: DEFAULT_STRIKES, heat: DEFAULT_HEAT_OPTS };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as PersistedLayout;
    const slots = (Array.isArray(parsed.slots) ? parsed.slots : [])
      .filter((s) => typeof s.ticker === "string" && s.ticker.length > 0)
      .map((s) => makeSlot(s.ticker))
      .slice(0, MAX_TICKERS);
    if (!slots.length) return fallback;
    const nStrikes = (STRIKE_OPTIONS as readonly number[]).includes(parsed.nStrikes) ? parsed.nStrikes : DEFAULT_STRIKES;
    const h = parsed.heat;
    const heat: HeatOpts = {
      palette: PALETTES.some((p) => p.id === h?.palette) ? h!.palette : DEFAULT_HEAT_OPTS.palette,
      showPct: typeof h?.showPct === "boolean" ? h.showPct : DEFAULT_HEAT_OPTS.showPct,
      dimSmall: typeof h?.dimSmall === "boolean" ? h.dimSmall : DEFAULT_HEAT_OPTS.dimSmall,
    };
    return { slots, nStrikes, heat };
  } catch {
    return fallback;
  }
}

function saveLayout(slots: Slot[], nStrikes: number, heat: HeatOpts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ slots: slots.map((s) => makeSlot(s.ticker)), nStrikes, heat }));
  } catch { /* storage unavailable */ }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OptionsFlowPage() {
  const [slots, setSlots] = useState<Slot[]>(() => loadLayout().slots);
  const [nStrikes, setNStrikes] = useState<number>(() => loadLayout().nStrikes);
  const [heat, setHeat] = useState<HeatOpts>(() => loadLayout().heat ?? DEFAULT_HEAT_OPTS);

  // ?ticker=XYZ deep-link from dashboard search
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = (params.get("ticker") ?? "").trim().toUpperCase();
    if (t) {
      setSlots([makeSlot(t)]);
      const url = new URL(window.location.href);
      url.searchParams.delete("ticker");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => { saveLayout(slots, nStrikes, heat); }, [slots, nStrikes, heat]);

  useEffect(() => {
    const symbols = slots.map((s) => s.ticker);
    watchSymbols(symbols).catch(() => {});
    const id = setInterval(() => watchSymbols(symbols).catch(() => {}), 60_000);
    return () => clearInterval(id);
  }, [slots]);

  const addSlot = () => {
    if (slots.length >= MAX_TICKERS) return;
    const next = DEFAULT_TICKERS.find((t) => !slots.some((s) => s.ticker === t)) ?? "IWM";
    setSlots((prev) => [...prev, makeSlot(next)]);
  };

  const removeSlot = (idx: number) => setSlots((prev) => prev.filter((_, i) => i !== idx));

  const updateSlot = useCallback((idx: number, patch: Partial<Slot>) => {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }, []);

  const gridClass =
    slots.length === 1 ? "grid-cols-1 max-w-5xl" :
    slots.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
                         "grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3";

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[var(--background)]">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3 pt-4 sm:px-6">
        <div className="mr-auto">
          <h1 className="text-lg font-black tracking-tight text-foreground">Options Flow</h1>
          <p className="text-[11px] text-foreground/55">Gamma exposure by strike &amp; expiry · Yahoo Finance, ~15 min delayed</p>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50">Strikes</span>
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
            {STRIKE_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setNStrikes(n)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-bold tabular-nums transition ${
                  nStrikes === n ? "bg-foreground text-[var(--background)]" : "text-foreground/55 hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <select
            value={heat.palette}
            onChange={(e) => setHeat((h) => ({ ...h, palette: e.target.value as HeatOpts["palette"] }))}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[11px] font-bold text-foreground"
            aria-label="Heatmap colours"
          >
            {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {([["showPct", "% of king"], ["dimSmall", "Dim small"]] as const).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setHeat((h) => ({ ...h, [k]: !h[k] }))}
              aria-pressed={heat[k]}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${
                heat[k] ? "border-foreground/40 bg-foreground text-[var(--background)]" : "border-[var(--border)] text-foreground/60 hover:text-foreground"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {slots.length < MAX_TICKERS && (
          <button
            onClick={addSlot}
            className="flex items-center gap-1 rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-[11px] font-bold text-foreground/65 transition hover:border-foreground/40 hover:text-foreground"
          >
            <Plus size={12} /> Add ticker
          </button>
        )}
      </div>

      {/* ── Ticker columns ──────────────────────────────────────────────── */}
      <div className="px-4 pb-8 sm:px-6">
        <div className={`grid gap-4 ${gridClass}`}>
          {slots.map((slot, i) => (
            <TickerPanelWithQuery
              key={slot.ticker + i}
              slot={slot}
              accentColor={ACCENTS[i]}
              nStrikes={nStrikes}
              heatOpts={heat}
              canRemove={slots.length > 1}
              onRemove={() => removeSlot(i)}
              onInputChange={(v) => updateSlot(i, { input: v })}
              onSelect={(sym) => {
                const t = sym.trim().toUpperCase();
                if (t) updateSlot(i, { ticker: t, input: t });
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
