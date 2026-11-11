"use client";
/**
 * SourceBadge — LIVE / 15-MIN DELAYED label for GEX data, driven by what the
 * backend served (GexOut.data_source / stale / as_of). Renders nothing for an
 * unknown source.
 */
import type { GexResult } from "@/lib/api";

const PROVIDER: Record<string, string> = { public: "Public.com", yfinance: "Yahoo Finance" };

/** Display name of the provider that served this result ("the data source" if unknown). */
export function sourceName(data: Pick<GexResult, "data_source"> | undefined): string {
  return (data?.data_source && PROVIDER[data.data_source]) || "the data source";
}

function age(asOf: string | null | undefined): string | null {
  if (!asOf) return null;
  const s = Math.max(0, Math.round((Date.now() - new Date(asOf).getTime()) / 1000));
  if (!Number.isFinite(s)) return null;
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}

export function SourceBadge({ data, className = "" }: { data: Pick<GexResult, "data_source" | "stale" | "as_of"> | undefined; className?: string }) {
  const src = data?.data_source;
  if (src !== "public" && src !== "yfinance") return null;
  const live = src === "public";
  const cachedFor = data?.stale ? age(data.as_of) : null;
  const title = `${PROVIDER[src]} · ${live ? "real-time" : "~15 min delayed"}${data?.stale ? ` · cached${cachedFor ? `, ${cachedFor} old` : ""} (rate-limited)` : ""}`;
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 font-mono text-[9px] font-medium uppercase leading-[16px] tracking-[0.1em] ${
        live ? "border-gain/40 bg-gain/10 text-gain" : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      } ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-gain" : "bg-amber-500"}`} />
      {live ? "Live" : "15-min delayed"}
      {data?.stale && <span className="normal-case tracking-normal opacity-80">· cached{cachedFor ? ` ${cachedFor}` : ""}</span>}
    </span>
  );
}
