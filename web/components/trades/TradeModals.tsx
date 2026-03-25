"use client";
import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { completeWeek, reopenWeek, WeeklySnapshot } from "@/lib/api";
import { LockOpen } from "lucide-react";
import { inp, weekLabel } from "./TradesHelpers";

// ── Complete Week Modal ───────────────────────────────────────────────────────

export function CompleteWeekModal({ week, onDone }: { week: WeeklySnapshot; onDone: () => void }) {
  const qc = useQueryClient();
  const [val, setVal] = useState(week.account_value?.toFixed(2) ?? "");
  const [err, setErr] = useState("");
  const mut = useMutation({
    mutationFn: () => completeWeek(week.id, val ? { account_value: parseFloat(val) } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weeks"] });
      qc.invalidateQueries({ queryKey: ["positions", week.id] });
      onDone();
    },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-[var(--surface)] rounded-2xl p-6 w-full sm:max-w-sm shadow-2xl border border-[var(--border)]">
        <h3 className="font-bold text-lg text-foreground mb-1">Complete Week</h3>
        <p className="text-xs text-foreground/60 mb-4">
          {weekLabel(week)} — all active positions will carry forward to next week.
        </p>
        <label className="text-xs text-foreground/70 block mb-1">Friday Account Value ($)</label>
        <input
          type="number" step="0.01" value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="100000.00"
          className={`${inp} mb-4`}
        />
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => mut.mutate()} disabled={mut.isPending}
            className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition"
          >
            {mut.isPending ? "Completing…" : "✓ Mark Complete"}
          </button>
          <button
            onClick={onDone}
            className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-foreground hover:bg-[var(--surface-2)] transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reopen Week Modal ─────────────────────────────────────────────────────────

export function ReopenWeekModal({ week, onDone }: { week: WeeklySnapshot; onDone: () => void }) {
  const qc = useQueryClient();
  const [err, setErr] = useState("");
  const mut = useMutation({
    mutationFn: () => reopenWeek(week.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weeks"] });
      qc.invalidateQueries({ queryKey: ["positions", week.id] });
      onDone();
    },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-[var(--surface)] rounded-2xl p-6 w-full sm:max-w-sm shadow-2xl border border-[var(--border)]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <LockOpen size={18} className="text-orange-500" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-foreground">Re-open Week</h3>
            <p className="text-xs text-foreground/60">{weekLabel(week)}</p>
          </div>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-3 mb-4">
          <p className="text-xs text-orange-700 dark:text-orange-300 font-semibold mb-1">⚠ Heads up</p>
          <p className="text-xs text-orange-600 dark:text-orange-400">
            Any positions that were carried forward into the following week from this week will be
            <strong> removed</strong> from that week. You can re-complete this week when done to carry them forward again.
          </p>
        </div>
        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => mut.mutate()} disabled={mut.isPending}
            className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50 transition"
          >
            {mut.isPending ? "Re-opening…" : "✎ Re-open Week"}
          </button>
          <button
            onClick={onDone}
            className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-foreground hover:bg-[var(--surface-2)] transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
