"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ListChecks, LockOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import {
  fetchWeeks, getOrCreateWeek, fetchPositions, deletePosition, updatePosition,
  completeWeek, reopenWeek, fetchMarketQuotes,
  WeeklySnapshot, OptionPosition, PositionStatus,
} from "@/lib/api";
import { EmptyState, Panel, Pill } from "@/components/ui";
import {
  usd, usdSigned, usdCompact, shortDate, toneOf, StatTile, StatRow, Dialog, ConfirmDialog,
  Field, FormActions, inputCls, num, thCls, theadCls, RowButton,
} from "./kit";
import { PositionForm } from "./PositionForm";

const CLOSED: PositionStatus[] = ["CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"];
const STATUSES: PositionStatus[] = ["ACTIVE", "CLOSED", "EXPIRED", "ASSIGNED", "ROLLED"];
const STATUS_LABEL: Record<PositionStatus, string> = {
  ACTIVE: "Open", CLOSED: "Bought back", EXPIRED: "Expired", ASSIGNED: "Assigned", ROLLED: "Rolled",
};
const STATUS_TONE: Record<PositionStatus, "accent" | "neutral" | "good" | "warn"> = {
  ACTIVE: "accent", CLOSED: "neutral", EXPIRED: "good", ASSIGNED: "warn", ROLLED: "neutral",
};

/** Days until expiry (0 on the day), or null. */
function dte(iso: string | null): number | null {
  if (!iso) return null;
  const end = new Date(iso.slice(0, 10) + "T16:00:00").getTime();
  return Math.ceil((end - Date.now()) / 86_400_000);
}

/** In the money from the live price: a call above its strike, a put below. */
function itm(p: OptionPosition, spot: number | undefined): boolean | null {
  if (spot == null) return null;
  return p.option_type === "CALL" ? spot > p.strike : spot < p.strike;
}

export function PositionsTab() {
  const qc = useQueryClient();
  const weeksQ = useQuery({ queryKey: ["weeks"], queryFn: fetchWeeks, staleTime: 60_000 });
  const weeks = useMemo(() => weeksQ.data ?? [], [weeksQ.data]);
  const [weekId, setWeekId] = useState<number | null>(null);

  // Default to the newest open week, else the newest week.
  useEffect(() => {
    if (weekId != null || weeks.length === 0) return;
    setWeekId((weeks.find((w) => !w.is_complete) ?? weeks[0]).id);
  }, [weeks, weekId]);

  const week = weeks.find((w) => w.id === weekId) ?? null;

  const newWeek = useMutation({
    mutationFn: () => getOrCreateWeek(),
    onSuccess: (w) => { qc.invalidateQueries({ queryKey: ["weeks"] }); setWeekId(w.id); },
  });

  if (weeksQ.isLoading) return <div className="grid gap-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-12" />)}</div>;
  if (weeksQ.error) return <p className="py-10 text-center text-sm text-loss">Couldn&apos;t load your weeks. {(weeksQ.error as Error).message}</p>;

  if (!week) {
    return (
      <EmptyState icon={ListChecks} title="No weeks yet"
        body="Each week holds the options you sold that week. Start this week to add your first position."
        action={<button onClick={() => newWeek.mutate()} disabled={newWeek.isPending} className="btn-primary h-10 px-4 text-sm"><Plus size={15} /> Start this week</button>} />
    );
  }

  const picker = (
    <>
      <label className="sr-only" htmlFor="week-pick">Week</label>
      <select id="week-pick" value={week.id} onChange={(e) => setWeekId(Number(e.target.value))}
        className={clsx(inputCls.replace("w-full ", ""), "w-auto max-w-full pr-8 font-medium")}>
        {weeks.map((w) => <option key={w.id} value={w.id}>{w.label}{w.is_complete ? " · complete" : ""}</option>)}
      </select>
      {week.is_complete ? <Pill tone="good" dot>Complete</Pill> : <Pill tone="accent" dot>Open</Pill>}
      <button onClick={() => newWeek.mutate()} disabled={newWeek.isPending} className="btn-ghost h-10 px-3 text-sm" title="Open the week for today's date (or jump to it)">
        This week
      </button>
    </>
  );
  return <WeekBody key={week.id} week={week} picker={picker} />;
}

function WeekBody({ week, picker }: { week: WeeklySnapshot; picker: React.ReactNode }) {
  const qc = useQueryClient();
  const { data: positions = [], isLoading, error } = useQuery({
    queryKey: ["positions", week.id],
    queryFn: () => fetchPositions(week.id),
    staleTime: 30_000,
  });

  const [form, setForm] = useState<{ edit?: OptionPosition } | null>(null);
  const [toDelete, setToDelete] = useState<OptionPosition | null>(null);
  const [closing, setClosing] = useState<{ pos: OptionPosition; status: PositionStatus } | null>(null);
  const [weekAction, setWeekAction] = useState<"complete" | "reopen" | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["positions"] });
    qc.invalidateQueries({ queryKey: ["holdings"] });
    qc.invalidateQueries({ queryKey: ["premiumDashboard"] });
    qc.invalidateQueries({ queryKey: ["portfolioSummary"] });
  };

  const del = useMutation({ mutationFn: (id: number) => deletePosition(id), onSuccess: () => { invalidate(); setToDelete(null); } });
  const setStatus = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { status: PositionStatus; premium_out: number | null } }) => updatePosition(id, body),
    onSuccess: () => { invalidate(); setClosing(null); },
  });

  const own = positions.filter((p) => !p.carried);
  const carried = positions.filter((p) => p.carried);
  const open = own.filter((p) => !CLOSED.includes(p.status));
  const closed = own.filter((p) => CLOSED.includes(p.status));
  const active = positions.filter((p) => p.status === "ACTIVE");

  const symbols = useMemo(() => Array.from(new Set(active.map((p) => p.symbol))).sort(), [active]);
  const { data: quotes } = useQuery({
    queryKey: ["liveQuotes", symbols.join(",")],
    queryFn: () => fetchMarketQuotes(symbols),
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
  const spot = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of quotes ?? []) if (q.price != null) m.set(q.symbol, q.price);
    return m;
  }, [quotes]);

  const weekNet = own.reduce((s, p) => s + (p.total_premium ?? 0), 0);
  const weekGross = own.reduce((s, p) => s + (p.premium_in ?? 0) * p.contracts * 100, 0);
  const atRisk = active.filter((p) => p.option_type === "PUT").reduce((s, p) => s + p.strike * p.contracts * 100, 0);
  const itmCount = active.filter((p) => itm(p, spot.get(p.symbol))).length;

  const onStatus = (p: OptionPosition, status: PositionStatus) => {
    if (status === p.status) return;
    if (status === "CLOSED" || status === "ROLLED") setClosing({ pos: p, status });
    // Expired: nothing paid to close. Assigned: exercised at the strike, the full premium is kept.
    else if (status === "EXPIRED" || status === "ASSIGNED") setStatus.mutate({ id: p.id, body: { status, premium_out: 0 } });
    else setStatus.mutate({ id: p.id, body: { status, premium_out: null } });
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {picker}
        <div className="ml-auto flex gap-2">
          {week.is_complete
            ? <button onClick={() => setWeekAction("reopen")} className="btn-ghost h-10 px-3 text-sm"><LockOpen size={14} /> Reopen</button>
            : <button onClick={() => setWeekAction("complete")} className="btn-ghost h-10 px-3 text-sm"><CheckCircle2 size={14} /> Complete week</button>}
          <button onClick={() => setForm({})} className="btn-primary h-10 px-3 text-sm"><Plus size={14} /> Add position</button>
        </div>
      </div>
      <StatRow cols={5}>
        <StatTile label="Week premium" value={usdSigned(weekNet)} tone={toneOf(weekNet)}
          sub={weekGross !== weekNet ? `${usd(weekGross)} sold, ${usd(weekGross - weekNet)} paid back` : `${own.length} position${own.length === 1 ? "" : "s"} this week`} />
        <StatTile label="Open now" value={active.length} sub={carried.length ? `${carried.length} carried from earlier weeks` : "all opened this week"} />
        <StatTile label="Cash secured" value={usdCompact(atRisk)} sub="strike × 100 on open puts" />
        <StatTile label="In the money" value={quotes ? itmCount : "—"} tone={itmCount ? "text-amber-600 dark:text-amber-300" : undefined}
          sub={quotes ? (itmCount ? "could be assigned" : "none at risk now") : symbols.length ? "loading prices…" : "no open positions"} />
        <StatTile label="Account value" value={usdCompact(week.account_value)} sub={week.is_complete ? `closed ${shortDate(week.completed_at)}` : "set when you complete the week"} />
      </StatRow>

      <Panel
        padded={false}
        title={`${week.label}`}
        sub={`${shortDate(week.week_start)} – ${shortDate(week.week_end, true)}`}
      >
        {error ? (
          <p className="px-4 py-10 text-center text-sm text-loss">Couldn&apos;t load positions. {(error as Error).message}</p>
        ) : isLoading ? (
          <div className="grid gap-2 p-4">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-9" />)}</div>
        ) : positions.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-foreground">Nothing sold this week yet</p>
            <p className="mt-1 text-sm text-foreground/55">Add a covered call or a cash-secured put to start tracking it.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-[13px]">
              <thead className={theadCls}>
                <tr>
                  <th className={clsx(thCls, "pl-4")}>Ticker</th>
                  <th className={thCls}>Contract</th>
                  <th className={thCls}>Expires</th>
                  <th className={clsx(thCls, "text-right")}>Sold at</th>
                  <th className={clsx(thCls, "text-right")}>Paid back</th>
                  <th className={clsx(thCls, "text-right")}>Net</th>
                  <th className={clsx(thCls, "text-right")}>Price now</th>
                  <th className={thCls}>Status</th>
                  <th className={clsx(thCls, "pr-4")}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                <Group label="Open this week" rows={open} spot={spot} onStatus={onStatus} onEdit={(p) => setForm({ edit: p })} onDelete={setToDelete} />
                <Group label="Carried from earlier weeks" rows={carried} spot={spot} onStatus={onStatus} onEdit={(p) => setForm({ edit: p })} onDelete={setToDelete} carried />
                <Group label="Closed this week" rows={closed} spot={spot} onStatus={onStatus} onEdit={(p) => setForm({ edit: p })} onDelete={setToDelete} />
              </tbody>
            </table>
          </div>
        )}
        {setStatus.error && <p className="border-t border-[var(--border)] px-4 py-2.5 text-sm text-loss">{(setStatus.error as Error).message}</p>}
      </Panel>

      {form && (
        <Dialog title={form.edit ? `Edit ${form.edit.symbol} ${form.edit.option_type === "CALL" ? "call" : "put"}` : "Add a position"} onClose={() => setForm(null)} wide>
          <PositionForm weekId={week.id} edit={form.edit} onDone={() => { setForm(null); invalidate(); }} />
        </Dialog>
      )}
      {toDelete && (
        <ConfirmDialog title="Delete this position?" confirm="Delete" busy={del.isPending} error={del.error?.message}
          onClose={() => setToDelete(null)} onConfirm={() => del.mutate(toDelete.id)}
          body={<>The {toDelete.symbol} ${toDelete.strike} {toDelete.option_type === "CALL" ? "call" : "put"} is removed with its assignment and premium-ledger rows. Holding history keeps its record. This can&apos;t be undone.</>} />
      )}
      {closing && (
        <CloseDialog pos={closing.pos} status={closing.status} busy={setStatus.isPending} error={setStatus.error?.message}
          onClose={() => setClosing(null)}
          onSave={(premium_out) => setStatus.mutate({ id: closing.pos.id, body: { status: closing.status, premium_out } })} />
      )}
      {weekAction && <WeekDialog week={week} action={weekAction} onClose={() => setWeekAction(null)} />}
    </>
  );
}

function Group({ label, rows, spot, onStatus, onEdit, onDelete, carried }: {
  label: string; rows: OptionPosition[]; spot: Map<string, number>; carried?: boolean;
  onStatus: (p: OptionPosition, s: PositionStatus) => void; onEdit: (p: OptionPosition) => void; onDelete: (p: OptionPosition) => void;
}) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.strike - b.strike);
  return (
    <>
      <tr>
        <td colSpan={9} className="bg-[var(--surface-2)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground/55">
          {label} <span className="text-foreground/35">· {rows.length}</span>
        </td>
      </tr>
      {sorted.map((p) => {
        const s = spot.get(p.symbol);
        const isItm = p.status === "ACTIVE" ? itm(p, s) : null;
        const days = p.status === "ACTIVE" ? dte(p.expiry_date) : null;
        return (
          <tr key={p.id} className="border-t border-[var(--border)] transition hover:bg-[var(--surface-2)]/60">
            <td className="px-3 py-2 pl-4">
              <Link href={`/stocks/${p.symbol}`} className="font-medium text-foreground hover:underline">{p.symbol}</Link>
              {p.holding_id != null && <span className="ml-1.5 text-[11px] text-foreground/40" title="Linked to a holding">◆</span>}
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-foreground">
              {p.contracts}× ${p.strike % 1 ? p.strike.toFixed(2) : p.strike}{" "}
              <span className={p.option_type === "CALL" ? "text-gain" : "text-loss"}>{p.option_type === "CALL" ? "Call" : "Put"}</span>
              {p.is_roll && <span className="ml-1.5 text-[11px] text-foreground/45">roll</span>}
              {carried && p.origin_week_label && <span className="block font-sans text-[11px] text-foreground/45">from {p.origin_week_label.replace("Week of ", "")}</span>}
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-foreground/80">
              {shortDate(p.expiry_date)}
              {days != null && <span className={clsx("ml-1.5 text-[11px]", days <= 1 ? "text-amber-600 dark:text-amber-300" : "text-foreground/45")}>{days < 0 ? "past" : days === 0 ? "today" : `${days}d`}</span>}
            </td>
            <td className="px-3 py-2 text-right text-foreground/80">{p.premium_in != null ? usd(p.premium_in) : "—"}</td>
            <td className="px-3 py-2 text-right text-foreground/60">{p.premium_out ? usd(Math.abs(p.premium_out)) : "—"}</td>
            <td className={clsx("px-3 py-2 text-right font-medium", toneOf(p.total_premium))}>{usdSigned(p.total_premium)}</td>
            <td className="whitespace-nowrap px-3 py-2 text-right">
              {s != null ? <span className="text-foreground/80">{usd(s)}</span> : <span className="text-foreground/35">—</span>}
              {isItm != null && <span className={clsx("ml-1.5 text-[11px]", isItm ? "text-amber-600 dark:text-amber-300" : "text-foreground/40")}>{isItm ? "ITM" : "OTM"}</span>}
            </td>
            <td className="px-3 py-2">
              <label className="sr-only" htmlFor={`st-${p.id}`}>Status</label>
              <div className="relative inline-flex">
                <Pill tone={STATUS_TONE[p.status]} className="pointer-events-none">{STATUS_LABEL[p.status]}</Pill>
                <select id={`st-${p.id}`} value={p.status} onChange={(e) => onStatus(p, e.target.value as PositionStatus)}
                  className="absolute inset-0 cursor-pointer opacity-0" title="Change status">
                  {STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
                </select>
              </div>
            </td>
            <td className="whitespace-nowrap px-3 py-2 pr-4 text-right">
              <RowButton label="Edit" onClick={() => onEdit(p)}><Pencil size={14} /></RowButton>
              <RowButton label="Delete" onClick={() => onDelete(p)} danger><Trash2 size={14} /></RowButton>
            </td>
          </tr>
        );
      })}
    </>
  );
}

/** Bought back or rolled: ask what it cost per share. */
function CloseDialog({ pos, status, onSave, onClose, busy, error }: {
  pos: OptionPosition; status: PositionStatus; onSave: (premiumOut: number | null) => void; onClose: () => void; busy: boolean; error?: string;
}) {
  const [cost, setCost] = useState(pos.premium_out ? String(Math.abs(pos.premium_out)) : "");
  const c = num(cost) ?? 0;
  const net = ((pos.premium_in ?? 0) - c) * pos.contracts * 100;
  return (
    <Dialog title={status === "ROLLED" ? `Roll ${pos.symbol} $${pos.strike}` : `Buy back ${pos.symbol} $${pos.strike}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(cost.trim() === "" ? null : -Math.abs(c)); }}>
        <Field label="Paid to close, per share" hint={`You sold it for ${usd(pos.premium_in)} a share.`}>
          <input autoFocus type="number" step="0.01" min="0" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.45" className={clsx(inputCls, "font-mono")} />
        </Field>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-sm">
          <span className="text-foreground/60">Net on this trade</span>
          <span className={clsx("font-mono font-medium", toneOf(net))}>{usdSigned(net)}</span>
        </div>
        {net < 0 && <p className="mt-2 text-[12px] text-loss">That&apos;s a realized loss. It won&apos;t lower the holding&apos;s cost basis.</p>}
        {status === "ROLLED" && <p className="mt-2 text-[12px] text-foreground/55">Add the new contract you rolled into as its own position, marked as a roll.</p>}
        <FormActions onCancel={onClose} busy={busy} label="Save" error={error} />
      </form>
    </Dialog>
  );
}

function WeekDialog({ week, action, onClose }: { week: WeeklySnapshot; action: "complete" | "reopen"; onClose: () => void }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(week.account_value != null ? String(week.account_value) : "");
  const mut = useMutation({
    mutationFn: () => (action === "complete" ? completeWeek(week.id, num(val) != null ? { account_value: num(val)! } : undefined) : reopenWeek(week.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weeks"] });
      qc.invalidateQueries({ queryKey: ["positions"] });
      qc.invalidateQueries({ queryKey: ["portfolioSummary"] });
      onClose();
    },
  });
  if (action === "reopen") {
    return (
      <ConfirmDialog title={`Reopen ${week.label}?`} confirm="Reopen" busy={mut.isPending} error={mut.error?.message}
        onClose={onClose} onConfirm={() => mut.mutate()}
        body="Positions this week carried into the next week are taken back out of it. Complete the week again when you're done to carry them forward." />
    );
  }
  return (
    <Dialog title={`Complete ${week.label}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
        <p className="mb-4 text-sm leading-relaxed text-foreground/65">Open positions carry into next week. Record what the account was worth at Friday&apos;s close.</p>
        <Field label="Account value at the close">
          <input autoFocus type="number" step="0.01" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder="25,000" className={clsx(inputCls, "font-mono")} />
        </Field>
        <FormActions onCancel={onClose} busy={mut.isPending} label="Complete week" error={mut.error?.message} />
      </form>
    </Dialog>
  );
}
