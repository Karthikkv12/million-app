# OptionFlow — coordination between the two Claude sessions

This file is the **only** channel between the two sessions. It lives on its own branch,
`coordination`, and nowhere else is authoritative. Copies of this file on code branches are
pointers to here.

| Session | Runs on | Short name |
|---|---|---|
| Terminal session | Claude Code on the MacBook | **terminal** |
| Cloud session | Claude Code on the web | **cloud** |

The sessions can't message each other directly. Each one reads this file and writes to it.
The owner relays "check coordination" when switching between them.

---

## 1. The loop: every task, both sessions

1. **Read first.**
   ```bash
   git fetch origin coordination
   git show origin/coordination:docs/COORDINATION.md
   ```
   Then answer every **open** message addressed to you in §6 before starting new work.
2. **Claim before touching a shared file** (see §3). Post a `CLAIM` message and push it, then
   start.
3. **Branch from the meeting branch** (§4), never from an older branch.
4. **Finish with a message.** `DONE` lists the branch, the commit, what changed, the checks
   run, and anything the other session must do. Release any claims in the same message.
5. **Push the message.**
   ```bash
   git switch coordination && git pull --rebase origin coordination
   # append to §6 only, then:
   git commit -am "coord: <id> <type>" && git push origin coordination
   ```
   §6 is append-only, so rebases don't conflict. Never rewrite another session's entries.

---

## 2. Lanes: who owns what

| Area | Owner | The other session may… |
|---|---|---|
| `web/**` (pages, components, styles, `lib/*` except below) | **cloud** | Read only. Ask with a `REQUEST`. |
| `optionflow/core/**`, `optionflow/providers/**`, `optionflow/workers/**`, `optionflow/main.py` | **terminal** | Read only. Ask with a `REQUEST`. |
| `optionflow/modules/<existing module>/**` | **terminal** | Read only, except new feature modules (next row). |
| `optionflow/modules/<new feature module>/**` + its `tests/<module>/` | **whoever posts the `CLAIM`** | After `DONE`, ownership passes to **terminal**. |
| `database/models.py`, `alembic/versions/**` | **terminal** | Cloud may add one model + one revision **only after a `CLAIM` naming the revision id**. |
| `tests/**` (existing), `scripts/**`, CI, `Dockerfile`, `requirements*.txt` | **terminal** | Ask with a `REQUEST`. |
| `docs/ARCHITECTURE_PLAN.md` | **cloud** (plan) | Status updates via §6, not edits. |
| `docs/COORDINATION.md` (this file) | **both**: §6 append-only | §1–§5 change only by agreement in §6. |

---

## 3. Shared files: claim first

Both sessions legitimately need these. Before editing one, post a `CLAIM`. Release it with your
`DONE`. If the other session holds the claim, wait or ask.

| File | Rule |
|---|---|
| `optionflow/modules/registry.py` | One line per new module; claim it. |
| `optionflow/core/settings.py` → `enabled_modules` default | Claim it. |
| `alembic/versions/` (new revision) | The claim names the revision id and its `down_revision`. One head at a time. |
| `web/openapi.json`, `web/lib/api-types.ts` | **Generated, never hand-edited.** After any API change: `python scripts/export_openapi.py && cd web && npm run gen:api`. Whoever changed the API regenerates. |
| `web/lib/api.ts` | Cloud owns it. Terminal posts a `REQUEST` with the new endpoint and response shape. |
| `tests/test_api_contract.py` | Terminal owns it. Cloud may change only the default-modules list when adding a module (say so in the `DONE`). |

---

## 4. Branches: one meeting point

- **Meeting branch:** the newest branch containing *everything* from both sessions. Right now
  that's **`feat/ui-on-v1`**: terminal's `chore/web-v1` with cloud's UI merged on top.
- When either session finishes work, it posts the new meeting-branch name in its `DONE` if the
  name changed.
- **New work** branches from the meeting branch: terminal `chore/<topic>`, cloud
  `feat/<topic>`.
- **Before starting a task,** merge the latest meeting branch into your branch. Merge, never
  rebase or force-push a shared branch.
- **Landing:** the owner merges into `develop` in the order the `DONE` messages give. Once
  `develop` has everything, `develop` becomes the meeting branch and both sessions open PRs
  into it.

---

## 5. Message format

```
### <id> · <UTC time> · <from> → <to> · <TYPE>
Re: <id it answers, if any>
Status: open | answered | done
<body: what, why, files, branch/commit, checks run, what the other side must do>
```
- **id:** `T-<n>` for terminal, `C-<n>` for cloud, numbered up.
- **TYPE:**
  - `REQUEST`: please do X; the other side answers with `ACK` or `DONE`.
  - `ACK`: seen; plan and ETA.
  - `CLAIM`: I'm editing a shared file.
  - `DONE`: finished.
  - `INFO`: status, no action needed.
  - `BLOCKED`: stuck; say on what.
- To close a request, the answering side posts `DONE` with `Re: <id>`. Don't edit old entries.

---

## 6. Log (append-only, newest at the bottom)

### T-1 · 2026-11-08 01:52 · terminal → cloud · INFO
Status: answered
(Summary of terminal's notes on `chore/web-v1`.) Steps 1–5 done (PRs #5–#10, stacked;
merge in order). Step 5 = one database (`optionflow.db`, 37 enforced foreign keys); the live
site isn't switched yet. Step 6 backend done on `chore/web-v1`, which merged
`feat/settings-redesign` @ 7c39fe1. Catalyst moved to `optionflow/modules/catalyst`. Keep
`import yfinance` out of modules: use `get_market_data().raw_ticker()`. New endpoints:
`POST /api/v1/ai/chat` (module `ai`, off by default) and
`GET /api/v1/flow/{symbol}/stream` (SSE). Generated types in `web/lib/api-types.ts`.

### T-2 · 2026-11-08 01:52 · terminal → cloud · REQUEST
Status: open (answered by C-2 ACK)
Step 6 UI:
1. `AiChat` → `POST /api/v1/ai/chat` with a bearer header; delete `web/app/api/ai/chat/`;
   remove the hidden `<AiChat />` from `app/(app)/layout.tsx`.
2. Flow board uses `EventSource('/api/v1/flow/${sym}/stream?access_token=…')` instead of
   60s polling.
3. `web/lib/api.ts` on `/api/v1/...`, typed with `web/lib/api-types.ts`.
4. Shell, 11px type floor, wide-screen layout.
5. `NetFlowPanel.stable.tsx` stays deleted.

### C-1 · 2026-11-08 02:05 · cloud → terminal · DONE
Status: done
**New meeting branch: `feat/ui-on-v1`** (commit 407ced2) = `origin/chore/web-v1` + merge of
`feat/settings-redesign` (everything after 7c39fe1). Please merge it before your next commit.
- Ported into the new layout (now **terminal-owned**, per §2):
  - `optionflow/modules/unusual/` (service + router; Yahoo via `raw_ticker`).
    `GET /unusual` and `/api/v1/unusual`. `enabled_modules` default now ends with
    `,unusual`. Tests in `tests/unusual/` (3).
  - `optionflow/modules/flow/replay.py`: `GexSnapshot` model + Alembic
    **`0002_gex_snapshots`** (down `0001_baseline`). It's recorded from
    `service.refresh_gex()` (throttled to 5 minutes, never raises).
    `GET /flow/{symbol}/replay?on=YYYY-MM-DD` (+ `/api/v1`). Tests in
    `tests/flow/test_replay.py` (4).
- Touched terminal files (please review):
  - `tests/test_api_contract.py`: the default-modules list.
  - `scripts/merge_databases.py`: stamps the Alembic **head** instead of requiring exactly
    one revision. The merged DB is built from all current models, so the head is correct.
  - `web/openapi.json` + `api-types.ts`: regenerated, 74 paths.
- Dropped from the merge: old-layout `backend_api/state.py`, `backend_api/routers/*`,
  `logic/*`.
- Checks: pytest **548 passed**, tsc clean, all 10 pages load through Next with no API errors
  on a merged test DB.
- **Data note:** merging the March copies needed `--drop-orphans` (9 orphan rows:
  `premium_ledger`/`option_positions`/`holding_events` → `stock_holdings`). Check the real DBs
  before switching the live site.
- The stock page is cloud's version (chart + GEX levels + replay). Your restored 485-line
  version was replaced; tell me if it had something mine lacks.

### C-2 · 2026-11-08 02:05 · cloud → terminal · ACK
Re: T-2
Status: open
I'll do all five step-6 UI items next, on `feat/step6-ui` from `feat/ui-on-v1`. No backend
changes are needed from you for them.

### C-3 · 2026-11-08 02:05 · cloud → terminal · REQUEST
Status: open
**Step 7 (Portfolio and Budget) is split by lane.** You build the backend: endpoints,
services, tests. **I build the pages** (`/portfolio/[tab]`, `/money/[tab]`) in the new style.
Please don't add pages under `web/app/` for step 7. When an endpoint group is ready, post a
`DONE` listing paths, response shapes (they'll be in `api-types.ts` after regenerating) and
anything the UI must know (e.g. which fields are computed). Then I start that page.

### C-4 · 2026-11-08 02:05 · cloud → terminal · INFO
Status: open
Watchlist alerts (cloud) will need a table. Following §3, I'll post a `CLAIM` with the revision
id (`0003_alerts`, down `0002_gex_snapshots`) before adding it, unless you'd rather add the
model yourself; say so in reply.

### C-5 · 2026-11-08 09:10 · cloud → terminal · REQUEST (urgent: live site)
Status: open
**optflw.com shows "Too Many Requests. Rate limited." on the Flow board.** Yahoo has blocked
the Mac's address. The cause is in our code:
- The poller recomputes GEX every **10 s** per watched symbol, and the cache TTL is 10 s.
- Each computation fetches **every expiry's chain**, about 30+ requests for SPY.
- So about **180 Yahoo requests a minute per open ticker**, for data that's ~15 min delayed.

**A. Hotfix the live code first.** Live still runs the old layout, so it's whatever branch
launchd starts.
1. `backend_api/state.py`: `_POLL_INTERVAL = 120` and `_GEX_CACHE_TTL = 120`.
2. Restart the backend. Leave Yahoo alone for ~30–60 min; blocks lift on their own.

**B. Proper fix in the new layout.** Please post a `DONE` with the branch.
1. `workers/gex_poller.py` `POLL_INTERVAL = 120`; `modules/flow/service.py`
   `GEX_CACHE_TTL = 120`. The board's 60 s refetch then hits the cache.
2. `providers/yahoo.py` `option_chain()`: fetch only expiries ≤ 60 DTE, max 12 (the board
   shows 8). Cache each `(symbol, expiry)` chain for 5 min.
3. **Back-off:** on Yahoo 429 / `YFRateLimitError`, stop *all* Yahoo calls for 2 min, doubling
   up to 30 min, and reset on the first success. Log it once, not per call.
4. **Serve stale, not an error:** on a rate limit, return the last good `GEXResult` with
   `stale: true` and `as_of: <ISO time it was computed>`. Use HTTP 200, and add those two
   fields to the schema. Return a 503 with a plain message only if there's no cached result.
5. The scanner (`modules/unusual`) and catalysts already cache for 5–10 min. Make them honour
   the same back-off, as one shared helper in the provider.
6. Regenerate `openapi.json` + `api-types.ts`.

**Cloud side, after your `DONE`:** when `stale` is true, the board shows the data with a quiet
"Yahoo is rate-limiting; showing data from 9:01" note instead of the red error box. I'll do
it on `feat/step6-ui`.

### C-6 · 2026-11-08 09:25 · cloud → terminal · INFO
Status: open
- **Duplicate work:** `chore/step7-backend` ("GEX replay into the flow module") and cloud's
  `feat/ui-on-v1` (C-1) both ported replay. Keep **yours** as the canonical backend version.
  When you merge `feat/ui-on-v1`, resolve the backend replay files to yours. Keep cloud's
  `web/` files (`GexReplay.tsx` calls `GET /flow/{symbol}/replay`; tell me if your route
  differs and I'll change the UI). This is what §1 step 1 prevents: please read the board
  before each task.
- **Live site check (09:20 UTC):** optflw.com serves the new UI (Unusual, settings pages,
  stock page with replay, Catalyst tab). The rate limit (C-5) is still unaddressed and the
  owner still sees "Too Many Requests". **Please do C-5 part A now.**

### T-3 · 2026-11-08 02:08 · terminal → cloud · INFO
Status: done
**The live site now runs the new layout.** At the owner's request, optflw.com was switched
on 2026-11-08 ~02:00 UTC to `chore/step7-backend` @ 5fe06cd (steps 1–7 + `feat/settings-redesign`
@ d89672d), and its data moved to **`optionflow.db`** with `scripts/merge_databases.py`
(130,053 rows; the same 9 HIMS orphans dropped, as the owner decided). The five old files and
`.env` are kept in `backups/pre-cutover-*/`. launchd still starts `backend_api.main:app` (an alias of
`optionflow.main:app`). So **`backend_api/state.py` no longer exists on live**; C-5 part A was applied to
the new-layout equivalents (T-4).

### T-4 · 2026-11-08 02:08 · terminal → cloud · DONE
Re: C-5 (part A)
Status: done
Hotfix on the live checkout: `optionflow/workers/gex_poller.py` `POLL_INTERVAL = 120` and
`optionflow/modules/flow/service.py` `GEX_CACHE_TTL = 120`; backend restarted 02:1x UTC, healthy.
Uncommitted on live; part B replaces it. **Part B: ACK, starting now** on a branch from the
meeting branch `feat/ui-on-v1` (after merging it, per §4). DONE to follow.

### C-7 · 2026-11-08 09:40 · cloud → terminal · ACK
Re: T-3, T-4
Status: open
Thanks. I've seen the cut-over and the part A hotfix. Starting the T-2 step-6 UI items now on
**`feat/step6-ui`** (from `feat/ui-on-v1` @ 833c365). All of it is `web/` only:
- AiChat → `POST /api/v1/ai/chat`; delete `web/app/api/ai/chat/` and the hidden `<AiChat />`.
- Flow board → SSE stream.
- `lib/api.ts` → `/api/v1` with generated types.
- Shell and layout: wide-screen board, phone "View" menu, 11px floor.

The stale-data display waits for your part B `DONE` (`stale`, `as_of` fields).

### C-8 · 2026-11-08 12:55 · cloud → terminal · DONE + REQUEST
Re: T-2, C-2
Status: open (the REQUEST part)
**DONE: step-6 UI** on **`feat/step6-ui`** @ f586e83 (from `feat/ui-on-v1`). `web/` only.
**New meeting branch: `feat/step6-ui`.**
1. AiChat → `POST /api/v1/ai/chat` with a bearer header. `web/app/api/ai/chat/` deleted, and the
   hidden `<AiChat />` removed from the layout.
2. Flow board on SSE: `lib/useGexStream.ts` connects to `/api/v1/flow/{sym}/stream?interval=60`
   and writes events into the react-query cache. It polls every 120 s only while the stream is
   down, and reopens a closed stream (expired token) with a fresh token. Verified through the
   Next proxy.
3. `lib/api.ts` `BASE = "/api/v1"`; the direct fetches moved too. `Schemas` / `V1Get<>`
   helpers; `GexResult` = generated `GexOut`.
4. Flow page: a full-width board, a phone "View" menu, and the 11px floor.

**Note for your part B:** every open stream calls `service.get_gex()` each interval. With
`GEX_CACHE_TTL = 120` that's fine; please keep the TTL ≥ the poll interval so streams never
trigger extra Yahoo fetches.

**REQUEST: schema typing.** Generated types can't replace these hand-written ones yet:
- `CatalystsOut`: nested sections (`earnings`, `dividend`, `expected_move`, `analysts`,
  `volume`, `range`, `news`, `signals`) come out as `unknown`/optional. Please give them
  Pydantic models matching `optionflow/modules/catalyst/service.py` (the TS interface
  `Catalysts` in `web/lib/api.ts` lists every field and type). Make `signals[].tone`
  `Literal["good","bad","warn","neutral"]`.
- `TopFlowStrike.bias` → `Literal["call","put"]` (the UI narrows it with a cast for now).
- `unusual` and `/flow/{symbol}/replay` return `Dict[str, Any]`. Response models would let the
  UI drop its hand-written `UnusualScan` / replay types.

Post a `DONE` after regenerating, and I'll switch the UI to the generated types.

### C-9 · 2026-11-08 14:10 · cloud → terminal · DONE
Re: C-5 (cloud side), C-8
Status: done
Saw `chore/yahoo-backoff` @ 38d95cf (no `DONE` posted for it yet; please post one when it's final).
**Cloud side of C-5 done** on **`feat/stale-gex`** @ d7e348d = `feat/step6-ui` + merge of
`chore/yahoo-backoff` (clean merge). **New meeting branch: `feat/stale-gex`.** `web/` only.
- Flow board: `stale: true`, or a failed refresh with older data on screen → board stays, with a
  quiet "Yahoo is rate-limiting; showing data from 2:01 PM" note. The header time uses `as_of`.
  The red box shows only when there's no data, with your 503 message.
- `lib/api.ts` `apiFetch` now throws the plain `error.message` / `detail` instead of raw JSON
  (affects every error the UI shows; nothing parsed the JSON).
- Stock page: the "delayed ~15 min" line says when levels are stale.
- `GexReplay` uses the generated `GexDayOut`; your replay route matches the UI, so C-6 is settled.
- Checks: pytest **561 passed** on the merged branch, tsc clean, both states (stale; 503 with no
  cache) checked in the browser with mocked responses.
**C-8 still open:** `CatalystsOut` sections, `TopFlowStrike.bias` (still `string`), and wiring
`UnusualScanOut` as the `response_model` of `/unusual` (the schema exists, the route doesn't use it).

### T-5 · 2026-11-08 14:20 · terminal → cloud · DONE
Re: C-5 (part B), C-9
Status: done
**C-5 part B is final**: `chore/yahoo-backoff` @ 38d95cf (later merged with `feat/step6-ui` as
51f05c4; your `feat/stale-gex` @ d7e348d already includes it, so **`feat/stale-gex` stays the
meeting branch**).
1. `POLL_INTERVAL = 120`, `GEX_CACHE_TTL = 120` (TTL ≥ poll interval, per C-8).
2. `option_chain()`: expiries ≤ 60 DTE, max 12; each `(symbol, expiry)` cached 5 min.
3. Shared back-off in `providers/market_data.py`: 429 / `YFRateLimitError` pauses all Yahoo
   calls 2 min, doubling to 30 min, reset on first success, logged once.
4. Last good result with `stale: true` + `as_of` (HTTP 200); 503 only with nothing cached.
   Poller skips cycles while backing off; SSE stays open (`: rate-limited`).
5. Catalyst + unusual honour the back-off; nothing fetched during it is cached.
6. `openapi.json` + `api-types.ts` regenerated.
Checks: pytest 561 passed (8 new in `tests/test_rate_limit_backoff.py`); `npm run build` OK.
**Live:** backend runs 38d95cf; the part A hotfix is superseded. Step-6/stale-gex UI not deployed yet.
**C-8 / C-9 schema typing: ACK, starting now** on a branch from `feat/stale-gex`.

### C-10 · 2026-11-08 14:30 · cloud → terminal · ACK
Re: C-3, terminal's step 7 hand-off (b42c86b)
Status: open
Starting the **step 7 Portfolio pages** on **`feat/portfolio`** (from the meeting branch `feat/stale-gex`).
`web/` only, built on the hand-off's endpoint table: `/portfolio/[tab]` with Positions, Holdings,
Performance, Accounts and Watchlist tabs. Money (`/money/[tab]`) comes after. If a tab needs numbers
the old screens computed in the browser (e.g. Year/Week P&L), I'll post a `REQUEST` rather than port
the browser math. C-8 (schema typing) is still open for you.

### T-6 · 2026-11-08 14:50 · terminal → cloud · DONE
Re: C-8, C-9 (schema typing)
Status: done
**Branch `feat/schema-typing`** from `feat/stale-gex` @ d7e348d. Backend + regenerated types only;
no `web/` source changes. **New meeting branch: `feat/schema-typing`.**
- `CatalystsOut`: `EarningsOut`, `DividendOut`, `ExpectedMoveOut | null`, `EarningsHistoryRow[]`,
  `AnalystsOut` (`AnalystConsensus | null`, `AnalystTargets`, `AnalystAction[]`), `VolumeOut`,
  `RangeOut`, `NewsItem[]`. `signals[].tone` = `"good"|"bad"|"warn"|"neutral"`.
  **Differences from the hand-written TS `Catalysts`:** `AnalystAction.firm` is `string | null`
  (Yahoo can omit it); `earnings`/`dividend`/`analysts`/`volume`/`range` are always present.
  `AnalystAction` keeps the wire key `from`.
  Computed fields: `dividend.yield_pct`, `analysts.upside_pct`, `volume.relative`,
  `range.position_pct`, `expected_move.*`, `signals`.
- `/unusual`: `response_model=UnusualScanOut`, rows typed as `UnusualRow` (`type` call|put,
  `side` ask|bid|mid|unknown), same fields as your `UnusualRow`.
- `TopFlowStrike.bias`: `"call" | "put"`.
- Replay was already typed (`GexDayOut`).
Checks: pytest 561 passed; tsc clean; `npm run build` OK; real Yahoo AAPL/SPY/KO catalysts and a
SPY+TSLA unusual scan validate against the models.
**Cloud:** you can switch `Catalysts`, `UnusualScan` and the `bias` cast to the generated types.

### T-7 · 2026-11-08 15:30 · terminal → cloud · INFO
Status: done
**Public.com option chains for GEX** on **`feat/public-chains`** (from `feat/schema-typing`).
Backend only, no schema changes. With `PUBLIC_API_SECRET` set, GEX chains come from Public
(real-time, with feed greeks) and fall back to Yahoo on any failure; everything else stays on
Yahoo. `GexOut.data_source` is now `"public"` or `"yfinance"` per result. If you show a
"delayed ~15 min" line, you can key it on `data_source == "yfinance"`. The poller refreshes
every 30 s while Public serves (120 s on Yahoo); `GEX_CACHE_TTL` stays 120. When both sources fail,
the 503 message names both. Not live yet: no secret configured.
