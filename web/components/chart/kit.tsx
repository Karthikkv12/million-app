"use client";
/**
 * Chart kit — one look for every Recharts chart: faint horizontal grid,
 * no axis lines, 11px mono ticks, a card-style tooltip, muted gain/loss.
 */
import { useChartColors } from "@/components/ui";

export function useChartStyle() {
  const c = useChartColors();
  return {
    c,
    grid: { stroke: c.grid, strokeDasharray: "0", vertical: false } as const,
    xAxis: { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: c.muted, fontFamily: "var(--font-mono)" }, tickMargin: 8 } as const,
    yAxis: { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: c.muted, fontFamily: "var(--font-mono)" }, width: 48 } as const,
    cursor: { stroke: c.border, strokeDasharray: "3 3" },
    barCursor: { fill: c.grid },
  };
}

interface Row { label: string; value: string; color?: string }

/** Tooltip card. Pass `rows` built from Recharts' payload via `format`. */
export function ChartTooltip({
  active, payload, label, title, format,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
  label?: unknown;
  title?: (label: unknown) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  format: (payload: any[]) => Row[];
}) {
  if (!active || !payload?.length) return null;
  const rows = format(payload);
  return (
    <div className="min-w-[150px] rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 shadow-[var(--shadow-float)]">
      {title && <p className="mb-1.5 font-mono text-[11px] text-foreground/55">{title(label)}</p>}
      <div className="grid gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-1.5 text-foreground/65">
              {r.color && <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />}
              {r.label}
            </span>
            <span className="font-mono font-medium tabular-nums text-foreground">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-foreground/55">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.dashed
            ? <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: i.color }} />
            : <span className="h-2 w-2 rounded-sm" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  );
}
