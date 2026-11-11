"use client";
/**
 * Privacy mode ("hide values"): adds `privacy` to <html>, remembered per device.
 * Any element with class `sensitive` is masked (•••••); `sensitive-blur` is blurred (charts).
 */
import { useEffect, useState } from "react";

const KEY = "of-privacy";
const EVENT = "of-privacy-change";

function read(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
function apply(on: boolean) {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("privacy", on);
}

export function usePrivacy(): [boolean, () => void] {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const sync = () => { const v = read(); setHidden(v); apply(v); };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const toggle = () => {
    const next = !read();
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* storage off: in-memory only */ }
    apply(next);
    setHidden(next);
    window.dispatchEvent(new Event(EVENT));
  };
  return [hidden, toggle];
}
