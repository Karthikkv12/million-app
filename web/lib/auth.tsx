"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { getTokens, clearTokens, login as apiLogin, logout as apiLogout, signup as apiSignup } from "./api";

interface AuthUser { user_id: number; username: string; }

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { access } = getTokens();
    if (access) {
      try {
        // decode payload (no verify — server validates on every request)
        const payload = JSON.parse(atob(access.split(".")[1]));
        if (payload.exp * 1000 > Date.now()) {
          setUser({ user_id: Number(payload.sub), username: payload.username ?? "" });
        } else {
          clearTokens();
        }
      } catch { clearTokens(); }
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    const data = await apiLogin(username, password);
    setUser({ user_id: data.user_id, username: data.username });
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  const signup = async (username: string, password: string) => {
    const data = await apiSignup(username, password);
    setUser({ user_id: data.user_id, username: data.username });
  };

  return <Ctx.Provider value={{ user, loading, login, logout, signup }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
