"use client";
/**
 * SVG overlay over the price pane of the Pulse chart: drawings (trend, ray, horizontal, vertical, Fibonacci,
 * rectangle, text, measure), price alerts and paper trade plans. Points are stored as (time, price) and placed with
 * the chart's own coordinate conversions, so they follow pan, zoom, scale mode and interval changes.
 *
 * With no tool picked the layer lets mouse events through to the chart except on the drawings themselves, which can
 * be selected and dragged (not when locked). With a tool picked, clicks place points.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, SeriesType, Logical } from "lightweight-charts";
import type { Drawing, DrawTool, Pt } from "./drawings";
import { FIB_LEVELS, TOOLS, logicalToTime, timeToLogical } from "./drawings";
import type { Bar } from "./indicators";
import type { PriceAlert, TradePlan } from "./store";
import { uid } from "./store";

interface Props {
  chart: IChartApi | null;
  series: ISeriesApi<SeriesType> | null;
  bars: Bar[];
  drawings: Drawing[];
  onChange: (next: Drawing[]) => void;
  tool: DrawTool | null;
  onToolDone: () => void;
  magnet: boolean;
  hideAll: boolean;
  color: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  alerts: PriceAlert[];
  plans: TradePlan[];
  dark: boolean;
  /** Bumped by the parent when series data or options change, to re-place everything. */
  version: number;
}

interface Box { w: number; h: number }

export function DrawingLayer({
  chart, series, bars, drawings, onChange, tool, onToolDone, magnet, hideAll, color, selected, onSelect,
  alerts, plans, dark, version,
}: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  const [, setTick] = useState(0);
  const [draft, setDraft] = useState<Pt[] | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const drag = useRef<{ id: string; idx: number | null; start: Pt; orig: Pt[] } | null>(null);
  const times = bars.map((b) => b.time);

  // Re-render whenever the visible area moves. Price-axis drags have no event, so compare a cheap signature each frame.
  useEffect(() => {
    if (!chart || !series) return;
    let raf = 0, sig = "";
    const loop = () => {
      const ts = chart.timeScale();
      const r = ts.getVisibleLogicalRange();
      const pane = chart.panes()[0];
      const w = Math.max(0, ts.width());
      const h = pane ? pane.getHeight() : 0;
      const ref = bars.length ? bars[bars.length - 1].close : 0;
      const s = `${r?.from}|${r?.to}|${w}|${h}|${series.priceToCoordinate(ref)}|${series.priceToCoordinate(ref * 1.01)}`;
      if (s !== sig) {
        sig = s;
        setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [chart, series, bars, version]);

  const X = useCallback((t: number): number | null => {
    if (!chart) return null;
    return chart.timeScale().logicalToCoordinate(timeToLogical(times, t) as Logical);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, bars]);
  const Y = useCallback((p: number): number | null => (series ? series.priceToCoordinate(p) : null), [series]);

  /** Pixel → (time, price), snapped to the nearest bar's OHLC when the magnet is on. */
  const toPt = useCallback((x: number, y: number): Pt | null => {
    if (!chart || !series) return null;
    const l = chart.timeScale().coordinateToLogical(x);
    const p = series.coordinateToPrice(y);
    if (l == null || p == null) return null;
    let t = logicalToTime(times, l);
    let price = p as number;
    if (magnet && bars.length) {
      const i = Math.max(0, Math.min(bars.length - 1, Math.round(l)));
      const b = bars[i];
      t = b.time;
      let best = price, bd = Infinity;
      for (const v of [b.open, b.high, b.low, b.close]) {
        const yy = series.priceToCoordinate(v);
        if (yy != null && Math.abs(yy - y) < bd) { bd = Math.abs(yy - y); best = v; }
      }
      if (bd < 40) price = best;
    }
    return { t, p: Math.round(price * 100) / 100 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, series, bars, magnet]);

  const local = (e: React.PointerEvent | PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // ── Placing points ─────────────────────────────────────────────────────────
  const need = tool ? TOOLS.find((t) => t.id === tool)!.points : 0;
  useEffect(() => { setDraft(null); }, [tool]);

  const finish = (pts: Pt[]) => {
    let text: string | undefined;
    if (tool === "text") {
      text = window.prompt("Text for the chart", "") ?? "";
      if (!text.trim()) { setDraft(null); onToolDone(); return; }
    }
    const d: Drawing = { id: uid(), tool: tool!, pts, color, text };
    onChange([...drawings, d]);
    onSelect(d.id);
    setDraft(null);
    onToolDone();
  };

  const onDown = (e: React.PointerEvent) => {
    if (!tool) return;
    e.preventDefault();
    const { x, y } = local(e);
    const pt = toPt(x, y);
    if (!pt) return;
    const pts = [...(draft ?? []), pt];
    if (pts.length >= need) finish(pts);
    else setDraft(pts);
  };

  const onMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    if (tool) { setHover(toPt(x, y)); return; }
    const d = drag.current;
    if (!d) return;
    const pt = toPt(x, y);
    if (!pt) return;
    const dt = pt.t - d.start.t, dp = pt.p - d.start.p;
    onChange(drawings.map((dr) => {
      if (dr.id !== d.id) return dr;
      if (d.idx != null) return { ...dr, pts: dr.pts.map((q, i) => (i === d.idx ? pt : q)) };
      return { ...dr, pts: d.orig.map((q) => ({ t: q.t + dt, p: Math.round((q.p + dp) * 100) / 100 })) };
    }));
  };

  useEffect(() => {
    const up = () => { drag.current = null; };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const startDrag = (e: React.PointerEvent, dr: Drawing, idx: number | null) => {
    if (tool) return;
    e.stopPropagation();
    onSelect(dr.id);
    if (dr.locked) return;
    const { x, y } = local(e);
    const pt = toPt(x, y);
    if (!pt) return;
    drag.current = { id: dr.id, idx, start: pt, orig: dr.pts };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  // ── Rendering ──────────────────────────────────────────────────────────────
  const { w, h } = box;
  const ink = dark ? "#e5e7eb" : "#0e0f12";
  const font = "DM Mono, ui-monospace, monospace";
  const label = (x: number, y: number, text: string, fill: string, anchor: "start" | "end" | "middle" = "start") => (
    <text x={x} y={y} fill={fill} fontSize={10.5} fontFamily={font} textAnchor={anchor} style={{ paintOrder: "stroke", stroke: dark ? "#141a22" : "#ffffff", strokeWidth: 3 }}>{text}</text>
  );

  const shape = (d: Drawing, preview = false) => {
    const pts = d.pts;
    const xs = pts.map((q) => X(q.t)), ys = pts.map((q) => Y(q.p));
    if (xs.some((v) => v == null) || ys.some((v) => v == null)) return null;
    const [x1, x2] = [xs[0]!, xs[1] ?? xs[0]!], [y1, y2] = [ys[0]!, ys[1] ?? ys[0]!];
    const sel = !preview && d.id === selected;
    const sw = sel ? 2 : 1.5;
    const hit = (el: React.ReactNode) => (
      <g key={d.id} onPointerDown={(e) => startDrag(e, d, null)} style={{ cursor: tool ? undefined : d.locked ? "pointer" : "move", pointerEvents: tool || preview ? "none" : "visiblePainted" }}>
        {el}
      </g>
    );
    const handles = sel && !d.locked ? xs.map((x, i) => (
      <circle key={i} cx={x!} cy={ys[i]!} r={4.5} fill={dark ? "#141a22" : "#fff"} stroke={d.color} strokeWidth={1.5}
        style={{ cursor: "grab", pointerEvents: "all" }} onPointerDown={(e) => startDrag(e, d, i)} />
    )) : null;
    const wide = (path: React.ReactNode) => <>{path}</>;

    switch (d.tool) {
      case "trend":
      case "ray": {
        let ex = x2, ey = y2;
        if (d.tool === "ray" && x2 !== x1) { ex = w; ey = y1 + ((y2 - y1) * (w - x1)) / (x2 - x1); }
        return hit(<>
          <line x1={x1} y1={y1} x2={ex} y2={ey} stroke="transparent" strokeWidth={12} />
          <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={d.color} strokeWidth={sw} />
          {handles}
        </>);
      }
      case "hline":
        return hit(<>
          <line x1={0} x2={w} y1={y1} y2={y1} stroke="transparent" strokeWidth={12} />
          <line x1={0} x2={w} y1={y1} y2={y1} stroke={d.color} strokeWidth={sw} />
          {label(w - 6, y1 - 4, pts[0].p.toFixed(2), d.color, "end")}
          {handles}
        </>);
      case "vline":
        return hit(<>
          <line x1={x1} x2={x1} y1={0} y2={h} stroke="transparent" strokeWidth={12} />
          <line x1={x1} x2={x1} y1={0} y2={h} stroke={d.color} strokeWidth={sw} />
          {handles}
        </>);
      case "rect":
        return hit(<>
          <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)}
            fill={d.color} fillOpacity={0.12} stroke={d.color} strokeWidth={sw} />
          {handles}
        </>);
      case "fib": {
        const lo = Math.min(x1, x2), hi = Math.max(x1, x2, lo + 40);
        return hit(<>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={d.color} strokeDasharray="3 3" strokeWidth={1} />
          {FIB_LEVELS.map((f) => {
            const price = pts[1] ? pts[1].p + (pts[0].p - pts[1].p) * f : pts[0].p;
            const y = Y(price);
            if (y == null) return null;
            return <g key={f}>
              <line x1={lo} x2={hi} y1={y} y2={y} stroke="transparent" strokeWidth={10} />
              <line x1={lo} x2={hi} y1={y} y2={y} stroke={d.color} strokeOpacity={f === 0 || f === 1 ? 1 : 0.7} strokeWidth={1} />
              {label(lo + 4, y - 3, `${f} · ${price.toFixed(2)}`, d.color)}
            </g>;
          })}
          {handles}
        </>);
      }
      case "measure": {
        if (!pts[1]) return null;
        const dp = pts[1].p - pts[0].p, pct = (dp / pts[0].p) * 100;
        const nb = Math.round(timeToLogical(times, pts[1].t) - timeToLogical(times, pts[0].t));
        const up = dp >= 0;
        const c = up ? "#34d399" : "#fb7185";
        const span = Math.abs(pts[1].t - pts[0].t);
        const spanTxt = span >= 86400 ? `${(span / 86400).toFixed(1)}d` : span >= 3600 ? `${(span / 3600).toFixed(1)}h` : `${Math.round(span / 60)}m`;
        return hit(<>
          <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={c} fillOpacity={0.13} />
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={1.5} />
          {label((x1 + x2) / 2, Math.min(y1, y2) - 6, `${up ? "+" : ""}${dp.toFixed(2)} (${up ? "+" : ""}${pct.toFixed(2)}%) · ${nb} bars · ${spanTxt}`, c, "middle")}
          {handles}
        </>);
      }
      case "text":
        return hit(<>
          <text x={x1} y={y1} fill={d.color} fontSize={13} fontFamily={font} fontWeight={600}
            style={{ paintOrder: "stroke", stroke: dark ? "#141a22" : "#ffffff", strokeWidth: 3 }}>{d.text}</text>
          {sel && <rect x={x1 - 3} y={y1 - 15} width={(d.text?.length ?? 1) * 8 + 6} height={20} fill="none" stroke={d.color} strokeDasharray="2 2" />}
        </>);
    }
    return wide(null);
  };

  const preview: Drawing | null = tool && draft && hover
    ? { id: "draft", tool, pts: [...draft, hover].slice(0, need), color } : null;

  const planShapes = plans.filter((p) => p.status === "planned" || p.status === "open").map((p) => {
    const x0 = X(p.created / 1000) ?? 0;
    const ye = Y(p.entry), ys = Y(p.stop), yt = Y(p.target);
    if (ye == null || ys == null || yt == null) return null;
    const left = Math.max(0, Math.min(x0, w - 140));
    const risk = Math.abs(p.entry - p.stop), reward = Math.abs(p.target - p.entry);
    return (
      <g key={p.id} style={{ pointerEvents: "none" }}>
        <rect x={left} width={w - left} y={Math.min(ye, yt)} height={Math.abs(yt - ye)} fill="#34d399" fillOpacity={0.1} />
        <rect x={left} width={w - left} y={Math.min(ye, ys)} height={Math.abs(ys - ye)} fill="#fb7185" fillOpacity={0.1} />
        <line x1={left} x2={w} y1={ye} y2={ye} stroke={ink} strokeOpacity={0.7} strokeWidth={1} />
        <line x1={left} x2={w} y1={yt} y2={yt} stroke="#34d399" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={left} x2={w} y1={ys} y2={ys} stroke="#fb7185" strokeWidth={1} strokeDasharray="4 3" />
        {label(left + 4, ye - 4, `Paper ${p.side} ${p.qty} @ ${p.entry.toFixed(2)} · R:R ${risk ? (reward / risk).toFixed(2) : "—"}`, ink)}
        {label(left + 4, yt - 4, `Target ${p.target.toFixed(2)}`, "#34d399")}
        {label(left + 4, ys + 12, `Stop ${p.stop.toFixed(2)}`, "#fb7185")}
      </g>
    );
  });

  const alertShapes = alerts.filter((a) => !a.triggered).map((a) => {
    const y = Y(a.price);
    if (y == null) return null;
    return (
      <g key={a.id} style={{ pointerEvents: "none" }}>
        <line x1={0} x2={w} y1={y} y2={y} stroke="#f59e0b" strokeWidth={1} strokeDasharray="2 4" />
        {label(6, y - 4, `🔔 ${a.dir === "above" ? "≥" : "≤"} ${a.price.toFixed(2)}${a.note ? ` · ${a.note}` : ""}`, "#f59e0b")}
      </g>
    );
  });

  return (
    <svg ref={svg} width={w} height={h} data-pulse-overlay
      className="absolute left-0 top-0 z-10"
      style={{ pointerEvents: tool ? "all" : "none", cursor: tool ? "crosshair" : undefined, touchAction: tool ? "none" : undefined }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => setHover(null)}
      onClick={(e) => { if (!tool && e.target === svg.current) onSelect(null); }}>
      {alertShapes}
      {planShapes}
      {!hideAll && drawings.filter((d) => !d.hidden).map((d) => shape(d))}
      {preview && shape(preview, true)}
      {tool && hover && (() => { const x = X(hover.t), y = Y(hover.p); return x != null && y != null ? <circle cx={x} cy={y} r={3} fill={color} /> : null; })()}
    </svg>
  );
}

/** The chart canvas plus this overlay as one PNG (for copy / save). */
export async function compositeScreenshot(chart: IChartApi): Promise<HTMLCanvasElement> {
  const base = chart.takeScreenshot(true, false);
  const el = chart.chartElement();
  const overlay = el.parentElement?.querySelector("svg[data-pulse-overlay]") as SVGSVGElement | null;
  if (!overlay) return base;
  const ratio = base.width / Math.max(1, el.clientWidth);
  const clone = overlay.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("overlay")); img.src = url; });
    const out = document.createElement("canvas");
    out.width = base.width; out.height = base.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(img, 0, 0, overlay.width.baseVal.value * ratio, overlay.height.baseVal.value * ratio);
    return out;
  } catch { return base; } finally { URL.revokeObjectURL(url); }
}
