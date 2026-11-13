"use client";
/**
 * useGexStream — keep a symbol's GEX fresh over Server-Sent Events.
 *
 * Opens GET /api/v1/flow/{symbol}/stream (EventSource can't send headers, so
 * the access token rides in the query string) and writes each `gex` event into
 * the react-query cache under ["gex", symbol], which every board reading that
 * key re-renders from. Returns whether the stream is currently connected, so
 * callers can fall back to slow polling while it isn't.
 *
 * Interval is 1 s, the backend's minimum. A check only reads the server's GEX cache, so it costs no upstream
 * calls. On Public the cache moves every second: workers.gex_respot re-prices the levels at the live price, and
 * the poller re-downloads each chain as fast as the rate limit allows (~2 s per watched symbol). On Yahoo it moves
 * every 120 s. Frames are sent only when GEX changed.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BASE, getTokens } from "@/lib/api";

const INTERVAL_S = 1;

export function useGexStream(symbol: string | undefined): boolean {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!symbol || typeof window === "undefined" || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 5_000;
    let closed = false;

    const open = () => {
      const { access } = getTokens();
      if (!access) { retry = setTimeout(open, backoff); return; }
      es = new EventSource(`${BASE}/flow/${encodeURIComponent(symbol)}/stream?access_token=${encodeURIComponent(access)}&interval=${INTERVAL_S}`);
      es.addEventListener("open", () => { setLive(true); backoff = 5_000; });
      es.addEventListener("gex", (e) => {
        try { qc.setQueryData(["gex", symbol], JSON.parse((e as MessageEvent).data)); } catch { /* ignore bad frame */ }
      });
      es.addEventListener("error", () => {
        setLive(false);
        // The browser retries on its own after a dropped connection (server sends retry: 5000).
        // A CLOSED stream (e.g. 401 once the token expired) needs a new EventSource with a fresh
        // token; polling in the meantime refreshes the token through apiFetch.
        if (es && es.readyState === EventSource.CLOSED && !closed) {
          es = null;
          retry = setTimeout(open, backoff);
          backoff = Math.min(backoff * 2, 120_000);
        }
      });
    };
    open();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
      setLive(false);
    };
  }, [symbol, qc]);

  return live;
}
