"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAuthSessions,
  fetchAuthEvents,
  revokeSession,
  changePassword,
  AuthSession,
  AuthEvent,
} from "@/lib/api";

// ── Change Password ────────────────────────────────────────────────────────────

function ChangePasswordSection() {
  const [current, setCurrent]   = useState("");
  const [next, setNext]         = useState("");
  const [confirm, setConfirm]   = useState("");
  const [ok, setOk]             = useState(false);
  const [err, setErr]           = useState("");

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
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <h2 className="font-bold text-gray-900 dark:text-white mb-3">Change Password</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        {[
          { label: "Current Password", val: current, set: setCurrent },
          { label: "New Password",     val: next,    set: setNext    },
          { label: "Confirm Password", val: confirm, set: setConfirm },
        ].map(({ label, val, set }) => (
          <div key={label}>
            <label className="text-xs text-gray-400 block mb-1">{label}</label>
            <input
              type="password"
              value={val}
              onChange={(e) => set(e.target.value)}
              autoComplete="off"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
        ))}
      </div>
      {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
      {ok  && <p className="text-xs text-green-500 mb-2">Password changed successfully!</p>}
      <button
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !current || !next || !confirm}
        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
      >
        {mut.isPending ? "Saving…" : "Update Password"}
      </button>
    </div>
  );
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function SessionsSection() {
  const qc = useQueryClient();
  const { data: sessions = [], isLoading } = useQuery<AuthSession[]>({
    queryKey: ["auth-sessions"],
    queryFn: fetchAuthSessions,
    staleTime: 30_000,
  });

  const revoke = useMutation({
    mutationFn: (id: number) => revokeSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-sessions"] }),
  });

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h2 className="font-bold text-gray-900 dark:text-white text-sm">Active Sessions</h2>
        <p className="text-xs text-gray-400 mt-0.5">Revoke a session to force sign out on that device.</p>
      </div>
      {isLoading && <p className="text-sm text-gray-400 p-4">Loading…</p>}
      {!isLoading && sessions.length === 0 && (
        <p className="text-sm text-gray-400 p-4">No active sessions.</p>
      )}
      {sessions.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 uppercase tracking-wide">
              {["Created", "Last Used", "IP", "Device", ""].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className={`border-b border-gray-50 dark:border-gray-800/50 ${s.is_current ? "bg-blue-50/40 dark:bg-blue-900/10" : ""}`}>
                <td className="px-3 py-2 text-gray-400 text-xs">{s.created_at.slice(0, 16).replace("T", " ")}</td>
                <td className="px-3 py-2 text-gray-400 text-xs">{s.last_used_at ? s.last_used_at.slice(0, 16).replace("T", " ") : "—"}</td>
                <td className="px-3 py-2 text-gray-500 text-xs font-mono">{s.ip_address ?? "—"}</td>
                <td className="px-3 py-2 text-gray-400 text-xs truncate max-w-[180px]">
                  {s.is_current && <span className="mr-1 text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 rounded font-bold">current</span>}
                  {s.user_agent ? s.user_agent.slice(0, 60) : "—"}
                </td>
                <td className="px-3 py-2">
                  {!s.is_current && (
                    <button
                      onClick={() => revoke.mutate(s.id)}
                      disabled={revoke.isPending}
                      className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/20 text-red-500 font-semibold hover:bg-red-100 transition disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Auth Events ───────────────────────────────────────────────────────────────

const EVENT_COLOR: Record<string, string> = {
  login:           "text-green-500",
  logout:          "text-gray-400",
  refresh:         "text-blue-400",
  signup:          "text-purple-500",
  change_password: "text-yellow-500",
  failed_login:    "text-red-500",
};

function EventsSection() {
  const { data: events = [], isLoading } = useQuery<AuthEvent[]>({
    queryKey: ["auth-events"],
    queryFn: fetchAuthEvents,
    staleTime: 60_000,
  });

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h2 className="font-bold text-gray-900 dark:text-white text-sm">Auth Event Log</h2>
        <p className="text-xs text-gray-400 mt-0.5">Last 25 security events on your account.</p>
      </div>
      {isLoading && <p className="text-sm text-gray-400 p-4">Loading…</p>}
      {!isLoading && events.length === 0 && (
        <p className="text-sm text-gray-400 p-4">No events recorded.</p>
      )}
      {events.length > 0 && (
        <div className="overflow-y-auto max-h-[320px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 uppercase tracking-wide sticky top-0 bg-white dark:bg-gray-900">
                {["Time", "Event", "Result", "IP"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                    {e.created_at.slice(0, 16).replace("T", " ")}
                  </td>
                  <td className={`px-3 py-2 font-mono text-xs font-semibold ${EVENT_COLOR[e.event_type] ?? "text-gray-500"}`}>
                    {e.event_type}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      e.success
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                    }`}>
                      {e.success ? "OK" : "FAIL"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-400 font-mono text-xs">{e.ip_address ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="p-4 max-w-screen-lg mx-auto">
      <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-6">Settings</h1>
      <div className="flex flex-col gap-6">
        <ChangePasswordSection />
        <SessionsSection />
        <EventsSection />
      </div>
    </div>
  );
}
