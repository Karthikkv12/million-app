"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { SampleBoard } from "@/components/marketing/SampleBoard";
import { clsx } from "clsx";

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

type Status = "checking" | "up" | "down";

/** Live backend status, read from the public health check. */
function useServiceStatus(): Status {
  const [status, setStatus] = useState<Status>("checking");
  useEffect(() => {
    let alive = true;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive) setStatus(j?.status === "healthy" || j?.status === "ok" ? "up" : "down"); })
      .catch(() => { if (alive) setStatus("down"); });
    return () => { alive = false; };
  }, []);
  return status;
}

function BrandPanel() {
  const status = useServiceStatus();
  return (
    <aside className="relative hidden overflow-hidden bg-[#0b0c10] text-white lg:flex lg:flex-col">
      <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1.2px)] [background-size:22px_22px]" />
      <div className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-[#2f5bea]/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-[#f2711c]/15 blur-3xl" />

      <div className="relative flex items-center justify-between p-10">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white text-black">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          </span>
          <span className="font-mono text-[13px] font-medium uppercase tracking-[0.2em]">OptionFlow</span>
        </Link>
      </div>

      <div className="relative flex flex-1 flex-col justify-center px-10 xl:px-16">
        <h2 className="max-w-md text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.04em]">
          Your desk is ready. <span className="text-white/45">Sign in to read today's positioning.</span>
        </h2>
        <ul className="mt-8 grid gap-3 text-[15px] text-white/75">
          {["Every strike × expiry on one board", "King node, flip and walls marked for you", "Sector heatmaps and volatility next door"].map((t) => (
            <li key={t} className="flex items-center gap-2.5"><Check size={16} className="text-emerald-400" />{t}</li>
          ))}
        </ul>
        <div className="mt-10 max-w-xl [&>div]:shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
          <SampleBoard compact />
        </div>
      </div>

      <div className="relative flex items-center justify-between gap-4 p-10 text-[13px] text-white/50">
        <span className="flex items-center gap-2">
          <span className={clsx(
            "h-2 w-2 rounded-full",
            status === "up" ? "bg-emerald-400" : status === "down" ? "bg-red-400" : "animate-pulse bg-white/40",
          )} />
          {status === "up" ? "All systems normal" : status === "down" ? "Service is having trouble" : "Checking status…"}
        </span>
        <span>Data delayed ~15 min</span>
      </div>
    </aside>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setError("");
    setLoading(true);
    try {
      await login(username.trim().toLowerCase(), password);
      setDone(true);
      router.push("/options-flow");
    } catch (err) {
      setError(friendlyError((err as Error).message ?? ""));
      setLoading(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);

  const field =
    "h-12 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[15px] text-foreground outline-none transition placeholder:text-foreground/35 focus:border-foreground/40 focus:ring-4 focus:ring-accent/15";

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <BrandPanel />

      <main className="dot-grid flex min-h-screen flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 lg:invisible">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-foreground text-background">
              <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            </span>
            <span className="font-mono text-[13px] font-medium uppercase tracking-[0.2em] text-foreground">OptionFlow</span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-foreground/60 transition hover:text-foreground">
            <ArrowLeft size={15} /> Back to site
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-12">
          <div className="card p-7 shadow-[var(--shadow-float)] sm:p-8">
            <h1 className="text-[28px] font-semibold tracking-[-0.035em] text-foreground">Sign in</h1>
            <p className="mt-1.5 text-[15px] text-foreground/60">Welcome back. Use the username your admin gave you.</p>

            <form onSubmit={handleSubmit} className="mt-7 grid gap-5" noValidate>
              <div className="grid gap-1.5">
                <label htmlFor="username" className="text-[13px] font-medium text-foreground/80">Username</label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className={field}
                />
              </div>

              <div className="grid gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="password" className="text-[13px] font-medium text-foreground/80">Password</label>
                  <details className="group relative">
                    <summary className="cursor-pointer list-none text-[13px] text-foreground/55 hover:text-foreground [&::-webkit-details-marker]:hidden">
                      Forgot password?
                    </summary>
                    <p className="absolute right-0 top-6 z-10 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[13px] leading-relaxed text-foreground/70 shadow-[var(--shadow-float)]">
                      Passwords are reset by your admin. Ask them for a temporary password, then change it in Settings.
                    </p>
                  </details>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={onKey}
                    onKeyDown={onKey}
                    required
                    className={`${field} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-foreground/45 transition hover:text-foreground"
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {capsLock && <p className="text-[13px] text-amber-600 dark:text-amber-400">Caps Lock is on.</p>}
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3.5 py-3 text-[13px] leading-relaxed text-red-700 dark:text-red-300">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || done || !username || !password}
                className="btn-primary mt-1 h-12 w-full text-[15px]"
              >
                {done ? <><Check size={17} /> Signed in</> :
                 loading ? <><Loader2 size={17} className="animate-spin" /> Signing in…</> :
                 <>Sign in <ArrowRight size={17} /></>}
              </button>
            </form>

            <div className="mt-6 flex items-center gap-2 border-t border-[var(--border)] pt-5 text-[13px] text-foreground/50">
              <Lock size={13} className="shrink-0" />
              Encrypted connection. Repeated failed attempts are blocked automatically.
            </div>
          </div>

          <p className="mt-6 text-center text-[13px] text-foreground/55">
            No account yet? OptionFlow is invite-only.{" "}
            <Link href="/#faq" className="font-medium text-foreground underline-offset-4 hover:underline">How to get access</Link>
          </p>
        </div>

        <p className="text-center text-[12px] text-foreground/40">© 2026 OptionFlow · Not investment advice</p>
      </main>
    </div>
  );
}
