# OptionFlow — Developer Setup & Workflow Guide

## Table of Contents
1. [Project Structure](#project-structure)
2. [Local Development Setup](#local-development-setup)
3. [Running the Servers](#running-the-servers)
4. [The Two-Server Setup (main vs develop)](#the-two-server-setup)
5. [How optflw.com Works](#how-optflwcom-works)
6. [Git Branch Workflow](#git-branch-workflow)
7. [Releasing to Production](#releasing-to-production)
8. [Checking What's Unreleased](#checking-whats-unreleased)

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
