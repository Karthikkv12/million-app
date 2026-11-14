# Hedge signal — skeptical re-test (2026-11-14)

Re-test of `docs/hedge-signal-backtest.md` (2026-11-13), from a fresh download. Scripts: `scripts/backtest_signal/`
`review.py` (points 1–12), `rebuild.py` (fear score, sizing, covered calls, survivorship), `roll.py` + `holdsim_roll`
(the roll), `compare.py` (old vs new), `probs.py` (odds per case + the exit line). IS = 1995–2014, OOS = 2015–2026.
**Every threshold below was chosen on IS only.** Two exceptions are flagged where they occur.

Data: Yahoo daily, fetched 2026-11-14 01:33 UTC. 148 symbols (WBA is now delisted and missing; one other symbol
changed), 827,847 symbol-days. The 11-13 report had 827,892; every count below is from this run.

## Final rule set (any holding, or a ticker you don't hold)

| | Rule |
|---|---|
| Inputs | VIX close and its 1-year percentile (p); the stock's RSI(14) on daily closes; 50 / 200-day averages; 52-week high |
| Fear score | S = clip((p − 0.5) / 0.5, 0, 1)^1.5 × clip((50 − RSI) / 30, 0, 1) |
| **Add / Buy** | S ≥ **0.283** (IS 92.5th percentile = as often as the old rule) |
| Sizing | Thirds: one tranche per signal, ≥ 10 trading days apart, ≤ 3 open, each held ≥ 60 trading days. No pause rule |
| **Don't add / Don't buy yet** | p < 0.60 and (≥ 10% under the 52-week high, or 3–15% over the 50-day with RSI > 65). Not a sell |
| Hold / Wait | Everything else. The desk shows the close (today's VIX) and the VIX close (today's price) that would make it Add / Buy |
| Exit line (held) | Calm market (p < 0.60): a close under the 200-day. During fear: no exit on breaks |
| Upside (held) | Nearest resistance, shown. No tested sell price: strength did not predict falls |
| Long calls | Buy 365+ days, ~0.80Δ. **No roll for time decay.** Roll or close inside 30 days of expiry (mechanics) |
| Long puts | Take profit on Add days; otherwise hold |
| Covered calls | Add days: sell **0.15Δ** instead of 0.30Δ, or skip the month. Calm weakness: stay at 0.30Δ, never closer. Otherwise 0.30Δ |
| IV | Shown as context. No gate |

## Old rule vs new rule

OLD = RSI < 40 & VIX ≥ 80th pct, holder 1.5× for 60 days. NEW = fear score ≥ 0.283, thirds. Excess = vs the stock's own
average for that period. Holder columns: average across 148 symbols. Overlay = the extra exposure's P&L, equal-weight
across symbols (`compare.py`).

| | OLD IS | NEW IS | OLD OOS | NEW OOS |
|---|---|---|---|---|
| Cases | 33,094 | 32,913 | 29,568 | 29,326 |
| 20-day excess (t) | +1.37% (3.90) | +1.59% (3.92) | +1.18% (2.99) | +1.22% (3.51) |
| 60-day excess (t) | +2.69% (4.08) | +3.26% (4.44) | +3.41% (1.78) | +3.45% (2.48) |
| Up after 20 days | 62.0% | 62.4% | 60.4% | 60.8% |
| Beat holding, 60 days | 56.7% | 57.5% | 55.3% | 55.4% |
| Episodes positive (60d) | 65.6% of 157 | 63.1% of 249 | 61.6% of 86 | 62.4% of 149 |
| Worst episode (60d excess) | −30.9% | −35.1% | −35.0% | −36.1% |
| Holder return / yr (B&H 22.2 / 23.2) | 29.3% | 26.6% | 31.9% | 28.3% |
| Holder Sharpe (B&H 0.592 / 0.550) | 0.587 | 0.598 | 0.542 | 0.550 |
| Holder max drawdown (B&H −65.6 / −60.3) | −76.6% | −72.1% | −72.2% | −67.8% |
| Overlay worst 60 days | −22.6% | −16.6% | −15.2% | −10.8% |
| Overlay in 2008 / 2022 | −9.26% (2008) | −1.92% (2008) | −8.29% (2022) | −1.87% (2022) |

The worst *episode* gets no better: an episode is the stock's own outcome, and sizing only limits how much is on.

## The 12 review points

**1. Counts.** 438,980 (IS, all with an outcome) + 385,907 (OOS with a 20-day outcome) = 824,887; plus 2,960 rows in the
last 20 trading days without one (148 × 20) = 827,847. Finding 1's table counted *all* OOS rows (388,867, report:
388,912) because it used group sizes, not rows with an outcome. Both totals are right; the report mixed the two bases.

**2. Overlap.** Yes. The probability table listed TRIM (= the fear days again) and both "Add" (all fear days) and
"Add, IV-gated" / "Fear dip, IV normal" (its two halves). Exclusive buckets, rows with a 20-day outcome:

| | n IS | 20d / 60d IS | n OOS | 20d / 60d OOS | t60 OOS |
|---|---|---|---|---|---|
| Fear dip (old rule) | 33,094 | +1.37 / +2.69 | 29,597 | +1.17 / +3.41 | 1.78 |
| Oversold, not enough fear | 34,095 | +0.05 / +1.11 | 31,722 | −0.02 / −0.51 | −0.40 |
| Calm weakness / stretched | 152,886 | −0.31 / −1.36 | 140,094 | −0.42 / −1.28 | −2.72 |
| Everything else | 218,905 | 0.00 / +0.37 | 184,494 | +0.13 / +0.49 | −0.03 |
| **Sum** | **438,980** | | **385,907** | | |

**3. Sharpe.** Withdrawn: "every rule within ±0.03". Change in Sharpe vs buy-and-hold: old signal **−0.052** (IS) /
**−0.040** (OOS); old 1.5/0.5 new-signal policy −0.032 IS. Old signal max drawdown: **−68.5%** IS / **−60.1%** OOS
(B&H −65.6 / −60.3), average across symbols.

**4. LEAPS held 20 days.** Both statements were true on different cost assumptions. 365-day 0.80Δ call on fear-dip
days, OOS, n 28,761:

| | Mean | Median | 25th | 75th | Positive |
|---|---|---|---|---|---|
| Stress costs, absolute | −1.3% | −3.6% | −20.5% | +15.4% | 44.6% |
| Stress costs, vs an average day | +3.5% | +1.4% | −15.5% | +20.4% | 52.2% |
| Base costs, absolute | +6.1% | +3.5% | −15.0% | +24.5% | 54.8% |
| Stress, 60 days, absolute | +10.8% | +4.6% | −24.0% | +36.6% | 54.0% |

A 20-day hold loses money in absolute terms under stress costs (+5 vol points, 2% each way). It beats buying the same
call on an average day by 3.5%.

**5. Finding 1, restated.** Old signal, holder return: IS 22.4% vs 22.2% buy-and-hold (+0.2), OOS 22.5% vs 23.2%
(−0.7). Sharpe lower in both (−0.05 / −0.04). By verdict, 20-day excess: TRIM +0.25% IS / +0.66% OOS, ADD −0.16% /
−0.25%. **Restated:** the old signal's ADD and TRIM were backwards in both periods; as a policy it cost Sharpe in both and
return only out of sample.

**6. Holdings, live** (Yahoo, fetched 2026-11-14 01:38 UTC; last bar 11-12 for BABA, NBIS, NOW, GOOG, 11-13 for NVDA
and VIX). Not committed (public repo); the desk now reads them from your synced positions. VIX 19.30, **75.4th
percentile** (the 80th is 19.87). RSI 42 for BABA and NBIS is **not** oversold under the rule (< 40). Calling them
oversold was wrong. NOW (RSI 11) and NVDA (RSI 19) are deep oversold; under the new score both are Add (score 0.36).

**7. IV gate on IS only.** Grid 0.8–1.5× of 365-day call 60-day excess on fear days. Rule fixed before looking: the
highest IS t, keeping ≥ 40% of fear days. It picks **0.8× (= almost no gate)**: IS t falls as the gate rises (none 4.31,
1.2× 3.24, 1.5× 2.95). OOS: no gate +7.49% (t 1.88, n 28,732); 0.8× +7.91% (t 1.93). The 1.2× gate's OOS +13.7% was
chosen after seeing OOS. **Dropped.**

**8. Multiple testing.** 28 option configs on OOS fear days, month-clustered t. Bonferroni (two-sided, 28 tests)
needs t ≥ 3.12; a max-t bootstrap (5,000 draws, keeps the configs' correlation) needs **2.35**. **All 16 configs held
20 days survive max-t** (t 2.99–3.29, adjusted p ≤ 0.013); 8 also survive Bonferroni. **None of the 12 held 60 days
survives** (best t 1.94, max-t p 0.12). The stock-level fear dip survives at 20 days (t 2.99–3.51) and the new score at 60
(t 2.48, ×2 for the two score variants read on OOS: p ≈ 0.026). Covered calls: 0.15Δ vs 0.30Δ t 3.86 passes Bonferroni
over 9 tests (2.77).

**9. The 3.5% and the roll.** 3.5% is the 20-day *option* excess on fear days (365-day 0.80Δ, stress), not the stock
edge (1.2%) and not the IV-gated 5.5%. A 0.80Δ call at 35% IV loses 3.5% per 20 trading days at **200 days left**
(3.37% at 210, 3.02% at 240; 213 by linear interpolation of 240/180 is close). **But the comparison was wrong in kind:**
it compared % decay of an option to an edge that only exists on ~7% of days. Tested directly (`roll.py`, 433,660
position-checks): a delta-matched roll into a fresh 365-day call vs holding, next 60 days, in % of the position:

| Days left | 0–90 | 90–120 | 120–150 | 150–180 | 180–210 | 210–240 | 240–270 | 270–300 | 300+ |
|---|---|---|---|---|---|---|---|---|---|
| Roll − hold, 2% costs, OOS | −6.6 | −4.4 | −4.4 | −4.2 | −4.2 | −4.3 | −4.1 | −3.9 | −3.9 |
| Roll better, % of cases | 23% | 28% | 29% | 27% | 24% | 20% | 18% | 15% | 9% |

Before costs it is ≈ 0 (+0.2 to +0.6) from 90 to 365 days: the fresh call decays less per dollar, but delta-matching
buys more dollars of it. **The 180-day ROLL is withdrawn.** Roll is now only "inside 30 days of expiry".

**10. Survivorship.** Not fixable here: Yahoo serves nothing for delisted tickers (WBA vanished between runs), and I
have no point-in-time constituent list. Estimate: OOS 60-day edge +3.41%; the bottom tenth of symbols averaged −3.37%.
If 5 / 10 / 20% of a point-in-time universe had behaved like that tenth: **+3.07 / +2.74 / +2.06%**. Names that crashed
≥ 70% at some point (72) still showed +3.83% vs +3.03% for the rest. Buy-and-hold's 22–23%/yr is inflated; the
*relative* edge is less so, but treat it as 2–3%, not 3.4%.

**11. Long puts.** Now simulated (`review.py`, 25% sample, −0.5Δ, stress costs). On fear days vs an average day, 60
days: 365-day **−7.9%** OOS (−3.3% IS), 180-day **−11.1%** (−5.1%); t −1.4 to −2.0. 20 days ≈ 0. Supports "take profit on
puts" at 60 days, with low confidence.

**12. Regimes and streaks** (stock, old fear-dip rule):

| | n | 20d | 60d | t60 |
|---|---|---|---|---|
| IS, SPY > 200-day | 14,450 | +0.36 | +1.70 | 2.89 |
| IS, SPY < 200-day | 18,644 | +2.14 | +3.45 | 3.19 |
| OOS, SPY > 200-day | 13,279 | +0.46 | −0.08 | −0.61 |
| OOS, SPY < 200-day | 16,318 | +1.75 | +6.25 | 2.02 |

241 fear episodes since 1995: 159 positive at 20 days, 156 at 60. **Longest run of losing episodes (60d): 10.** Worst:
1996-05-23 −30.9%, 2020-01-27 −25.3%, 2007-10-15 −22.2%. The edge is larger below the 200-day, not smaller: the bear
problem is a few deep episodes, which sizing handles better than filters.

## Suggestions tested (from the outside review)

| Suggestion | Result | Kept? |
|---|---|---|
| Drop or re-choose the IV gate on IS | IS picks no gate | **Dropped** |
| Continuous fear score, cutoffs on IS | Cutoffs by an IS t-rule: fired 2.6× as often, OOS 60d +2.03% (t 1.66): **worse**. Same score at the old rule's frequency: OOS +3.45% (t 2.48) vs +3.41% (t 1.78) | **Kept, frequency-matched** (flag: two score variants were read on OOS) |
| Map score to 0 / half / full size | The "half" band was tiny (2,002 OOS cases, −0.19% at 60d) | Not kept; thirds instead |
| ≤ 3 tranches ≥ 10 days apart | 2008 −9.26 → −3.05; 2022 −8.29 → −1.88; OOS max DD −72.2 → −67.8; return 31.9 → 28.3 | **Kept** |
| + pause after 2 losing tranches | 2008 −6.55 (worse than without), 2022 −3.24 | Not kept |
| Roll at the decay crossover (~200–213 days) | Rolling loses ~4% at every days-left | **Withdrawn entirely** |
| Covered calls on fear dips: 0.15Δ / skip vs 0.30Δ | +0.33% / +0.23% of the stock per month (t 3.86 / 2.84 OOS, 4.71 / 3.58 IS); 0.50Δ −0.85% | **Kept: 0.15Δ** |
| Calm weakness: sell closer to the money | 0.50Δ vs 0.30Δ: −0.24% (t −1.8) OOS, −0.34% IS | **No** |

Covered-call caveat: premiums come from the IV model (no skew, no earnings premium), sold 3% under model mid; the 60-day
figures repeat the first month's difference by construction.

## Exit line (held)

First calm-market close under the 200-day: 60-day excess −1.58% IS (t 0.74, the wrong sign once month-clustered) /
**−1.65% OOS (t −2.75)**. During fear the same break came before +1.15% / +3.6%. A weak, one-period edge: a reason to
cut, not a crash call.

## Revised confidence

| Claim | Before | Now |
|---|---|---|
| The old signal was useless to harmful | High | High (ADD/TRIM backwards in both periods) |
| Fear dips beat holding over 20 days (stock) | Moderate–high | Moderate–high (OOS t 3.0–3.5, survives correction) |
| … over 60 days (stock) | Moderate–high | Moderate (score t 2.48; old rule t 1.78) |
| The edge survives theta / IV / costs on 365-day calls, 20 days, vs an average day | Moderate | Moderate (survives max-t) |
| … 60 days | Moderate | **Low** (fails the correction) |
| IV-gated adds do better | (implicit) | **Withdrawn** (hindsight) |
| Roll at ~180 days | High | **Withdrawn** (rolling loses ~4% everywhere) |
| Adding in thirds limits bear-market damage | — | Moderate (2008 / 2022 cut by ~2/3; one test) |
| Calm weakness: don't add | Moderate–low | Moderate (OOS t −2.7; IS t −1.6) |
| Exit line (calm, under 200-day) | — | Low–moderate (OOS only) |
| Covered calls: 0.15Δ on fear dips | — | Moderate (both periods; model premiums) |
| Long puts: take profit on fear dips | — (assumed) | Low (−8 to −11% over 60d, t ≈ −1.4 OOS) |
| Any single call is right | Low | Low (up ~6 in 10) |
| Survivorship-free edge | — | Estimate 2–3% at 60 days, not 3.4% |

## Claims changed or withdrawn

1. 827,892 / 438,980 / 385,952 → 827,847 / 438,980 / 385,907 (this download); Finding 1's 388,912 was all OOS rows.
2. Finding 2 and the probability table overlapped; now exclusive (sums tie out).
3. "Sharpe within ±0.03 of buy-and-hold" → old signal −0.052 / −0.040. Old max DD filled in (−68.5 / −60.1).
4. "Lowered return" → only out of sample (IS +0.2 pts, OOS −0.7).
5. "A 20-day LEAPS hold loses after costs" → true in absolute terms with stress costs only (−1.3% mean, 44.6% positive);
   +3.5% vs an average day.
6. BABA / NBIS "oversold" → not oversold (RSI 42 ≥ 40).
7. 1.2× IV gate → dropped (IS picks none).
8. "t 1.8–1.9 at 60 days" → does not survive a 28-test correction; the 20-day results do.
9. "Edge 3.5% clears decay only above ~240 days" → crossover ≈ 200 days, and the premise was wrong: **ROLL withdrawn**.
10. "Not just survivorship" → edge likely 2–3%, not 3.4%.
11. "Covers long puts" → now tested; supports take-profit with low confidence.
12. "Fails in long bear markets, add in pieces" → quantified: thirds cut the 2008 / 2022 hit by about two thirds.
13. ADD rule → fear score ≥ 0.283 (frequency-matched, IS-chosen).
14. The committed holdings snapshot (`holdings_data.py`, `data/holdings.json`, the report's holdings tables) is removed.

Not financial advice. Averages for setups, not forecasts for one stock.

## Round 3 — re-read on 200 symbols (2026-11-14)

`scripts/backtest_signal/signal3.py`: 52 names added (see docs/swing-signal.md), 1,175,374 symbol-days. Excess = vs
holding the same stock; t clustered by month.

| Rule | 1995–2014, 60d | 2015–2026, 20d | 2015–2026, 60d | 52 new names, 2015–2026, 60d |
|---|---|---|---|---|
| ADD (fear score ≥ 0.283) | +3.22% (t 4.55) | +1.31% (t 3.17) | +3.55% (t 2.46) | +3.82% (t 1.98) |
| CAUTION | −1.08% (t −1.52) | −0.37% (t −2.46) | −1.04% (t −2.63) | −0.40% (t −1.94) |
| EXIT (calm, fresh close under the 200-day) | −1.45% (t 0.12) | −0.40% (t −1.78) | −0.99% (t −2.53) | +0.75% (t −0.87) |

- **ADD holds**, including on the names it never saw. No filter beat it on 1995–2014: score ≥ 0.25 / 0.35, 60-day
  return vs SPY ≥ −10% / −20%, within 20% of the 200-day, ≤ 30% off the 52-week high. The relative-strength filter
  raised the t (4.92) but cut the average from +3.2% to +2.1%, so it was not taken.
- **CAUTION holds.**
- **EXIT is the weakest rule.** It shows no edge on 1995–2014 (t 0.1), is −1.0% (not −1.65%) on 200 names in
  2015–2026, and is positive on the new names. It stays a "reason to cut, not a crash call", and the app's numbers
  now say −1.0%. If next week's names also fail it, drop it.
