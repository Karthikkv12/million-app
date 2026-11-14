# Signal accuracy tracker: what each round of added stocks bought us

One row per round of universe growth, measured the same way every time (`scripts/backtest_signal/accuracy.py`; raw
numbers in `docs/signal-accuracy.json`). All figures are 2015–2026, the years the rules never saw when they were set.
Weekly: add names to `fetch.py`, re-run `fetch.py` + `feats.py`, add the round to `ADDED` in `accuracy.py`, run it, and
append a round below.

## What "accuracy" means here

Adding stocks does not change what a rule does. It changes **how precisely we know the rule's edge**, and it lets us
**test the rule on stocks it never saw**. So each round tracks two things.

**1. Precision: the 95% range of the edge.**

- edge = x̄ = the average result per signal (a swing trade's return; for Add / Caution / Exit, the 60-day return minus
  holding the same stock).
- SE (standard error) = how far x̄ could be off by chance. 95% range = x̄ ± 1.96 · SE. Narrower = sharper.
- If every signal were independent: SE = σ / √n. Then 37% more signals would shrink SE by 1 − √(1/1.37) = **14%**.
- They are not independent. Stocks fire on the same days (a market selloff makes 80 names oversold at once), so the
  trades are clustered by month: SE = √(Σ_months (Σ_{i in month} (x_i − x̄))²) / n.
- Effective n = (σ / SE)² is how many truly independent signals the data is worth.

**2. Hold-out: do the new names behave as predicted?** The previous round's edge is the prediction; the names a round
adds were never used to set any rule, so their result is a fresh out-of-sample test.

Two t-stats are reported. *t (pooled)* = x̄ / SE above: it weights every trade equally, so busy crash months dominate.
*t (per month)* averages each month first, so every month counts the same. Rules were chosen with the per-month t, and
the earlier docs quote it. The pooled t is the stricter one for "the average trade".

## Round log

### R2 · 148 names (2026-11-14) — the baseline

| Signal (2015–2026) | Signals | Effective n | Edge | SE | 95% range | t pooled | t per month | Win |
|---|---|---|---|---|---|---|---|---|
| Swing buy (per trade) | 11,923 | 787 | +0.56% | 0.22% | +0.12% to +0.99% | 2.52 | 5.33 | 65.5% |
| Strong swing buy | 1,658 | 427 | +0.90% | 0.39% | +0.14% to +1.67% | 2.32 | 5.11 | 65.5% |
| Add (60d vs holding) | 29,326 | 222 | +3.45% | 2.00% | −0.47% to +7.36% | 1.73 | 2.48 | 55.4% |
| Caution (60d vs holding) | 136,245 | 768 | −1.28% | 0.81% | −2.86% to +0.30% | −1.59 | −2.75 | 45.8% |
| Exit (60d vs holding) | 2,922 | 518 | −1.71% | 0.78% | −3.23% to −0.18% | −2.19 | −2.81 | 45.0% |

### R3 · 200 names (2026-11-14) — +52 names

| Signal (2015–2026) | Signals | Effective n | Edge | SE | 95% range | t pooled | t per month | Win |
|---|---|---|---|---|---|---|---|---|
| Swing buy (per trade) | 16,307 | 731 | +0.56% | 0.22% | +0.12% to +1.00% | 2.50 | 5.51 | 65.8% |
| Strong swing buy | 2,125 | 434 | +0.95% | 0.37% | +0.22% to +1.67% | 2.55 | 5.36 | 66.0% |
| Add (60d vs holding) | 40,304 | 199 | +3.55% | 1.93% | −0.24% to +7.34% | 1.84 | 2.46 | 55.8% |
| Caution (60d vs holding) | 186,937 | 771 | −1.04% | 0.74% | −2.50% to +0.42% | −1.40 | −2.63 | 46.6% |
| Exit (60d vs holding) | 4,118 | 580 | −0.99% | 0.70% | −2.36% to +0.38% | −1.42 | −2.53 | 47.3% |

**What R3 bought: precision (R2 → R3)**

| Signal | Signals | SE if independent | SE actual | 95% range width |
|---|---|---|---|---|
| Swing buy | +37% | −14% | **+0.7%** (no change) | 0.87 → 0.87 pts |
| Strong swing buy | +28% | −12% | **−4.8%** | 1.53 → 1.45 pts |
| Add | +37% | −14% | **−3.3%** | 7.83 → 7.57 pts |
| Caution | +37% | −14% | **−7.8%** | 3.16 → 2.92 pts |
| Exit | +41% | −16% | **−10.1%** | 3.05 → 2.74 pts |

**What R3 bought: hold-out (the 52 new names only)**

| Signal | R2 predicted | New names got | New names' 95% range | Verdict |
|---|---|---|---|---|
| Swing buy | +0.56% | +0.56% | +0.08% to +1.03% | **holds**, exactly |
| Strong swing buy | +0.90% | +1.10% | +0.32% to +1.87% | **holds** |
| Add | +3.45% | +3.82% | +0.20% to +7.45% | **holds** |
| Caution | −1.28% | −0.40% | −1.63% to +0.83% | weaker, same sign |
| Exit | −1.71% | **+0.75%** | −0.72% to +2.22% | **fails**: wrong sign |

**Reading R3.**
- The 52 names added 37% more signals but only 0–10% more precision. Swing and Add stayed as uncertain as before,
  because the new names fire in the **same months** as the old ones (still 143 swing months, 82 Add months). A fear
  selloff makes them all oversold together, so it counts as one event, not 52.
- Add's whole 2015–2026 edge rests on about 200 independent observations from 82 fear months. On the strict pooled t
  its 95% range (−0.2% to +7.3%) still includes zero. Adding more US large caps will barely move that.
- The real gain was the hold-out test. Swing, Strong swing and Add held on names they never saw. Exit did not, and its
  edge shrank from −1.71% to −0.99%. Strong swing's precision also improved most among the buy signals.

## How to make the next rounds count

Precision grows with **independent** observations, not with more stocks that move together:
- **More time.** Each pre-1995 year adds new fear months (1987, 1990). Yahoo has history back to the 1960s–80s for many
  of these names. This is the biggest lever for Add.
- **Names that move differently.** Small caps, international, commodities, bonds, utilities and REITs fire on
  different days than US mega caps. Another 50 tech names adds count, not information.
- **Track the effective n**, not the symbol count. A round is worth keeping when it narrows the 95% range or passes
  the hold-out. A rule that fails two hold-outs in a row (Exit is at one) gets dropped.
