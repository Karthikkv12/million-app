"use client";
/**
 * Settings → Notifications: turn on push alerts on this device (buy-backs and trades from the hedge desk).
 * iPhone delivers web push only to the app added to the Home Screen (iOS 16.4+); this page says so when needed.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Send, Share } from "lucide-react";
import { fetchPushConfig, fetchPushDevices, removePushSubscription, savePushSubscription, sendTestPush } from "@/lib/api";

type State = "checking" | "unsupported" | "needs-install" | "denied" | "off" | "on";

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const isIOS = () => typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = () => typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export function NotificationsSection() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["notify", "config"], queryFn: fetchPushConfig });
  const devices = useQuery({ queryKey: ["notify", "devices"], queryFn: fetchPushDevices });
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(isIOS() && !standalone() ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") { setState("denied"); return; }
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const turnOn = async () => {
    if (!cfg.data?.public_key) return;
    setBusy(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.data.public_key) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await savePushSubscription({ endpoint: j.endpoint, keys: j.keys });
      setState("on");
      setMsg("On. Send a test to check it reaches this device.");
      qc.invalidateQueries({ queryKey: ["notify", "devices"] });
    } catch (e) {
      setMsg((e as Error).message || "Couldn't turn notifications on.");
    } finally { setBusy(false); }
  };

  const turnOff = async () => {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await removePushSubscription(sub.endpoint).catch(() => null); await sub.unsubscribe(); }
      setState("off");
      qc.invalidateQueries({ queryKey: ["notify", "devices"] });
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await sendTestPush();
      setMsg(r.sent ? `Sent to ${r.sent} device${r.sent > 1 ? "s" : ""}.` : "Nothing was delivered. Turn notifications off and on again on this device.");
      qc.invalidateQueries({ queryKey: ["notify", "devices"] });
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  const serverOff = cfg.data && !cfg.data.enabled;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 px-5 py-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-foreground/70">
            {state === "on" ? <Bell size={18} /> : <BellOff size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium text-foreground">
              {state === "on" ? "On for this device" : state === "checking" ? "Checking…" : "Off on this device"}
            </p>
            <p className="text-[13px] text-foreground/55">
              Buy-backs (most of the premium captured) and new trades from the hedge desk, checked every minute while the market is open.
              Each alert comes once a day.
            </p>
          </div>
          {state === "on" ? (
            <div className="flex gap-2">
              <button className="btn-ghost" disabled={busy} onClick={test}><Send size={15} /> Test</button>
              <button className="btn-ghost" disabled={busy} onClick={turnOff}>Turn off</button>
            </div>
          ) : state === "off" ? (
            <button className="btn-primary" disabled={busy || !cfg.data?.enabled} onClick={turnOn}><Bell size={15} /> Turn on</button>
          ) : null}
        </div>
        {(serverOff || state === "needs-install" || state === "denied" || state === "unsupported" || msg) && (
          <div className="border-t border-[var(--border)] px-5 py-4 text-[13px] leading-relaxed text-foreground/70">
            {serverOff && <p>Notifications aren&apos;t set up on the server yet (the push keys are missing).</p>}
            {state === "needs-install" && (
              <p className="flex flex-wrap items-center gap-1">
                On iPhone, add OptionFlow to your Home Screen first: tap <Share size={14} className="inline" /> Share, then
                <b className="font-medium text-foreground">Add to Home Screen</b>. Open it from there and come back to this page.
              </p>
            )}
            {state === "denied" && <p>Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.</p>}
            {state === "unsupported" && <p>This browser can&apos;t receive push notifications.</p>}
            {msg && <p className="text-foreground">{msg}</p>}
          </div>
        )}
      </div>

      {!!devices.data?.length && (
        <div className="card overflow-hidden">
          <p className="border-b border-[var(--border)] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">Devices with notifications on</p>
          <ul className="divide-y divide-[var(--border)]">
            {devices.data.map((d) => (
              <li key={d.id} className="px-5 py-3 text-[13px]">
                <p className="truncate text-foreground/80">{d.user_agent || "Unknown device"}</p>
                <p className="font-mono text-[11px] text-foreground/45">since {d.created_at.slice(0, 10)}{d.last_ok_at ? ` · last delivered ${d.last_ok_at.slice(0, 16).replace("T", " ")} UTC` : ""}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
