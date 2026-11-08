"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronLeft, Zap } from "lucide-react";
import { fetchGex, GexResult } from "@/lib/api";
import TradingChart from "@/components/chart/TradingChart";
import TickerSearchInput from "@/components/TickerSearchInput";
import { Panel, Pill } from "@/components/ui";
import { GexReplay } from "@/components/options-flow/GexReplay";
import { SourceBadge, sourceName } from "@/components/options-flow/SourceBadge";

const usd = (v?: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dist = (lv?: number | null, spot?: number) => (lv == null || !spot ? "" : `${lv >= spot ? "+" : ""}${(((lv - spot) / spot) * 100).toFixed(1)}%`);
const bigUsd = (v?: number | null) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "+";
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : `${s}$${(a / 1e6).toFixed(0)}M`;
};

export default function StockPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const sym = decodeURIComponent(symbol).toUpperCase();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [showLevels, setShowLevels] = useState(true);

  const { data: gex, isLoading: gexLoading } = useQuery<GexResult>({
    queryKey: ["gex", sym],
    queryFn: () => fetchGex(sym),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const levels = useMemo(() => (gex && !gex.error && showLevels ? {
    spot: gex.spot,
    callWall: gex.max_call_wall,
    putWall: gex.max_put_wall,
    zeroGamma: gex.zero_gamma,
    kingNode: gex.max_gex_strike,
  } : undefined), [gex, showLevels]);

  const longGamma = (gex?.net_gex ?? 0) >= 0;
  const rows = gex && !gex.error ? [
    { label: "King node", v: gex.max_gex_strike, cls: "text-[#b45309] dark:text-[#fde725]", note: "Largest gamma strike; price often pins here" },
    { label: "Call wall", v: gex.max_call_wall, cls: "text-gain", note: "Likely ceiling" },
    { label: "Flip", v: gex.zero_gamma, cls: "text-accent", note: "Dealer behaviour changes here" },
    { label: "Put wall", v: gex.max_put_wall, cls: "text-loss", note: "Likely floor" },
  ].sort((a, b) => (b.v ?? 0) - (a.v ?? 0)) : [];

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 pb-16 pt-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground"><ChevronLeft size={16} /> Back</button>
        <TickerSearchInput value={q} onChange={setQ} onSelect={(s) => router.push(`/stocks/${encodeURIComponent(s.trim().toUpperCase())}`)} placeholder="Open another ticker" actionLabel="Open" className="w-full sm:w-80" />
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />Stock</p>
          <h1 className="font-mono text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-[40px]">{sym}</h1>
          {gex && !gex.error && <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[15px] text-foreground/60">{usd(gex.spot)} <SourceBadge data={gex} />{gex.stale && (
            <span className="text-[12px] text-foreground/40">{sourceName(gex)} is rate-limiting; levels from {gex.as_of ? new Date(gex.as_of).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "earlier"}</span>
          )}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/options-flow?ticker=${sym}`} className="btn-ghost h-10"><Zap size={15} /> Flow board</Link>
          <Link href={`/catalyst/${sym}`} className="btn-ghost h-10"><CalendarClock size={15} /> Catalysts</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel padded={false} title="Price" actions={
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground/65">
            <input type="checkbox" checked={showLevels} onChange={(e) => setShowLevels(e.target.checked)} className="accent-[rgb(var(--accent-rgb))]" />
            GEX levels <SourceBadge data={gex} />
          </label>
        }>
          <div className="p-2"><TradingChart symbol={sym} gexLevels={levels} initialPeriod="5D" /></div>
        </Panel>

        <Panel title="Dealer levels" actions={gex && !gex.error ? <Pill tone={longGamma ? "good" : "warn"} className="normal-case tracking-normal">{longGamma ? "+GEX · pinned" : "−GEX · volatile"}</Pill> : null}>
          {gexLoading ? <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div>
            : !gex || gex.error ? <p className="text-[13px] text-foreground/60">No options data for {sym}.</p> : (
              <>
                <ul className="divide-y divide-[var(--border)]">
                  {rows.map((r) => (
                    <li key={r.label} className="py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={`font-mono text-[11px] uppercase tracking-[0.14em] ${r.cls}`}>{r.label}</span>
                        <span className="font-mono text-[15px] font-medium tabular-nums text-foreground">{usd(r.v)} <span className="text-[12px] text-foreground/45">{dist(r.v, gex.spot)}</span></span>
                      </div>
                      <p className="text-[12px] text-foreground/50">{r.note}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-baseline justify-between border-t border-[var(--border)] pt-3">
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Net GEX</span>
                  <span className={`font-mono text-[15px] tabular-nums ${longGamma ? "text-gain" : "text-loss"}`}>{bigUsd(gex.net_gex)}</span>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-foreground/55">
                  {gex.zero_gamma != null && (gex.spot >= gex.zero_gamma
                    ? "Above the flip: dealers tend to sell rallies and buy dips, which dampens moves."
                    : "Below the flip: dealers tend to sell into drops and buy into rallies, which stretches moves.")}
                </p>
              </>
            )}
        </Panel>
      </div>

      <div className="mt-4">
        <GexReplay symbol={sym} />
      </div>
    </div>
  );
}
