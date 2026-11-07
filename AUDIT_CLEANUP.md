# OptionFlow — Stale Reference Cleanup Audit
> Created: 2026-03-06 | Last updated: 2026-03-07 | Status: **✅ Priority 1–4 complete**

This file tracks all remnant references to the old project names (`million-app`, `Trading_app_v2`, `OptionFlow_V1`, `trading_journal`) found across the codebase.

---

## 🔴 Priority 1 — Live Code (runtime impact) — ✅ DONE

| # | File | Line | What it says | Status |
|---|------|------|--------------|--------|
| 1 | `backend_api/security.py` | 22 | `JWT_AUDIENCE` defaults to `"million-app"` | ✅ Changed to `optionflow-app`, issuer to `optionflow-api` |
| 2 | `tests/test_api_gex.py` | 30 | `os.environ.setdefault("JWT_AUDIENCE", "million-app")` | ✅ Updated to `optionflow-app` |
| 2b | `.github/workflows/ci.yml` | 36,50,81,95 | `JWT_AUDIENCE/ISSUER: "million-app/million-api"` | ✅ Updated to `optionflow-app/optionflow-api` |

**Side effect:** All logged-in sessions were invalidated — users must log in again after v2.5.6 deploy.

---

## 🟡 Priority 2 — Scripts — ✅ DONE

| # | File | Lines | What it says | Status |
|---|------|-------|--------------|--------|
| 3 | `scripts/backup_dbs.py` | 31 | `"trading_journal.db"` listed as a backup target | ✅ Removed |
| 4 | `scripts/migrate_to_split_dbs.py` | 4, 15 | References `trading_journal.db` as migration source | ℹ️ One-time migration script — already ran. Leave as historical record. |
| 5 | `scripts/migrate_sqlite_to_postgres.py` | 7, 18 | References `trading_journal.db` as Postgres source | ⚠️ Still needs update when Postgres migration is attempted |

---

## 🟡 Priority 3 — Config / Env — ✅ DONE (no .env file needed in dev)

| # | File | Line | What it says | Status |
|---|------|-------|--------------|--------|
| 6 | `.env` | 7 | `# DATABASE_URL=sqlite:///trading_journal.db` | ℹ️ `.env` not checked in — remove manually if present locally |

---

## 🟢 Priority 4 — Docs — ✅ DONE

| # | File | Line | What it says | Status |
|---|------|-------|--------------|--------|
| 7 | `DEV_GUIDE.md` | 418 | `cd ~/Desktop/OptionFlow_V1/OptionFlow_V1` | ✅ Fixed to `cd ~/Desktop/OptionFlow_main` |
| 8 | `AGENT_CONTEXT.md` | 12 | `GitHub repo: Karthikkv12/million-app` | ✅ Updated with note that repo rename is optional |

---

## 🔵 Priority 5 — GitHub / Git Remote (cosmetic, external action needed)

| # | What | Current value | Action needed |
|---|------|--------------|---------------|
| 9 | GitHub repo name | `Karthikkv12/million-app` | Rename to `optionflow` (or `million-app` is fine to keep) on GitHub Settings → Repository name. Then run: `git remote set-url origin https://github.com/Karthikkv12/optionflow.git` locally. GitHub auto-redirects old URL so nothing breaks immediately. |

---

## Recommended Order When Tackling

1. **#1 + #2 together** (security.py + test) — change audience string in one commit
2. **#3** (backup_dbs.py) — remove dead `trading_journal.db` entry
3. **#6** (`.env`) — remove stale comment
4. **#7** (DEV_GUIDE.md) — fix wrong path
5. **#4 + #5** (migration scripts) — decide: delete them or rewrite for 5-DB architecture
6. **#8** (AGENT_CONTEXT.md) — update after GitHub repo is renamed
7. **#9** (GitHub rename) — do last, update git remote after

---

*Nothing in this file has been changed yet. Update status here as items are resolved.*

---

## ☁️ TODO — Move optflw.com to Railway (Shelved 2026-11-07)
> Code is ready in PR #4 (`claude/wonderful-turing-dd9y4e` → `develop`, CI green).
> Nothing is deployed yet. Until then optflw.com runs on the MacBook via the Cloudflare tunnel.

**Done (in PR #4):** Dockerfile + `railway.json` (backend, SQLite on a `/data` volume),
`web/railway.json` (frontend), `/restore-db` upload endpoint + `scripts/upload_dbs.sh`,
`docs/RAILWAY.md` guide, `scripts/setup_mac_server.sh`, CI fix.

**To resume:**
- [ ] Merge PR #4 into `develop`
- [ ] Create Railway account (Hobby, ~$5/mo) and follow `docs/RAILWAY.md` steps 1–3
- [ ] Upload DBs from the Mac with `scripts/upload_dbs.sh`, then delete `RESTORE_TOKEN`
- [ ] Point optflw.com DNS at Railway, delete the Cloudflare tunnel, retire the Mac
- [ ] Remove or disable `.github/workflows/deploy-backend.yml` (AWS; fails on push to `main`)

**Security — do regardless of hosting:**
- [ ] Make the GitHub repo private (`main` history has `.env`, all `*.db` files, admin password)
- [ ] Rotate Tradier token and OpenAI key (committed in `.env` on `main`)
- [ ] Refresh the Cloudflare tunnel token (pasted in chat)
- [ ] Change the app admin password; remove it from `AGENT_CONTEXT.md`

---

## 🚀 SaaS Migration Roadmap (Shelved — budget pending)
> Brainstorm list. No action until explicitly decided.

### Why the current setup can't scale
- `optflw.com` runs through a Cloudflare tunnel → your Mac → port 3000
- Any reboot, sleep, dev restart, or broken build = live outage for all users
- SQLite can't handle concurrent writes from multiple users
- `next dev` is not a production server (slow, exposes internals, no caching)

### Step 1 — SQLite → PostgreSQL (biggest blocker, do this first)
- SQLAlchemy models are already clean — mostly a DB URL swap
- 5 SQLite files → 1 Postgres DB with 5 schemas (or 5 separate DBs)
- Run Alembic migrations against Postgres to create schema
- Write a one-time data migration script (5 SQLite files → Postgres)
- **Cost options:**
  - Supabase free tier — 500MB, enough for personal use indefinitely
  - Railway free tier — $5 credit/mo
  - Neon.tech free tier — generous free Postgres

### Step 2 — Host the backend (FastAPI off your Mac)
- Options in order of cheapest:
  - **Railway** (~$5/mo, easy deploy from GitHub)
  - **Render** (free tier for web services, sleeps after inactivity)
  - **Fly.io** (free tier, stays awake)
- Just needs: `Dockerfile` or `requirements.txt` + env vars configured in dashboard

### Step 3 — Host the frontend (Next.js off your Mac)
- **Vercel** — free tier, deploys from GitHub automatically on every push to `main`
- Point `optflw.com` DNS at Vercel instead of Cloudflare tunnel
- Zero config for Next.js — Vercel built it

### Step 4 — Stripe + multi-user (do last)
- Add `tier` field to `users` table (`free | pro | lifetime`)
- FastAPI middleware checks tier before serving gated routes
- Stripe webhook flips tier on payment
- ~1 week of work once infra is sorted

### Total cost when ready
| Service | Free tier | Paid tier |
|---------|-----------|-----------|
| Vercel (frontend) | Free forever for personal | $20/mo pro |
| Supabase (Postgres) | Free 500MB | $25/mo |
| Railway (backend) | $5 credit/mo | ~$5–10/mo |
| **Total** | **~$0** to start | **~$30–35/mo** |

### Prerequisite checklist before any of this
- [ ] SQLite → PostgreSQL migration complete
- [ ] All secrets in env vars (JWT_SECRET, DB_URL, TRADIER_TOKEN, OPENAI_KEY)
- [ ] `next build` working cleanly (✅ already fixed in v2.5.4)
- [ ] Alembic migration history complete for all 5 DBs
- [ ] Stale reference cleanup done (see audit list above)
