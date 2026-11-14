"use client";
/**
 * Settings → Notifications: turn on push alerts on this device (buy-backs and trades from the hedge desk).
 * iPhone delivers web push only to the app added to the Home Screen (iOS 16.4+); this page says so when needed.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Send, Share } from "lucide-react";
import { clsx } from "clsx";
import { fetchNotifyPrefs, fetchPushConfig, fetchPushDevices, removePushSubscription, saveNotifyPrefs, savePushSubscription, sendTestPush, NotifyPrefs } from "@/lib/api";
import { okBooks, useLiveBooks } from "@/lib/live";

const KINDS: { key: keyof Omit<NotifyPrefs, "symbols" | "level_symbols">; label: string; desc: string }[] = [
  { key: "buyback", label: "Buy back", desc: "A short option has given up most of its premium (80%, or 50% with 3+ days left)." },
  { key: "sell_call", label: "Sell call", desc: "The desk suggests a call under your strategy (Hedge → Strategy)." },
  { key: "sell_put", label: "Sell put", desc: "The desk suggests a put or a put spread under your strategy." },
  { key: "buy_stock", label: "Buy stock", desc: "An odd lot at or below your average: round it up to 100 shares. Also the long call under LEAPS or Diagonals." },
  { key: "iv_spike", label: "IV spike", desc: "Implied volatility jumps on a stock you hold." },
  { key: "expiring_itm", label: "Expiring in the money", desc: "An option you sold is in the money with a day or less left." },
  { key: "signals", label: "Signals", desc: "A holding's backtested signal turns Add (fear dip), Exit (under the 200-day in a calm market), Take profit or Roll. Once per stock and signal per week." },
  { key: "levels", label: "Dealer levels shift", desc: "The call wall, put wall, king or flip moves to a new strike, or the price crosses the flip. For your stocks and the tickers you add below." },
];

/** Extra tickers for level alerts (SPY, QQQ…), on top of the holdings. */
function LevelTickers({ p, held, save }: { p: NotifyPrefs; held: string[]; save: (n: NotifyPrefs) => void }) {
  const [v, setV] = useState("");
  const list = p.level_symbols ?? [];
  const add = () => {
    const s = v.trim().toUpperCase();
    setV("");
    if (!s || list.includes(s) || !/^[A-Z.^]{1,10}$/.test(s) || list.length >= 20) return;
    save({ ...p, level_symbols: [...list, s].sort() });
  };
  return (
    <div className="border-t border-[var(--border)] px-5 py-4">
      <p className="text-[14.5px] font-medium text-foreground">Level alerts also for</p>
      <p className="text-[12.5px] text-foreground/55">
        Your stocks{held.length ? ` (${held.length})` : ""} are always watched. Add index or other tickers here, up to 20 in all.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {list.map((s) => (
          <button key={s} onClick={() => save({ ...p, level_symbols: list.filter((x) => x !== s) })} aria-label={`Remove ${s}`}
            className="h-8 rounded-full border border-accent bg-accent/10 px-3 font-mono text-[12px] text-accent">
            {s} <span aria-hidden className="ml-1 text-accent/60">×</span>
          </button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex items-center gap-1.5">
          <input value={v} onChange={(e) => setV(e.target.value)} placeholder="SPY" aria-label="Add a ticker for level alerts"
            className="h-8 w-24 rounded-full border border-[var(--border)] bg-transparent px-3 font-mono text-[12px] uppercase text-foreground placeholder:text-foreground/35 focus:border-foreground/40 focus:outline-none" />
          <button type="submit" className="h-8 rounded-full border border-[var(--border)] px-3 text-[12px] text-foreground/70 hover:text-foreground">Add</button>
        </form>
      </div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={clsx("relative h-6 w-10 shrink-0 rounded-full transition", on ? "bg-foreground" : "bg-foreground/20")}>
      <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-[var(--background)] shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

/** Which alerts, for which stocks. Saved on every device as soon as it changes. */
function Controls() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["notify", "prefs"], queryFn: fetchNotifyPrefs });
  const held = okBooks(useLiveBooks().data).map((b) => b.symbol).sort();
  const [err, setErr] = useState<string | null>(null);
  const p = prefs.data;
  if (!p) return null;
  const save = async (next: NotifyPrefs) => {
    setErr(null);
    qc.setQueryData(["notify", "prefs"], next);                       // optimistic
    try { qc.setQueryData(["notify", "prefs"], await saveNotifyPrefs(next)); }
    catch (e) { setErr((e as Error).message); qc.invalidateQueries({ queryKey: ["notify", "prefs"] }); }
  };
  const all = !p.symbols.length;
  const toggleSym = (sym: string) => {
    const cur = all ? held : p.symbols;
    const next = cur.includes(sym) ? cur.filter((x) => x !== sym) : [...cur, sym];
    if (!next.length) return;                                         // keep at least one; turn kinds off to mute
    save({ ...p, symbols: next.length === held.length ? [] : next });
  };
  return (
    <div className="card overflow-hidden">
      <p className="border-b border-[var(--border)] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/50">What to send</p>
      <ul className="divide-y divide-[var(--border)]">
        {KINDS.map((k) => (
          <li key={k.key} className="flex items-center gap-4 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-medium text-foreground">{k.label}</p>
              <p className="text-[12.5px] leading-snug text-foreground/55">{k.desc}</p>
            </div>
            <Switch on={!!p[k.key]} label={k.label} onChange={(v) => save({ ...p, [k.key]: v })} />
          </li>
        ))}
      </ul>
      <div className="border-t border-[var(--border)] px-5 py-4">
        <p className="text-[14.5px] font-medium text-foreground">Stocks</p>
        <p className="text-[12.5px] text-foreground/55">Only alert for the ones selected.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button onClick={() => save({ ...p, symbols: [] })} aria-pressed={all}
            className={clsx("h-8 rounded-full border px-3 text-[12px] font-medium", all ? "border-foreground bg-foreground text-[var(--background)]" : "border-[var(--border)] text-foreground/60")}>
            All my stocks
          </button>
          {held.map((sym) => {
            const on = all || p.symbols.includes(sym);
            return (
              <button key={sym} onClick={() => toggleSym(sym)} aria-pressed={on}
                className={clsx("h-8 rounded-full border px-3 font-mono text-[12px]", on ? "border-accent bg-accent/10 text-accent" : "border-[var(--border)] text-foreground/45")}>
                {sym}
              </button>
            );
          })}
        </div>
        {!all && p.symbols.some((s) => !held.includes(s)) && (
          <p className="mt-2 text-[12px] text-foreground/45">Also kept: {p.symbols.filter((s) => !held.includes(s)).join(", ")} (not held right now).</p>
        )}
      </div>
      {p.levels && <LevelTickers p={p} held={held} save={save} />}
      {err && <p className="border-t border-[var(--border)] px-5 py-3 text-[13px] text-loss">{err}</p>}
    </div>
  );
}

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
          <div className="min-w-[200px] flex-1">
            <p className="text-[15px] font-medium text-foreground">
              {state === "on" ? "On for this device" : state === "checking" ? "Checking…" : "Off on this device"}
            </p>
            <p className="text-[13px] text-foreground/55">
              Checked every minute while the market is open. Each alert comes once a day. Choose which below.
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

      {state === "on" && <Controls />}

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
