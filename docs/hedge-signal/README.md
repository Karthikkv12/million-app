# Hedge signal — results and files (2026-11-13)

| File | What it is |
|---|---|
| `../hedge-signal-backtest.md` | The full written report: data, findings, options pass, odds per signal, confidence |
| `report.html` | The visual report (open in a browser) |
| `data-summary-page.html` | Source of the data-summary dashboard page (needs the dashboard runtime to draw) |
| `data/*.json` | Every table behind the dashboard, `{rows, meta}`; `meta` holds the script that made it |
| `data/probs-raw.json` | Odds per signal before the conservative Add adjustment |
| `screenshots/stock-page-signal.png` | The stock page with the signal and its hover window (local test run) |

Code: `optionflow/modules/hedge/signal.py` (the signal), `service.py` (`/hedge/signal/{symbol}`),
`web/components/signal/` (badge + hover window). Backtest scripts: `scripts/backtest_signal/` (see its README).
The raw backtest data (~750 MB: prices, features, simulated options) is not committed; the scripts rebuild it.
