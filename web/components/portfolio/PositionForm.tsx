"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { fetchHoldings, createPosition, updatePosition, OptionPosition, PositionStatus } from "@/lib/api";
import { Segmented } from "@/components/ui";
import { Field, FormActions, inputCls, isoDay, num, usd, usdSigned, toneOf } from "./kit";

interface FormState {
  symbol: string; option_type: "CALL" | "PUT"; contracts: string; strike: string;
  sold_date: string; expiry_date: string; premium_in: string; premium_out: string;
  spot_price: string; margin: string; holding_id: string; is_roll: boolean; notes: string;
}

const today = () => new Date().toISOString().slice(0, 10);

function fromPosition(p?: OptionPosition): FormState {
  return {
    symbol: p?.symbol ?? "",
    option_type: p?.option_type ?? "PUT",
    contracts: String(p?.contracts ?? 1),
    strike: p?.strike != null ? String(p.strike) : "",
    sold_date: p ? isoDay(p.sold_date) : today(),
    expiry_date: isoDay(p?.expiry_date),
    premium_in: p?.premium_in != null ? String(p.premium_in) : "",
    premium_out: p?.premium_out != null && p.premium_out !== 0 ? String(p.premium_out) : "",
    spot_price: p?.spot_price != null ? String(p.spot_price) : "",
    margin: p?.margin != null ? String(p.margin) : "",
    holding_id: p?.holding_id != null ? String(p.holding_id) : "",
    is_roll: p?.is_roll ?? false,
    notes: p?.notes ?? "",
  };
}

export function PositionForm({ weekId, edit, onDone }: { weekId: number; edit?: OptionPosition; onDone: () => void }) {
  const [f, setF] = useState<FormState>(() => fromPosition(edit));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const { data: holdings = [] } = useQuery({ queryKey: ["holdings"], queryFn: fetchHoldings, staleTime: 60_000 });
  const sym = f.symbol.trim().toUpperCase();
  // Calls are covered by shares of the same ticker; a put can optionally be tied to a holding.
  const linkable = holdings.filter((h) => h.status === "ACTIVE" && (f.option_type === "PUT" || !sym || h.symbol === sym));

  const mut = useMutation({
    mutationFn: () => {
      const body: Partial<OptionPosition> = {
        symbol: sym,
        option_type: f.option_type,
        contracts: parseInt(f.contracts, 10) || 1,
        strike: Number(f.strike),
        sold_date: f.sold_date || null,
        expiry_date: f.expiry_date || null,
        premium_in: num(f.premium_in),
        premium_out: num(f.premium_out),
        spot_price: num(f.spot_price),
        margin: num(f.margin),
        holding_id: f.holding_id ? Number(f.holding_id) : null,
        is_roll: f.is_roll,
        notes: f.notes.trim() || null,
        status: (edit?.status ?? "ACTIVE") as PositionStatus,
      };
      return edit ? updatePosition(edit.id, body) : createPosition(weekId, body);
    },
    onSuccess: onDone,
  });

  // Moneyness at the sale, from the price you entered.
  const spot = num(f.spot_price), strike = num(f.strike), prem = num(f.premium_in);
  let sale: { label: string; intrinsic: number; extrinsic: number } | null = null;
  if (spot && strike && prem) {
    const intrinsic = Math.min(prem, Math.max(0, f.option_type === "CALL" ? spot - strike : strike - spot));
    const label = Math.abs(spot - strike) <= strike * 0.005 ? "At the money" : intrinsic > 0 ? "In the money" : "Out of the money";
    sale = { label, intrinsic, extrinsic: prem - intrinsic };
  }
  const contracts = parseInt(f.contracts, 10) || 1;
  const showOut = f.is_roll || (edit && ["CLOSED", "ROLLED"].includes(edit.status));
  const net = ((prem ?? 0) + (num(f.premium_out) ?? 0)) * contracts * 100;

  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented label="Option type" value={f.option_type} onChange={(v) => set("option_type", v)}
          options={[{ value: "PUT", label: "Cash-secured put" }, { value: "CALL", label: "Covered call" }]} />
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-foreground/75">
          <input type="checkbox" checked={f.is_roll} onChange={(e) => set("is_roll", e.target.checked)} className="accent-[rgb(var(--accent-rgb))]" />
          Rolled from an earlier contract
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Ticker">
          <input required value={f.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="AAPL" className={clsx(inputCls, "font-mono uppercase")} autoFocus={!edit} />
        </Field>
        <Field label="Contracts">
          <input required type="number" min="1" step="1" value={f.contracts} onChange={(e) => set("contracts", e.target.value)} className={clsx(inputCls, "font-mono")} />
        </Field>
        <Field label="Strike">
          <input required type="number" min="0" step="0.01" inputMode="decimal" value={f.strike} onChange={(e) => set("strike", e.target.value)} placeholder="150" className={clsx(inputCls, "font-mono")} />
        </Field>
        <Field label="Premium per share">
          <input type="number" min="0" step="0.01" inputMode="decimal" value={f.premium_in} onChange={(e) => set("premium_in", e.target.value)} placeholder="1.25" className={clsx(inputCls, "font-mono")} />
        </Field>
        <Field label="Sold on">
          <input type="date" value={f.sold_date} onChange={(e) => set("sold_date", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Expires">
          <input type="date" value={f.expiry_date} onChange={(e) => set("expiry_date", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Stock price at sale">
          <input type="number" min="0" step="0.01" inputMode="decimal" value={f.spot_price} onChange={(e) => set("spot_price", e.target.value)} placeholder="optional" className={clsx(inputCls, "font-mono")} />
        </Field>
        <Field label="Margin used">
          <input type="number" min="0" step="1" inputMode="decimal" value={f.margin} onChange={(e) => set("margin", e.target.value)} placeholder="optional" className={clsx(inputCls, "font-mono")} />
        </Field>
      </div>

      {sale && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-[13px]">
          <span className="font-medium text-foreground">{sale.label}</span>
          <span className="text-foreground/60">Time value <span className="font-mono text-gain">{usd(sale.extrinsic)}</span>/sh ({usd(sale.extrinsic * contracts * 100, 0)})</span>
          {sale.intrinsic > 0 && <span className="text-foreground/60">Intrinsic <span className="font-mono text-amber-600 dark:text-amber-300">{usd(sale.intrinsic)}</span>/sh, which isn&apos;t income</span>}
        </div>
      )}

      {showOut && (
        <div className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
          <Field label={f.is_roll ? "Roll credit (+) or debit (−) per share" : "Paid to close per share (negative)"}>
            <input type="number" step="0.01" inputMode="decimal" value={f.premium_out} onChange={(e) => set("premium_out", e.target.value)} placeholder="-0.45" className={clsx(inputCls, "font-mono")} />
          </Field>
          {f.premium_out !== "" && (
            <p className="pb-2.5 text-sm text-foreground/60">Net <span className={clsx("font-mono font-medium", toneOf(net))}>{usdSigned(net)}</span></p>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={f.option_type === "CALL" ? "Shares it covers" : "Tie to a holding (optional)"}>
          <select value={f.holding_id} onChange={(e) => {
            const v = e.target.value; set("holding_id", v);
            const h = holdings.find((x) => String(x.id) === v); if (h) set("symbol", h.symbol);
          }} className={inputCls}>
            <option value="">None</option>
            {linkable.map((h) => (
              <option key={h.id} value={h.id}>{h.symbol} · {h.shares.toLocaleString()} sh · basis {usd(h.live_adj_basis ?? h.adjusted_cost_basis)}</option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" className={inputCls} />
        </Field>
      </div>
      {f.option_type === "CALL" && sym && linkable.length === 0 && (
        <p className="mt-2 text-[12px] text-foreground/55">No {sym} shares on file. Add them under Holdings to track how this call lowers their cost.</p>
      )}

      <FormActions onCancel={onDone} busy={mut.isPending} label={edit ? "Save changes" : "Add position"} disabled={!sym || !f.strike} error={mut.error?.message} />
    </form>
  );
}
