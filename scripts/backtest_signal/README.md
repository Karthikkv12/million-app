# Hedge signal backtest (2026-11-13)

Reproduces docs/hedge-signal-backtest.md. Run in an empty working folder (the data is not committed):

    python fetch.py      # ~150 symbols + ^VIX, full daily history from Yahoo → prices.pkl, vix.pkl
    python feats.py      # point-in-time features + forward returns → F.pkl
    python evalA.py      # the old (pre-backtest) signal
    python evalB.py      # timing IC of 33 features, 1995–2014 vs 2015–2026
    python evalC.py; python evalD.py; python grid.py; python rebound.py; python stops.py
    python overlay.py; python overlay2.py; python voltgt.py; python bearfix.py; python final.py
    PYTHONPATH=<repo> python parity.py   # the live signal.evaluate() vs the backtest rules on 3,000 random days

Needs pandas, numpy, yfinance.
