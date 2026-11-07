# OptionFlow — Developer Setup & Workflow Guide

## Table of Contents
1. [🚀 Startup Checklist (After Every Reboot)](#-startup-checklist-after-every-reboot--new-session)
2. [🔧 Restart Commands](#-restart-commands-when-a-server-dies-mid-session)
3. [Project Structure](#project-structure)
4. [Local Development Setup](#local-development-setup)
5. [Running the Servers](#running-the-servers)
6. [How optflw.com Works](#how-optflwcom-works)
7. [Git Branch Workflow](#git-branch-workflow)
8. [Releasing to Production](#releasing-to-production)
9. [Checking What's Unreleased](#checking-whats-unreleased)

---

## 🚀 Startup Checklist (After Every Reboot / New Session)

> Run this top-to-bottom every time you open the laptop or start a new session.  
> All servers are killed on shutdown — none survive a reboot automatically.  
> Takes ~60 seconds.

---

### STEP 1 — Open VS Code & terminal, go to the project folder

```bash
cd ~/Desktop/OptionFlow_main
```

---

### STEP 2 — Confirm you're on `develop`

```bash
git branch --show-current
# must print: develop
# if not: git checkout develop
```

---

### STEP 3 — Pull latest from GitHub

```bash
git pull origin develop
```

---

### STEP 4 — Start the Backend (FastAPI — port 8000)

```bash
cd ~/Desktop/OptionFlow_main
source .venv/bin/activate
uvicorn backend_api.main:app --reload --port 8000 &
```

✅ Verify it's up:
```bash
curl -s http://localhost:8000/health
# → {"status":"ok"}
```

---

### STEP 5 — Start the Frontend — port 3000

> Powers **optflw.com** via Cloudflare tunnel when running.

```bash
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd ~/Desktop/OptionFlow_main/web
node node_modules/.bin/next dev --port 3000 &
```

✅ Verify: open **http://localhost:3000** — should load the app.

---

### STEP 6 — Quick Sanity Check

Run these to confirm everything is healthy before starting work:

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Correct branch | `git branch --show-current` | `develop` |
| 2 | Backend alive | `curl -s localhost:8000/health` | `{"status":"ok"}` |
| 3 | Frontend alive | `curl -s -o /dev/null -w "%{http_code}" localhost:3000` | `200` |
| 4 | No lost work | `git status` | clean or intentional WIP |

---

### STEP 7 — Ready to Work ✅

- Edit files in `~/Desktop/OptionFlow_main/`
- Frontend hot-reloads on every save at `localhost:3000`
- `optflw.com` reflects port 3000 (via Cloudflare tunnel)

---

## 🔧 Restart Commands (when a server dies mid-session)

### Restart backend only
```bash
kill -9 $(lsof -ti :8000) 2>/dev/null; sleep 1
cd ~/Desktop/OptionFlow_main
source .venv/bin/activate
uvicorn backend_api.main:app --reload --port 8000 &
```

### Restart frontend only
```bash
kill -9 $(lsof -ti :3000) 2>/dev/null; sleep 1
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd ~/Desktop/OptionFlow_main/web
node node_modules/.bin/next dev --port 3000 &
```

### Restart everything at once
```bash
kill -9 $(lsof -ti :8000 :3000) 2>/dev/null; sleep 1

cd ~/Desktop/OptionFlow_main
source .venv/bin/activate
uvicorn backend_api.main:app --reload --port 8000 &

export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd web && node node_modules/.bin/next dev --port 3000 &

echo "All servers starting..."
```

---

## Project Structure

```
OptionFlow_main/            ← repo root (branch: develop)
├── backend_api/            ← FastAPI Python backend
│   └── routers/
│       ├── watchlist.py    ← Watchlist CRUD + sync (v2.6.0)
│       └── markets.py      ← Market quotes incl. watchlist-quotes endpoint
├── web/                    ← Next.js frontend
│   ├── app/
│   │   └── (app)/
│   │       ├── trades/page.tsx     ← slim orchestrator (7 tabs as of v2.6.0)
│   │       └── budget/page.tsx     ← slim 272-line orchestrator (v2.5.0)
│   ├── components/
│   │   ├── trades/         ← 14 component files
│   │   │   ├── TradesHelpers.ts, TradeModals.tsx, PositionForm.tsx
│   │   │   ├── StatusSelect.tsx, AssignmentPanel.tsx, PositionRow.tsx
│   │   │   ├── PositionsTab.tsx, SymbolsTab.tsx, YearTab.tsx
│   │   │   ├── PremiumTab.tsx, AccountTab.tsx, HoldingsTab.tsx
│   │   │   ├── PortfolioSummaryBar.tsx
│   │   │   └── WatchlistTab.tsx    ← Watchlist (v2.6.0)
│   │   └── budget/         ← 5 component files (split from budget/page in v2.5.0)
│   │       ├── BudgetHelpers.ts, BudgetSection.tsx, BudgetCharts.tsx
│   │       ├── BudgetAnnualSummary.tsx, CCSection.tsx
│   └── lib/                ← API client, auth, hooks
├── database/               ← SQLAlchemy models (5-DB architecture)
├── logic/                  ← Domain service modules (auth, budget, portfolio, gamma)
│   └── watchlist.py        ← sync_watchlist_from_positions (v2.6.0)
├── alembic/                ← DB migrations (0023 migrations as of v2.6.0)
├── scripts/                ← Utility scripts (backup_dbs.py)
├── backups/                ← Auto-generated DB snapshots (gitignored)
├── users.db                ← Auth database
├── trades.db               ← Accounts & holdings database
├── portfolio.db            ← Options portfolio database
├── budget.db               ← Budget database
├── markets.db              ← Market data database
├── requirements.txt        ← Python dependencies
├── VERSIONS.md             ← Release history
└── DEV_GUIDE.md            ← this file
```

---

## Local Development Setup

### Prerequisites
- Python 3.13 (`.venv` inside repo root at `~/Desktop/OptionFlow_main/.venv`)
- Node.js v20.11.1 at `~/bin/node-v20.11.1-darwin-arm64/bin/`
- Node PATH must be set in every new terminal:
  ```bash
  export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
  ```

### First-time install
```bash
cd ~/Desktop/OptionFlow_main

# Backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd web && npm install
```

---

## Running the Servers

You need **two processes** running simultaneously:

### 1. Backend (FastAPI) — port 8000
```bash
cd ~/Desktop/OptionFlow_main
source .venv/bin/activate
uvicorn backend_api.main:app --reload --port 8000
```

### 2. Frontend (Next.js) — port 3000
```bash
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd ~/Desktop/OptionFlow_main/web
node node_modules/.bin/next dev --port 3000
```

---

## Server Overview

| URL | Purpose |
|---|---|
| `http://localhost:8000` | FastAPI backend API |
| `http://localhost:3000` | Next.js frontend (develop branch, hot-reload) |
| `https://optflw.com` | Live site via Cloudflare tunnel → port 3000 |

---

## How optflw.com Works

optflw.com is served via a **Cloudflare Tunnel** (not ngrok, not Vercel). The tunnel process runs locally:

```
cloudflared tunnel run --token <token>
```

The tunnel is configured in the **Cloudflare Zero Trust dashboard** (not in any local file):
- Dashboard → Networks → Tunnels → your tunnel → Public Hostname tab
- Shows: `optflw.com` → `http://localhost:3000`

**This means optflw.com = whatever is running on port 3000 on your Mac.**

| State | What the world sees at optflw.com |
|---|---|
| Current setup | `main` branch (port 3000) |
| If you change Cloudflare to port 3002 | `develop` branch |
| If your Mac sleeps / server stops | Site goes down |

**To change which branch optflw.com shows:**
Go to Cloudflare dashboard → change the tunnel destination port between 3000 and 3002.

**Risk:** The site is entirely dependent on your laptop being on and the server running. This is fine for development/demo but not for a production app with users.

---

## Git Branch Workflow

```
feat/your-feature
       ↓ (PR or merge)
    develop          ← all active work lives here
       ↓ (on explicit release approval only)
     main            ← production, never touched directly
       ↓
   git tag vX.Y.Z
```

### Rules
- **Never commit directly to `main`**
- All development happens on `develop` or a `feat/*` branch
- `main` is only updated when you explicitly say "release"
- Every release gets a semantic version tag (`v1.0.0`, `v1.1.0`, etc.)

### Daily workflow
```bash
# Make sure you're on develop
git checkout develop

# Create a feature branch for larger work
git checkout -b feat/my-feature

# Work, commit often
git add -A
git commit -m "feat: describe what you built"

# Push to GitHub
git push origin feat/my-feature

# When done, merge into develop
git checkout develop
git merge feat/my-feature
git push origin develop
```

### Starting a new terminal session
```bash
cd ~/Desktop/OptionFlow_main
git branch --show-current   # should say: develop
```

---

## Releasing to Production

When you say "release" or "this looks good, ship it":

```bash
# 1. Merge develop into main
git checkout main
git merge develop
git push origin main

# 2. Tag the release
git tag -a v1.2.0 -m "v1.2.0 — description of what's in this release"
git push origin v1.2.0

# 3. Go back to develop
git checkout develop
```

Then update `VERSIONS.md` with the release notes.

After a release, update the `main` worktree so port 3000 reflects the new version:
```bash
cd ~/Desktop/OptionFlow_main
git pull origin main
# restart the port 3000 server
```

---

## Checking What's Unreleased

**What's on develop but not yet in production:**
```bash
git log --oneline origin/main..develop
```
If this prints nothing → develop and main are in sync.
If it prints commits → those are staged changes not yet released.

**Current version in production:**
```bash
git tag --sort=-version:refname | head -5
```

**Full branch picture:**
```bash
git log --oneline --graph --all --decorate -10
```

---

## 🔮 Future Product Roadmap (If Launching as SaaS)

> **Current status:** Personal tool running on SQLite. The architecture is sound for personal use.
> These are the steps required **if / when** the goal shifts to a paid multi-user product.

### Phase 1 — Infrastructure (Required before any public users)

| Task | Why | Effort |
|------|-----|--------|
| **PostgreSQL migration** | SQLite can’t handle concurrent writes from multiple users | ~1 week |
| **Alembic migrations per DB** | Without migration history, schema changes in prod are risky | ~2 days |
| **Docker + docker-compose** | Reproducible local + prod environment | ~1 day |
| **Environment config** | `.env` files / secrets management for prod DB URL, JWT secret, Tradier token | ~1 day |

**PostgreSQL migration notes:**
- 5 SQLite DBs → 5 PostgreSQL schemas (or one Postgres DB with 5 schemas)
- SQLAlchemy already abstracts the driver — mostly a DB URL swap + asyncpg driver
- Alembic handles the schema migration once URL is updated
- Session factories in `database/models.py` are the only code that needs changing

### Phase 2 — Monetisation

| Task | Why | Effort |
|------|-----|--------|
| **Stripe integration** | Subscription billing + webhook for entitlement | ~2 days |
| **Subscription tier on `users` table** | `tier: free│pro│lifetime` field + middleware enforcement | ~1 day |
| **Paywall middleware** | FastAPI dependency that checks `user.tier` before serving gated routes | ~1 day |
| **Free tier limits** | e.g. 1 symbol GEX lookup/day free, unlimited for Pro | ~1 day |

### Phase 3 — Reliability / Observability

| Task | Why | Effort |
|------|-----|--------|
| **Structured logging** | JSON logs to a file/service — currently just `logging.getLogger` | ~1 day |
| **Sentry error tracking** | Catch unhandled exceptions in prod silently | ~2 hours |
| **CI/CD (GitHub Actions)** | Run 428 tests on every push to `develop` | ~1 day |
| **Health check alerting** | Alert if `/health` returns 503 (e.g. UptimeRobot free tier) | ~1 hour |

### Phase 4 — Product Differentiation (what makes it worth paying for)

| Feature | Value | Notes |
|---------|-------|-------|
| **GEX caching + faster page load** | Options Flow page loads in <1s instead of 3–8s | Persist last result to markets.db, background refresh |
| **Tradier real-time data** | 15-min delay → real-time OPRA feed | Requires paid Tradier account |
| **FIFO/LIFO P&L tax reporting** | Export realized P&L CSV for tax software | Builds on existing ledger |
| **Multi-symbol GEX watchlist** | Watch SPY, QQQ, AAPL simultaneously | State already supports it |
| **Email / push alerts** | Alert when spot crosses zero-gamma level | New infra needed |

### Recommended Sequencing

```
Today (personal tool):  SQLite → Keep as-is

When ready to launch:   PostgreSQL + Alembic → Docker → Stripe → Paywall middleware
                        (estimate: 2–3 weeks of focused work)

Post-launch:            Observability → GEX caching → Tradier real-time → Tax engine
```

> **Key decision point:** The moment you want a second person to use this app, PostgreSQL becomes non-optional. Everything else can wait.

---

## Committing Changes

```bash
cd ~/Desktop/OptionFlow_main

# Stage everything
git add -A

# Commit with a descriptive message
git commit -m "feat: short summary

- detail 1
- detail 2"

# Push to GitHub
git push origin develop
```

**Commit message prefixes:**
| Prefix | Use for |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `chore:` | Config, tooling, no code change |
| `docs:` | Documentation only |
| `refactor:` | Code restructure, no new feature |
| `style:` | CSS / visual only |
