"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { getTokens, refreshSession, tokenClaims, login as apiLogin, logout as apiLogout, signup as apiSignup } from "./api";

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

/** New access token from the HttpOnly refresh cookie (or a pre-cookie token, migrated once). */
async function _silentRefresh(): Promise<AuthUser | null> {
  const data = await refreshSession();
  if (!data) return null;
  return { user_id: data.user_id, username: data.username ?? "", role: data.role ?? "user" };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On load: the access token is only ever in memory, so ask the API for one using the cookie.
  useEffect(() => {
    (async () => {
      setUser(await _silentRefresh());
      setLoading(false);
    })();
  }, []);

  // Renew the access token before its 15-minute expiry while the page is open.
  useEffect(() => {
    if (!user) return;
    const check = async () => {
      const exp = tokenClaims(getTokens().access)?.exp;
      if (exp && exp * 1000 - Date.now() > 3 * 60 * 1000) return;
      if (!(await _silentRefresh())) setUser(null);
    };
    const interval = setInterval(check, 2 * 60 * 1000);
    // Phones freeze background tabs: check as soon as the page is visible again.
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
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

