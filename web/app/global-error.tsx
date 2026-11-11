"use client";

/* Replaces the root layout, so the app's CSS may be missing (e.g. after a deploy): inline styles only. */
import { useEffect } from "react";
import { isStaleBuild, reloadForNewBuild } from "@/lib/stale-build";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleBuild(error);
  useEffect(() => {
    console.error(error);
    if (stale) reloadForNewBuild();
  }, [error, stale]);

  const btn = { height: 44, padding: "0 18px", borderRadius: 12, border: "1px solid #d4d2cc", fontSize: 15, fontWeight: 500, cursor: "pointer" } as const;
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f5f4f0", color: "#0b0c10", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{stale ? "Loading the new version…" : "Something went wrong"}</h2>
          {!stale && <p style={{ fontSize: 14, color: "#6b6a66", margin: 0, maxWidth: 420 }}>{error.message}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...btn, background: "#0b0c10", color: "#fff", borderColor: "#0b0c10" }} onClick={() => window.location.reload()}>Reload</button>
            {!stale && <button style={{ ...btn, background: "#fff" }} onClick={() => reset()}>Try again</button>}
          </div>
        </div>
      </body>
    </html>
  );
}
