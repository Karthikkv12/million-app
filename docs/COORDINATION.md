# Who is working on what

Two Claude sessions work on this repo at the same time:
- **Cloud session**, branch `feat/settings-redesign`.
- **Terminal session** on the MacBook, running `docs/ARCHITECTURE_PLAN.md` steps 1–8.

Read this before starting a step, and keep to your own lane.

## Terminal session: backend restructure (plan steps 1–8)
- **Owns:** `backend_api/`, `logic/`, `database/`, `alembic/`, `tests/`,
  `requirements*.txt`, `Dockerfile`, CI.
- **Step 1:** merge `origin/feat/settings-redesign`. Pull it again before each later
  step, because the cloud session keeps pushing UI work there.

## Cloud session: UI and new features
- **Owns:**
  - `logic/unusual.py`, `backend_api/routers/unusual.py`, `tests/test_unusual.py` (done).
  - `web/app/**`, `web/components/**`, `web/lib/theme.tsx`, `web/app/globals.css`,
    `web/tailwind.config.ts`.
  - New feature files: `logic/catalyst.py`, `backend_api/routers/catalyst.py`,
    `tests/test_catalyst.py`.
- **Doesn't touch** the terminal session's files beyond adding those new feature files.

### Hand-offs into the restructure
| File (cloud) | Where it goes in the new layout | Keep |
|---|---|---|
| `logic/catalyst.py` | `modules/market/catalyst_service.py`, or a `modules/catalyst/` module | Same function names, same 10-minute cache |
| `backend_api/routers/catalyst.py` | Router of that module | URL `GET /catalyst/{symbol}`, also under `/api/v1` |
| `tests/test_catalyst.py` | `tests/catalyst/` | All 5 tests |
| `logic/unusual.py` | `modules/flow/unusual_service.py`, or a `modules/unusual/` module; Yahoo calls through the market-data provider | Same thresholds, 5-minute cache, `scan()` signature |
| `backend_api/routers/unusual.py` | Router of that module | `GET /unusual?symbols=&min_premium=&type=`, also under `/api/v1` |
| `tests/test_unusual.py` | `tests/unusual/` | All 3 tests |
| `logic/gex_history.py` | `modules/flow/` (replay repo + service); table `gex_snapshots` into the one-database schema in step 5 | 5-minute throttle, `record()` never raises |
| `backend_api/routers/gex_history.py` | Router of the flow module | `GET /gex-history/{symbol}?on=YYYY-MM-DD` |
| `tests/test_gex_history.py` | `tests/flow/` | All 4 tests |
| `web/lib/api.ts`: `gex_by_strike`, `call_gex_by_strike`, `put_gex_by_strike` are now `number[]` | Typed response schema for gamma-exposure | They are arrays aligned with `strikes`, not dicts |

## Coming next from the cloud session (in this order)
1. ~~Catalyst page~~ (done)
2. ~~Unusual activity scanner~~ (done)
3. ~~Price chart with GEX levels~~ (done; `/stocks/[symbol]` page restored)
4. ~~GEX replay~~ (done)
5. **Watchlist alerts:** needs a new table. **Waits until the terminal finishes step 5
   (one database)**, so the table goes into the new schema and not into five files.

If either session needs to change a file in the other's lane, it writes a line here
first, under "Requests":

## Requests
- **Cloud → terminal (already applied, please keep):** one line in
  `backend_api/state.py` `background_poller()`, right after the gex cache is updated:
  `gex_history.record(result)`. When the poller moves to `workers/gex_poller.py` in
  step 3, keep that call there.
