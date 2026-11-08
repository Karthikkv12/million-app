"use client";
/**
 * useHedgeStream — the hedge books, refreshed every second over SSE.
 *
 * Opens GET /api/v1/hedge/stream (token in the query string; EventSource can't
 * send headers) and writes each `books` event into react-query under
 * ["hedge-books"]. Returns whether the stream is connected so the page can fall
 * back to polling.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BASE, getTokens } from "@/lib/api";

export function useHedgeStream(enabled = true): boolean {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 3_000;
    let closed = false;

    const open = () => {
      const { access } = getTokens();
      if (!access) { retry = setTimeout(open, backoff); return; }
      es = new EventSource(`${BASE}/hedge/stream?access_token=${encodeURIComponent(access)}&interval=1`);
      es.addEventListener("open", () => { setLive(true); backoff = 3_000; });
      es.addEventListener("books", (e) => {
        try { qc.setQueryData(["hedge-books"], JSON.parse((e as MessageEvent).data)); } catch { /* bad frame */ }
      });
      es.addEventListener("error", () => {
        setLive(false);
        if (es && es.readyState === EventSource.CLOSED && !closed) {   // e.g. 401 after the token expired
          es = null;
          retry = setTimeout(open, backoff);
          backoff = Math.min(backoff * 2, 60_000);
        }
      });
    };
    // pause while the tab is hidden (phones keep background tabs alive); resume on return
    const onVis = () => {
      if (document.hidden) {
        if (retry) { clearTimeout(retry); retry = null; }
        es?.close(); es = null; setLive(false);
      } else if (!es && !closed) {
        backoff = 3_000; open();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    if (!document.hidden) open();
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVis);
      if (retry) clearTimeout(retry);
      es?.close();
      setLive(false);
    };
  }, [enabled, qc]);

  return live;
}
