"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { adminListUsers, adminCreateUser, adminPatchUser, adminDeleteUser, AdminUser } from "@/lib/api";
import { Users, Plus, ShieldCheck, ShieldOff, UserCheck, UserX, X, Trash2 } from "lucide-react";

export default function AdminUsersPage() {
  const { isAdmin, loading } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", password: "", role: "user" as "admin" | "user" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [patchingId, setPatchingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [loading, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    adminListUsers()
      .then(setUsers)
      .finally(() => setFetching(false));
  }, [isAdmin]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const newUser = await adminCreateUser(createForm.username, createForm.password, createForm.role);
      setUsers((prev) => [...prev, newUser]);
      setShowCreate(false);
      setCreateForm({ username: "", password: "", role: "user" });
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (u: AdminUser) => {
    setPatchingId(u.user_id);
    try {
      const updated = await adminPatchUser(u.user_id, { is_active: !u.is_active });
      setUsers((prev) => prev.map((x) => (x.user_id === u.user_id ? updated : x)));
    } finally {
      setPatchingId(null);
    }
  };

  const handleToggleRole = async (u: AdminUser) => {
    setPatchingId(u.user_id);
    try {
      const updated = await adminPatchUser(u.user_id, { role: u.role === "admin" ? "user" : "admin" });
      setUsers((prev) => prev.map((x) => (x.user_id === u.user_id ? updated : x)));
    } finally {
      setPatchingId(null);
    }
  };

  const handleDelete = async (user_id: number) => {
    // Optimistically remove immediately so the row disappears without waiting
    setUsers((prev) => prev.filter((x) => x.user_id !== user_id));
    setConfirmDeleteId(null);
    try {
      await adminDeleteUser(user_id);
    } catch {
      // Rollback: re-fetch the list if the delete failed
      adminListUsers().then(setUsers);
    } finally {
      setPatchingId(null);
    }
  };

  if (loading || fetching) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 rounded-full border-2 border-foreground/20 border-t-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
            <Users size={16} className="text-foreground/70" />
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground">User Management</h1>
            <p className="text-xs text-foreground/50">{users.length} account{users.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-foreground text-background text-xs font-semibold hover:opacity-90 transition"
        >
          <Plus size={13} />
          New User
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-foreground">Create User</h2>
              <button onClick={() => { setShowCreate(false); setCreateError(""); }} className="p-1 rounded-lg hover:bg-[var(--surface-2)] text-foreground/50 hover:text-foreground transition">
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-foreground/60 block mb-1">Username</label>
                <input
                  autoFocus
                  value={createForm.username}
                  onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-sm text-foreground placeholder:text-foreground/30 outline-none focus:ring-1 focus:ring-foreground/30"
                  placeholder="username"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground/60 block mb-1">Password</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-sm text-foreground placeholder:text-foreground/30 outline-none focus:ring-1 focus:ring-foreground/30"
                  placeholder="min 6 characters"
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground/60 block mb-1">Role</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as "admin" | "user" }))}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/30"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {createError && <p className="text-xs text-red-500">{createError}</p>}
              <button
                type="submit"
                disabled={creating}
                className="w-full py-2 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* User table */}
      <div className="border border-[var(--border)] rounded-2xl overflow-hidden bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]">
              <th className="text-left px-4 py-3 text-xs font-semibold text-foreground/50 uppercase tracking-wide">User</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-foreground/50 uppercase tracking-wide">Role</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-foreground/50 uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-foreground/50 uppercase tracking-wide">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {users.map((u) => (
              <tr key={u.user_id} className="hover:bg-[var(--surface-2)] transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-black text-foreground uppercase">{u.username[0]}</span>
                    </div>
                    <span className="font-medium text-foreground">{u.username}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                    u.role === "admin"
                      ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                      : "bg-foreground/5 text-foreground/60 border border-foreground/10"
                  }`}>
                    {u.role === "admin" ? <ShieldCheck size={10} /> : null}
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                    u.is_active
                      ? "bg-green-500/10 text-green-500 border border-green-500/20"
                      : "bg-red-500/10 text-red-500 border border-red-500/20"
                  }`}>
                    {u.is_active ? "Active" : "Disabled"}
                  </span>
                </td>
                <td className="px-4 py-3 text-foreground/40 text-xs">
                  {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 justify-end">
                    <button
                      onClick={() => handleToggleRole(u)}
                      disabled={patchingId === u.user_id}
                      title={u.role === "admin" ? "Remove admin" : "Make admin"}
                      className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-foreground/40 hover:text-amber-500 transition disabled:opacity-40"
                    >
                      {u.role === "admin" ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                    </button>
                    <button
                      onClick={() => handleToggleActive(u)}
                      disabled={patchingId === u.user_id}
                      title={u.is_active ? "Disable user" : "Enable user"}
                      className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-foreground/40 hover:text-foreground transition disabled:opacity-40"
                    >
                      {u.is_active ? <UserX size={14} /> : <UserCheck size={14} />}
                    </button>
                    {confirmDeleteId === u.user_id ? (
                      <>
                        <button
                          onClick={() => handleDelete(u.user_id)}
                          disabled={patchingId === u.user_id}
                          className="px-2 py-1 rounded-lg bg-red-500/10 text-red-500 text-xs font-semibold hover:bg-red-500/20 transition disabled:opacity-40"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-foreground/40 hover:text-foreground transition"
                        >
                          <X size={13} />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(u.user_id)}
                        title="Delete user"
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-foreground/20 hover:text-red-500 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <div className="text-center py-12 text-foreground/30 text-sm">No users found</div>
        )}
      </div>
    </div>
  );
}
