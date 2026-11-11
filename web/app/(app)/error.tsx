"use client";

import { useEffect } from "react";
import { isStaleBuild, reloadForNewBuild } from "@/lib/stale-build";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleBuild(error);
  useEffect(() => {
    console.error(error);
    if (stale) reloadForNewBuild();
  }, [error, stale]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-xl font-semibold">{stale ? "Loading the new version…" : "Something went wrong"}</h2>
      {!stale && <p className="max-w-md text-sm text-foreground/60">{error.message}</p>}
      <div className="flex gap-2">
        <button className="btn-primary h-10" onClick={() => window.location.reload()}>Reload</button>
        {!stale && <button className="btn-ghost h-10" onClick={() => reset()}>Try again</button>}
      </div>
    </div>
  );
}
