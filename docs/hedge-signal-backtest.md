# Hedge signal backtest — 2026-11-13

> **Re-tested 2026-11-14: see [hedge-signal-review.md](hedge-signal-review.md).** Withdrawn there: the 1.2× IV gate (hindsight), the 180-day ROLL (rolling lost to holding at every days-left), "Sharpe within ±0.03", "BABA / NBIS oversold"; counts reconciled; ADD is now a fear score; adds go in thirds.

What drives the ADD / HOLD / CAUTION verdict on the Hedge desk for holdings of long calls (LEAPS) and long puts
(`optionflow/modules/hedge/signal.py`). Code to reproduce: `scripts/backtest_signal/`.

## Data

| | |
|---|---|
| Universe | 148 US symbols: 131 stocks (mega caps, high-beta tech, China ADRs, banks, energy, health care, consumer, industrials) + 17 ETFs |
| History | Daily prices from Yahoo, Jan 1995 → Nov 13 2026 (31.9 years); VIX for market fear |
| Data points | **827,892 symbol-days** (824,932 with a 20-day outcome) |
| Crashed names | 69 of the stocks fell ≥ 70% from a peak at some point (INTC, BABA, PYPL, ZM, NIO, …) |
| Method | Rules chosen on **1995–2014** (438,980 days), then checked **untouched on 2015–2026** (385,952 days) |
| Outcome | Return over the next 20 and 60 trading days, minus what simply holding that stock returned on average |
| Significance | t-statistics clustered by month: in a panic every stock dips together, so days are not independent |
| Tests run | 33 features × 3 outcomes × 2 periods; 52 rule grids × 2 sides; 8 holding policies; 7 bear-market filters; 3,000-day parity check |

## Finding 1 — the signal that was live did not work

Out of sample, after its **TRIM** call the stock went up *more* (+2.24% over 20 days) than after **ADD** (+1.53%).
As a holding policy it lowered both return and Sharpe versus doing nothing. It measured volatility, not direction.

## Finding 2 — the pattern: why a stock is down decides what comes next

| Setup | 20d vs holding (95–14 / 15–26) | 60d vs holding | Up after 20d |
|---|---|---|---|
| **Stock oversold (RSI < 40) while VIX is in the top 20% of its year** | **+1.37% / +1.16%** | **+2.69% / +3.41%** | 62% / 60% |
| Stock 10%+ off its high while the market is calm (VIX < 60th pct) | −0.3% / −0.4% | −1.4% / −1.3% | 57% / 55% |
| All other days | 0.0% / +0.1% | +0.5% / +0.4% | 58% / 58% |

- Dips during **market-wide fear** rebound. Dips when the market is **calm** are a problem with the stock; they don't.
- **Strength is not a sell.** Trend, momentum and buying-volume all predicted slightly *lower* returns for the same stock
  (mean reversion). No bucket predicted a fall.
- **Stops fail in fear.** A close under the 20-day low during fear came before +1.8–2.7% vs holding over 20 days.

## Robustness of ADD

- Entering at the **next open** instead of the close: +1.22% (same).
- Works in **ETFs** (+1.1%), **crashed stocks** (+1.2%) and the rest (+1.4%): not just survivorship.
- **241 separate fear episodes** since 1995: ADD beat holding in **159 (66%)** over 20 days, 156 over 60.
- Positive over 20 days in **26 of 31 years**.
- **Fails in long bear markets**: 2008 −2.9% / −6.5% (20d / 60d), 2022 −0.3% / −5.1%. Worst single episodes were
  17–26% behind holding. No filter (SPY trend, deeper VIX, VIX easing) fixed this out of sample. → Add in pieces.

## Finding 3 — no rule beats holding on risk-adjusted terms

As a full policy over 148 symbols (exposure 1.5 on ADD, 0.5 on cuts), every rule moved return and drawdown together:
ADD rules +5–6%/yr with deeper drawdowns; cut rules −4–5%/yr with ~10 points smaller drawdowns. Sharpe stayed within
±0.03 of buy-and-hold. Volatility targeting helped in 1995–2014 and not after. **The signal is a timing aid for
adding, not a source of risk-free extra return.**

## What is not tested

- **Options flow and dealer levels (GEX walls, gamma flip)**: no multi-year history exists. Shown as context only.
- **Per-stock implied volatility**: no history; VIX stands in for fear.
- **The options themselves**: the test is on the stock. LEAPS add leverage and time decay; a 20% stock drawdown is a
  much larger loss on a call.
- **Survivorship**: all 148 symbols still trade. The ETF and crashed-stock checks limit, but don't remove, the bias.

## Second pass — the options themselves (theta, IV, time left)

The first pass tested the stock. LEAPS lose value to time and move with IV, so every symbol-day was re-run as a
**simulated long call** priced with Black-Scholes:

| Input | How |
|---|---|
| 30-day IV | A model fit on the five real IV histories Yahoo serves (SPY/VIX, QQQ/VXN, DIA/VXD, GLD/GVZ, USO/OVX): log IV from 20/60/252-day realised vol and the VIX vs its 1-year median. Held out one underlying at a time: 2.1–2.5 vol points error on the equity indexes (vs ~5 for realised vol alone), 0.78 correlation with 20-day IV changes (it sees the crush). On 35 single stocks vs today's live chains: 6.7 points error, no bias, correlation 0.90; it misses earnings premiums. |
| Long-dated IV | Mean-reverting term structure, speed 2.25/yr fit on VIX vs VIX3M (1.9 points error). |
| Rates | 13-week T-bill. |
| Costs (stress) | +5 vol points on entry, 2% of the option price each way. |
| Configs | 90 / 180 / 365 / 540 days × 0.70 / 0.80Δ × 20 / 60-day holds; 808,838 symbol-days each. |

Results (2015–2026, unseen; excess = vs the same call bought on an average day for that stock):

| | 20 days | 60 days |
|---|---|---|
| Fear dip, 365d 0.80Δ, stress costs | +3.5% of premium (t 3.2), but −1.3% absolute: **a 20-day hold loses after costs** | +7.5% excess, +10.8% absolute, up 54% |
| Same, stock IV ≥ 1.2× its 5-year normal | +5.5% | **+13.7% excess, +17.1% absolute, up 59%** |
| Fear dip, stock IV normal | +1.1% | −0.3% |

- **Rich IV did not hurt.** The richest-IV fear dips did best; long-dated IV barely moves and the rebound outweighs the crush.
- **Theta depends on time left, not IV.** A 0.80Δ call loses about 2.2% of its value per 20 trading days at 365 days,
  3.1% at 240, 4.0% at 180, 5.6% at 120, 7.2% at 90. The edge (~3.5% per 20 days) clears that only above ~240 days.

Live rules from this (conservative):
- ADD needs the fear dip **and** the stock's IV ≥ 1.2× its 5-year normal; with a live chain the lower of the model's
  and the chain's ratio counts (stricter than the backtest).
- Add with **365+ days, ~0.80Δ**, and plan to hold **60+ trading days**.
- **ROLL** when a held leg loses ≥ 4% per 20 trading days (≈ 180 days left at 0.80Δ); "roll soon" at 3%.
- Each leg shows days left, IV (chain, or the model when there's no quote), delta, time value and decay per 20 days.

Caveat: the 1.2× gate was chosen after seeing that the IV-normal fear dips were weak in 2015–2026 (they were fine in
1995–2014), so it is partly hindsight. It is kept because it only removes adds; it never adds risk.

## Probabilities per signal (2015–2026, unseen)

From `scripts/backtest_signal/probs.py`. "Edge > 0" is the share of 4,000 month-cluster bootstrap draws in which the
average 60-day excess over holding was positive. The desk shows these on every call.

| Signal | Stock up 60d | Beats holding 60d | 365d call profits 60d | Avg edge 60d (90% range) | Edge > 0 |
|---|---|---|---|---|---|
| Add (shown conservatively: lower of gated / ungated) | 66% | 56% | 54% | +3.6% (+0.6 to +6.6) | 98% |
| Add, IV-gated as backtested | 71% | 61% | 59% | +6.2% (+1.7 to +10.3) | 99% |
| Fear dip, stock IV normal | 60% | 49% | 48% | +0.3% (−1.8 to +2.1) | 59% |
| Oversold, VIX calm-ish | 60% | 49% | 48% | +0.1% (−2.2 to +2.6) | 55% |
| Don't add | 58% | 46% | 46% | −1.2% (−2.5 to +0.1) | 6% |
| Hold (everything else) | 61% | 48% | 48% | +0.3% (−0.9 to +1.4) | 67% |
| Take profit on puts (fear dip) | 66% stock up | — | — | +3.6% | 98% |

These are averages for each setup, not a forecast for one stock: a single Add still fails about 4 times in 10.

## Your P&L on a holding (tested; weighed as risk, not direction)

`scripts/backtest_signal/holdsim.py`: a 365-day 0.80Δ call bought every 21 trading days on every symbol and checked
monthly — 39,294 positions, 275,058 checks — with the same IV model and costs. Findings (2015–2026, unseen):

- **P&L does not predict the stock.** By P&L bucket (−50% … +200%), the stock's next-60-day excess over holding was
  never significant (|t| < 1.2, both periods). So P&L never changes Add / Hold / Don't add.
- **The fear-dip edge held at every P&L**, strongest for deep losers (+4.8% / 60 days) and big winners.
- **Rolling a winner to lock gains didn't pay.** A delta-matched roll into a fresh 0.80Δ call, the difference banked,
  lost to holding in every bucket after costs, and didn't shrink the worst case.
- **What P&L changes is how much of what you paid is at risk:**

| P&L on the calls | Lost >25% of what was paid in 60d | Gained >25% | Worst 1 in 20 | Time value left |
|---|---|---|---|---|
| below −50% | 12% | 21% | −32% | 90% |
| −25% to 0 | 25% | 35% | −57% | 25% |
| +25% to +50% | 26% | 40% | −76% | 8% |
| +100% to +200% | 29% | 46% | −109% | 2% |
| above +200% | 36% | 50% | −229% | 1% |

The desk shows your P&L, these odds for your bucket, and a note: big winners can give back more than they cost
(taking some off is a risk choice, not an edge); deep losers are mostly time value. Shares show P&L vs your average,
for context only.

## Confidence

| Claim | Confidence |
|---|---|
| The old signal was useless to harmful | High |
| Fear dips (RSI < 40, VIX ≥ 80th pct) beat holding over 20–60 days on average | Moderate–high (t 2.7 out of sample, 66% of episodes, all groups) |
| Calm-market weakness: don't add | Moderate–low (small edge, t ≈ −2) |
| Any single call is right | Low: 40% of ADD cases were still down 20 days later; 10% fell 11%+ |
| The edge survives theta, IV and costs on 365-day calls held 60 days | Moderate (t 1.8–1.9 at 60 days; 3.2 at 20) |
| A single LEAPS add makes money | Low: 52–59% over 60 days; the edge is the big rebounds |
| Roll at ~180 days left | High (it is arithmetic: decay outruns the edge) |
| Flow / dealer reads help | Unknown (untested) |
