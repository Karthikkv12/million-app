/**
 * After a deploy, a page that was already open (often the Home Screen app) still runs the old build and asks for
 * JS / CSS chunks that no longer exist. That surfaces as an error boundary ("Something went wrong") on the next
 * navigation. Reloading once fetches the new build. The guard stops a reload loop if the error is real.
 */
const KEY = "of_stale_reload_at";

export function isStaleBuild(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const msg = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg);
}

/** Reload once per minute at most. Returns true when a reload was started. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage off: still reload once */ }
  window.location.reload();
  return true;
}
