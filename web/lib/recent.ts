/** Recently checked tickers on the Research → Catalysts page (per browser, best effort). */
export const RECENT_KEY = "of-catalyst-recent";

export function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}

export function rememberSymbol(sym: string) {
  try {
    const prev = loadRecent();
    localStorage.setItem(RECENT_KEY, JSON.stringify([sym, ...prev.filter((s) => s !== sym)].slice(0, 8)));
  } catch { /* storage unavailable */ }
}
