# Hedge signal backtest (2026-11-13)

Reproduces docs/hedge-signal-backtest.md. Run in an empty working folder (the data is not committed):

    python fetch.py      # ~150 symbols + ^VIX, full daily history from Yahoo → prices.pkl, vix.pkl
    python feats.py      # point-in-time features + forward returns → F.pkl
    python evalA.py      # the old (pre-backtest) signal
    python evalB.py      # timing IC of 33 features, 1995–2014 vs 2015–2026
    python evalC.py; python evalD.py; python grid.py; python rebound.py; python stops.py
    python overlay.py; python overlay2.py; python voltgt.py; python bearfix.py; python final.py
    PYTHONPATH=<repo> python parity.py   # the live signal.evaluate() vs the backtest rules on 3,000 random days

Options (theta, IV, time left), 2026-11-13 second pass:

    # also fetch the IV indexes: ^VIX ^VXN ^VXD ^GVZ ^OVX ^VIX3M ^IRX and USO → ividx.pkl (see ivmodel.py)
    python ivmodel.py    # 30-day IV model, leave-one-underlying-out; term-structure speed from VIX vs VIX3M
    python optsim.py     # Black-Scholes P&L of long calls on every symbol-day (4 DTEs × 2 deltas × 2 cost cases × 20/60 days)
    python opteval.py; python optgate.py; python optfinal.py
    PYTHONPATH=<repo> python parity_iv.py   # live signal.iv_model() vs the backtest's IV ratio on 1,000 random days

Needs pandas, numpy, yfinance.

Re-test, 2026-11-14 (docs/hedge-signal-review.md):

    python review.py      # the 12 review points: counts, exclusive buckets, Sharpe/DD, LEAPS distribution, IS-only IV gate,
                          # multiple testing (Bonferroni + max-t bootstrap), decay curve, long puts, regimes, streaks
    python holdsim_roll.py && python roll.py   # the roll, tested directly by days left
    python rebuild.py     # fear score (IS-chosen), tranche sizing, covered calls, survivorship estimate
    python compare.py     # old rule vs new rule, both periods
    python probs.py       # odds per desk case + the exit line

Round 3, 2026-11-14 (200 symbols: fetch.py now lists 52 more; docs/swing-signal.md, docs/hedge-signal-review.md):

    python fetch.py && python feats.py   # 200 symbols, 1,175,374 symbol-days
    python swing3.py      # can the swing drop leg be sharper? (vol-scaled, stock-only, trend filters) + new-52 hold-out
    python swing3b.py     # grade the swing buys: the STRONG tier (5-day drop ≥ 7%, above the 200-day)
    python signal3.py     # ADD / CAUTION / EXIT re-read on 200 names, and ADD filters
    python accuracy.py    # the accuracy tracker: per round, each signal's edge, SE, 95% range, effective n, hold-out
                          # → accuracy.json; append the round to docs/signal-accuracy.md (+ docs/signal-accuracy.json)

Weekly: add names to fetch.py, re-run the four lines above, compare with the tables in the docs. A rule changes only
when a candidate beats it on 1995–2014 (both the average and the t); the new names are a hold-out.
