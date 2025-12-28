# Million App

Trading / budget journal with a separated backend API (FastAPI) and frontend (Streamlit).

## Quick start (local)

1. Create a virtualenv and install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Run tests:

```bash
PYTHONPATH=. pytest -q
```

3. Run the backend API (FastAPI):

```bash
export DATABASE_URL="sqlite:///trading_journal.db"  # or your Postgres URL
export JWT_SECRET="change-me"                       # required for production
PYTHONPATH=$PWD python -m uvicorn backend_api.main:app --reload --host 127.0.0.1 --port 8000
```

## Phase 1: Postgres + migrations (recommended)

1. Point `DATABASE_URL` at Postgres (example):

```bash
export DATABASE_URL="postgresql+psycopg://USER:PASSWORD@HOST:5432/million"
```

2. Run migrations with Alembic:

```bash
alembic upgrade head
```

Notes:
- By default, the app auto-creates tables only for SQLite. For Postgres, run Alembic migrations.
- Optional pooling knobs for the backend: `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT`.

## Docker (local Postgres + API + Streamlit)

Run everything with Postgres via Docker Compose:

```bash
cd million-app
docker compose up --build
```

- Streamlit: http://127.0.0.1:8501
- API health: http://127.0.0.1:8000/health

The API container runs `alembic upgrade head` on startup (Postgres only).

4. Run the frontend (Streamlit):

```bash
export API_BASE_URL="http://127.0.0.1:8000"
streamlit run app.py
```

Demo credentials: `demo` / `demo123` (if you created it in the configured DB)

## Deploy

This setup requires deploying the backend API and the Streamlit frontend separately.

- Backend: host `backend_api.main:app` on any Python host (Render/Railway/Fly.io/etc.) and set `DATABASE_URL` and `JWT_SECRET`.
- Frontend (Streamlit Community Cloud): set `API_BASE_URL` in Streamlit Secrets pointing to your backend URL.

1. Push your `main` branch to GitHub (already done).
2. On https://share.streamlit.io create a new app using this repository and branch `main`.
3. If you want persistent data, provision a Postgres DB and set it as `DATABASE_URL` for the backend.

Recommended “best free now, AWS-ready later” path:
- Streamlit Community Cloud (frontend)
- Render (FastAPI backend)
- Neon (Postgres)

See `docs/FREE_HOSTING.md` for the step-by-step.

The backend will use `DATABASE_URL` if present; otherwise it falls back to a local sqlite file `trading_journal.db` in the repo root.

## Migrate data from local SQLite to Postgres

See `scripts/migrate_sqlite_to_postgres.py` for a helper to copy data from the local sqlite database to a Postgres instance.

## Notes
- Password hashing uses `passlib` and `pbkdf2_sha256` for compatibility and security.
- For production use a managed Postgres service and keep secrets out of the repo.
# million-app
My financial dashboard.
