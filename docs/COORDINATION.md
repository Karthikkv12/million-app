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
| `web/lib/api.ts`: `gex_by_strike`, `call_gex_by_strike`, `put_gex_by_strike` are now `number[]` | Typed response schema for gamma-exposure | They are arrays aligned with `strikes`, not dicts |

## Coming next from the cloud session (in this order)
1. **Catalyst page** (`web/app/(app)/catalyst/**`). UI only.
2. **Unusual activity scanner:** `logic/unusual.py` + `routers/unusual.py` (new
   files only), page `web/app/(app)/unusual`.
3. **Price chart with GEX levels:** UI only, on the stock page.
4. **GEX replay:** reads the existing snapshots. Adds one read-only route.
5. **Watchlist alerts:** needs a new table. **Waits until the terminal finishes step 5
   (one database)**, so the table goes into the new schema and not into five files.

If either session needs to change a file in the other's lane, it writes a line here
first, under "Requests":

## Requests
- (none yet)
