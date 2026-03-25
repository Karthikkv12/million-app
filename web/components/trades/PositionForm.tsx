"use client";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchHoldings, createPosition, updatePosition,
  OptionPosition, PositionStatus,
} from "@/lib/api";
import { X } from "lucide-react";
import { inp, datInp, emptyForm, posToForm, PosFormState } from "./TradesHelpers";

// ── Add / Edit Position Form ──────────────────────────────────────────────────

export function PositionForm({
  weekId, editPos, onDone,
}: { weekId: number; editPos?: OptionPosition; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<PosFormState>(editPos ? posToForm(editPos) : emptyForm());
  const [err, setErr] = useState("");

  const { data: allHoldings = [] } = useQuery({
    queryKey: ["holdings"],
    queryFn: fetchHoldings,
    staleTime: 30_000,
  });

  const relevantHoldings = allHoldings.filter((h) =>
    h.status === "ACTIVE" &&
    (f.option_type === "CALL"
      ? h.symbol === f.symbol.toUpperCase()
      : true)
  );

  function set(k: keyof PosFormState, v: string | boolean) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  const mut = useMutation({
    mutationFn: () => {
      const body = {
        symbol: f.symbol.toUpperCase(),
        contracts: parseInt(f.contracts),
        strike: parseFloat(f.strike),
        option_type: f.option_type,
        sold_date: f.sold_date || null,
        expiry_date: f.expiry_date || null,
        premium_in: f.premium_in ? parseFloat(f.premium_in) : null,
        premium_out: f.premium_out ? parseFloat(f.premium_out) : null,
        spot_price: f.spot_price ? parseFloat(f.spot_price) : null,
        is_roll: f.is_roll,
        margin: f.margin ? parseFloat(f.margin) : null,
        notes: f.notes || null,
        holding_id: f.holding_id ? parseInt(f.holding_id) : null,
        status: f.status as PositionStatus,
        buy_date: f.buy_date || null,
      };
      return editPos
        ? updatePosition(editPos.id, body)
        : createPosition(weekId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["positions", weekId] });
      qc.invalidateQueries({ queryKey: ["holdings"] });
      qc.invalidateQueries({ queryKey: ["premiumDashboard"] });
      onDone();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const field = (label: string, el: React.ReactNode) => (
    <div>
      <label className="text-xs text-foreground/70 block mb-1">{label}</label>
      {el}
    </div>
  );

  return (
    <div className="bg-[var(--surface)] border border-blue-200 dark:border-blue-800 rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-foreground">{editPos ? "Edit Position" : "Add Position"}</h3>
        <button onClick={onDone} className="p-1.5 rounded-xl text-foreground/70 hover:bg-[var(--surface-2)] transition">
          <X size={15} />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {field("Symbol", <input value={f.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="AAPL" className={inp} />)}
        {field("Contracts", <input type="number" min="1" value={f.contracts} onChange={(e) => set("contracts", e.target.value)} className={inp} />)}
        {field("Strike ($)", <input type="number" step="0.5" value={f.strike} onChange={(e) => set("strike", e.target.value)} placeholder="150.00" className={inp} />)}
        {field("Type", (
          <select value={f.option_type} onChange={(e) => set("option_type", e.target.value as "PUT" | "CALL")} className={inp}>
            <option value="CALL">CALL (CC)</option>
            <option value="PUT">PUT (CSP)</option>
          </select>
        ))}
        {field("Sold Date", <input type="date" value={f.sold_date} onChange={(e) => set("sold_date", e.target.value)} className={datInp} />)}
        {field("Expiry Date", <input type="date" value={f.expiry_date} onChange={(e) => set("expiry_date", e.target.value)} className={datInp} />)}
        {field("Buy Date", <input type="date" value={f.buy_date} onChange={(e) => set("buy_date", e.target.value)} className={datInp} />)}
        {field("Premium In ($)", <input type="number" step="0.01" value={f.premium_in} onChange={(e) => set("premium_in", e.target.value)} placeholder="0.00" className={inp} />)}
        {field("Spot Price ($)", <input type="number" step="0.01" value={f.spot_price} onChange={(e) => set("spot_price", e.target.value)} placeholder="underlying at sale" className={inp} />)}
        {field("Margin ($)", <input type="number" step="1" value={f.margin} onChange={(e) => set("margin", e.target.value)} placeholder="optional" className={inp} />)}
      </div>

      {/* Live moneyness / extrinsic breakdown */}
      {(() => {
        const spot   = parseFloat(f.spot_price);
        const strike = parseFloat(f.strike);
        const prem   = parseFloat(f.premium_in);
        if (!spot || !strike || !prem || isNaN(spot) || isNaN(strike) || isNaN(prem)) return null;
        const intrinsic = f.option_type === "CALL"
          ? Math.max(0, spot - strike)
          : Math.max(0, strike - spot);
        const cappedIntrinsic = Math.min(intrinsic, prem);
        const extrinsic = Math.max(0, prem - cappedIntrinsic);
        const atmBand = strike * 0.005;
        const moneyness = Math.abs(spot - strike) <= atmBand ? "ATM"
          : (f.option_type === "CALL" ? spot > strike : spot < strike) ? "ITM" : "OTM";
        const badgeColor = moneyness === "ITM"
          ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-700"
          : moneyness === "ATM"
          ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700"
          : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-500 border-green-300 dark:border-green-700";
        const itmWarn = moneyness === "ITM" && cappedIntrinsic > 0;
        return (
          <div className="mb-3 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] flex flex-wrap gap-4 items-center">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${badgeColor}`}>
              {moneyness}
            </span>
            <div className="text-xs">
              <span className="text-foreground/50">Intrinsic: </span>
              <span className={`font-semibold ${itmWarn ? "text-orange-500" : "text-foreground/70"}`}>
                ${cappedIntrinsic.toFixed(2)}/sh
              </span>
            </div>
            <div className="text-xs">
              <span className="text-foreground/50">Extrinsic (θ income): </span>
              <span className="font-semibold text-green-500">${extrinsic.toFixed(2)}/sh</span>
              <span className="text-foreground/40 ml-1">(${(extrinsic * (parseInt(f.contracts) || 1) * 100).toFixed(0)} total)</span>
            </div>
            {itmWarn && (
              <p className="w-full text-[11px] text-orange-500/80 mt-0 pt-0">
                ⚠ Selling ITM — ${cappedIntrinsic.toFixed(2)}/sh is intrinsic value, not theta income. True extrinsic collected is <strong>${extrinsic.toFixed(2)}/sh</strong>.
              </p>
            )}
          </div>
        );
      })()}

      {(f.is_roll || ["CLOSED", "EXPIRED", "ROLLED"].includes(f.status)) && (() => {
        // ASSIGNED is intentionally excluded: assignment happens at the strike price,
        // there is no buyback cost — the full premium collected is kept.
        const premIn  = parseFloat(f.premium_in)  || 0;
        const premOut = parseFloat(f.premium_out) || 0;
        const contracts = parseInt(f.contracts) || 1;
        const netTotal  = (premIn + premOut) * contracts * 100;
        const isLoss    = premOut !== 0 && Math.abs(premOut) > premIn;
        return (
          <div className="mb-3">
            <label className="text-xs text-foreground/70 block mb-1">
              Prem Out ($) <span className="text-foreground/40">— buyback/close cost (enter as negative, e.g. −0.45)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number" step="0.01" value={f.premium_out}
                onChange={(e) => set("premium_out", e.target.value)}
                placeholder={f.is_roll ? "Roll credit (+) or debit (−)" : "e.g. −0.45"}
                className={`${inp} flex-1 ${isLoss ? "border-red-400 dark:border-red-600" : ""}`}
              />
              {f.premium_out !== "" && (
                <div className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${
                  isLoss
                    ? "bg-red-50 dark:bg-red-900/30 text-red-500"
                    : "bg-green-50 dark:bg-green-900/20 text-green-600"
                }`}>
                  Net: {netTotal >= 0 ? "+" : ""}${netTotal.toFixed(2)}
                  {isLoss && <span className="ml-1.5 text-[10px] font-bold">LOSS — adj basis unaffected</span>}
                </div>
              )}
            </div>
            {isLoss && (
              <p className="mt-1.5 text-[11px] text-red-500/80">
                ⚠ Buyback cost exceeds premium collected. This is a realized loss. Adj basis will <span className="font-bold">not</span> be reduced.
              </p>
            )}
          </div>
        );
      })()}

      <div className="flex items-center gap-3 mb-3">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-foreground">
          <input
            type="checkbox" checked={f.is_roll}
            onChange={(e) => set("is_roll", e.target.checked)}
            className="rounded accent-purple-500"
          />
          This is a roll
        </label>
      </div>
      <div className="mb-3">
        {field("Notes", <input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" className={inp} />)}
      </div>
      <div className="mb-3">
        {field(
          f.option_type === "CALL" ? "Link to Holding (CC)" : "Link to Holding (CSP — optional)",
          <select
            value={f.holding_id}
            onChange={(e) => {
              const val = e.target.value;
              set("holding_id", val);
              if (val) {
                const chosen = allHoldings.find(h => String(h.id) === val);
                if (chosen) set("symbol", chosen.symbol);
              }
            }}
            className={inp}
          >
            <option value="">— No holding linked —</option>
            {relevantHoldings.map((h) => (
              <option key={h.id} value={String(h.id)}>
                {h.symbol}{h.company_name ? ` · ${h.company_name.slice(0, 25)}` : ""} · {h.shares.toLocaleString()} shares · live adj basis ${(h.live_adj_basis ?? h.adjusted_cost_basis).toFixed(2)}
              </option>
            ))}
            {f.option_type === "CALL" && relevantHoldings.length === 0 && (
              <option disabled value="">(no {f.symbol || ""} holdings — add one in Holdings tab)</option>
            )}
          </select>
        )}
      </div>
      {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
      {(!f.symbol || !f.strike) && (
        <p className="text-xs text-foreground/50 mb-2">* Symbol and Strike are required</p>
      )}
      <button
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !f.symbol || !f.strike}
        className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {mut.isPending ? "Saving…" : editPos ? "Save Changes" : "Add Position"}
      </button>
    </div>
  );
}
