# Deploying OptionFlow to Railway

Runs optflw.com in the cloud so no Mac has to stay on. Two Railway services
from this one repo, plus a volume that holds the five SQLite databases.

```
optflw.com ──► frontend (Next.js, web/) ──/api/*──► backend (FastAPI, Dockerfile)
                                                       └── volume /data/*.db
```

Cost: Railway Hobby plan, ~$5/month for this size.

---

## 1. Create the project

1. Sign up at https://railway.com with GitHub and pick the **Hobby** plan.
2. **New Project → Deploy from GitHub repo → `million-app`.**
   Railway creates one service. It becomes the **backend**.

## 2. Backend service

In the service's **Settings**:

| Setting | Value |
|---|---|
| Service name | `backend` (the frontend's URL below depends on this name) |
| Root directory | *(empty — repo root)* |
| Branch | `develop` for now (`main` once this is released) |
| Config file | `railway.json` (picked up automatically) |

**Volume:** right-click the service → **Attach volume** → mount path `/data`.

**Variables** (service → Variables → Raw editor):

```
PORT=8000
DB_DIR=/data
JWT_SECRET=<run: python3 -c "import secrets; print(secrets.token_hex(64))">
TRADIER_TOKEN=<your Tradier token>
OPENAI_API_KEY=<your OpenAI key>
RESTORE_TOKEN=<run: python3 -c "import secrets; print(secrets.token_urlsafe(32))">
```

`RESTORE_TOKEN` is temporary: it switches on the database upload in step 4.

**Networking → Generate domain** (needed once for the upload; you can remove it after).

Deploy, then check `https://<backend-domain>/health` shows `"status":"healthy"`.
The databases start empty at this point.

## 3. Frontend service

In the project: **New → GitHub repo → `million-app`** again, then in **Settings**:

| Setting | Value |
|---|---|
| Service name | `frontend` |
| Root directory | `web` |
| Branch | same as the backend |
| Config file | `web/railway.json` (picked up automatically) |

**Variables** — set this **before** the first build. Next.js bakes the backend
address into the build, so changing it later needs a redeploy:

```
BACKEND_URL=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:${{backend.PORT}}
```

Plus `OPENAI_API_KEY` if you use the AI chat (it runs in the frontend).

**Networking → Generate domain**, open it: the login page should load.

## 4. Upload your data (one time)

On the Mac that has the database files (default folder `~/Downloads`):

```bash
BACKEND=https://<backend-domain> RESTORE_TOKEN=<token> bash scripts/upload_dbs.sh ~/Downloads
```

Log in on the frontend domain and check your latest trades and budget entries.

Then **delete `RESTORE_TOKEN`** from the backend's variables. The upload endpoint
returns 404 without it.

## 5. Point optflw.com at Railway

1. Frontend service → **Settings → Networking → Custom domain** → `optflw.com`.
   Railway shows a CNAME target.
2. Cloudflare → `optflw.com` → **DNS**: remove the record the tunnel created for
   `optflw.com`, then add a **CNAME** `@` → the Railway target. Leave it
   **DNS only** (grey cloud) until Railway shows the certificate as issued.
3. Cloudflare Zero Trust → Networks → Tunnels: delete the optflw tunnel (or its
   public hostname) and stop `cloudflared` on the Mac.

## Notes

- **One backend replica.** SQLite and the GEX poller expect a single process;
  don't scale the backend past 1 while on SQLite.
- **Backups.** Railway volumes support backups (volume → Backups). Turn on a schedule.
- **Postgres later.** The code already supports `DATABASE_URL`; see
  `scripts/migrate_sqlite_to_postgres.py` if you outgrow SQLite.
