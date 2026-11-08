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

## Terminal session status (2026-11-08)
- Steps 1–5 done (PRs #5–#10, stacked; merge in order). Step 5 = one database
  (`optionflow.db`, 37 enforced foreign keys); the live site is **not** switched yet.
- Step 6 backend done on `chore/web-v1` (stacked on #10), which also merges
  `feat/settings-redesign` @ 7c39fe1. UI conflicts there took **your** version.
- Catalyst hand-off done: `optionflow/modules/catalyst/` (same function names,
  same 10-minute cache), `GET /catalyst/{symbol}` and `/api/v1/catalyst/{symbol}`,
  5 tests in `tests/catalyst/`. Yahoo access goes through the provider
  (`get_market_data().raw_ticker()`); please keep `import yfinance` out of modules.
- New backend for the UI to adopt (see Requests):
  - `POST /api/v1/ai/chat` — body `{messages: [{role, content}]}`, bearer auth,
    streams `text/plain`. Module `ai` is **off by default** (`ENABLED_MODULES`).
  - `GET /api/v1/flow/{symbol}/stream?access_token=…&interval=10` — Server-Sent
    Events, `event: gex` with the gamma-exposure body when it changes. Next's
    proxy drops connections after 120s; EventSource reconnects (`retry: 5000`).
  - `web/lib/api-types.ts` — generated from `web/openapi.json`
    (`python scripts/export_openapi.py && cd web && npm run gen:api`). A test
    fails if the API changes without regenerating.
- New tables (e.g. watchlist alerts) can go ahead: add a model in
  `database/models.py` + an Alembic revision (`alembic revision --autogenerate`).

## Requests
- **Terminal → cloud (step 6 UI):**
  1. Point `components/AiChat.tsx` at `POST /api/v1/ai/chat` (send the bearer
     header, not `accessToken` in the body), then delete `web/app/api/ai/chat/`
     and remove the hidden `<AiChat />` from `app/(app)/layout.tsx`.
  2. Use the flow stream on the flow board instead of 60s polling
     (`new EventSource(`/api/v1/flow/${sym}/stream?access_token=${token}`)`).
  3. Move `web/lib/api.ts` calls to `/api/v1/...` and type them with
     `web/lib/api-types.ts` (`paths["/api/v1/…"]["get"]["responses"]["200"]`).
     Legacy paths keep working until this is done.
  4. Plan step 6 UI items: the shell, the 11px type floor, the wide-screen layout.
  5. `web/components/gex/NetFlowPanel.stable.tsx` was deleted (plan Drop list;
     nothing imports it). Don't re-add it.
