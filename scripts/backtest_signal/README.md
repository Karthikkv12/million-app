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
