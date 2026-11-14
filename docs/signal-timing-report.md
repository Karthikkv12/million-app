# Add / Hold / Trim as a timing signal — frozen-rule evaluation (2026-11-14)

The owner's request, following Grok's five-point plan: evaluate the signal as an entry / exit timing signal on the
expanded data, rules frozen. Script: `scripts/backtest_signal/timing.py`. Raw numbers: `docs/signal-timing.json`.

**Rules (frozen, the live `hedge.signal.evaluate()` for a long holder):** ADD = fear score ≥ 0.283. CAUTION (don't add)
= calm market (VIX below its 60th percentile) and either ≥ 10% under the 52-week high, or 3–15% over the 50-day with
RSI > 65. EXIT = calm market and the close under the 200-day, no Add. HOLD = otherwise. The app's TRIM is the
take-profit on puts / short calls on fear-dip days. For a long holder the sell side is EXIT and CAUTION, so "Trim" is
measured as those here.

**Data:** 265 symbols, 1963–2026, 2,239,142 stock-days; modeled VIX before 1991. **Out of sample (OOS)** = everything
except the 148 original names in 1995–2014: 1963–1994, 2015–2026, and the 117 added names in every year. The
returns are close to close, with no costs. "Excess" = minus a random day in the same stock and era. t-stats are
clustered by month.

## 1. Forward returns (out of sample)

| Signal | Share of days | 5d excess | 20d | 60d | 120d | 60d median excess | 60d up |
|---|---|---|---|---|---|---|---|
| **Add** | 7.6% | +0.40% (t 2.3) | +0.94% (t 2.3) | **+2.45% (t 3.0)** | **+3.36% (t 2.8)** | +1.75% | 65.8% |
| Hold | 56.7% | −0.05% | −0.06% | +0.02% | +0.02% | −0.16% | 62.1% |
| Caution | 34.4% | 0.00% | −0.11% | −0.58% (t −1.5) | −0.77% (t −1.4) | −0.66% | 59.5% |
| Exit, first day | 2.1% | +0.11% | +0.17% | −0.28% (t −0.5) | −0.50% (t −0.6) | −0.45% | 58.6% |
| Random day | | +0.34% raw | +1.34% | +4.05% | +8.28% | (median +3.36%) | 61.5% |

Add raw: +6.38% over 60 days (median +5.14%) vs +3.93% (+3.36%) for a random day in the same stocks; +11.4% over 120
days vs +8.1%. The edge grows to 120 days. Hold is exactly average, as it should be. Caution is mildly negative. Exit
has **no edge out of sample** (in sample it was −1.9% for every Exit day).

## 2. Path: how far Adds go against you, and what Exit saved

**Max adverse excursion after Add** (lowest intraday low vs the signal close, OOS):

| Within | 10th pct | 25th | Median | 75th | 90th |
|---|---|---|---|---|---|
| 20 days | −17.4% | −9.9% | −4.8% | −1.9% | −0.4% |
| 60 days | −24.8% | −14.8% | −7.4% | −2.9% | −0.8% |
| 120 days | −30.3% | −18.8% | −9.7% | −3.9% | −1.2% |

Even Adds that were **up after 60 days** dipped first: median −4.4%. 46% of them went −5% or worse, 21% went −10%,
10% went −15%, 5% went −20% and 1.5% went −30%.

**Stops** (each Add held 60 days or stopped at entry × (1 − k); in sample chosen, out of sample read):

| Stop | In sample mean / win | OOS mean | OOS median | OOS win | OOS worst 1 in 20 | OOS stopped out |
|---|---|---|---|---|---|---|
| **None** | **+7.6% / 68%** | **+6.4%** | **+5.1%** | **65.8%** | −20.0% | 0% |
| 10% | +4.0% / 51% | +3.7% | +1.1% | 52.1% | −10% | 39% |
| 15% | +5.0% / 59% | +4.4% | +3.5% | 59.2% | −15% | 25% |
| 20% | +5.8% / 63% | +5.0% | +4.3% | 62.4% | −20% | 15% |
| 25% | +6.3% / 66% | +5.4% | +4.7% | 64.0% | −25% | 10% |
| 30% | +6.7% / 67% | +5.7% | +4.9% | 64.9% | −30% | 7% |

Every stop lowered the average in both periods; a tighter stop lowered it more. The stop fill assumes no gap through
it, so real stops would do slightly worse.

**Did Exit (Trim) save drawdown?** After a fresh Exit, the worst close in the next 120 days averaged −12.7% (median −8.6%)
vs −11.0% (−7.5%) after a random day. **As a switch** (step out while Exit is on, back in when it clears, 0.1% a
switch), median per stock vs holding:

| Era | Exit switch: annual / max drawdown | Holding | Time out | Switches a year |
|---|---|---|---|---|
| 1963–1979 | +2.8% / −54% | +6.8% / −52% | 17% | 10 |
| 1980–1994 | +10.2% / −53% | +15.5% / −50% | 17% | 10 |
| 1995–2002 | +9.6% / −53% | +12.3% / −57% | 16% | 12 |
| 2003–2014 | +7.9% / −60% | +12.4% / −60% | 14% | 10 |
| 2015–2026 | +7.3% / −55% | +11.0% / −53% | 17% | 12 |

A 3% or 5% buffer under the 200-day cut the switching but still lost 1.4–4 points a year. Exit cost 3–5 points a
year in every era and **did not reduce the max drawdown**. It is calm-market-only by design, and the big drawdowns
happen in fear, when Exit is off. It whipsaws about 10 times a year.

**Suggested levels (informational; the rules stay frozen):**
- **Add entry:** stage it, as the app already says (thirds, ≥ 10 trading days apart). The median Add goes −7% before it
  works, so a staged entry buys part of that dip instead of being stopped by it.
- **Add stop:** no hard stop at −10% to −20%. Those stopped out 15–40% of trades and cut the average by a quarter to
  a half. If you need a catastrophe stop, **−25% to −30%** costs about 1 point of the 60-day average, touches 7–10% of
  trades, and caps the tail.
- **Add exit:** hold at least 60 days; the edge keeps growing to 120 days (+3.4%).
- **Trim / Exit:** **don't use Exit as a sell rule**. It cost 3–5 points a year with no drawdown saved. It did work in a
  very calm market: in VIX < 15 a fresh Exit was −1.96% vs holding over 60 days (t −3.3). That is a candidate for the
  next round, tested properly, not a change now.

## 3. By market backdrop (OOS, excess vs a random day)

| Backdrop | Add 60d | Caution 60d | Exit 60d | Hold 60d |
|---|---|---|---|---|
| S&P above its 200-day | +0.38% (t 0.7) | −0.41% | −0.56% | −0.36% |
| **S&P below its 200-day** | **+3.91% (t 3.0)** | −1.39% | +0.37% | +1.19% |
| VIX < 15 | +0.53% | **−1.35% (t −3.0)** | **−1.96% (t −3.3)** | −0.90% |
| VIX 15–20 | −0.02% | −1.26% (t −2.3) | −0.68% | −0.69% |
| VIX 20–30 | +1.26% (t 1.6) | +1.30% | +0.55% | +0.90% |
| **VIX ≥ 30** | **+6.84% (t 3.2)** | +11.60% | +17.32% | +4.78% |
| 10-yr yield rising (6 months) | +0.61% | −1.60% (t −3.0) | −1.73% (t −2.0) | −1.35% |
| **10-yr yield falling** | **+4.63% (t 3.6)** | +0.45% | +1.31% | +1.26% |
| Recession (NBER) | +4.05% (t 1.2) | −1.64% | −1.35% | +0.72% |
| No recession | +2.08% (t 3.2) | −0.49% | −0.15% | −0.04% |

- **Add's edge lives in stress:** when the S&P is under its 200-day, when the VIX is at 30 or more, and when yields
  are falling. In an uptrend or with the VIX at 15–20, an Add is a coin flip.
- **The sell-side signals only work in calm markets with rising rates.** With the VIX at 30 or more, anything that
  looks weak rebounds hard.

## 4. By sector and era (60-day excess)

**Add was positive in all 13 sectors.** Strongest (t ≥ 3): materials +3.3%, utilities & REITs +2.9%, industrials
+2.3%, consumer staples +2.1%; health care +2.2% (t 2.7). Weakest: world indexes +1.2% (t 1.8) and bonds / commodities /
countries +1.2% (t 1.2). **Caution** worked best in tech (−1.6%, t −1.9) and consumer discretionary (−1.4%, t −2.1).
**Exit** worked only in consumer discretionary (−2.2%), world indexes (−1.5%) and bonds / commodities (−1.5%); it was
positive in staples, health care, industrials and utilities.

| Era | Add: original 148 | Add: added names | Caution: original / added | Exit: original / added |
|---|---|---|---|---|
| 1963–1979 (OOS) | +0.90% | **+2.96% (t 2.4)** | −0.24% / −0.52% | −0.71% / −0.21% |
| 1980–1994 (OOS) | +0.62% | +1.31% | −0.76% / −0.27% | +0.80% / +0.64% |
| **1995–2002** (IS for the original names) | **+6.69% (t 3.2)** | **+5.26% (t 3.4)** | −4.19% / −1.90% | −2.73% / −0.42% |
| 2003–2014 (IS for the original names) | +0.86% | +0.75% | +0.04% / +0.53% | +0.88% / +1.74% |
| 2015–2026 (OOS) | +3.44% (t 1.7) | +3.18% (t 2.3) | −1.28% / −0.36% | −2.36% / −0.49% |

- **1995–2002** was the signal's best era. It held for the names it was never fit on (+5.3%), so that era's strength is
  not overfitting.
- **2003–2014** was flat even in sample, because 2008 was a long fear period in which early Adds kept falling.
- The edge is **episodic**: it pays in 1995–2002 and 2015–2026, and is small in 1963–1994 and 2003–2014.

## 5. Decay: has the edge shrunk?

**No.** Add's 60-day excess has no trend: +0.03 points per decade ± 0.24 (532 months with an Add). Rolling 5-year
windows swing between −2.8% (2004–08) and +7.3% (1998–2002). The recent windows are 2016–20 +6.6%, 2018–22 +2.2%,
2020–24 +2.5% and 2022–26 +1.7%. By year since 2015: +0.2, +9.1, +3.6, +1.5, +6.6, +13.7, −3.2, −3.3, +11.8, +3.2,
+7.5, +5.4%. Two losing years (2021, 2022) followed the 2020 boom; 2023–26 is back to normal. Caution and Exit show
no trend either (−0.01 and −0.06 per decade).

## What it means

1. **Add is a real, durable entry-timing signal** (+2.5% vs a random day over 60 days, +3.4% over 120, OOS), with no
   decay. It works in every sector and best when the market is genuinely stressed.
2. **Expect heat:** a median −7% move against you before it works. A staged entry and no tight stop are what the
   evidence supports.
3. **Hold** is neutral, as designed.
4. **Caution** is a mild don't-add (−0.6%), useful in calm markets and in tech / consumer names.
5. **Exit is not a useful sell rule** as it stands: no OOS edge, no drawdown saved, 3–5 points a year lost as a switch.
   The one place it worked (very calm markets, VIX < 15) is a candidate to test next round, chosen on 1995–2014 and
   read on the rest.

No rule was changed by this evaluation.
