"use client";
/**
 * Sectors — ranked sector rows (SPDR ETF move, diverging bar) that expand in place into a
 * heat strip of the sector's key stocks, tile width ∝ market cap. Replaces the old Markets page.
 */
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";
import { heatColor } from "@/components/ui";
import { DeskRow } from "@/components/desk";
import { useQuotes } from "./quotes";
import { SECTORS, SECTOR_ROWS, StockTile } from "./sector-baskets";

const STOCKS = Array.from(new Set(Object.values(SECTORS).flatMap((s) => s.stocks.map((x) => x.symbol))));
const ETFS = SECTOR_ROWS.map((r) => r.etf).filter((e): e is string => !!e);
const SYMBOLS = [...ETFS, ...STOCKS];

const pctTxt = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);

export function Sectors() {
  const { data: q } = useQuotes(SYMBOLS, 15_000);
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const basketMove = (stocks: StockTile[]) => {
      const xs = stocks.map((s) => ({ w: s.weight, p: q?.[s.symbol]?.change_pct })).filter((x): x is { w: number; p: number } => x.p != null);
      const w = xs.reduce((a, x) => a + x.w, 0);
      return w ? xs.reduce((a, x) => a + x.w * x.p, 0) / w : null;
    };
    return SECTOR_ROWS.map((r) => {
      const stocks = (r.baskets ?? []).flatMap((k) => SECTORS[k].stocks).sort((a, b) => b.weight - a.weight);
      const pct = r.etf ? q?.[r.etf]?.change_pct ?? null : basketMove(stocks);
      const breadth = stocks.length ? stocks.filter((s) => (q?.[s.symbol]?.change_pct ?? 0) > 0).length / stocks.length : null;
      return { ...r, key: r.etf ?? r.label, stocks, pct, breadth };
    }).sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
  }, [q]);

  const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.pct ?? 0)));

  return (
    <div className="border-t border-[var(--border)]">
      {rows.map((r) => {
        const isOpen = open === r.key;
        const w = r.pct == null ? 0 : (Math.abs(r.pct) / max) * 50;
        const canOpen = r.stocks.length > 0;
        return (
          <Fragment key={r.key}>
            <DeskRow onClick={canOpen ? () => setOpen(isOpen ? null : r.key) : undefined} active={isOpen}>
              <div className="grid min-h-[48px] grid-cols-[minmax(0,1.25fr)_minmax(48px,1fr)_64px_16px] items-center gap-x-3 py-2 pl-4 pr-3 sm:grid-cols-[minmax(0,1.3fr)_52px_minmax(80px,1fr)_68px_64px_18px]">
                <span className="text-[13.5px] leading-tight text-foreground/85">{r.label}</span>
                <span className="hidden font-mono text-[11.5px] text-foreground/45 sm:inline">{r.etf ?? "basket"}</span>
                <span className="relative h-[8px]" aria-hidden>
                  <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[var(--border-strong)]" />
                  {r.pct != null && (
                    <span className={clsx("absolute inset-y-0", r.pct >= 0 ? "bg-gain/75" : "bg-loss/75")}
                      style={r.pct >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
                  )}
                </span>
                <span className={clsx("text-right font-mono text-[13px] tabular-nums", r.pct == null ? "text-foreground/40" : r.pct >= 0 ? "text-gain" : "text-loss")}>{pctTxt(r.pct)}</span>
                <span className="hidden text-right font-mono text-[11px] text-foreground/45 sm:inline" title="Share of the basket's stocks that are up">
                  {r.breadth != null ? `${Math.round(r.breadth * 100)}% up` : ""}
                </span>
                {canOpen ? <ChevronDown size={14} className={clsx("text-foreground/40 transition", isOpen && "rotate-180")} /> : <span />}
              </div>
            </DeskRow>
            {isOpen && (
              <div className="flex flex-wrap gap-[2px] border-b border-[var(--border)] bg-foreground/[0.025] p-3">
                {r.stocks.map((s) => {
                  const p = q?.[s.symbol]?.change_pct ?? null;
                  const c = heatColor(p);
                  return (
                    <Link key={s.symbol} href={`/stocks/${s.symbol}`} title={`${s.name} ${pctTxt(p)}`}
                      className="flex min-h-[54px] min-w-[64px] flex-col justify-between px-2 py-1.5 transition hover:brightness-110"
                      style={{ flexGrow: Math.max(1, Math.sqrt(s.weight)), flexBasis: 0, background: c.bg, color: c.fg }}>
                      <span className="font-mono text-[12px] font-semibold">{s.symbol}</span>
                      <span className="font-mono text-[11px] tabular-nums opacity-90">{pctTxt(p)}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
