"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Navbar";
import { SampleBoard } from "@/components/marketing/SampleBoard";

function friendlyError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("too many") || m.includes("throttl") || m.includes("429")) {
    return "Too many attempts. Wait a minute, then try again.";
  }
  if (m.includes("invalid") || m.includes("incorrect") || m.includes("401") || m.includes("credentials")) {
    return "That username and password don't match. Check them and try again.";
  }
  if (m.includes("fetch") || m.includes("network")) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return raw || "Sign-in failed. Try again.";
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username.trim().toLowerCase(), password);
      router.push("/options-flow");
    } catch (err) {
      setError(friendlyError((err as Error).message ?? ""));
    } finally {
      setLoading(false);
    }
  };

  const field =
    "h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[15px] text-foreground outline-none transition placeholder:text-foreground/35 focus:border-foreground/40 focus:ring-2 focus:ring-accent/30";

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Left: product panel (wide screens) */}
      <aside className="dot-grid relative hidden flex-col justify-between border-r border-[var(--border)] p-10 lg:flex">
        <Logo href="/" />
        <div className="mx-auto w-full max-w-xl">
          <SampleBoard />
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-foreground/60">
            Gamma exposure by strike and expiry, with the king node, flip and walls marked for you.
          </p>
        </div>
        <p className="font-mono text-[12px] text-foreground/45">Market data delayed about 15 minutes.</p>
      </aside>

      {/* Right: form */}
      <main className="flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between lg:justify-end">
          <span className="lg:hidden"><Logo href="/" /></span>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-foreground/60 transition hover:text-foreground">
            <ArrowLeft size={15} /> Home
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <p className="eyebrow mb-3 flex items-center gap-2"><span className="h-px w-4 bg-foreground/30" />Welcome back</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground">Sign in to OptionFlow</h1>

          <form onSubmit={handleSubmit} className="mt-8 grid gap-5" noValidate>
            <div className="grid gap-1.5">
              <label htmlFor="username" className="text-[13px] font-medium text-foreground/80">Username</label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className={field}
              />
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="password" className="text-[13px] font-medium text-foreground/80">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={`${field} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-foreground/45 transition hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2.5 text-[13px] text-red-700 dark:text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="btn-primary mt-1 h-11 w-full"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-8 text-[13px] leading-relaxed text-foreground/50">
            Accounts are created by an admin. Ask yours for access, or for a password reset.
          </p>
        </div>
      </main>
    </div>
  );
}
