# OptionFlow — Developer Setup & Workflow Guide

## Table of Contents
1. [🚀 Startup Checklist (After Every Reboot)](#-startup-checklist-after-every-reboot--new-session)
2. [🔧 Restart Commands](#-restart-commands-when-a-server-dies-mid-session)
3. [Project Structure](#project-structure)
4. [Local Development Setup](#local-development-setup)
5. [Running the Servers](#running-the-servers)
6. [The Two-Server Setup (main vs develop)](#the-two-server-setup)
7. [How optflw.com Works](#how-optflwcom-works)
8. [Git Branch Workflow](#git-branch-workflow)
9. [Releasing to Production](#releasing-to-production)
10. [Checking What's Unreleased](#checking-whats-unreleased)

---

## 🚀 Startup Checklist (After Every Reboot / New Session)

> Run this top-to-bottom every time you open the laptop or start a new session.  
> All servers are killed on shutdown — none survive a reboot automatically.  
> Takes ~60 seconds.

---

### STEP 1 — Open VS Code & terminal, go to the right folder

```bash
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1
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
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1
source ~/Desktop/OptionFlow_V1/.venv/bin/activate
PYTHONPATH=/Users/karthikkondajjividyaranya/Desktop/OptionFlow_V1/OptionFlow_V1 \
  python -m uvicorn backend_api.main:app --host 127.0.0.1 --port 8000 --reload &
```

✅ Verify it's up:
```bash
curl -s http://localhost:8000/health
# → {"status":"ok"}
```

---

### STEP 5 — Start the Main (Stable) Frontend — port 3000

> This serves the last released `main` branch and powers **optflw.com** via Cloudflare tunnel.

```bash
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd ~/Desktop/OptionFlow_main/web
node node_modules/.bin/next dev --port 3000 &
```

✅ Verify: open **http://localhost:3000** — should load the stable version.

---

### STEP 6 — Start the Develop Frontend — port 3002

> This is your active working copy. All code changes hot-reload here.

```bash
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1/web
node node_modules/.bin/next dev --port 3002 &
```

✅ Verify: open **http://localhost:3002** — should load with your latest changes.

---

### STEP 7 — Quick Sanity Check Table

Run these to confirm everything is healthy before starting work:

| # | Check | Command | Expected result |
|---|---|---|---|
| 1 | Correct branch | `git branch --show-current` | `develop` |
| 2 | Backend alive | `curl -s localhost:8000/health` | `{"status":"ok"}` |
| 3 | Port 3000 alive | `curl -s -o /dev/null -w "%{http_code}" localhost:3000` | `200` |
| 4 | Port 3002 alive | `curl -s -o /dev/null -w "%{http_code}" localhost:3002` | `200` |
| 5 | No lost work | `git status` | clean or intentional WIP |

---

### STEP 8 — Ready to Work ✅

- Edit files in `~/Desktop/OptionFlow_V1/OptionFlow_V1/` only
- **Never edit `~/Desktop/OptionFlow_main/`** — read-only production reference
- `localhost:3002` hot-reloads on every save
- `localhost:3000` and `optflw.com` are frozen until you explicitly release

---

## 🔧 Restart Commands (when a server dies mid-session)

### Restart backend only
```bash
kill -9 $(lsof -ti :8000) 2>/dev/null
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1
source ~/Desktop/OptionFlow_V1/.venv/bin/activate
PYTHONPATH=/Users/karthikkondajjividyaranya/Desktop/OptionFlow_V1/OptionFlow_V1 \
  python -m uvicorn backend_api.main:app --host 127.0.0.1 --port 8000 --reload &
```

### Restart port 3000 (stable) only
```bash
kill -9 $(lsof -ti :3000) 2>/dev/null; sleep 1
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd ~/Desktop/OptionFlow_main/web
node node_modules/.bin/next dev --port 3000 &
```

### Restart port 3002 (develop) only
```bash
kill -9 $(lsof -ti :3002) 2>/dev/null; sleep 1
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1/web
node node_modules/.bin/next dev --port 3002 &
```

### Restart everything at once
```bash
kill -9 $(lsof -ti :8000 :3000 :3002) 2>/dev/null; sleep 1

# Backend
source ~/Desktop/OptionFlow_V1/.venv/bin/activate
PYTHONPATH=/Users/karthikkondajjividyaranya/Desktop/OptionFlow_V1/OptionFlow_V1 \
  python -m uvicorn backend_api.main:app --host 127.0.0.1 --port 8000 --reload &

# Stable frontend
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd ~/Desktop/OptionFlow_main/web && node node_modules/.bin/next dev --port 3000 &

# Develop frontend
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1/web && node node_modules/.bin/next dev --port 3002 &

echo "All servers starting..."
```

---

## Project Structure

```
OptionFlow_V1/              ← repo root
├── backend_api/            ← FastAPI Python backend
├── web/                    ← Next.js frontend
│   ├── app/                ← App Router pages
│   ├── components/         ← React components
│   └── lib/                ← API client, auth, hooks
├── database/               ← SQLAlchemy models
├── logic/                  ← GEX calculations
├── alembic/                ← DB migrations
├── requirements.txt        ← Python dependencies
├── Procfile                ← Railway backend deploy command
├── railway.toml            ← Railway deploy config
├── vercel.json             ← Vercel frontend deploy config
├── VERSIONS.md             ← Release history
└── DEV_GUIDE.md            ← this file
```

There is also a **second working copy** of the repo at:
```
~/Desktop/OptionFlow_main/  ← git worktree, always on main branch
```
This is not a separate clone — it shares the same git history. It exists purely to run the `main` branch locally at the same time as `develop`.

---

## Local Development Setup

### Prerequisites
- Python 3.13 (`.venv` inside repo root)
- Node.js v20.11.1 at `~/bin/node-v20.11.1-darwin-arm64/bin/`
- Node PATH must be set in every new terminal:
  ```bash
  export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
  ```

### First-time install
```bash
# Backend
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend (develop)
cd web && npm install

# Frontend (main worktree)
cd ~/Desktop/OptionFlow_main/web && npm install
```

---

## Running the Servers

You need **three processes** running simultaneously:

### 1. Backend (FastAPI) — port 8000
```bash
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1
source .venv/bin/activate
python -m uvicorn backend_api.main:app --reload --port 8000
```
Both frontend servers share this single backend. There is only one backend running at a time.

### 2. Frontend — main branch — port 3000
```bash
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd ~/Desktop/OptionFlow_main/web
npx next dev -p 3000
```

### 3. Frontend — develop branch — port 3002
```bash
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1/web
npx next dev -p 3002
```

Or use the npm scripts (from `web/package.json`):
```bash
npm run dev:main      # port 3000
npm run dev:develop   # port 3001 (alias, same idea)
```

---

## The Two-Server Setup

| URL | Folder | Branch | Purpose |
|---|---|---|---|
| `http://localhost:3000` | `OptionFlow_main/` | `main` | Production reference — the last released version |
| `http://localhost:3002` | `OptionFlow_V1/OptionFlow_V1/` | `develop` | Active development — all new work goes here |
| `http://localhost:8000` | same repo | — | FastAPI backend, shared by both |

**Why two servers?**
- You can open both URLs side by side and visually compare production vs what you're building
- `localhost:3000` never changes unless you explicitly release
- All your coding and changes only affect `localhost:3002`

**How the worktree works:**
`OptionFlow_main/` is a **git worktree** — not a clone. It shares the same `.git` database as `OptionFlow_V1/OptionFlow_V1/`. When you push a release to `main`, you can `git pull` inside `OptionFlow_main/` and port 3000 will reflect the new release after a server restart.

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
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1
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

## Committing Changes

```bash
cd ~/Desktop/OptionFlow_V1/OptionFlow_V1

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
