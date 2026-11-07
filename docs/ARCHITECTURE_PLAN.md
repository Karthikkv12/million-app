# OptionFlow Architecture Plan — handoff brief

Written for the Claude Code session that runs on the MacBook.
Visual version: https://claude.ai/artifact/Ep27pPaL9feJhouZKEpqhC

**Goal:** one clean codebase that serves optflw.com now and a phone app later.

**Reference for the look:** the `feat/flow-heatmaps` branch (the strike × expiry
GEX board, warm paper / near-black tokens, DM Sans + DM Mono, top bar).
skylit.ai is the wider inspiration. Where this plan and that branch disagree on
visuals, keep the branch.

**Decisions made:**
- **Budget and Portfolio:** their screens stay removed for now and get rebuilt later
  in the new style. Their data, logic and API are kept, as modules that can be
  switched off.
- **Market data:** Yahoo is the default. Tradier comes back as an optional provider,
  used only when `TRADIER_TOKEN` is set.

---

## 1. Backend today (counted on `develop`)

| Problem | Where |
|---|---|
| 5 SQLite files that can't link or join; every table points at `users.db`, and broker accounts (`trades.db`) are split from their holdings (`portfolio.db`) | `database/models.py` |
| Import loop: `logic/services.py` re-exports 4 modules with `import *`, and 5 modules import it back. Tests monkeypatch it to swap the DB | `logic/` |
| Business logic in routers: the markets router is 549 lines, calls Yahoo itself and reshapes pandas data | `backend_api/routers/markets.py` |
| Two writers for `markets.db`: an ORM model (`NetFlowSnapshot`, unused) and raw `sqlite3` | `backend_api/state.py` |
| `state.py` mixes caches, the GEX poller and raw SQL | `backend_api/state.py` |
| 24 `os.getenv` calls in 7 files, plus a hand-written `.env` loader | various, `main.py` |
| Yahoo called from 3 places; Tradier mixed into the math | `markets.py`, `state.py`, `gamma.py` |
| One 1,404-line file with 40 functions | `logic/portfolio.py` |
| Not ready for a phone app: no `/api/v1`, untyped `Dict` responses, AI chat lives in Next.js | — |

## 2. Backend target

```
optionflow/
  main.py                 builds the app, mounts enabled modules under /api/v1
  core/                   settings.py (pydantic-settings) · db.py · security.py · deps.py · errors.py
  providers/              market_data.py (interface) · yahoo.py · tradier.py · ai.py
  workers/                gex_poller.py · backfill.py
  modules/
    auth/                 router.py · service.py · repo.py · models.py · schemas.py
    market/               quotes, search, stock info/history
    flow/                 GEX (math from logic/gamma.py), heatmap data, snapshots
    watchlist/
    portfolio/            weeks · positions · assignments · holdings · accounts (one file each)
    budget/               budget · credit cards · cash · ledger
alembic/                  one history for one database
tests/<module>/
```

**Rules**
1. Routers only handle HTTP: parse the request, call one service function, and return
   a typed Pydantic schema. No pandas and no provider calls in routers.
2. Services are plain functions with no FastAPI imports. The API, the workers and the
   tests all call them the same way.
3. A module may call another module's `service`, never its `repo` or `models`.
   No `import *`.
4. Every setting lives in `core/settings.py`, including `ENABLED_MODULES`
   (default: `auth,market,flow,watchlist`).
5. Providers sit behind one interface. `get_market_data()` returns Tradier when a token
   is set, and Yahoo otherwise.

**Phone-app readiness**
- Versioned `/api/v1`. Keep the old paths as aliases until the website moves over.
- Typed responses everywhere, so the website generates its TypeScript client from
  OpenAPI and an app can do the same.
- Move the AI chat from `web/app/api/ai/chat` into the backend (`modules/ai` or
  `providers/ai.py`).
- Stream the flow board over Server-Sent Events (`/api/v1/flow/{symbol}/stream`)
  instead of having every client poll.
- One error shape: `{"error": {"code", "message"}}`.

## 3. Frontend target (unchanged from before, adjusted to the heatmap branch)

- **Navigation:** Market (Today, Flow, Sectors), then later Portfolio and Money when
  they're rebuilt. The top bar from the heatmap branch stays; the groups become its
  menus.
- **Tokens:** the ones on the heatmap branch. Add `gain`, `loss` and `warn`.
  Use **one** accent: make the GO button ink-colored, call wall `gain`, put wall
  `loss`, flip `accent`.
- **Type floor of 11px.** Fix the wide-screen layout (the board stops at about
  1,020px at 1440) and fold the phone controls into one "View" menu.
- **Component layers:** tokens → `components/ui` → `components/trading` →
  `features/*` → `app/*`.

## 4. Carry-over

Tag `develop` as **`pre-new-build`** before deleting anything.

**Keep (move as-is)**
- All data in all five DB files (merged into one database in step 5).
- `logic/gamma.py` math; auth (JWT refresh rotation, password hashing, sessions,
  auth events); holdings basis, premium ledger and double-entry cash ledger logic.
- The 474 tests, with imports updated as code moves.
- Frontend: GexHeatmap, LevelsStrip, DetailsDrawer, palettes, tokens and fonts, top
  bar, TickerSearchInput, SectorHeatmap, the dashboard cards and VIX panel,
  TradingChart, and the Settings, Users and Login pages.
- Dockerfile, `railway.json` (both), CI, `scripts/backup_dbs.py`,
  `scripts/create_user.py`.

**Rewrite (keep the behavior, not the code)**
- `logic/services.py` facade → direct imports.
- `state.py` → `modules/flow` + `workers/gex_poller.py`, writing through the ORM
  (`NetFlowSnapshot` / `PriceSnapshot` already exist).
- `routers/markets.py` → `modules/market` + `providers/yahoo.py`.
- Tradier → `providers/tradier.py`, optional.
- `logic/portfolio.py`, `trade_services.py`, `holdings.py`, `premium_ledger.py`,
  `portfolio_services.py` → `modules/portfolio/*`.
- The `.env` loader and `os.getenv` calls → `core/settings.py`.
- AI chat → backend. Also remove the hidden `<AiChat />` that is mounted on every
  page in `app/(app)/layout.tsx`.
- 23 migrations → one baseline migration for the single database.
- `web/lib/api.ts` (735 lines; the new UI uses ~15 of the 92 routes) → a client
  generated from OpenAPI.
- Budget and Portfolio screens → rebuilt later in the new style.

**Drop**
- 18 `* 2.py` copies, `backend_api/schemas.py.bak`, `database/models.py.bak`,
  `logic/services.py.bak2`, `logic/services.py 2.bak2`,
  `web/components/gex/*.stable.tsx`, `web/nohup.out`.
- Orders: the `/orders` calls in `api.ts` (there's no backend route) and the `orders`
  table from migration 0009 (there's no model).
- AWS: `aws/`, `.github/workflows/deploy-backend.yml`, `.env.production.example`
  (ECS). Railway is the chosen host.
- `vercel.json`, `runtime.txt`.
- One-time scripts: `migrate_to_split_dbs.py`, `fix_closed_adj_basis.py`,
  `audit_testuser.py`, `seed_test_user.py` (check the tests don't use it first).
- The `google-genai` package. Move `pytest` and `httpx` to `requirements-dev.txt`.
- Stale remote branches: `team/*`, `feature/backend-today`,
  `feature/frontend-sidebar`, `feature/ops-cloud-deploy`, `alert-autofix-1`.
  Ask the owner before deleting them.
- The admin password in `AGENT_CONTEXT.md`. Remove it from the file and change it.
- `/restore-db` endpoint, once the one-time Railway data upload is done.

## 5. Order of work

Each step is its own branch off `develop` and its own PR into `develop`. Before each
push: `pytest`, `npm run build`, and screenshots at 1280px and 390px in light and
dark. Never push to `main`. Keep optflw.com running; develop on port 3002.

1. **Land the heatmap work.** Tag `pre-new-build`, merge `feat/flow-heatmaps` into
   `develop` (it's based on old `main`, so expect conflicts on files `develop`
   changed), delete the Drop list, and fix the second accent color.
2. **Core.** `core/settings.py`, `core/db.py`, `core/deps.py`. Replace every
   `logic.services` import with a direct one, delete the facade, and make the tests
   use a settings or DB fixture instead of monkeypatching.
3. **Providers and flow.** The market-data interface with Yahoo and Tradier. Move the
   gamma math, caches and poller into `modules/flow` + `workers/`, ORM only.
4. **Modules under `/api/v1`.** auth → market → watchlist → portfolio → budget, with
   typed responses and `ENABLED_MODULES`. Old paths stay as aliases.
5. **One database.** A script that copies the five files into one, with real foreign
   keys and a fresh baseline migration. Back up first with `scripts/backup_dbs.py`.
6. **Website on the new API.** Generate the TS client, move the AI chat to the
   backend, add the flow SSE stream, and finish the shell, type floor and wide layout.
7. **Bring back Portfolio and Budget** in the new style (`/portfolio/[tab]`,
   `/money/[tab]`).
8. **Phone app** on the same `/api/v1` and generated client.

Stop after each step and report what changed before starting the next.
