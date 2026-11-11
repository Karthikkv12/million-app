"use client";
import { useState, useCallback, useEffect } from "react";
import { watchSymbols } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { Plus, SlidersHorizontal } from "lucide-react";
import { TickerPanelWithQuery, makeSlot, STRIKE_OPTIONS, PALETTES, DEFAULT_HEAT_OPTS } from "@/components/options-flow";
import type { Slot, HeatOpts } from "@/components/options-flow";

const MAX_TICKERS = 3;
// One accent (matches --accent): light #2f5bea, dark #90bff9
const ACCENT = { light: "#2f5bea", dark: "#90bff9" } as const;
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
      .map((s) => makeSlot(s.ticker, s.metric))
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ slots: slots.map((s) => makeSlot(s.ticker, s.metric)), nStrikes, heat }));
  } catch { /* storage unavailable */ }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OptionsFlowPage() {
  const { theme } = useTheme();
  const accent = ACCENT[theme];
  const [slots, setSlots] = useState<Slot[]>(() => loadLayout().slots);
  const [viewOpen, setViewOpen] = useState(false);
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
    slots.length === 1 ? "grid-cols-1" :
    slots.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
                         "grid-cols-1 lg:grid-cols-3";

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[var(--background)]">
      {/* ── Header + toolbar (desk style) ───────────────────────────────── */}
      <div className="px-4 pt-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground/50">Flow</p>
            <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.03em] text-foreground sm:text-[34px]">Dealer exposure board</h1>
          </div>
          <p className="max-w-md text-right text-[12.5px] leading-relaxed text-foreground/50">Gamma (GEX) and vanna (VEX) by strike × expiry. ★ marks the king node; tap a ticker&apos;s Details for flow and levels.</p>
        </div>

        <div className="-mx-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-[var(--border-strong)] px-4 py-2 sm:-mx-8 sm:px-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Strikes</span>
            <div role="radiogroup" aria-label="Strikes around spot" className="flex">
              {STRIKE_OPTIONS.map((n) => (
                <button key={n} role="radio" aria-checked={nStrikes === n} onClick={() => setNStrikes(n)}
                  className={`px-2 py-1 font-mono text-[12px] tabular-nums transition ${nStrikes === n ? "text-foreground underline decoration-2 underline-offset-[6px]" : "text-foreground/45 hover:text-foreground"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <button onClick={() => setViewOpen((o) => !o)} aria-expanded={viewOpen}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/60 md:hidden">
            <SlidersHorizontal size={13} /> View
          </button>

          <div className={`${viewOpen ? "flex" : "hidden"} w-full flex-wrap items-center gap-x-5 gap-y-2 md:flex md:w-auto`}>
            <label className="flex items-center gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">Colors</span>
              <select
                value={heat.palette}
                onChange={(e) => setHeat((h) => ({ ...h, palette: e.target.value as HeatOpts["palette"] }))}
                className="bg-transparent py-1 font-mono text-[12px] text-foreground focus:outline-none"
                aria-label="Heatmap colours"
              >
                {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            {([["showPct", "% of king"], ["dimSmall", "Dim small"]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setHeat((h) => ({ ...h, [k]: !h[k] }))} aria-pressed={heat[k]}
                className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/60 transition hover:text-foreground">
                <span className={`relative h-3.5 w-6 rounded-full transition ${heat[k] ? "bg-foreground" : "bg-foreground/20"}`}>
                  <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--background)] transition-all ${heat[k] ? "left-3" : "left-0.5"}`} />
                </span>
                {lbl}
              </button>
            ))}
          </div>

          {slots.length < MAX_TICKERS && (
            <button onClick={addSlot}
              className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:underline">
              <Plus size={13} /> Add ticker
            </button>
          )}
        </div>
      </div>

      {/* ── Ticker columns ──────────────────────────────────────────────── */}
      <div className="pb-10 pt-2 sm:px-4">
        <div className={`grid gap-y-8 lg:gap-x-0 ${gridClass} [&>*]:min-w-0 max-lg:[&>*+*]:border-t-2 max-lg:[&>*+*]:border-[var(--border-strong)] max-lg:[&>*+*]:pt-2 lg:[&>*+*]:border-l-2 lg:[&>*+*]:border-[var(--border-strong)] lg:[&>*]:px-3`}>
          {slots.map((slot, i) => (
            <TickerPanelWithQuery
              key={slot.ticker + i}
              slot={slot}
              accentColor={accent}
              nStrikes={nStrikes}
              heatOpts={heat}
              canRemove={slots.length > 1}
              onRemove={() => removeSlot(i)}
              onInputChange={(v) => updateSlot(i, { input: v })}
              onMetricChange={(m) => updateSlot(i, { metric: m })}
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
