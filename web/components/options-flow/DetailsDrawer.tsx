"use client";
/**
 * DetailsDrawer — one ticker's dealer levels and option premium, desk style.
 *   Levels: a plain-language read, every level in one table (price, distance, meaning),
 *           the GEX profile, and the strikes holding the most gamma.
 *   Flow:   premium figures + call/put split, where the premium sits (strikes, expiries),
 *           and how net premium moved through the day.
 */
import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { X } from "lucide-react";
import type { GexResult } from "@/lib/api";
import { Tag } from "@/components/desk";
import { GexProfileChart } from "./GexProfileChart";
import { FlowMomentumChart } from "./FlowMomentumChart";

type Tab = "levels" | "flow";

interface Props {
  open: boolean;
  onClose: () => void;
  data: GexResult;
  ticker: string;
  accentColor: string;
}

const money = (v?: number | null) => {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(0)}K` : `${s}$${a.toFixed(0)}`;
};
const dist = (lvl: number | null | undefined, spot: number) => (lvl == null || !spot ? null : (lvl - spot) / spot);
const pct = (v: number | null, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const daysTo = (exp: string) => Math.max(0, Math.round((new Date(exp + "T16:00:00").getTime() - Date.now()) / 86_400_000));

function Section({ title, meta, children, className }: { title: string; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("border-b border-[var(--border)] px-5 py-5", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-foreground">{title}</h3>
        {meta && <span className="text-right font-mono text-[10.5px] text-foreground/45">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

// ── Levels ────────────────────────────────────────────────────────────────────
function Read({ d }: { d: GexResult }) {
  const long = (d.net_gex ?? 0) >= 0;
  const above = d.zero_gamma != null ? d.spot >= d.zero_gamma : null;
  const cw = dist(d.max_call_wall, d.spot), pw = dist(d.max_put_wall, d.spot), k = dist(d.max_gex_strike, d.spot);
  return (
    <Section title="The read" meta={<Tag tone={long ? "gain" : "warn"}>{long ? "+GEX · pinned" : "−GEX · volatile"}</Tag>}>
      <p className="text-[14.5px] leading-relaxed text-foreground/85">
        {long
          ? "Dealers are net long gamma: they sell into rallies and buy dips, which tends to slow moves down and pull price toward big strikes."
          : "Dealers are net short gamma: they have to buy rallies and sell dips, which tends to speed moves up and widen the day's range."}
        {above != null && d.zero_gamma != null && (
          <> Price is <b className="font-medium text-foreground">{above ? "above" : "below"}</b> the flip at {d.zero_gamma.toFixed(2)} ({pct(dist(d.zero_gamma, d.spot))}), {above ? "so a drop through it would switch dealers to amplifying moves." : "so reclaiming it would calm things down."}</>
        )}
      </p>
      <ul className="mt-3 grid gap-1.5 font-mono text-[12.5px] text-foreground/70">
        {d.max_call_wall != null && <li><span className="text-gain">▲ Resistance</span> call wall {d.max_call_wall} ({pct(cw)})</li>}
        {d.max_put_wall != null && <li><span className="text-loss">▼ Support</span> put wall {d.max_put_wall} ({pct(pw)})</li>}
        {d.max_gex_strike != null && <li><span className="text-[#b45309] dark:text-[#fde725]">★ Magnet</span> king node {d.max_gex_strike} ({pct(k)}), often where price pins into expiry</li>}
      </ul>
    </Section>
  );
}

function LevelsTable({ d }: { d: GexResult }) {
  const rows = [
    { name: "Call wall", price: d.max_call_wall, tone: "text-gain", note: "Largest call gamma: likely ceiling" },
    { name: "★ King", price: d.max_gex_strike, tone: "text-[#b45309] dark:text-[#fde725]", note: "Largest gamma overall: magnet" },
    { name: "Flip", price: d.zero_gamma, tone: "text-accent", note: "Dealer behaviour switches here" },
    { name: "Put wall", price: d.max_put_wall, tone: "text-loss", note: "Largest put gamma: likely floor" },
    { name: "Spot", price: d.spot, tone: "text-foreground", note: "Last price" },
  ].filter((r) => r.price != null).sort((a, b) => (b.price as number) - (a.price as number));
  return (
    <Section title="Levels" meta="sorted by price">
      <table className="w-full font-mono text-[13px] tabular-nums">
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={clsx("border-b border-[var(--border)] last:border-0", r.name === "Spot" && "bg-foreground/[0.05]")}>
              <td className={clsx("py-2 pl-2 pr-3 font-medium", r.tone)}>{r.name}</td>
              <td className="py-2 pr-3 text-right text-foreground">{(r.price as number).toFixed(2)}</td>
              <td className="w-16 py-2 pr-3 text-right text-foreground/55">{r.name === "Spot" ? "" : pct(dist(r.price, d.spot))}</td>
              <td className="hidden py-2 pr-2 font-sans text-[12.5px] text-foreground/55 sm:table-cell">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function TopGamma({ d }: { d: GexResult }) {
  const rows = useMemo(() => {
    const all = (d.strikes ?? []).map((s, i) => ({ strike: s, gex: d.gex_by_strike?.[i] ?? 0 }));
    const total = all.reduce((a, r) => a + Math.abs(r.gex), 0) || 1;
    return all.sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 6).map((r) => ({ ...r, share: Math.abs(r.gex) / total }));
  }, [d]);
  if (!rows.length) return null;
  const max = rows[0].share || 1;
  return (
    <Section title="Where the gamma sits" meta="share of total |GEX|, all expiries">
      <div className="grid gap-1.5">
        {rows.map((r) => (
          <div key={r.strike} className="grid grid-cols-[64px_minmax(0,1fr)_64px_56px] items-center gap-3 font-mono text-[12.5px] tabular-nums">
            <span className="text-foreground">{r.strike}</span>
            <span className="h-[8px] bg-foreground/[0.06]"><span className={clsx("block h-full", r.gex >= 0 ? "bg-gain/70" : "bg-loss/70")} style={{ width: `${(r.share / max) * 100}%` }} /></span>
            <span className="text-right text-foreground/70">{(r.share * 100).toFixed(1)}%</span>
            <span className="text-right text-foreground/45">{pct(dist(r.strike, d.spot))}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-foreground/45">Green = call-heavy (dampens), red = put-heavy (amplifies). A few dominant strikes mean strong pinning there.</p>
    </Section>
  );
}

// ── Flow ──────────────────────────────────────────────────────────────────────
export function Premium({ d }: { d: GexResult }) {
  const call = d.call_premium ?? 0, put = d.put_premium ?? 0, tot = call + put || 1;
  const ratio = put ? call / put : null;
  const figs: [string, string, string?][] = [
    ["Calls", money(call), "text-gain"],
    ["Puts", money(put), "text-loss"],
    ["Net", money(call - put), call >= put ? "text-gain" : "text-loss"],
    ["Call / put", ratio == null ? "—" : ratio.toFixed(2)],
    ["Volume", (d.total_volume ?? 0).toLocaleString()],
  ];
  return (
    <Section title="Premium" meta="open interest × mid">
      <div className="grid grid-cols-3 gap-y-3 sm:grid-cols-5 sm:divide-x sm:divide-[var(--border)]">
        {figs.map(([l, v, t]) => (
          <div key={l} className="min-w-0 sm:px-3 sm:first:pl-0">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-foreground/45">{l}</p>
            <p className={clsx("truncate font-mono text-[18px] font-medium tabular-nums", t ?? "text-foreground")}>{v}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex h-2 overflow-hidden">
        <div className="bg-gain/80" style={{ width: `${(call / tot) * 100}%` }} />
        <div className="bg-loss/80" style={{ width: `${(put / tot) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-foreground/50">
        <span>{((call / tot) * 100).toFixed(0)}% calls</span><span>{((put / tot) * 100).toFixed(0)}% puts</span>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-foreground/45">This is money sitting in open contracts, not today&apos;s trades. Use the momentum chart below to see how it changed during the day.</p>
    </Section>
  );
}

export function StrikesTable({ d }: { d: GexResult }) {
  const rows = d.top_flow_strikes ?? [];
  if (!rows.length) return null;
  return (
    <Section title="Where the premium sits" meta="top strikes within ±30% of spot">
      <table className="w-full font-mono text-[12.5px] tabular-nums">
        <thead>
          <tr className="border-b border-[var(--border-strong)] text-left text-[9.5px] uppercase tracking-[0.14em] text-foreground/45">
            <th className="pb-1.5 font-normal">Strike</th><th className="pb-1.5 text-right font-normal">vs spot</th>
            <th className="pb-1.5 text-right font-normal">Calls</th><th className="pb-1.5 text-right font-normal">Puts</th>
            <th className="pb-1.5 text-right font-normal">Net</th><th className="pb-1.5 pl-3 font-normal">Bias</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.strike} className="border-b border-[var(--border)] last:border-0">
              <td className="py-1.5 text-foreground">{r.strike}</td>
              <td className="py-1.5 text-right text-foreground/50">{pct(dist(r.strike, d.spot))}</td>
              <td className="py-1.5 text-right text-gain/90">{money(r.call_prem)}</td>
              <td className="py-1.5 text-right text-loss/90">{money(r.put_prem)}</td>
              <td className={clsx("py-1.5 text-right", r.net >= 0 ? "text-gain" : "text-loss")}>{money(r.net)}</td>
              <td className="py-1.5 pl-3"><Tag tone={r.bias === "call" ? "gain" : "loss"}>{r.bias}</Tag></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export function ExpiryTable({ d }: { d: GexResult }) {
  const rows = (d.flow_by_expiry ?? []).slice(0, 8);
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  return (
    <Section title="By expiry" meta="net = calls − puts">
      <div className="grid gap-1">
        {rows.map((r) => {
          const w = (Math.abs(r.net) / max) * 50;
          return (
            <div key={r.expiry} className="grid grid-cols-[86px_34px_minmax(0,1fr)_72px] items-center gap-3 font-mono text-[12.5px] tabular-nums">
              <span className="text-foreground">{r.expiry.slice(5)}</span>
              <span className="text-foreground/45">{daysTo(r.expiry)}d</span>
              <span className="relative h-[8px]">
                <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[var(--border-strong)]" />
                <span className={clsx("absolute inset-y-0", r.net >= 0 ? "bg-gain/70" : "bg-loss/70")} style={r.net >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
              </span>
              <span className={clsx("text-right", r.net >= 0 ? "text-gain" : "text-loss")}>{money(r.net)}</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────────
export function DetailsDrawer({ open, onClose, data, ticker, accentColor }: Props) {
  const [tab, setTab] = useState<Tab>("levels");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${ticker} details`}>
      <button className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-label="Close details" />
      <aside className="relative flex h-[100dvh] w-full max-w-[680px] flex-col border-l border-[var(--border-strong)] bg-[var(--background)]">
        <header className="flex items-end gap-4 border-b border-[var(--border-strong)] px-5 pt-4">
          <div className="pb-3">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/45">Details</p>
            <h2 className="font-mono text-[22px] font-semibold tracking-tight text-foreground">
              {ticker} <span className="text-[15px] font-normal tabular-nums text-foreground/55">{data.spot.toFixed(2)}</span>
            </h2>
          </div>
          <div role="tablist" aria-label="Details section" className="ml-auto flex gap-5">
            {([["levels", "Levels"], ["flow", "Premium & flow"]] as const).map(([t, l]) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`-mb-px border-b-2 pb-3 font-mono text-[11px] uppercase tracking-[0.14em] ${tab === t ? "border-foreground text-foreground" : "border-transparent text-foreground/45 hover:text-foreground"}`}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="mb-2.5 rounded-md p-1.5 text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {tab === "levels" ? (
            <>
              <Read d={data} />
              <LevelsTable d={data} />
              <GexProfileChart data={data} accentColor={accentColor} />
              <TopGamma d={data} />
            </>
          ) : (
            <>
              <Premium d={data} />
              <FlowMomentumChart symbol={ticker} accentColor={accentColor} />
              <StrikesTable d={data} />
              <ExpiryTable d={data} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
