"use client";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAuthSessions, fetchAuthEvents, revokeSession, changePassword, logoutAll,
  AuthSession, AuthEvent,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import {
  Monitor, Smartphone, Tablet, Terminal, Eye, EyeOff, Check, LogIn, LogOut,
  RefreshCw, KeyRound, ShieldAlert, ShieldX, Sun, Moon,
} from "lucide-react";
import { clsx } from "clsx";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseUA(ua?: string): { label: string; kind: "desktop" | "phone" | "tablet" | "script" } {
  if (!ua) return { label: "Unknown device", kind: "desktop" };
  if (/^(node|python|curl|axios|undici|okhttp)/i.test(ua)) return { label: "Script or API client", kind: "script" };
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Firefox\//.test(ua) ? "Firefox" :
    /CriOS|Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" : "Browser";
  const os =
    /iPhone/.test(ua) ? "iPhone" :
    /iPad/.test(ua) ? "iPad" :
    /Android/.test(ua) ? "Android" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Windows/.test(ua) ? "Windows" :
    /CrOS/.test(ua) ? "ChromeOS" :
    /Linux/.test(ua) ? "Linux" : "";
  const kind = /iPhone|Android.*Mobile/.test(ua) ? "phone" : /iPad|Android/.test(ua) ? "tablet" : "desktop";
  return { label: os ? `${browser} on ${os}` : browser, kind };
}

function ago(iso?: string): string {
  if (!iso) return "—";
  const t = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const EVENT_META: Record<string, { label: string; icon: typeof LogIn; tone: "neutral" | "good" | "bad" | "warn" }> = {
  login:             { label: "Signed in",              icon: LogIn,       tone: "good" },
  logout:            { label: "Signed out",             icon: LogOut,      tone: "neutral" },
  logout_all:        { label: "Signed out everywhere",  icon: LogOut,      tone: "warn" },
  refresh:           { label: "Session refreshed",      icon: RefreshCw,   tone: "neutral" },
  change_password:   { label: "Password changed",       icon: KeyRound,    tone: "warn" },
  revoke_session:    { label: "Device signed out",      icon: ShieldX,     tone: "warn" },
  login_throttled:   { label: "Too many sign-in attempts", icon: ShieldAlert, tone: "bad" },
  refresh_throttled: { label: "Too many refresh attempts", icon: ShieldAlert, tone: "bad" },
  signup:            { label: "Account created",        icon: Check,       tone: "good" },
};

const TONE = {
  neutral: "text-foreground/55 bg-foreground/[0.05]",
  good:    "text-gain bg-gain/10",
  warn:    "text-warn bg-warn/10",
  bad:     "text-loss bg-loss/10",
};

// ── Layout pieces ─────────────────────────────────────────────────────────────

function Section({ id, sub, action, children }: {
  id: string; title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section id={id}>
      <div className="card overflow-hidden">
        {(sub || action) && (
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
            {sub ? <p className="min-w-0 text-[13px] leading-relaxed text-foreground/60">{sub}</p> : <span />}
            {action}
          </header>
        )}
        <div>{children}</div>
      </div>
    </section>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────

export function ProfileSection() {
  const { user, logout } = useAuth();
  const name = user?.username ?? "";
  return (
    <Section id="profile" title="Profile" sub="The account you're signed in with.">
      <div className="flex flex-wrap items-center gap-4 px-5 py-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-foreground text-lg font-semibold text-background">
          {name.slice(0, 1).toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-foreground">{name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground/70">
              {user?.role ?? "user"}
            </span>
            <span className="font-mono text-[11px] text-foreground/50">ID {user?.user_id}</span>
          </div>
        </div>
        <button className="btn-ghost" onClick={() => logout()}>
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </Section>
  );
}

// ── Appearance ────────────────────────────────────────────────────────────────

export function AppearanceSection() {
  const { theme, toggle } = useTheme();
  const options = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark",  label: "Dark",  icon: Moon },
  ] as const;
  return (
    <Section id="appearance" title="Appearance" sub="Saved on this device.">
      <div className="px-5 py-5">
        <div role="radiogroup" aria-label="Theme" className="grid max-w-sm grid-cols-2 gap-3">
          {options.map(({ id, label, icon: Icon }) => {
            const on = theme === id;
            return (
              <button
                key={id}
                role="radio"
                aria-checked={on}
                onClick={() => { if (!on) toggle(); }}
                className={clsx(
                  "group rounded-xl border p-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  on ? "border-foreground" : "border-[var(--border)] hover:border-[var(--border-strong)]",
                )}
              >
                <div className={clsx(
                  "flex h-16 flex-col gap-1.5 rounded-lg border p-2",
                  id === "light" ? "border-black/10 bg-[#f6f6f3]" : "border-white/10 bg-[#0a0a0a]",
                )}>
                  <div className={clsx("h-1.5 w-10 rounded-full", id === "light" ? "bg-black/70" : "bg-white/80")} />
                  <div className={clsx("h-1.5 w-16 rounded-full", id === "light" ? "bg-black/15" : "bg-white/20")} />
                  <div className="mt-auto flex gap-1">
                    <div className="h-3 w-6 rounded-sm bg-[#22968a]" />
                    <div className="h-3 w-6 rounded-sm bg-[#53318f]" />
                    <div className="h-3 w-6 rounded-sm bg-[#fde725]" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between px-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Icon size={14} />{label}</span>
                  {on && <Check size={15} className="text-foreground" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

// ── Password ──────────────────────────────────────────────────────────────────

// Mirrors the backend policy in logic/auth_services.py (_validate_password_policy).
const RULES = [
  { label: "At least 12 characters", test: (p: string) => p.length >= 12, required: true },
  { label: "Upper and lower case",   test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p), required: true },
  { label: "A number",               test: (p: string) => /\d/.test(p), required: true },
  { label: "A symbol (recommended)", test: (p: string) => /[^A-Za-z0-9]/.test(p), required: false },
];

function PasswordField({ id, label, value, onChange, autoComplete }: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-foreground/80">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 pr-10 text-sm text-foreground outline-none transition focus:border-foreground/40 focus:ring-2 focus:ring-accent/30"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-foreground/45 hover:text-foreground"
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

export function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const passed = RULES.filter((r) => r.test(next)).length;
  const mismatch = confirm.length > 0 && next !== confirm;
  const requiredOk = RULES.every((r) => !r.required || r.test(next));
  const ready = current.length > 0 && requiredOk && next === confirm;

  const mut = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => { setCurrent(""); setNext(""); setConfirm(""); },
  });

  return (
    <Section id="password" title="Password" sub="Changing it signs out your other devices.">
      <form
        className="grid grid-cols-1 gap-6 px-5 py-5 md:grid-cols-[minmax(0,1fr)_220px]"
        onSubmit={(e) => { e.preventDefault(); if (ready) mut.mutate(); }}
      >
        <div className="grid max-w-md gap-4">
          <PasswordField id="pw-current" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
          <PasswordField id="pw-new" label="New password" value={next} onChange={setNext} autoComplete="new-password" />
          <PasswordField id="pw-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {mismatch && <p className="text-[13px] text-loss">The new passwords don't match.</p>}
          {mut.isError && <p className="text-[13px] text-loss">{(mut.error as Error).message || "Couldn't change the password. Check your current password and try again."}</p>}
          {mut.isSuccess && <p className="flex items-center gap-1.5 text-[13px] text-gain"><Check size={14} /> Password changed.</p>}
          <div>
            <button type="submit" className="btn-primary" disabled={!ready || mut.isPending}>
              {mut.isPending ? "Changing…" : "Change password"}
            </button>
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div className="grid grid-cols-4 gap-1" aria-hidden>
            {RULES.map((_, i) => (
              <div key={i} className={clsx(
                "h-1 rounded-full transition-colors",
                i < passed ? (requiredOk ? "bg-gain" : "bg-warn") : "bg-foreground/10",
              )} />
            ))}
          </div>
          <ul className="grid grid-cols-1 gap-1.5">
            {RULES.map((r) => {
              const ok = r.test(next);
              return (
                <li key={r.label} className={clsx("flex items-center gap-2 text-[13px]", ok ? "text-foreground" : "text-foreground/50")}>
                  <span className={clsx("flex h-4 w-4 items-center justify-center rounded-full border",
                    ok ? "border-gain bg-gain text-on-tone" : "border-[var(--border-strong)]")}>
                    {ok && <Check size={10} strokeWidth={3} />}
                  </span>
                  {r.label}
                </li>
              );
            })}
          </ul>
        </div>
      </form>
    </Section>
  );
}

// ── Devices ───────────────────────────────────────────────────────────────────

const KIND_ICON = { desktop: Monitor, phone: Smartphone, tablet: Tablet, script: Terminal };

export function DevicesSection() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const [confirmAll, setConfirmAll] = useState(false);
  const { data: sessions = [], isLoading } = useQuery<AuthSession[]>({
    queryKey: ["auth-sessions"], queryFn: fetchAuthSessions, staleTime: 30_000,
  });
  const revoke = useMutation({
    mutationFn: (id: number) => revokeSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-sessions"] }),
  });
  const all = useMutation({ mutationFn: logoutAll, onSuccess: () => logout() });

  // The API doesn't flag the current session; treat the most recently used
  // session from this exact browser as "this browser".
  const currentId = useMemo(() => {
    if (typeof navigator === "undefined") return undefined;
    const mine = sessions
      .filter((s) => s.is_current || s.user_agent === navigator.userAgent)
      .sort((a, b) => (b.last_used_at ?? b.created_at).localeCompare(a.last_used_at ?? a.created_at));
    return mine[0]?.id;
  }, [sessions]);

  return (
    <Section
      id="devices"
      title="Devices"
      sub="Where your account is signed in. Signing a device out ends its session right away."
      action={
        confirmAll ? (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-foreground/70">Sign out of every device, including this one?</span>
            <button className="btn-ghost h-8 px-3" onClick={() => setConfirmAll(false)}>Cancel</button>
            <button className="btn h-8 bg-loss px-3 text-on-tone hover:bg-loss/85" onClick={() => all.mutate()} disabled={all.isPending}>
              Sign out all
            </button>
          </div>
        ) : (
          <button className="btn-ghost h-8 px-3" onClick={() => setConfirmAll(true)} disabled={sessions.length === 0}>
            Sign out everywhere
          </button>
        )
      }
    >
      {isLoading ? (
        <div className="space-y-3 px-5 py-5">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>
      ) : sessions.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-foreground/60">No active sessions.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {sessions.map((s) => {
            const { label, kind } = parseUA(s.user_agent);
            const Icon = KIND_ICON[kind];
            const isMe = s.id === currentId;
            return (
              <li key={s.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-foreground/70">
                  <Icon size={17} strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{label}</span>
                    {isMe && (
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-accent">
                        This browser
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-foreground/55">
                    Active {ago(s.last_used_at ?? s.created_at)}
                    {s.ip_address ? <> · <span className="font-mono">{s.ip_address}</span></> : null}
                    {" · "}signed in {ago(s.created_at)}
                  </p>
                </div>
                {!isMe && (
                  <button
                    className="btn-ghost h-8 shrink-0 px-3 text-[13px]"
                    onClick={() => revoke.mutate(s.id)}
                    disabled={revoke.isPending && revoke.variables === s.id}
                  >
                    Sign out
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ── Activity ──────────────────────────────────────────────────────────────────

type Filter = "important" | "failed" | "all";

export function ActivitySection() {
  const [filter, setFilter] = useState<Filter>("important");
  const { data: events = [], isLoading } = useQuery<AuthEvent[]>({
    queryKey: ["auth-events"], queryFn: fetchAuthEvents, staleTime: 60_000,
  });
  const shown = events.filter((e) =>
    filter === "all" ? true :
    filter === "failed" ? !e.success || e.event_type.endsWith("_throttled") :
    e.event_type !== "refresh",
  );
  const failedCount = events.filter((e) => !e.success || e.event_type.endsWith("_throttled")).length;
  const [expanded, setExpanded] = useState(false);

  // Collapse runs of the same event (e.g. twelve sign-ins in a row) into one row.
  const groups = useMemo(() => {
    const out: { first: AuthEvent; last: AuthEvent; count: number }[] = [];
    for (const e of shown) {
      const g = out[out.length - 1];
      if (g && g.first.event_type === e.event_type && g.first.success === e.success
          && (g.first.user_agent ?? "") === (e.user_agent ?? "") && (g.first.ip_address ?? "") === (e.ip_address ?? "")) {
        g.count += 1; g.last = e;
      } else {
        out.push({ first: e, last: e, count: 1 });
      }
    }
    return out;
  }, [shown]);
  const LIMIT = 6;
  const visible = expanded ? groups : groups.slice(0, LIMIT);

  return (
    <Section
      id="activity"
      title="Sign-in activity"
      sub="The last 25 security events on your account."
      action={
        <div role="tablist" aria-label="Filter activity" className="flex rounded-lg border border-[var(--border)] p-0.5">
          {([
            ["important", "Important"],
            ["failed", `Failed${failedCount ? ` · ${failedCount}` : ""}`],
            ["all", "All"],
          ] as [Filter, string][]).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={clsx(
                "rounded-md px-2.5 py-1 text-[13px] font-medium transition",
                filter === id ? "bg-foreground text-background" : "text-foreground/60 hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {isLoading ? (
        <div className="space-y-3 px-5 py-5">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-8" />)}</div>
      ) : groups.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-foreground/60">
          {filter === "failed" ? "No failed or blocked attempts. Good." : "Nothing here yet."}
        </p>
      ) : (
        <ol className="relative px-5 py-3">
          {visible.map(({ first: e, last, count }) => {
            const meta = EVENT_META[e.event_type] ?? { label: e.event_type.replace(/_/g, " "), icon: ShieldAlert, tone: "neutral" as const };
            const tone = e.success ? meta.tone : "bad";
            const Icon = e.success ? meta.icon : ShieldAlert;
            const device = e.user_agent ? parseUA(e.user_agent).label : null;
            return (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
                <span className={clsx("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", TONE[tone])}>
                  <Icon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    {e.success ? meta.label : `${meta.label} failed`}
                    {count > 1 && <span className="ml-2 font-mono text-[12px] text-foreground/50">×{count}</span>}
                  </p>
                  {(device || e.ip_address || count > 1) && (
                    <p className="truncate text-[13px] text-foreground/55">
                      {[device, e.ip_address, count > 1 ? `since ${ago(last.created_at)}` : null].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <time
                  dateTime={e.created_at}
                  title={new Date(e.created_at.endsWith("Z") ? e.created_at : e.created_at + "Z").toLocaleString()}
                  className="shrink-0 pt-0.5 font-mono text-[12px] tabular-nums text-foreground/50"
                >
                  {ago(e.created_at)}
                </time>
              </li>
            );
          })}
          {groups.length > LIMIT && (
            <li className="pt-2">
              <button className="text-[13px] font-medium text-foreground/60 hover:text-foreground" onClick={() => setExpanded((x) => !x)}>
                {expanded ? "Show less" : `Show ${groups.length - LIMIT} more`}
              </button>
            </li>
          )}
        </ol>
      )}
    </Section>
  );
}

