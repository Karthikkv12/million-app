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

### R4 · 265 names, back to 1963 (2026-11-14) — time, other markets, sharper measurement

What changed in the data (`fetch.py` last three lines, `feats4.py`, `round4.py`; raw numbers in
`docs/signal-accuracy-r4.json`):
- **+65 symbols, picked to move differently from US mega caps:** 12 indexes (S&P 500 from 1927, Russell 2000, Nikkei,
  FTSE, DAX, CAC, Hang Seng, ASX, TSX, Bovespa, KOSPI, Taiwan); older stocks in materials, REITs, insurance, staples,
  transports, utilities and health care; bond, commodity and country ETFs. MMC and K no longer download.
- **Back to 1963.** 2,239,142 stock-days (R3: 1,175,374). Before 1991 there is no VIX, so the fear gauge is a modeled
  VIX built from the S&P 500's own volatility and drawdown. It was fit on 1990–2014 and checked on 2015–2026: it
  explains 87% / 72% of log-VIX moves and is on the same side of the 80th percentile 88% of days. 427,155 stock-days
  use it.
- **Foreign indexes use their own gauge** (the same model on their own index), so their crises count as their own.
- **Eras:** 1963–1994 is a new hold-out era. No rule was set on it. 1995–2014 is where the rules were chosen.
  2015–2026 is the original unseen period.

**Lever 1: more names (2015–2026 only, comparable with R2/R3)**

| Signal | Signals R3 → R4 | SE change | Effective n | Edge R4 | 95% range R4 |
|---|---|---|---|---|---|
| Swing buy | 16,312 → 20,987 | −3.2% | 732 → 702 | +0.49% | +0.06% to +0.91% |
| Strong swing buy | 2,125 → 2,335 | −1.2% | 434 → 435 | +0.96% | +0.24% to +1.68% |
| Add | 40,313 → 54,549 | **−12.9%** | 199 → 211 | +3.32% | **+0.02% to +6.62%** |
| Caution | 186,914 → 243,340 | −11.2% | 770 → 822 | −0.87% | −2.17% to +0.42% |
| Exit | 4,118 → 5,866 | −15.6% | 580 → 678 | −0.80% | −1.96% to +0.36% |

Names that move differently did more than R3's tech-heavy additions did (Add −12.9% vs −3.3%). Add's range clears zero
for the first time, barely.

Hold-out on the 65 new names (2015–2026), R3's estimate → what they did:

| Signal | R3 predicted | New names got | 95% range | Verdict |
|---|---|---|---|---|
| Swing buy | +0.56% | +0.23% | −0.18% to +0.64% | weaker (bonds, utilities, indexes rarely drop 5% for stock reasons) |
| Strong swing buy | +0.95% | +1.06% | −0.01% to +2.13% | **holds** |
| Add | +3.54% | +2.69% | +0.49% to +4.88% | **holds** |
| Caution | −1.04% | −0.33% | −1.31% to +0.65% | right sign, weak |
| Exit | −0.99% | −0.34% | −1.33% to +0.65% | right sign, weak |

**Lever 2: more time (US names, 2015–2026 → every unseen year, 1963–1994 + 2015–2026)**

| Signal | Months with signals | SE change | Effective n | 95% range, 2015–2026 | 95% range, all unseen years | Edge, all unseen |
|---|---|---|---|---|---|---|
| Swing buy | 143 → 518 | **−35%** | 721 → 1,497 | +0.08% to +0.92% | **+0.14% to +0.69%** | +0.42% |
| Strong swing buy | 140 → 419 | **−27%** | 448 → 760 | +0.27% to +1.68% | **+0.55% to +1.58%** | +1.06% |
| Add | 82 → 277 | **−38%** | 210 → 412 | +0.01% to +6.75% | **+0.28% to +4.47%** | +2.37% |
| Caution | 117 → 426 | **−33%** | 822 → 1,600 | −2.22% to +0.40% | −1.61% to +0.14% | −0.74% |
| Exit | 116 → 408 | **−30%** | 672 → 1,342 | −1.99% to +0.36% | −1.37% to +0.27% | −0.55% |

This was the big lever: 27–38% narrower ranges, against 1–16% from more names. Add is now proven at 95% on unseen
data, at a smaller and more realistic size (+2.4%, not +3.4%).

The 1963–1994 era alone, as a hold-out: Swing +0.32% (t 1.9), **Strong swing +1.20% (t 3.2)**, Add +1.16% (t 1.2),
Caution −0.53% (t −0.9), Exit −0.23% (t −0.4). Strong swing held best. Add kept its sign but was weaker; part of that
may be the modeled gauge.

**Lever 3: other markets (10 foreign indexes, each on its own fear gauge, 1963–1994 + 2015–2026)**

Add +1.35% (t 1.65; 95% range −0.26% to +2.95%): the same direction, weaker, not proven alone. Swing buys: nothing
(−0.02%). Strong swing buys: too few to read (19). The fear-dip idea travels; the swing idea is a stock-level effect.

**Lever 4: measure more cleverly**

*The fear score as a scale, not a yes/no.* 60-day return vs holding, by score band:

| Score band | 1995–2014 (rules set) | Unseen years (1963–94 + 2015–26) |
|---|---|---|
| 0 (no fear dip) | −0.51% | −0.39% |
| 0–0.10 | +0.85% | +0.39% |
| 0.10–0.20 | +1.25% | +1.08% |
| 0.20–0.283 | +1.50% | +1.51% |
| 0.283–0.45 (Buy) | +2.69% | +1.64% |
| 0.45+ (Buy) | +3.29% | +2.89% |
| **Slope, per +0.1 of score** | +0.66% (t 2.72) | **+0.51% (t 2.74)** |

The edge rises step by step in both periods. The slope uses every day, so it is estimated more tightly (t 2.74) than
the yes/no Buy on the same unseen data (t 2.22). The 0.20–0.283 band ("near a Buy") earned about as much as the
0.283–0.45 band on unseen years.

*Swing trades net of the market* (each trade minus the S&P 500 over the same days):

| All unseen years | Raw per trade | Net of the S&P 500 | Effective n raw → net |
|---|---|---|---|
| All swing buys | +0.42% (t 3.0) | **+0.08% (t 1.5)** | 1,497 → 7,151 |
| 5% drop above the 200-day | +0.63% (t 3.4) | +0.32% (t 3.8) | 1,097 → 3,905 |
| Strong swing buy | +1.06% (t 4.0) | **+0.71% (t 4.4)** | 760 → 1,575 |

Subtracting the market removes most of the shared noise, so effective n goes up 2–5×. The plain swing buy is mostly
the market's bounce. The Strong grade is a real stock-specific edge, and the sharpest swing number we have.

**What changed in the app (R4)**
- Scanner: new **60d edge** column. Each name's fear-score band and that band's unseen-years 60-day edge vs holding
  (`signal.SCORE_BANDS`, `score_band()`; scan rows `score_band`, `score_edge_60`).
- Add evidence text: +2.4% vs holding over 60 days (95% range +0.3% to +4.5%), all unseen years; was +3.6% from
  2015–2026 alone.
- Caution: −0.7% (range −1.6% to +0.1%). Exit: −0.55% (range −1.4% to +0.3%); the app now calls Exit's edge unproven.
- Swing drawer: plain swing buys made +0.08% net of the market; Strong swing buys beat it by +0.71% (`swing.STATS`
  `net_unseen`, `strong_net_unseen`).
- **Live track record** (`hedge.signal_log`, table `signal_log`, migration 0015, `GET /hedge/signal-log`, scanner
  page panel). It logs every scanner Buy / Swing buy / Strong swing buy at the close (and intraday alerts apart), and
  scores each by the backtest's own exit. It is a forward test that grows every day.
- Exit rule: R3 said "drop it if it fails two hold-outs in a row". In R4 it kept the right sign on both new hold-outs
  (the 65 names and 1963–1994), so it stays, but labeled unproven.

**Where next round's accuracy comes from**
1. The track record. In a few months it will be the only evidence no backtest choice touched.
2. Strong swing net of the market: it is precise enough (t 4.4) to grade further, e.g. by drop size, on all unseen
   years.
3. A score → expected edge model (the slope) could replace the bands. The bands are the cautious first step.
4. More countries' stocks (not just their indexes) would test the swing idea abroad.
