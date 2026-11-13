"use client";
/**
 * FlowTheory — the "Theory" pop-up for one ticker's dealer map (Flow board column, stock page "Dealer levels").
 * Every example is read from the live GEX result of the ticker being viewed (`data`): its walls, flip, king, max
 * pain, heatmap cells, VEX, IV and premium. Nothing is made up; a section whose number is missing says so instead.
 * The board's query (SSE stream / polling) keeps `data` fresh, so the pop-up updates while it is open.
 */
import type { GexResult } from "@/lib/api";
import { H, P, Formula, Terms, Theory } from "@/components/hedge/Theory";

export const money = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "−" : "+";
  return `${s}$${a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a.toFixed(0)}`;
};
export const plainMoney = (v: number) => money(v).slice(1);
export const px = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v.toFixed(2));
export const dist = (level: number, spot: number) => {
  const d = (level / spot - 1) * 100;
  return Math.abs(d) < 0.05 ? "at spot" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}% ${d > 0 ? "above" : "below"}`;
};
export const expLabel = (e: string) => {
  const d = new Date(`${e}T12:00:00`);
  return Number.isNaN(d.getTime()) ? e : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const k = (v: number) => (v % 1 === 0 ? v.toFixed(0) : String(v));
const ACTION = { BUY_CALL: "Buy call", SELL_CALL: "Sell call", BUY_PUT: "Buy put", SELL_PUT: "Sell put" } as const;

/** Strongest heatmap cell and how much of the gamma sits in the nearest expiry. */
function heatFacts(d: GexResult) {
  const exps = d.heatmap_expiries ?? [], ks = d.heatmap_strikes ?? [], rows = d.heatmap_values ?? [];
  let best: { exp: string; strike: number; v: number } | null = null;
  let total = 0;
  rows.forEach((row, i) => row.forEach((v, j) => {
    total += Math.abs(v);
    if (!best || Math.abs(v) > Math.abs(best.v)) best = { exp: exps[i], strike: ks[j], v };
  }));
  const near = rows[0] ? rows[0].reduce((a, v) => a + Math.abs(v), 0) : 0;
  return { best: best as { exp: string; strike: number; v: number } | null, nearShare: total ? near / total : null, nearExp: exps[0] };
}

/** The pop-up body: each section explains one statistic with this ticker's own numbers. */
export function FlowTheoryBody({ data: d }: { data: GexResult }) {
  const sym = d.symbol, spot = d.spot;
  const long = (d.net_gex ?? 0) >= 0;
  const flip = d.zero_gamma, cw = d.max_call_wall, pw = d.max_put_wall, king = d.max_gex_strike;
  const heat = heatFacts(d);
  const o = d.outlook;
  const iv = d.atm_iv_30d ?? o?.atm_iv ?? null;
  const day = iv != null ? spot * iv / Math.sqrt(252) : null;
  const top = d.top_flow_strikes?.[0];
  const idea = d.ideas?.find((i) => i.fit === "favored") ?? d.ideas?.[0];
  const asOf = d.as_of ? new Date(d.as_of).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const above = flip != null ? spot >= flip : null;

  return (
    <>
      <P>
        Every example below is {sym}&apos;s live map{asOf ? `, as of ${asOf}` : ""} (spot <b className="text-foreground">${px(spot)}</b>).
        It refreshes with the board, so the numbers change as the market moves.
      </P>

      <H>1 · Who is on the other side</H>
      <P>
        Market makers (dealers) sell most of the options customers buy, then hedge with shares so they stay neutral.
        Gamma is how fast that hedge has to change as the price moves. The map shows where that forced buying and
        selling sits, strike by strike.
      </P>
      <Formula>GEX = gamma × open interest × 100 × spot² × 1%   (calls +, puts −)</Formula>

      <H>2 · The regime: net GEX</H>
      <P>
        {sym}&apos;s net GEX is <b className={long ? "text-gain" : "text-loss"}>{money(d.net_gex ?? 0)}</b>. For every 1% move,
        dealers trade about {plainMoney(d.net_gex ?? 0)} of {sym} stock to stay hedged
        {long
          ? <>, and because it is positive they trade <b className="text-foreground">against</b> the move: they sell rallies and buy dips. Moves tend to fade and the price gets pinned between the walls.</>
          : <>, and because it is negative they trade <b className="text-foreground">with</b> the move: they sell into drops and buy into rallies. Moves tend to run further than usual.</>}
      </P>

      <H>3 · The levels, today</H>
      <Terms rows={[
        ...(cw != null ? [[`Call wall ${k(cw)}`, <>{dist(cw, spot)}. The strike with the most call gamma. Dealers sell more stock as {sym} rises toward it, so it often caps rallies.</>] as [React.ReactNode, React.ReactNode]] : []),
        ...(pw != null ? [[`Put wall ${k(pw)}`, <>{dist(pw, spot)}. The most put gamma. It often holds dips; if it breaks, the hedging can speed the fall.</>] as [React.ReactNode, React.ReactNode]] : []),
        ...(king != null ? [[`★ King ${k(king)}`, <>{dist(king, spot)}. The single strike with the most net gamma. Price is drawn toward it, most of all near expiry.</>] as [React.ReactNode, React.ReactNode]] : []),
        ...(flip != null ? [[`Flip ${px(flip)}`, <>{dist(flip, spot)}. Where net gamma changes sign. Spot is <b className="text-foreground">{above ? "above" : "below"}</b> it, so {above ? "dealers dampen moves" : "dealers amplify moves"}. A cross is the regime change to watch.</>] as [React.ReactNode, React.ReactNode]] : []),
        ...(d.max_pain != null ? [[`◎ Max pain ${k(d.max_pain)}`, <>{dist(d.max_pain, spot)}, for {d.max_pain_expiry ? expLabel(d.max_pain_expiry) : "the nearest expiry"}. Where that expiry&apos;s open options are worth least. It matters in the last day or two before expiry.</>] as [React.ReactNode, React.ReactNode]] : []),
      ]} />
      {cw != null && pw != null && (
        <P>
          Read together: {sym} is boxed between {k(pw)} and {k(cw)} ({((cw - pw) / spot * 100).toFixed(1)}% wide).
          {long ? " In long gamma that box usually holds, so fading moves toward its edges is the base case." : " In short gamma the box is weaker; a break of either wall can run."}
        </P>
      )}

      <H>4 · Reading the heatmap</H>
      <P>
        Rows are expiries, columns are strikes, and each cell is the GEX of that one strike and expiry. Bright positive
        cells are stabilising, deep negative cells are accelerating.
      </P>
      {heat.best ? (
        <P>
          On {sym}&apos;s map the strongest cell is <b className="text-foreground">{k(heat.best.strike)} on {expLabel(heat.best.exp)}</b> at{" "}
          <b className={heat.best.v >= 0 ? "text-gain" : "text-loss"}>{money(heat.best.v)}</b> ({dist(heat.best.strike, spot)}).
          {heat.nearShare != null && <> The nearest expiry ({expLabel(heat.nearExp)}) holds {(heat.nearShare * 100).toFixed(0)}% of the gamma shown{heat.nearShare > 0.4 ? ", so expect these levels to shift once it expires" : ", so the levels should still hold after it expires"}.</>}
        </P>
      ) : <P>No heatmap cells for {sym} right now.</P>}

      <H>5 · VEX: what a change in volatility does</H>
      <P>
        VEX (the second tab) is the change in dealers&apos; hedge for a 1-point move in implied vol. {sym}&apos;s net VEX is{" "}
        <b className="text-foreground">{money(d.net_vex ?? 0)}</b> per vol point.{" "}
        {(d.net_vex ?? 0) >= 0
          ? "Positive: if IV falls (after earnings or a calm session), dealers end up buyers of stock, which supports the price. A jump in IV does the reverse."
          : "Negative: if IV falls, dealers end up sellers of stock, which weighs on the price. A jump in IV makes them buyers."}
      </P>

      <H>6 · How far it is likely to move</H>
      {iv != null && day != null ? (
        <>
          <Formula>1-day move ≈ spot × IV ÷ √252 = {px(spot)} × {(iv * 100).toFixed(1)}% ÷ 15.9 ≈ ${day.toFixed(2)}</Formula>
          <P>
            {sym}&apos;s 30-day ATM IV is {(iv * 100).toFixed(1)}%, so options price a typical day at about ±${day.toFixed(2)} (±{(day / spot * 100).toFixed(2)}%).
            {o?.expected_low != null && o?.expected_high != null && <> Over {o.expected_dte} days, the ±1σ range is {px(o.expected_low)} – {px(o.expected_high)}, about two times in three.</>}
            {cw != null && <> The call wall is {(Math.abs(cw - spot) / day).toFixed(1)} typical days away.</>}
          </P>
        </>
      ) : <P>No usable implied vol for {sym} right now.</P>}

      <H>7 · Premium: where the money sits</H>
      <P>
        Premium is open interest × price: the money held in open contracts. {sym} has{" "}
        <b className="text-gain">{plainMoney(d.call_premium)}</b> in calls and <b className="text-loss">{plainMoney(d.put_premium)}</b> in puts
        ({d.net_flow >= 0 ? "call-heavy" : "put-heavy"} by {plainMoney(d.net_flow)}).
        {top && <> The busiest strike is <b className="text-foreground">{k(top.strike)}</b> with {plainMoney(top.call_prem)} calls and {plainMoney(top.put_prem)} puts, {top.bias === "call" ? "mostly calls" : "mostly puts"}.</>}
        {" "}Premium says where bets are; it doesn&apos;t say whether they were bought or sold (the By strike tab in Details does).
      </P>

      <H>8 · Putting it to work</H>
      <ul className="list-disc space-y-1 pl-5">
        {long ? (
          <>
            <li>Long gamma: sell premium at the walls{cw != null ? ` (calls near ${k(cw)}` : ""}{pw != null ? `${cw != null ? "," : " ("} puts near ${k(pw)})` : cw != null ? ")" : ""} and expect a range.</li>
            <li>Buying breakouts works poorly here unless spot closes beyond a wall.</li>
          </>
        ) : (
          <>
            <li>Short gamma: moves extend. Favour buying options on the side the price is moving, not selling them.</li>
            <li>Size down: daily ranges run wider than the IV implies.</li>
          </>
        )}
        {flip != null && <li>Watch {px(flip)}: a cross {above ? "below it turns dealers into chasers" : "above it calms the tape"}. Turn on Dealer-levels alerts in Settings → Notifications to be told.</li>}
        {king != null && <li>Into expiry, price often drifts to the king ({k(king)}){d.max_pain != null ? ` or max pain (${k(d.max_pain)})` : ""}.</li>}
      </ul>
      {idea && (
        <P>
          The board&apos;s own example right now: <b className="text-foreground">{ACTION[idea.action]} {k(idea.strike)}{idea.otype === "call" ? "C" : "P"} {expLabel(idea.expiry)}</b>{" "}
          at ${idea.premium.toFixed(2)} (Δ {idea.delta.toFixed(2)}, break-even {px(idea.breakeven)}, {idea.fit === "favored" ? "fits the regime" : idea.fit === "against" ? "against the regime" : "the other side"}). {idea.reason}
        </P>
      )}

      <H>Limits</H>
      <P>
        The model assumes customers buy calls and puts and dealers sell them. When a big fund sells calls instead, the
        sign of that strike is wrong. Open interest updates once a day, so intraday trades move the map only after the
        next morning. Use these levels as zones, not exact prices. Not advice.
      </P>
    </>
  );
}

export function FlowTheory({ data, compact = false }: { data: GexResult; compact?: boolean }) {
  return (
    <Theory title={`How to read ${data.symbol}'s dealer map`} label={compact ? "" : "Theory"}>
      <FlowTheoryBody data={data} />
    </Theory>
  );
}
