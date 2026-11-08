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

## Progress (2026-11-08 14:30 UTC)

Day-to-day status lives on the `coordination` branch (`docs/COORDINATION.md` §6).
This is a snapshot.

| Step | State | Branch / PR |
|---|---|---|
| 0. Owner: secrets, private repo, 2FA | **Not confirmed.** Nothing in the log says the keys or the admin password were replaced | owner |
| 1. Land heatmaps, drop list, one accent | Done, not merged | [PR #5](https://github.com/Karthikkv12/million-app/pull/5) |
| 2. Core | Done, not merged | [PR #6](https://github.com/Karthikkv12/million-app/pull/6) |
| 3. Providers and flow | Done, not merged | [PR #7](https://github.com/Karthikkv12/million-app/pull/7) |
| 4. Modules under `/api/v1` | Done, not merged | [PR #8](https://github.com/Karthikkv12/million-app/pull/8), [PR #9](https://github.com/Karthikkv12/million-app/pull/9) |
| 5. One database | Done; **live site switched** to `optionflow.db` (130,053 rows, 9 HIMS orphans dropped) | [PR #10](https://github.com/Karthikkv12/million-app/pull/10) |
| 6. Website on the new API | Backend done ([PR #11](https://github.com/Karthikkv12/million-app/pull/11)). UI done: `/api/v1` + generated types, AI chat on the backend, SSE flow stream, wide board (`feat/step6-ui`). Yahoo rate-limit fix done both sides (`chore/yahoo-backoff`, `feat/stale-gex`). **Still open:** httpOnly cookies, two-factor login, Sentry, new-device alerts; schema typing request C-8 | see left |
| 7. Portfolio and Budget | Backend done ([PR #12](https://github.com/Karthikkv12/million-app/pull/12)). Pages **in progress** on `feat/portfolio`: shell + Positions tab done; Holdings, Performance, Accounts, Watchlist are placeholders; `/money/[tab]` not started; pen test not started | see left |
| 8. Phone app | Not started | — |

**Meeting branch:** `feat/stale-gex` (`feat/portfolio` builds on it).
**Nothing is merged into `develop` yet.** PRs #5–#12 are stacked and merge in order;
the live site runs `chore/step7-backend` directly.

Open items to watch:
- C-8 (terminal): Pydantic models for `CatalystsOut` sections, `TopFlowStrike.bias`
  literal, `response_model` on `/unusual`.
- Terminal hasn't posted a `DONE` for `chore/yahoo-backoff` (C-5 part B).
- C-4: the alerts table (`0003_alerts`) is still unclaimed.

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

### Screen status

| Screen | Status | Where |
|---|---|---|
| Flow (options-flow) | **Redesigned** (board by local session; one-accent levels strip, drawer cards, 11px floor in `feat/settings-redesign`) | both branches |
| Shell: top bar, tokens, fonts | **Redesigned** | `feat/flow-heatmaps` |
| Settings | **Redesigned**: Profile, Appearance, Password (rules match the backend policy), Devices, Sign-in activity | `feat/settings-redesign` |
| Landing (`/`) | **Redesigned**: sample board, "How to read it", modules, disclaimer footer | `feat/settings-redesign` |
| Login | **Redesigned**: split layout, plain-language errors | `feat/settings-redesign` |
| Users (admin) | **Redesigned**: summary, search, actions menu, reset password, real password policy | `feat/settings-redesign` |
| Markets | **Redesigned**: breadth, sentiment, VIX, ranked sector ETFs, movers, graded heatmaps | `feat/settings-redesign` |
| Dashboard | **Redesigned**: quote cards, volatility, calendar (now follows theme), Jump to | `feat/settings-redesign` |
| Ledger | Hidden; rebuilt with Money in step 7 | step 7 |
| Portfolio | **In progress**: shell + Positions tab; other tabs placeholders | `feat/portfolio` |
| Budget (Money) | Not started | step 7 |

`feat/settings-redesign` also contains:
- **Theme fix** in `lib/theme.tsx`. `ThemeProvider` wrote its initial "dark" to
  storage before reading the saved value, so a saved light theme was lost.
- `cellColor` exported from `GexHeatmap.tsx`.
- `components/marketing/SampleBoard.tsx`.
- A `logoutAll` helper in `lib/api.ts`.
- **Shared card system** in `components/ui.tsx`: `Panel`, `SectionHeader`, `Change`,
  `Pill`, `Segmented`, `heatColor`, `useChartColors`. New cards should use these.
- Light-mode fixes: the TradingView calendar was always dark; several white-on-white
  labels and buttons; pale `*-300` text on light backgrounds.

Backend gaps the new screens exposed (fold into step 4, auth module):
- `/auth/sessions` doesn't flag the current session, so Settings guesses
  "This browser" from the user agent. Return `is_current`.
- Auth events don't store the device or IP. Record both, so sign-in activity can show
  where each sign-in came from.

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

## 5. Security

| Layer | Today | Target | Step |
|---|---|---|---|
| Secrets | **Leaked:** `.env` (Tradier and OpenAI keys), all `*.db` files and the admin password are in the public repo history | Repo private; new keys and password; secrets only in host variables and `core/settings.py`; GitHub secret scanning with push protection | 0 · 2 |
| Login | Refresh rotation, PBKDF2, login rate limit, auth events and session revoke are built. Tokens are in `localStorage` | Two-factor login (TOTP or passkeys); httpOnly cookies on the web; Keychain or Keystore in the app | 6 · 8 |
| Permissions | Every query is filtered by `user_id`; `test_auth_and_isolation.py` | An isolation test in every module; admin checks on the server only | 4 |
| Front door | Backend hidden behind Next.js; CORS defaults to `*`; `/market/quotes` has no auth; `/restore-db` exists | CORS = optflw.com only; every route requires auth or a rate limit; CSP and HSTS headers; remove `/restore-db` | 2 · 4 |
| Data | SQLite files on a laptop | Managed database, encrypted at rest, scheduled and tested backups; brokerages linked only via OAuth (SnapTrade or Plaid), never stored passwords | 5 |
| Phone app | Third-party keys already stay on the server | No keys in the app; tokens in Keychain or Keystore; App Attest or Play Integrity | 8 |
| Code | Dependabot on; no branch protection | CodeQL on `develop`; protected `main`/`develop` with required CI; Pydantic on every input | 1 |
| Watching | Auth events recorded; no alerts | Sentry, uptime checks, new-device login alerts, a one-page leak plan | 6 |
| Accounts | Unknown | Two-factor login on GitHub, Cloudflare, Railway and the registrar; separate dev and prod data; pen test before outside users | 0 · 7 |

**Step 0 is for the owner, not the agent:** make the repo private; replace the Tradier
and OpenAI keys, the admin password and the Cloudflare tunnel token; turn on secret
scanning with push protection; enable two-factor login on GitHub, Cloudflare and Railway.

Agent rules from here on: never commit `.env`, `*.db` or tokens; never print secrets
in logs or chat; ask before changing anything in GitHub, Cloudflare or Railway settings.

## 6. Order of work

Step 0 (the owner) comes first. Each step is its own branch off `develop` and its own PR into `develop`. Before each
push: `pytest`, `npm run build`, and screenshots at 1280px and 390px in light and
dark. Never push to `main`. Keep optflw.com running; develop on port 3002.

1. **Land the heatmap work.** Tag `pre-new-build`, merge `feat/flow-heatmaps` into
   `develop` (it's based on old `main`, so expect conflicts on files `develop`
   changed), then merge `feat/settings-redesign` on top (Settings, landing, login,
   theme fix). Delete the Drop list, and fix the second accent color.
   Protect `main`/`develop` with required CI and turn on CodeQL.
2. **Core.** `core/settings.py`, `core/db.py`, `core/deps.py`. Replace every
   `logic.services` import with a direct one, delete the facade, and make the tests
   use a settings or DB fixture instead of monkeypatching. Secrets only from
   Settings, CORS limited to optflw.com, security headers on.
3. **Providers and flow.** The market-data interface with Yahoo and Tradier. Move the
   gamma math, caches and poller into `modules/flow` + `workers/`, ORM only.
4. **Modules under `/api/v1`.** auth → market → watchlist → portfolio → budget, with
   typed responses and `ENABLED_MODULES`. Old paths stay as aliases. Every route
   requires auth or a rate limit, there's an isolation test per module, and
   `/restore-db` is removed. The auth module returns `is_current` on sessions and
   records the device and IP on auth events.
5. **One database.** A script that copies the five files into one, with real foreign
   keys and a fresh baseline migration. Back up first with `scripts/backup_dbs.py`.
   Host it encrypted with scheduled, tested backups.
6. **Website on the new API.** Generate the TS client, move the AI chat to the
   backend, add the flow SSE stream, and finish the shell, type floor and wide layout.
   All current screens are restyled (see Screen status). httpOnly cookie auth, two-factor login, Sentry and new-device alerts.
7. **Bring back Portfolio and Budget** in the new style (`/portfolio/[tab]`,
   `/money/[tab]`). Short pen test before outside users.
8. **Phone app** on the same `/api/v1` and generated client. Keychain or Keystore
   tokens, no third-party keys, App Attest or Play Integrity.

Stop after each step and report what changed before starting the next.
