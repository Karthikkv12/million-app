"use client";
/**
 * VolTarget — the Hedge page's "Vol target" tab: exposure = σ_target / σ̂_forecast on the synced book.
 *
 * The forecast is a GARCH(1,1) on today's book replayed over three years of daily returns (server:
 * optionflow/modules/hedge/voltarget.py). Exposure is in delta dollars, so options count with shares.
 * The page shows the scale for the whole book, the forecast against the target over the last year, and what
 * each holding would be at that scale. Target and cap are remembered per browser.
 * The theory is behind the Theory button (VolTargetTheory), not on the page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { fetchVolTarget, VolTarget as VT, VolTargetHolding } from "@/lib/api";
import { DeskFigure, DeskFigures, DeskSection } from "@/components/desk";
import { Computing, Formula, H, P, Terms, Theory } from "./Theory";

const TARGETS = [0.10, 0.15, 0.20, 0.25] as const;
const CAPS = [1, 1.5, 2] as const;
const KEY = "hedge_vol_target";
const REFRESH_MS = 60_000;              // the server caches the priced book for 60 s

const vol = (v?: number | null, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const pct = (v?: number | null, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const money = (v?: number | null, signed = false) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : signed && v > 0 ? "+" : "";
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}K` : `${s}$${a.toFixed(0)}`;
};
const ct = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v).toString() : v.toFixed(1));
const sh = (v?: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) >= 10 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1)} sh`);
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });

function readPrefs(): { target: number; cap: number } {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { target: TARGETS.includes(p.target) ? p.target : 0.15, cap: CAPS.includes(p.cap) ? p.cap : 1 };
  } catch { return { target: 0.15, cap: 1 }; }
}

function Chips<T extends number>({ label, options, value, onChange, fmt }: {
  label: string; options: readonly T[]; value: T; onChange: (v: T) => void; fmt: (v: T) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex">
        {options.map((o) => (
          <button key={o} role="radio" aria-checked={value === o} onClick={() => onChange(o)}
            className={clsx("px-2 py-1 font-mono text-[12px] tabular-nums", value === o ? "text-foreground underline decoration-2 underline-offset-[6px]" : "text-foreground/45 hover:text-foreground")}>
            {fmt(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Charts: forecast vs target, and the exposure that implies (two charts, one axis each) ────────
const PAD_L = 40, PAD_R = 8;
type Pt = VT["chart"][number];

/** One hovered day shared by both charts (they have the same x axis). */
function useHover(n: number) {
  const [i, setI] = useState<number | null>(null);
  const onMove = (e: React.PointerEvent<SVGSVGElement>, W: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setI(Math.max(0, Math.min(n - 1, Math.round(((x - PAD_L) / (W - PAD_L - PAD_R)) * (n - 1)))));
  };
  return { i, onMove, onLeave: () => setI(null) };
}

function LineChart({ pts, value, height, max, refAt: refLine, refLabel, fmt, title, cls, hover, area }: {
  pts: Pt[]; value: (p: Pt) => number | null | undefined; height: number; max: number;
  refAt?: number; refLabel?: string; fmt: (v: number) => string; title: string; cls: string;
  hover: ReturnType<typeof useHover>; area?: boolean;
}) {
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height, top = 16, bottom = 18;
  const x = (i: number) => PAD_L + (i / Math.max(1, pts.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => top + (1 - Math.min(v, max) / max) * (H - top - bottom);
  let path = "", pen = false;                         // a gap in the data lifts the pen
  pts.forEach((p, i) => {
    const v = value(p);
    if (v == null) { pen = false; return; }
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  // a reference line without a text label gets its value on the axis instead of the midpoint tick
  const ticks = refLine != null && !refLabel ? [0, refLine, max] : [0, max / 2, max];
  const every = W < 480 ? 4 : W < 900 ? 3 : 2;      // month labels: fewer on a narrow chart
  const months = pts.map((p, i) => ({ i, d: p.date })).filter((p, k, arr) => k === 0 || p.d.slice(0, 7) !== arr[k - 1].d.slice(0, 7))
    .filter((_, k) => k % every === 1);
  const hi = hover.i, hp = hi != null ? pts[hi] : null, hv = hp ? value(hp) : null;
  return (
    <figure ref={box} className="min-w-0">
      <figcaption className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-foreground/45">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block h-auto w-full touch-none select-none" role="img" aria-label={title}
        onPointerMove={(e) => hover.onMove(e, W)} onPointerDown={(e) => hover.onMove(e, W)} onPointerLeave={hover.onLeave}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 3.5} textAnchor="end" className="fill-foreground/45 font-mono text-[10px]">{fmt(t)}</text>
          </g>
        ))}
        {months.map(({ i, d }) => (
          <text key={d} x={x(i)} y={H - 4} textAnchor="middle" className="fill-foreground/40 font-mono text-[10px]">
            {new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}
          </text>
        ))}
        {area && path && <path d={`${path}L${x(pts.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} className={cls} fill="currentColor" fillOpacity={0.12} />}
        <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" className={cls} />
        {refLine != null && (
          <g className="text-foreground/60">
            <line x1={PAD_L} x2={W - PAD_R} y1={y(refLine)} y2={y(refLine)} stroke="currentColor" strokeWidth={1.25} strokeDasharray="5 4" />
            {refLabel && <text x={W - PAD_R - 2} y={y(refLine) + 14 < H - bottom ? y(refLine) + 14 : y(refLine) - 5} textAnchor="end" className="fill-foreground/70 font-mono text-[10.5px]">{refLabel}</text>}
          </g>
        )}
        {hp && hv != null && (
          <g>
            <line x1={x(hi!)} x2={x(hi!)} y1={top} y2={H - bottom} stroke="var(--border-strong)" strokeWidth={1} />
            <circle cx={x(hi!)} cy={y(hv)} r={4} className={cls} fill="currentColor" stroke="var(--background)" strokeWidth={2} />
          </g>
        )}
      </svg>
      <p className="h-4 font-mono text-[11px] tabular-nums text-foreground/60" aria-live="polite">
        {hp && hv != null ? <>{dayLabel(hp.date)} · <span className="text-foreground">{fmt(hv)}</span></> : <span className="text-foreground/35">Hover or tap the chart for a day</span>}
      </p>
    </figure>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────
function RiskBar({ v }: { v?: number | null }) {
  if (v == null) return <span className="text-foreground/30">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-foreground/[0.08]" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} />
      </span>
      <span className="w-9 text-right">{pct(v)}</span>
    </span>
  );
}

function Row({ h }: { h: VolTargetHolding }) {
  const hot = h.forecast != null && h.long_run != null && h.forecast > h.long_run * 1.1;
  const cool = h.forecast != null && h.long_run != null && h.forecast < h.long_run * 0.9;
  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className="py-2.5 pr-3">
        <Link href={`/stocks/${h.symbol}`} className="font-medium text-foreground hover:text-accent">{h.symbol}</Link>
        <p className="font-sans text-[11px] text-foreground/45">
          {[h.shares ? `${h.shares} sh` : null, h.long_contracts ? `+${ct(h.long_contracts)} long` : null,
            h.short_contracts ? `−${ct(h.short_contracts)} sold` : null].filter(Boolean).join(" · ") || "—"}
        </p>
      </td>
      <td className="sensitive py-2.5 pr-3 text-right">{money(h.exposure)}<p className="text-[11px] text-foreground/45">{pct(h.weight, 1)}<span className="hidden sm:inline"> of capital</span></p></td>
      <td className="py-2.5 pr-3 text-right" title={`Long-run ${vol(h.long_run)} · last 20 days ${vol(h.realized_20d)}`}>
        <span className={clsx(hot ? "text-loss" : cool ? "text-gain" : "text-foreground")}>{vol(h.forecast)}</span>
        <p className="text-[11px] text-foreground/45">avg {vol(h.long_run, 0)}</p>
      </td>
      <td className="hidden sm:table-cell py-2.5 pr-3 text-right"><RiskBar v={h.risk_share} /></td>
      <td className="hidden sm:table-cell py-2.5 pr-3 text-right text-foreground/70"
        title={h.has_options ? "Not shown with options: an option's risk isn't a share of capital" : "Exposure this stock alone would get: target ÷ its own forecast, capped"}>{pct(h.own_exposure)}</td>
      <td className={clsx("hidden sensitive py-2.5 pr-3 text-right md:table-cell", h.unlimited_loss ? "text-loss" : "text-foreground/75")}
        title={h.worst_day != null ? `Worst replayed day ${money(-h.worst_day, true)} · 1-in-100 day ${money(-(h.loss_99 ?? 0), true)}` : undefined}>
        {h.unlimited_loss ? "unlimited" : money(h.max_loss)}
      </td>
      <td className="hidden sm:table-cell sensitive py-2.5 pr-3 text-right">{money(h.suggested_exposure)}</td>
      <td className={clsx("sensitive py-2.5 text-right", (h.change ?? 0) > 0 ? "text-gain" : (h.change ?? 0) < 0 ? "text-loss" : "text-foreground/55")}>
        {money(h.change, true)}
        {h.contracts_after ? (
          <p className="text-[11px]" title="Contracts at the target scale (every position scales the same)">
            {[h.long_contracts ? `long ${ct(h.long_contracts)}→${ct(h.contracts_after.long)}` : null,
              h.short_contracts ? `sold ${ct(h.short_contracts)}→${ct(h.contracts_after.short)}` : null].filter(Boolean).join(" · ")}
          </p>
        ) : <p className="text-[11px]">{sh(h.change_shares)} Δ</p>}
      </td>
    </tr>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────
export function VolTargetTab() {
  const [prefs, setPrefs] = useState<{ target: number; cap: number }>({ target: 0.15, cap: 1 });
  const loaded = useRef(false);
  useEffect(() => { setPrefs(readPrefs()); loaded.current = true; }, []);
  useEffect(() => { if (loaded.current) try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage off */ } }, [prefs]);
  const { data: d, isLoading, error } = useQuery({
    queryKey: ["vol-target", prefs.target, prefs.cap], queryFn: () => fetchVolTarget(prefs.target, prefs.cap),
    refetchInterval: REFRESH_MS, staleTime: REFRESH_MS, placeholderData: (prev) => prev,
  });
  const pts = useMemo(() => d?.chart ?? [], [d?.chart]);
  const hover = useHover(pts.length);
  const volMax = useMemo(() => {
    const m = Math.max(prefs.target, ...pts.map((p) => p.forecast ?? 0));
    return Math.ceil((m * 1.1) / 0.05) * 0.05;
  }, [pts, prefs.target]);
  const scaleMax = useMemo(() => {
    const m = Math.max(1, ...pts.map((p) => p.scale ?? 0));
    return Math.ceil((m * 1.1) / 0.5) * 0.5;
  }, [pts]);
  const add = d?.scale != null ? d.scale - 1 : null;
  const verdict = d?.scale == null ? null
    : Math.abs(add!) < 0.05 ? "On target: keep the book as it is."
    : add! < 0 ? `Too much risk: cut every position${d.method === "repriced" ? " (contracts too)" : ""} to ${pct(d.scale)} of its size.`
    : `Room for more: you could scale every position to ${pct(d.scale)}${d.capped ? " (held back by the cap)" : ""}.`;

  return (
    <>
      <div className="-mx-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-[var(--border-strong)] px-4 py-2 sm:mx-0 sm:px-0">
        <Chips label="Target vol" options={TARGETS} value={prefs.target as typeof TARGETS[number]} onChange={(t) => setPrefs((p) => ({ ...p, target: t }))} fmt={(v) => `${v * 100}%`} />
        <Chips label="Max exposure" options={CAPS} value={prefs.cap as typeof CAPS[number]} onChange={(c) => setPrefs((p) => ({ ...p, cap: c }))} fmt={(v) => `${v}×`} />
        <p className="ml-auto text-right font-mono text-[11px] text-foreground/45">
          {d && <span className={clsx(d.method === "repriced" && "text-foreground/70")}
            title={d.method === "repriced" ? "Every option leg repriced with Black-Scholes on each past day: vega, gamma, theta and the loss cap included" : "Shares only: delta dollars are exact"}>
            {d.method === "repriced" ? "method: options fully repriced" : "method: shares (delta)"}
          </span>}
          {d?.capital_source && <span> · {d.capital_source === "account" ? "capital = synced account value" : d.capital_source === "gross" ? "capital = gross exposure (no account value synced)" : "capital set"}</span>}
        </p>
      </div>

      {error && !d && <p className="py-6 text-[14px] text-loss">{(error as Error).message || "Couldn't compute the volatility target."}</p>}
      {isLoading && <Computing what="your forecast" />}
      {d?.error && <p className="py-10 text-[15px] text-foreground/60">{d.error}</p>}

      {d && !d.error && (
        <>
          <div className="py-5">
            {verdict && <p className={clsx("mb-4 border-l-[3px] pl-3 text-[15px] font-medium", add! < -0.05 ? "border-loss text-foreground" : add! > 0.05 ? "border-gain text-foreground" : "border-accent text-foreground")}>{verdict}</p>}
            {d.scale != null && d.scale < 0.25 && (
              <p className="-mt-2 mb-4 pl-[15px] text-[12.5px] text-foreground/55">
                A scale this small isn&apos;t an error: options move like many more shares than the cash they cost, so an options-heavy book can carry several times the target&apos;s daily swings. Theory explains it.
              </p>
            )}
            <DeskFigures>
              <DeskFigure size="lg" label="Forecast vol" value={vol(d.forecast)}
                tone={d.forecast != null && d.forecast > prefs.target ? "text-loss" : "text-gain"}
                sub={`target ${vol(prefs.target, 0)} · avg ${vol(d.long_run, 0)}`} />
              <DeskFigure label="Scale" value={d.scale != null ? `${d.scale.toFixed(2)}×` : "—"} sub={d.capped ? "at the cap" : "× every position"} />
              <DeskFigure sensitive label="Gross exposure" value={money(d.gross)} sub={`→ ${money(d.scale != null ? d.gross * d.scale : null)} at target`} />
              <DeskFigure sensitive label="Capital" value={money(d.capital)} sub={`${pct(d.capital ? d.gross / d.capital : null)} invested`} />
            </DeskFigures>
            <DeskFigures className="mt-4 border-t border-[var(--border)] pt-4">
              <DeskFigure sensitive label="Worst day" value={money(d.worst_day != null ? -d.worst_day : null, true)} tone="text-loss"
                sub={`replayed · ${pct(d.capital && d.worst_day != null ? d.worst_day / d.capital : null, 1)} of capital`} />
              <DeskFigure sensitive label="1-in-100 day" value={money(d.loss_99 != null ? -d.loss_99 : null, true)}
                sub={`${pct(d.capital && d.loss_99 != null ? d.loss_99 / d.capital : null, 1)} of capital`} />
              <DeskFigure sensitive label="Max loss" value={d.unlimited.length ? "Unlimited" : money(d.max_loss)}
                tone={d.unlimited.length ? "text-loss" : undefined}
                sub={d.unlimited.length ? `calls sold beyond cover: ${d.unlimited.join(" · ")}` : "held to expiry"} />
            </DeskFigures>
            {d.vix_note && <p className="mt-3 font-mono text-[11px] text-warn">{d.vix_note}</p>}
          </div>

          <DeskSection label="Forecast vs target" meta={<>Your book as it is today,<br />replayed over the last year.<br />Above the dashed line:<br />hold less.</>}>
            {pts.length > 1 ? (
              <div className="grid gap-4">
                <LineChart pts={pts} value={(p) => p.forecast} height={180} max={volMax} refAt={prefs.target} refLabel={`your target ${vol(prefs.target, 0)}`}
                  fmt={(v) => `${Math.round(v * 100)}%`} title="Forecast volatility of your book (annual)" cls="text-accent" hover={hover} />
                <LineChart pts={pts} value={(p) => p.scale} height={140} max={scaleMax} refAt={1}
                  fmt={(v) => `${+v.toFixed(2)}×`} title="Scale the rule gives your book (dashed 1× = as is; below: cut, above: add)" cls="text-gain" hover={hover} area />
                <p className="font-mono text-[11.5px] text-foreground/55">
                  Today: {vol(d.forecast)} forecast → {d.scale != null ? `${d.scale.toFixed(2)}×` : "—"}
                  {d.max_scale != null && <> · the {prefs.cap}× max exposure allows up to {d.max_scale.toFixed(2)}×</>}.
                </p>
              </div>
            ) : <p className="text-[13px] text-foreground/55">Not enough shared price history to chart.</p>}
          </DeskSection>

          <DeskSection label="By holding" meta={<>Exposure = delta dollars:<br />shares and options together.<br />Change = what to add or cut<br />to hit the target.</>}>
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full font-mono sm:min-w-[720px] md:min-w-[820px] text-[12.5px] tabular-nums">
                <thead>
                  <tr className="border-b border-[var(--border-strong)] text-[10px] uppercase tracking-[0.14em] text-foreground/45">
                    <th className="pb-2 pr-3 text-left font-normal">Symbol</th>
                    <th className="pb-2 pr-3 text-right font-normal">Exposure</th>
                    <th className="pb-2 pr-3 text-right font-normal" title="GARCH forecast, annual; red above its own average, green below"><span className="sm:hidden">Vol</span><span className="hidden sm:inline">Forecast vol</span></th>
                    <th className="hidden sm:table-cell pb-2 pr-3 text-right font-normal" title="Share of the book's risk (variance)">Risk share</th>
                    <th className="hidden sm:table-cell pb-2 pr-3 text-right font-normal" title="target ÷ this stock's own forecast, capped">Alone</th>
                    <th className="hidden pb-2 pr-3 text-right font-normal md:table-cell" title="Most it can lose if every leg is held to expiry">Max loss</th>
                    <th className="hidden sm:table-cell pb-2 pr-3 text-right font-normal">At target</th>
                    <th className="pb-2 text-right font-normal">Change</th>
                  </tr>
                </thead>
                <tbody>{d.holdings.map((h) => <Row key={h.symbol} h={h} />)}</tbody>
              </table>
            </div>
            {d.holdings.some((h) => h.error) && (
              <p className="mt-2 font-mono text-[11px] text-foreground/45">Left out of the forecast: {d.holdings.filter((h) => h.error).map((h) => `${h.symbol} (${h.error})`).join(" · ")}</p>
            )}
            {d.holdings.some((h) => h.note) && (
              <p className="mt-1 font-mono text-[11px] text-warn">{d.holdings.filter((h) => h.note).map((h) => `${h.symbol}: ${h.note}`).join(" · ")}</p>
            )}
          </DeskSection>

        </>
      )}
    </>
  );
}

/** The Theory pop-up for this tab. */
export function VolTargetTheory() {
  return (
    <Theory title="Volatility targeting">
      <P>Hold less when markets get wild, more when they&apos;re calm, so the risk you carry stays about the same.</P>
      <Formula>exposure = σ_target ÷ σ̂_forecast</Formula>
      <Terms rows={[
        ["exposure", "how much of your capital is in the market"],
        ["σ_target", "the risk you want, as annual volatility (the Target vol chips)"],
        ["σ̂_forecast", "the forecast of market risk; the hat means it's an estimate"],
      ]} />
      <P>With a 15% target: a 10% forecast gives 150% (leverage, or 100% at the cap), 15% gives 100%, 30% gives 50%.</P>

      <H>The forecast: GARCH(1,1)</H>
      <Formula>var[t+1] = ω + α·move[t]² + β·var[t]</Formula>
      <Terms rows={[
        ["α = 0.10", "a big move today raises tomorrow's risk"],
        ["β = 0.85", "risk fades slowly: volatility comes in clusters"],
        ["ω", "set to (1 − α − β) × the 3-year average variance, so the forecast drifts back to normal"],
      ]} />
      <P>α + β = 0.95: a shock loses half its effect in about 13 trading days. Daily variance × 252 sessions, square-rooted, gives the annual vol shown.</P>

      <H>How this tab uses it: shares</H>
      <P>For shares the daily P&amp;L is exact: shares × price × that day&apos;s move. Your book as it is today is replayed over three years of daily returns and the forecast runs on that, so holdings that move together count as more risk than ones that offset.</P>

      <H>Options: every contract repriced</H>
      <P>Delta alone is wrong for options. A LEAPS also moves with implied volatility, a long option can never lose more than it&apos;s worth, and sold options lose faster the further the stock runs at them while earning time decay. So as soon as you hold any option, every contract (bought or sold) is repriced with Black-Scholes on each past day:</P>
      <Formula>P&amp;L = contracts × 100 × [ BS(S·eʳ, σ₁, T − 1 day) − BS(S, σ, T) ]</Formula>
      <Terms rows={[
        ["S·eʳ", "today's price moved by that day's actual return"],
        ["σ₁", "the contract's implied vol moved with VIX that day: σ × VIX₁ ÷ VIX₀ (fear up → IV up)"],
        ["T − 1 day", "one trading day of time decay"],
        ["contracts", "signed: sold options are negative, so they earn theta and lose on big moves"],
      ]} />
      <P>What changes: a 1-year call gets about a quarter of its daily swing from implied vol, which delta ignored. For long calls IV usually rises when the stock falls, cushioning the loss, so the forecast is often lower than before; long puts the other way. Sold options show their real tail: <b className="font-medium text-foreground">Worst day</b> and <b className="font-medium text-foreground">1-in-100 day</b> are the replayed losses, and <b className="font-medium text-foreground">Max loss</b> is the most each holding can lose held to expiry: the premium for a long option, strike − credit for a sold put, unlimited for calls sold beyond the shares and long calls that cover them.</P>
      <P><b className="font-medium text-foreground">Scale</b> = target ÷ forecast, cut so gross exposure stays within max exposure × capital. Every position gets the same scale, contracts included; scaling the contracts scales their repriced P&amp;L exactly, so the rule holds for options too. <b className="font-medium text-foreground">Change</b> shows the delta dollars to add or cut, and for option holdings the contract counts at the target (e.g. long 5→3.6).</P>

      <H>Why the scale can be tiny</H>
      <P>Risk is measured against your capital. An option costs far less than the shares it moves like: a call worth $500 can move like $10,000 of stock. So a book of options can swing many times more than its cash suggests, and the forecast can read 100% a year or more even though each stock is &quot;only&quot; 40–60% volatile. Then target ÷ forecast is small: 15% ÷ 200% = 0.075×, meaning that book carries about 13× the daily swings you asked for. It&apos;s consistent, not a bug. Remember the other side too: a long option&apos;s loss stops at its price (Max loss), so for a book of bought LEAPS the daily swings are big but the worst case is bounded.</P>

      <H>Limits</H>
      <P>Implied vol follows VIX in proportion; a single stock&apos;s IV can also jump on its own news (earnings), which the replay doesn&apos;t see. Prices use Black-Scholes, not the market&apos;s skew. The replay holds today&apos;s book fixed: it measures today&apos;s risk, not how you did.</P>

      <H>Why it works, and what it costs</H>
      <P>Big losses tend to come when volatility spikes, and that&apos;s when the rule has you holding less. It usually improves return per unit of risk. The cost: after a crash, volatility stays high while prices rebound, so you can be underweight for the recovery. It also trades more often.</P>
      <p className="text-foreground/50">A forecast, not advice.</p>
    </Theory>
  );
}
