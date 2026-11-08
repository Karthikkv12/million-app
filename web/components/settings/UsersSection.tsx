"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth";
import { adminListUsers, adminCreateUser, adminPatchUser, adminDeleteUser, AdminUser } from "@/lib/api";
import { Panel, Pill } from "@/components/ui";
import {
  Plus, Search, MoreHorizontal, ShieldCheck, ShieldOff, UserCheck, UserX, KeyRound, Trash2,
  X, Copy, Check, RefreshCw,
} from "lucide-react";

// Mirrors the backend password policy (logic/auth_services.py).
const RULES = [
  { label: "12+ characters", test: (p: string) => p.length >= 12 },
  { label: "Upper and lower case", test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: "A number", test: (p: string) => /\d/.test(p) },
];

function generatePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*?"];
  const all = sets.join("");
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const chars = [...sets.map(pick), ...Array.from({ length: 12 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function joined(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Dialog shell ─────────────────────────────────────────────────────────────

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-float)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-foreground/50 transition hover:bg-[var(--surface-2)] hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const input = "h-10 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-foreground outline-none transition focus:border-foreground/40 focus:ring-2 focus:ring-accent/20";

function PasswordInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} className={clsx(input, "font-mono")} autoComplete="new-password" spellCheck={false} />
        <button type="button" onClick={() => onChange(generatePassword())} className="btn-ghost h-10 shrink-0 px-3" title="Generate a strong password">
          <RefreshCw size={14} /> Generate
        </button>
        <button type="button" onClick={copy} disabled={!value} className="btn-ghost h-10 w-10 shrink-0 px-0" aria-label="Copy password">
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {RULES.map((r) => {
          const ok = r.test(value);
          return (
            <li key={r.label} className={clsx("flex items-center gap-1.5 text-[12px]", ok ? "text-gain" : "text-foreground/50")}>
              <Check size={12} className={ok ? "" : "opacity-30"} />{r.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Create user ──────────────────────────────────────────────────────────────

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (u: AdminUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [role, setRole] = useState<"user" | "admin">("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = username.trim().length > 0 && RULES.every((r) => r.test(password));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setError("");
    try {
      onCreated(await adminCreateUser(username.trim().toLowerCase(), password, role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the user.");
      setBusy(false);
    }
  };

  return (
    <Dialog title="New user" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="nu-name" className="text-[13px] font-medium text-foreground/80">Username</label>
          <input id="nu-name" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} className={input} autoCapitalize="none" spellCheck={false} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="nu-pass" className="text-[13px] font-medium text-foreground/80">Temporary password</label>
          <PasswordInput id="nu-pass" value={password} onChange={setPassword} />
          <p className="text-[12px] text-foreground/50">Share it privately. They can change it in Settings after signing in.</p>
        </div>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-[13px] font-medium text-foreground/80">Role</legend>
          <div className="grid grid-cols-2 gap-2">
            {([["user", "User", "Uses the app"], ["admin", "Admin", "Also manages users"]] as const).map(([v, l, d]) => (
              <label key={v} className={clsx("cursor-pointer rounded-xl border p-3 transition", role === v ? "border-foreground" : "border-[var(--border)] hover:border-[var(--border-strong)]")}>
                <input type="radio" name="role" value={v} checked={role === v} onChange={() => setRole(v)} className="sr-only" />
                <span className="block text-sm font-medium text-foreground">{l}</span>
                <span className="block text-[12px] text-foreground/55">{d}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-[13px] text-loss">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost h-10">Cancel</button>
          <button type="submit" disabled={!ok || busy} className="btn-primary h-10">{busy ? "Creating…" : "Create user"}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Reset password ───────────────────────────────────────────────────────────

function ResetPasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const ok = RULES.every((r) => r.test(password));
  const submit = async () => {
    setBusy(true); setError("");
    try { await adminPatchUser(user.user_id, { password }); setDone(true); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't reset the password."); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title={`Reset password for ${user.username}`} onClose={onClose}>
      {done ? (
        <div className="grid gap-4">
          <p className="flex items-center gap-2 text-sm text-gain"><Check size={16} /> Password updated.</p>
          <p className="text-[13px] text-foreground/65">Send them this temporary password privately and ask them to change it in Settings:</p>
          <code className="block select-all rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-sm text-foreground">{password}</code>
          <div className="flex justify-end"><button onClick={onClose} className="btn-primary h-10">Done</button></div>
        </div>
      ) : (
        <div className="grid gap-4">
          <PasswordInput id="rp-pass" value={password} onChange={setPassword} />
          {error && <p role="alert" className="text-[13px] text-loss">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost h-10">Cancel</button>
            <button onClick={submit} disabled={!ok || busy} className="btn-primary h-10">{busy ? "Saving…" : "Set password"}</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ── Row actions menu ─────────────────────────────────────────────────────────

function RowMenu({ u, isSelf, onRole, onActive, onReset, onDelete }: {
  u: AdminUser; isSelf: boolean; onRole: () => void; onActive: () => void; onReset: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (open) { setOpen(false); setConfirm(false); return; }
    const r = btnRef.current!.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 260;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, right: window.innerWidth - r.right, up });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) { setOpen(false); setConfirm(false); }
    };
    const shut = () => { setOpen(false); setConfirm(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") shut(); };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", shut, true);
      window.removeEventListener("resize", shut);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground/80 transition hover:bg-[var(--surface-2)] hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="relative">
      <button ref={btnRef} onClick={toggle} aria-label={`Actions for ${u.username}`} aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground/55 transition hover:bg-[var(--surface-2)] hover:text-foreground">
        <MoreHorizontal size={16} />
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ top: pos.top, right: pos.right, transform: pos.up ? "translateY(-100%)" : undefined }}
          className="fixed z-[160] w-56 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-float)]"
        >
          {confirm ? (
            <div className="grid gap-2 p-2">
              <p className="text-[13px] text-foreground">Delete <b>{u.username}</b>? This can't be undone.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirm(false)} className="btn-ghost h-8 flex-1 px-2 text-[13px]">Cancel</button>
                <button onClick={() => { setOpen(false); onDelete(); }} className="btn h-8 flex-1 bg-red-600 px-2 text-[13px] text-white hover:bg-red-700">Delete</button>
              </div>
            </div>
          ) : (
            <>
              <button className={item} disabled={isSelf} onClick={() => { setOpen(false); onRole(); }}>
                {u.role === "admin" ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}{u.role === "admin" ? "Remove admin" : "Make admin"}
              </button>
              <button className={item} disabled={isSelf} onClick={() => { setOpen(false); onActive(); }}>
                {u.is_active ? <UserX size={15} /> : <UserCheck size={15} />}{u.is_active ? "Disable sign-in" : "Enable sign-in"}
              </button>
              <button className={item} onClick={() => { setOpen(false); onReset(); }}>
                <KeyRound size={15} />Reset password
              </button>
              <div className="my-1 h-px bg-[var(--border)]" />
              <button className={clsx(item, "text-red-600 hover:text-loss")} disabled={isSelf} onClick={() => setConfirm(true)}>
                <Trash2 size={15} />Delete user
              </button>
              {isSelf && <p className="px-2.5 pb-1 pt-1.5 text-[12px] text-foreground/45">You can't change or delete your own account here.</p>}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

/** Settings → Users (admin only). The page header comes from the Settings shell. */
export function UsersSection() {
  const { isAdmin, loading, user: me } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [fetching, setFetching] = useState(true);
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => { if (!loading && !isAdmin) router.replace("/settings"); }, [loading, isAdmin, router]);
  useEffect(() => {
    if (!isAdmin) return;
    adminListUsers().then(setUsers).finally(() => setFetching(false));
  }, [isAdmin]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(""), 3000); };

  const patch = async (u: AdminUser, body: { role?: string; is_active?: boolean }, msg: string) => {
    setBusyId(u.user_id);
    try {
      const updated = await adminPatchUser(u.user_id, body);
      setUsers((prev) => prev.map((x) => (x.user_id === u.user_id ? updated : x)));
      flash(msg);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Couldn't update the user.");
    } finally { setBusyId(null); }
  };

  const remove = async (u: AdminUser) => {
    setUsers((prev) => prev.filter((x) => x.user_id !== u.user_id));
    try { await adminDeleteUser(u.user_id); flash(`${u.username} deleted.`); }
    catch { adminListUsers().then(setUsers); flash("Couldn't delete the user."); }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...users]
      .filter((u) => !q || u.username.toLowerCase().includes(q))
      .sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === "admin" ? -1 : 1));
  }, [users, query]);

  const admins = users.filter((u) => u.role === "admin").length;
  const disabled = users.filter((u) => !u.is_active).length;

  if (loading || fetching) {
    return (
      <div>
        <div className="grid gap-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex justify-end">
        <button onClick={() => setShowCreate(true)} className="btn-primary h-10"><Plus size={15} /> New user</button>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[["Accounts", users.length], ["Admins", admins], ["Disabled", disabled]].map(([l, v]) => (
          <div key={l as string} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/55">{l}</p>
            <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-foreground">{v}</p>
          </div>
        ))}
      </div>

      <Panel
        title={`All accounts · ${shown.length}`}
        padded={false}
                actions={
          <label className="relative hidden sm:block">
            <span className="sr-only">Search users</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search"
              className="h-8 w-48 rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-2 text-[13px] text-foreground outline-none focus:border-foreground/30" />
          </label>
        }
      >
        <div className="border-b border-[var(--border)] p-3 sm:hidden">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users" aria-label="Search users"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[14px] text-foreground outline-none" />
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-foreground/55">{query ? `No users match “${query}”.` : "No users yet."}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {shown.map((u) => {
              const isSelf = me?.user_id === u.user_id;
              return (
                <li key={u.user_id} className={clsx("flex items-center gap-3 px-4 py-3 transition", busyId === u.user_id && "opacity-60", !u.is_active && "bg-foreground/[0.02]")}>
                  <div className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                    u.role === "admin" ? "bg-foreground text-background" : "border border-[var(--border-strong)] bg-[var(--surface-2)] text-foreground")}>
                    {u.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={clsx("truncate text-sm font-medium", u.is_active ? "text-foreground" : "text-foreground/50 line-through decoration-foreground/30")}>{u.username}</span>
                      {isSelf && <Pill tone="accent">You</Pill>}
                    </div>
                    <p className="mt-0.5 text-[12px] text-foreground/50">
                      <span className="sm:hidden">{u.role === "admin" ? "Admin" : "User"} · {u.is_active ? "Active" : "Disabled"} · </span>
                      Joined {joined(u.created_at)}
                    </p>
                  </div>
                  <div className="hidden items-center gap-2 sm:flex">
                    <Pill className={u.role === "admin" ? "!border-foreground !text-foreground" : ""}>{u.role}</Pill>
                    <Pill tone={u.is_active ? "good" : "bad"} dot>{u.is_active ? "Active" : "Disabled"}</Pill>
                  </div>
                  <RowMenu
                    u={u}
                    isSelf={isSelf}
                    onRole={() => patch(u, { role: u.role === "admin" ? "user" : "admin" }, u.role === "admin" ? `${u.username} is no longer an admin.` : `${u.username} is now an admin.`)}
                    onActive={() => patch(u, { is_active: !u.is_active }, u.is_active ? `${u.username} can no longer sign in.` : `${u.username} can sign in again.`)}
                    onReset={() => setResetFor(u)}
                    onDelete={() => remove(u)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <p className="mt-4 text-[13px] text-foreground/50">
        Registration is closed, so new people can only get in through an account you create here.
      </p>

      {notice && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[150] -translate-x-1/2 rounded-xl bg-foreground px-4 py-2.5 text-[13px] text-background shadow-[var(--shadow-float)] md:bottom-8">
          {notice}
        </div>
      )}
      {showCreate && (
        <CreateUserDialog onClose={() => setShowCreate(false)} onCreated={(u) => { setUsers((p) => [...p, u]); setShowCreate(false); flash(`${u.username} created.`); }} />
      )}
      {resetFor && <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  );
}
