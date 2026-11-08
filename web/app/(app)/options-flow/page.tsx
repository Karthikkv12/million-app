"use client";
import { useState, useCallback, useEffect } from "react";
import { watchSymbols } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { Segmented } from "@/components/ui";
import { Plus, SlidersHorizontal } from "lucide-react";
import { TickerPanelWithQuery, makeSlot, STRIKE_OPTIONS, PALETTES, DEFAULT_HEAT_OPTS, BOARD_OPTIONS } from "@/components/options-flow";
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
      .map((s) => makeSlot(s.ticker))
      .slice(0, MAX_TICKERS);
    if (!slots.length) return fallback;
    const nStrikes = (STRIKE_OPTIONS as readonly number[]).includes(parsed.nStrikes) ? parsed.nStrikes : DEFAULT_STRIKES;
    const h = parsed.heat;
    const heat: HeatOpts = {
      palette: PALETTES.some((p) => p.id === h?.palette) ? h!.palette : DEFAULT_HEAT_OPTS.palette,
      showPct: typeof h?.showPct === "boolean" ? h.showPct : DEFAULT_HEAT_OPTS.showPct,
      dimSmall: typeof h?.dimSmall === "boolean" ? h.dimSmall : DEFAULT_HEAT_OPTS.dimSmall,
      board: BOARD_OPTIONS.some((b) => b.value === h?.board) ? h!.board : DEFAULT_HEAT_OPTS.board,
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
                         "grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3";

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[var(--background)]">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="px-4 pb-4 pt-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="eyebrow mb-1.5 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />Flow</p>
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-3xl">Options Flow</h1>
            <p className="mt-1 text-[13px] text-foreground/55">Gamma (GEX) and vanna (VEX) exposure by strike and expiry</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Exposure board"
              value={heat.board}
              onChange={(v) => setHeat((h) => ({ ...h, board: v as HeatOpts["board"] }))}
              options={BOARD_OPTIONS}
            />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Strikes</span>
            <Segmented
              label="Strikes around spot"
              value={String(nStrikes)}
              onChange={(v) => setNStrikes(Number(v) as typeof nStrikes)}
              options={STRIKE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
            />

            {/* Phones: palette and toggles live behind one "View" button */}
            <button
              onClick={() => setViewOpen((o) => !o)}
              aria-expanded={viewOpen}
              className="btn-ghost h-8 px-3 text-[12px] md:hidden"
            >
              <SlidersHorizontal size={14} /> View
            </button>

            <div className={`${viewOpen ? "flex" : "hidden"} w-full flex-wrap items-center gap-2 md:flex md:w-auto`}>
              <select
                value={heat.palette}
                onChange={(e) => setHeat((h) => ({ ...h, palette: e.target.value as HeatOpts["palette"] }))}
                className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] font-medium text-foreground"
                aria-label="Heatmap colours"
              >
                {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {([["showPct", "% of king"], ["dimSmall", "Dim small"]] as const).map(([k, lbl]) => (
                <button
                  key={k}
                  onClick={() => setHeat((h) => ({ ...h, [k]: !h[k] }))}
                  aria-pressed={heat[k]}
                  className={`h-8 rounded-lg border px-3 text-[12px] font-medium transition ${
                    heat[k] ? "border-foreground bg-foreground text-[var(--background)]" : "border-[var(--border)] text-foreground/60 hover:text-foreground"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {slots.length < MAX_TICKERS && (
              <button
                onClick={addSlot}
                className="flex h-8 items-center gap-1 rounded-lg border border-dashed border-[var(--border-strong)] px-3 text-[12px] font-medium text-foreground/65 transition hover:border-foreground/40 hover:text-foreground"
              >
                <Plus size={13} /> Add ticker
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Ticker columns ──────────────────────────────────────────────── */}
      <div className="px-4 pb-8 sm:px-6">
        <div className={`grid gap-4 ${gridClass}`}>
          {slots.map((slot, i) => (
            <TickerPanelWithQuery
              key={slot.ticker + i}
              slot={slot}
              accentColor={accent}
              nStrikes={nStrikes}
              heatOpts={heat}
              sideBySide={slots.length === 1}
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
