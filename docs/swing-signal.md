# Swing signal (1 week – 1 month) — backtest and rule

2026-11-14. Scripts: `scripts/backtest_signal/swing.py` (round 1) and `swing2.py` (round 2), on the same data as the
hedge-signal backtest (148 US stocks and ETFs, daily, 1995-01 → 2026-11-13; `fetch.py`, `feats.py`).

**Method.** The setup is read at the close; the trade is bought at the **next open** and sold by the exit rule.
Returns are absolute, per trade, after a **0.2% round-trip cost**. One trade at a time per symbol. Rules were chosen on
**1995–2014** by month-clustered t-stat and read once on **2015–2026**. (Round-1 tables showed both periods side by
side, so the 2015–2026 numbers were visible while choosing; the choice below follows the 1995–2014 ranking.)

## The rule

| | |
|---|---|
| **Buy** | a fear dip (fear score ≥ 0.283: VIX percentile × how oversold, the same as the 1–3 month Add) **or** a drop of ≥ 5% over 5 trading days with the close above the 200-day average |
| **Sell** | the first close above the 10-day average, or after 20 trading days |
| **Stop** | none: every stop tested (5%, 7%, 10%) lowered the average trade |

| Period | Trades | Avg | Median | Win | Days held | Worst 1 in 20 | t |
|---|---|---|---|---|---|---|---|
| 1995–2014 (chosen) | 13,495 | +0.84% | +1.22% | 67.0% | 5.4 | −8.2% | 9.45 |
| **2015–2026 (unseen)** | **11,923** | **+0.56%** | **+1.08%** | **65.5%** | **5.5** | **−9.1%** | **5.33** |
| Any day, held 5 days (2015–2026) | 78,004 | +0.16% | | 51.2% | 5 | | |

In 2015–2026 the 148 names gave about 14 swing buys a day on average (median 4); 82% of days had at least one.

## What else was tested (per trade after costs; 1995–2014 / 2015–2026)

| Setup | Hold 5d | Hold 10d | Hold 20d |
|---|---|---|---|
| Any day | +0.12 / +0.16 | +0.49 / +0.56 | +1.22 / +1.37 |
| Fear dip (Add) | +0.62 / +0.52 | +1.28 / +1.16 | +2.23 / +2.42 |
| 5-day drop ≥ 5%, above 200-day | +0.74 / +0.58 | +1.32 / +1.03 | +2.10 / +2.08 |
| 5-day drop ≥ 10%, above 200-day | +1.74 / +1.04 | +2.35 / +1.49 | +3.55 / +2.80 |
| RSI(2) < 10 (classic) | +0.26 / +0.24 | +0.64 / +0.62 | +1.33 / +1.35 |
| Fear dip or 5% drop (the rule) | +0.63 / +0.47 | +1.29 / +1.02 | +2.24 / +2.14 |

- **Longer exit, 2–3 weeks:** the same entry sold when the 5-day drop is recovered (close back at the close before
  it), max 20 days: +1.59% / +1.32% per trade, 67% / 65% winners, ~13 days. A bigger trade, a lower t (8.4 vs 9.45).
- **Timing vs picking:** the fear-dip trade beat the same day's average of all 148 names by only +0.1% over 10 days;
  most of it is the whole market bouncing. The 5-day drop above the 200-day beat it by +0.5% (≥ 7% drops: +0.7%,
  ≥ 10%: +1.1%), so that part is about the stock. Many swing buys on one day are mostly one bet.
- **RSI(2)** (a popular short-term rule) added little after 2014 and was dropped.
- **Bear markets** (the rule, 10-day-average exit): 2008 +0.27%, 2020 +0.02%, 2022 +0.52% per trade; single trades
  still lost 9% or more 1 time in 20.

## In the app

`optionflow/modules/hedge/swing.py` (`read()`), on every Signal-scanner row (`GET /hedge/scan`: `swing`,
`swing_reason`, `swing_buy_below`, `swing_exit_above`, `ret5`, `vs_200d`, `swing_stats`). Research → Signal scanner →
**Swing · 1–4 wk**. `tests/hedge/test_swing.py` checks the live rule against the backtest definition on random series.

## Round 3 — 200 symbols, sharper signals (2026-11-14)

52 names added (`fetch.py`, last two lines): MRVL ADI NXPI ON MCHP INTU ADSK WDAY ANET SPOT PINS COF USB PNC SPGI ICE CME
BX TMO ABT DHR ISRG VRTX REGN MDT SYK BKNG CMG LULU ROST TJX MO UNP NOC GD ETN DAL CCL EOG PSX VLO FCX NEM LIN NEE DUK AMT
XLU XBI EEM EFA GDX. Now 200 symbols, 1,175,374 symbol-days. None of the new names was used to choose a rule, so they are a
second hold-out. Scripts: `swing3.py`, `swing3b.py`.

**The rule holds on names it never saw.** The current rule (fear dip or 5% drop above the 200-day; sell above the 10-day
average or after 20 days), per trade after costs:

| | Trades | Avg | Median | Win | Worst 1 in 20 | t |
|---|---|---|---|---|---|---|
| 1995–2014 (200 names) | 19,578 | +0.81% | +1.25% | 67.1% | −8.5% | 9.89 |
| 2015–2026 (200 names) | 16,307 | +0.56% | +1.08% | 65.8% | −8.7% | 5.51 |
| 2015–2026, the 52 new names only | 4,384 | +0.56% | +1.08% | 66.4% | −7.8% | 5.09 |

**Sharper triggers did not beat it** (1995–2014 avg / t → 2015–2026 avg / t). A change had to beat the current rule on
1995–2014 on both the average and the t, by more than noise:

| Drop leg (fear-dip leg unchanged) | 1995–2014 | 2015–2026 |
|---|---|---|
| **Current: drop ≥ 5%, above 200-day** | +0.81% / 9.89 | +0.56% / 5.51 |
| Volatility-scaled drop, z ≤ −1.25 / −1.5 / −2 | +0.73–0.76% / 5.7–10.1 | +0.52–0.63% / 4.9–5.5 |
| Drop ≥ 5% and z ≤ −1.25 | +0.81% / 9.99 | +0.61% / 5.91 |
| Stock-only drop (vs SPY) ≥ 5% | +0.75% / 8.32 | +0.53% / 4.96 |
| Drop ≥ 5%, SPY above its 200-day | +0.82% / 9.91 | +0.57% / 4.10 |
| Drop ≥ 5%, ≤ 25% off the 52-week high | +0.79% / 10.38 | +0.55% / 5.39 |

Two variants edged the current rule on 1995–2014 by 0.01% and 0.1 of t. That is noise, so the trigger is unchanged.

**Strong swing buy (new).** The buys were graded instead (8 grades, chosen on 1995–2014 as the highest average with t ≥ 5):
**a 5-day drop of 7% or more with the close above the 200-day.**

| Strong buys | Trades | Avg | Median | Win | Days | Worst 1 in 20 | t |
|---|---|---|---|---|---|---|---|
| 1995–2014 | 2,414 | +1.53% | +2.55% | 69.7% | 7.0 | −10.8% | 6.70 |
| 2015–2026 | 2,125 | +0.95% | +2.35% | 66.0% | 7.5 | −13.1% | 5.36 |
| 2015–2026, 52 new names | 467 | +1.10% | +2.42% | 67.9% | 7.6 | −11.5% | 2.84 |

About twice the average trade, with a deeper worst case. The other grades: both legs at once (1995–2014 +1.64%, but
t 4.4 and 2015–2026 +0.35%); fear dip only (2015–2026 t 1.8: mostly the market bouncing); RSI(2) < 5 (no bigger trade).

**In the app.** `swing.read()` returns `strong`; the scanner rows carry `swing_strong`; the tag reads "Strong swing".

## Live scanner (2026-11-14)

`optionflow/modules/hedge/scan_live.py` re-prices the Signal scanner **every second, 09:30–16:00 ET on weekdays**. Each
tick sends one batched Public quote request for the 100 popular names, sets today's bar to the live price and reads the
rows again. The S&P 500 updates 50 names a tick (all 503 in about 10 s), and only while someone has it open, because
Public allows about 8 requests a second for the whole app. When a name turns into a Buy, Swing buy or Strong swing buy
and stays one for 3 straight seconds, it alerts once per symbol and kind per day: in the Notification Center, plus a
phone push where push is set up (Settings → Notifications → Signal scanner). The rules are read on closes, so an
intraday Buy means "if it closes here", and the backtests buy at the next open.

## Round 4 (2026-11-14): the market-adjusted view

On 265 names back to 1963 (docs/signal-accuracy.md → R4), each swing trade minus the S&P 500 over the same days, on
every year no rule was set on (1963–1994 + 2015–2026): all swing buys +0.08% (t 1.5), so they are mostly the market's
bounce; Strong swing buys +0.71% (t 4.4), a real stock-specific edge. Strong swing buys also held on 1963–1994 alone
(+1.20% a trade, t 3.2). The trigger is unchanged; the swing drawer now shows both net numbers.
