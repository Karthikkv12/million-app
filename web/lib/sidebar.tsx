"use client";
import { createContext, useContext, useEffect, useState } from "react";

interface SidebarCtx {
  collapsed: boolean;
  toggle: () => void;
}

const Ctx = createContext<SidebarCtx>({ collapsed: false, toggle: () => {} });

/** On iPad (md breakpoint, 768–1023 px) the sidebar defaults to collapsed so the
 *  content area isn't squeezed to ~528 px.  On larger screens it defaults open.
 *  A localStorage value always wins if the user has previously toggled it. */
function getInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) return saved === "true";
  } catch {}
  // Default: collapsed on tablet (< 1024 px), expanded on laptop+
  return window.innerWidth < 1024;
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  // Hydrate from localStorage / viewport after mount (avoids SSR mismatch)
  useEffect(() => {
    setCollapsed(getInitialCollapsed());
  }, []);

  const toggle = () =>
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("sidebar-collapsed", String(next)); } catch {}
      return next;
    });

  return <Ctx.Provider value={{ collapsed, toggle }}>{children}</Ctx.Provider>;
}

export const useSidebar = () => useContext(Ctx);
