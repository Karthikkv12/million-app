"use client";
/**
 * Notification Center: the bell in the top bar (next to hide-figures) and a side drawer that groups every
 * notification the app raised — hedge trades, dealer levels and IV, price alerts, paper trades, daily reports —
 * whether or not a push reached a device (notify.service.record). Phones: full screen. iPad / desktop: a right-side
 * drawer like the heat maps' Details.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Bell, BarChart3, BellRing, Check, FileText, Layers, NotebookPen, Settings2, Trash2, X } from "lucide-react";
import { clearInbox, fetchInbox, Inbox, InboxItem, markInboxRead } from "@/lib/api";

const KEY = ["notify", "inbox"];
type Group = "signals" | "trades" | "levels" | "alerts" | "paper" | "reports" | "other";
const GROUPS: { id: Group; label: string; icon: typeof Bell }[] = [
  { id: "signals", label: "Signals", icon: Activity },
  { id: "trades", label: "Trades", icon: BarChart3 },
  { id: "levels", label: "Levels & IV", icon: Layers },
  { id: "alerts", label: "Price alerts", icon: BellRing },
  { id: "paper", label: "Paper trades", icon: NotebookPen },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "other", label: "Other", icon: Bell },
];
const groupOf = (kind: string): Group =>
  kind === "signals" ? "signals" : ["buyback", "sell_call", "sell_put", "buy_stock", "expiring_itm"].includes(kind) ? "trades"
    : kind === "levels" || kind === "iv_spike" ? "levels"
    : kind === "price_alert" ? "alerts"
    : kind.startsWith("paper_") ? "paper"
    : kind === "report" ? "reports" : "other";

function dayLabel(iso: string): string {
  const d = new Date(iso), now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<Inbox>({ queryKey: KEY, queryFn: fetchInbox, refetchInterval: 60_000, retry: false });
  const n = data?.unread ?? 0;
  return (
    <>
      <button onClick={() => setOpen(true)} data-testid="notify-bell" aria-haspopup="dialog"
        aria-label={n ? `Notifications, ${n} unread` : "Notifications"} title="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-foreground/70 transition hover:text-foreground">
        <Bell size={15} />
        {n > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-loss px-1 font-mono text-[9.5px] font-semibold leading-none text-white">
            {n > 99 ? "99+" : n}
          </span>
        )}
      </button>
      {open && typeof document !== "undefined" && createPortal(<Drawer data={data} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Drawer({ data, onClose }: { data?: Inbox; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [group, setGroup] = useState<Group | "all">("all");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [onClose]);
  const setUnread = (ids: number[] | null, unread: number) => qc.setQueryData<Inbox>(KEY, (d) => d && ({
    unread, items: d.items.map((i) => (ids == null || ids.includes(i.id) ? { ...i, read: true } : i)) }));
  const read = useMutation({ mutationFn: (ids?: number[]) => markInboxRead(ids), onSuccess: (r, ids) => setUnread(ids ?? null, r.unread) });
  const clear = useMutation({ mutationFn: clearInbox, onSuccess: () => qc.setQueryData<Inbox>(KEY, { items: [], unread: 0 }) });

  const items = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(() => {
    const c = new Map<Group, { all: number; unread: number }>();
    for (const i of items) {
      const g = groupOf(i.kind), x = c.get(g) ?? { all: 0, unread: 0 };
      x.all += 1; if (!i.read) x.unread += 1; c.set(g, x);
    }
    return c;
  }, [items]);
  const shown = group === "all" ? items : items.filter((i) => groupOf(i.kind) === group);
  const byDay = useMemo(() => {
    const out: { day: string; items: InboxItem[] }[] = [];
    for (const i of shown) {
      const d = dayLabel(i.created_at);
      if (out.at(-1)?.day !== d) out.push({ day: d, items: [] });
      out.at(-1)!.items.push(i);
    }
    return out;
  }, [shown]);
  const open = (i: InboxItem) => {
    if (!i.read) read.mutate([i.id]);
    onClose();
    if (i.url) router.push(i.url);
  };
  const unread = data?.unread ?? 0;
  const chips: { id: Group | "all"; label: string; n: number; u: number }[] = [
    { id: "all", label: "All", n: items.length, u: unread },
    ...GROUPS.filter((g) => counts.has(g.id)).map((g) => ({ id: g.id, label: g.label, n: counts.get(g.id)!.all, u: counts.get(g.id)!.unread })),
  ];

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true" aria-label="Notifications" data-testid="notify-drawer">
      <button className="absolute inset-0 hidden bg-black/50 backdrop-blur-[2px] sm:block" onClick={onClose} aria-label="Close notifications" tabIndex={-1} />
      <aside className="relative flex h-[100dvh] w-full flex-col bg-[var(--background)] text-left sm:max-w-[440px] sm:border-l sm:border-[var(--border-strong)]">
        <header className="border-b border-[var(--border-strong)] px-5 pt-[max(12px,env(safe-area-inset-top))]">
          <div className="flex items-center gap-3 pb-3">
            <div className="min-w-0">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-foreground/45">Notification center · last 7 days</p>
              <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
                {unread ? `${unread} unread` : "All caught up"}
              </h2>
            </div>
            <button type="button" autoFocus onClick={onClose} aria-label="Close"
              className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-foreground/70 hover:text-foreground"><X size={16} /></button>
          </div>
          {items.length > 0 && (
            <div role="tablist" aria-label="Notification groups" className="-mx-5 flex gap-1.5 overflow-x-auto overflow-y-hidden px-5 pb-3">
              {chips.map((c) => (
                <button key={c.id} role="tab" aria-selected={group === c.id} onClick={() => setGroup(c.id)}
                  className={clsx("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[12.5px] transition",
                    group === c.id ? "border-foreground bg-foreground text-[var(--background)]" : "border-[var(--border)] text-foreground/70 hover:text-foreground")}>
                  {c.label}
                  <span className={clsx("font-mono text-[10.5px]", group === c.id ? "opacity-70" : "text-foreground/40")}>{c.n}</span>
                  {c.u > 0 && group !== c.id && <span className="h-1.5 w-1.5 rounded-full bg-loss" aria-label={`${c.u} unread`} />}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
          {!data ? (
            <p className="px-5 py-10 text-center text-[13px] text-foreground/50">Loading…</p>
          ) : !items.length ? (
            <div className="px-6 py-14 text-center">
              <Bell size={22} className="mx-auto text-foreground/30" />
              <p className="mt-3 text-[15px] font-medium text-foreground">No notifications yet</p>
              <p className="mx-auto mt-1.5 max-w-xs text-[13px] text-foreground/55">
                Holding signals, buy-backs, trade suggestions, dealer-level moves, price alerts, paper trades and daily reports collect here for 7 days.
              </p>
            </div>
          ) : byDay.map(({ day, items: list }) => (
            <section key={day}>
              <h3 className="sticky top-0 z-[1] border-b border-[var(--border)] bg-[var(--background)] px-5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-foreground/45">{day}</h3>
              <ul>
                {list.map((i) => {
                  const G = GROUPS.find((g) => g.id === groupOf(i.kind))!;
                  return (
                    <li key={i.id} className="border-b border-[var(--border)]">
                      <button onClick={() => open(i)} data-testid="notify-item"
                        className={clsx("flex w-full gap-3 px-5 py-3 text-left transition hover:bg-foreground/[0.04]", !i.read && "bg-accent/[0.04]")}>
                        <span className={clsx("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--border)]", i.read ? "text-foreground/45" : "text-foreground")}>
                          <G.icon size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className={clsx("min-w-0 flex-1 text-[13.5px] leading-snug", i.read ? "text-foreground/70" : "font-medium text-foreground")}>{i.title}</span>
                            <span className="shrink-0 font-mono text-[10.5px] text-foreground/40">{timeOf(i.created_at)}</span>
                          </span>
                          {i.body && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-foreground/55">{i.body}</span>}
                          <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-foreground/35">{G.label}{i.symbol ? ` · ${i.symbol}` : ""}</span>
                        </span>
                        {!i.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <footer className="flex items-center gap-2 border-t border-[var(--border-strong)] px-5 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          <button onClick={() => read.mutate(undefined)} disabled={!unread || read.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[12px] text-foreground/75 hover:text-foreground disabled:opacity-40">
            <Check size={13} /> Mark all read
          </button>
          <button onClick={() => { if (window.confirm("Delete every notification?")) clear.mutate(); }} disabled={!items.length || clear.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[12px] text-foreground/75 hover:text-loss disabled:opacity-40">
            <Trash2 size={13} /> Clear
          </button>
          <Link href="/settings/notifications" onClick={onClose}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] text-foreground/60 hover:text-foreground">
            <Settings2 size={13} /> Push settings
          </Link>
        </footer>
      </aside>
    </div>
  );
}
