"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { getTokens, clearTokens, login as apiLogin, logout as apiLogout, signup as apiSignup } from "./api";

interface AuthUser { user_id: number; username: string; role: string; }

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  isAdmin: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

async function _silentRefresh(): Promise<AuthUser | null> {
  const { refresh } = getTokens();
  if (!refresh) return null;
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) { clearTokens(); return null; }
    const data = await res.json();
    // setTokens equivalent inline (avoids circular import)
    localStorage.setItem("of_access", data.access_token);
    localStorage.setItem("of_refresh", data.refresh_token);
    const payload = JSON.parse(atob(data.access_token.split(".")[1]));
    return { user_id: Number(payload.sub), username: payload.username ?? "", role: payload.role ?? "user" };
  } catch { clearTokens(); return null; }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { access } = getTokens();
      if (access) {
        try {
          const payload = JSON.parse(atob(access.split(".")[1]));
          if (payload.exp * 1000 > Date.now()) {
            // Access token still valid — use it
            setUser({ user_id: Number(payload.sub), username: payload.username ?? "", role: payload.role ?? "user" });
          } else {
            // Access token expired — try silent refresh before logging out
            const refreshed = await _silentRefresh();
            setUser(refreshed);
          }
        } catch { clearTokens(); }
      }
      setLoading(false);
    })();
  }, []);

  // Proactively refresh the access token every 12 minutes (before the 15-min expiry)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      const { access } = getTokens();
      if (!access) return;
      try {
        const payload = JSON.parse(atob(access.split(".")[1]));
        const expiresIn = payload.exp * 1000 - Date.now();
        // Refresh if less than 3 minutes remaining
        if (expiresIn < 3 * 60 * 1000) {
          const refreshed = await _silentRefresh();
          if (!refreshed) setUser(null);
        }
      } catch { /* ignore */ }
    }, 2 * 60 * 1000); // check every 2 minutes
    return () => clearInterval(interval);
  }, [user]);

  const login = async (username: string, password: string) => {
    const data = await apiLogin(username, password);
    setUser({ user_id: data.user_id, username: data.username, role: data.role ?? "user" });
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  const signup = async (username: string, password: string) => {
    const data = await apiSignup(username, password);
    setUser({ user_id: data.user_id, username: data.username, role: data.role ?? "user" });
  };

  return <Ctx.Provider value={{ user, loading, login, logout, signup, isAdmin: user?.role === "admin" }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

