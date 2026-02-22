"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAuthSessions, fetchAuthEvents, revokeSession, changePassword, AuthSession, AuthEvent } from "@/lib/api";
import { Shield, Monitor, Key, CheckCircle, XCircle } from "lucide-react";
import { PageHeader } from "@/components/ui";

const EVENT_COLOR: Record<string, string> = {
  login:           "text-green-500",
  logout:          "text-gray-400",
  refresh:         "text-blue-400",
  signup:          "text-purple-500",
  change_password: "text-yellow-500",
  failed_login:    "text-red-500",
};

const inp = "w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--surface)] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

function ChangePasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext]       = useState("");
  const [confirm, setConfirm] = useState("");
  const [ok, setOk]           = useState(false);
  const [err, setErr]         = useState("");

  const mut = useMutation({
    mutationFn: () => {
      if (next !== confirm) throw new Error("Passwords do not match");
      if (next.length < 8) throw new Error("Password must be at least 8 characters");
      return changePassword(current, next);
    },
    onSuccess: () => { setOk(true); setCurrent(""); setNext(""); setConfirm(""); setErr(""); },
    onError: (e: Error) => { setErr(e.message); setOk(false); },
  });

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30"><Key size={16} className="text-blue-500" /></span>
        <h2 className="font-bold text-gray-900 dark:text-white">Change Password</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {[
          { label: "Current Password", val: current, set: setCurrent },
          { label: "New Password",     val: next,    set: setNext    },
          { label: "Confirm Password", val: confirm, set: setConfirm },
        ].map(({ label, val, set }) => (
          <div key={label}>
            <label className="text-xs text-gray-400 block mb-1">{label}</label>
            <input type="password" value={val} onChange={(e) => set(e.target.value)} autoComplete="off" className={inp} />
          </div>
        ))}
      </div>
      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      {ok  && <p className="text-xs text-green-500 mb-3 flex items-center gap-1"><CheckCircle size={12} /> Password changed successfully!</p>}
      <button onClick={() => mut.mutate()} disabled={mut.isPending || !current || !next || !confirm}
        className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
        {mut.isPending ? "Saving…" : "Update Password"}
      </button>
    </div>
  );
}

function SessionsSection() {
  const qc = useQueryClient();
  const { data: sessions = [], isLoading } = useQuery<AuthSession[]>({ queryKey: ["auth-sessions"], queryFn: fetchAuthSessions, staleTime: 30_000 });
  const revoke = useMutation({
    mutationFn: (id: number) => revokeSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-sessions"] }),
  });

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
        <span className="p-2 rounded-xl bg-purple-50 dark:bg-purple-900/30"><Monitor size={16} className="text-purple-500" /></span>
        <div>
          <h2 className="font-bold text-gray-900 dark:text-white text-sm">Active Sessions</h2>
          <p className="text-xs text-gray-400">Revoke a session to force sign-out on that device.</p>
        </div>
      </div>

      {isLoading && (
        <div className="p-4 space-y-2">
          {[1,2].map(i => <div key={i} className="skeleton h-12 rounded-xl" />)}
        </div>
      )}
      {!isLoading && sessions.length === 0 && <p className="text-sm text-gray-400 p-5">No active sessions.</p>}

      {sessions.length > 0 && (
        <>
          {/* Mobile */}
          <div className="flex flex-col divide-y divide-gray-50 dark:divide-gray-800 md:hidden">
            {sessions.map((s) => (
              <div key={s.id} className={`p-4 ${s.is_current ? "bg-blue-50/40 dark:bg-blue-900/10" : ""}`}>
                <div className="flex items-start justify-between">
                  <div>
                    {s.is_current && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 rounded font-bold mr-1">current</span>}
                    <span className="text-xs font-mono text-gray-500">{s.ip_address ?? "—"}</span>
                    <p className="text-xs text-gray-400 mt-1 truncate max-w-[240px]">{s.user_agent ? s.user_agent.slice(0, 50) : "—"}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Created {s.created_at.slice(0, 16).replace("T", " ")}</p>
                  </div>
                  {!s.is_current && (
                    <button onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}
                      className="text-xs px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition disabled:opacity-50 shrink-0 ml-3">
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] text-gray-400 uppercase tracking-wide bg-[var(--surface-2)]">
                  {["Created", "Last Used", "IP", "Device", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className={`border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors ${s.is_current ? "bg-blue-50/40 dark:bg-blue-900/10" : ""}`}>
                    <td className="px-4 py-3 text-gray-400 text-xs">{s.created_at.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{s.last_used_at ? s.last_used_at.slice(0, 16).replace("T", " ") : "—"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{s.ip_address ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs truncate max-w-[200px]">
                      {s.is_current && <span className="mr-1 text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 rounded font-bold">current</span>}
                      {s.user_agent ? s.user_agent.slice(0, 60) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {!s.is_current && (
                        <button onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}
                          className="text-xs px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition disabled:opacity-50">
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function EventsSection() {
  const { data: events = [], isLoading } = useQuery<AuthEvent[]>({ queryKey: ["auth-events"], queryFn: fetchAuthEvents, staleTime: 60_000 });

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
        <span className="p-2 rounded-xl bg-yellow-50 dark:bg-yellow-900/30"><Shield size={16} className="text-yellow-500" /></span>
        <div>
          <h2 className="font-bold text-gray-900 dark:text-white text-sm">Auth Event Log</h2>
          <p className="text-xs text-gray-400">Last 25 security events on your account.</p>
        </div>
      </div>

      {isLoading && (
        <div className="p-4 space-y-2">
          {[1,2,3].map(i => <div key={i} className="skeleton h-10 rounded-xl" />)}
        </div>
      )}
      {!isLoading && events.length === 0 && <p className="text-sm text-gray-400 p-5">No events recorded.</p>}

      {events.length > 0 && (
        <>
          {/* Mobile */}
          <div className="flex flex-col divide-y divide-gray-50 dark:divide-gray-800 md:hidden overflow-y-auto max-h-[320px]">
            {events.map((e) => (
              <div key={e.id} className="flex items-center justify-between p-3">
                <div>
                  <span className={`text-xs font-mono font-bold ${EVENT_COLOR[e.event_type] ?? "text-gray-500"}`}>{e.event_type}</span>
                  <p className="text-[10px] text-gray-400">{e.created_at.slice(0, 16).replace("T", " ")} · {e.ip_address ?? "—"}</p>
                </div>
                {e.success ? <CheckCircle size={14} className="text-green-500 shrink-0" /> : <XCircle size={14} className="text-red-500 shrink-0" />}
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden md:block overflow-y-auto max-h-[320px]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[11px] text-gray-400 uppercase tracking-wide sticky top-0 bg-[var(--surface)] bg-[var(--surface-2)]">
                  {["Time", "Event", "Result", "IP"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
                    <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">{e.created_at.slice(0, 16).replace("T", " ")}</td>
                    <td className={`px-4 py-2.5 font-mono text-xs font-semibold ${EVENT_COLOR[e.event_type] ?? "text-gray-500"}`}>{e.event_type}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${e.success ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
                        {e.success ? "OK" : "FAIL"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{e.ip_address ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="p-4 sm:p-6 max-w-screen-lg mx-auto">
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-5">
        <ChangePasswordSection />
        <SessionsSection />
        <EventsSection />
      </div>
    </div>
  );
}
