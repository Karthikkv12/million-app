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
