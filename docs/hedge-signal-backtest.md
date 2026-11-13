# Hedge signal backtest — 2026-11-13

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

## Confidence

| Claim | Confidence |
|---|---|
| The old signal was useless to harmful | High |
| Fear dips (RSI < 40, VIX ≥ 80th pct) beat holding over 20–60 days on average | Moderate–high (t 2.7 out of sample, 66% of episodes, all groups) |
| Calm-market weakness: don't add | Moderate–low (small edge, t ≈ −2) |
| Any single call is right | Low: 40% of ADD cases were still down 20 days later; 10% fell 11%+ |
| Flow / dealer reads help | Unknown (untested) |
