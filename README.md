# Million App

Simple trading / budget journal built with Streamlit.

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

3. Run the app:

```bash
streamlit run app.py
# open the printed http://localhost:8501 (or port shown)
```

Demo credentials: `demo` / `demo123`

## Deploy to Streamlit Community Cloud

1. Push your `main` branch to GitHub (already done).
2. On https://share.streamlit.io create a new app using this repository and branch `main`.
3. If you want persistent data, provision a Postgres DB (Supabase/Railway/Render) and add the connection URL as a secret named `DATABASE_URL`.

The app will use `DATABASE_URL` if present; otherwise it falls back to a local sqlite file `trading_journal.db` in the repo root.

## Migrate data from local SQLite to Postgres

See `scripts/migrate_sqlite_to_postgres.py` for a helper to copy data from the local sqlite database to a Postgres instance.

## Notes
- Password hashing uses `passlib` and `pbkdf2_sha256` for compatibility and security.
- For production use a managed Postgres service and keep secrets out of the repo.
# million-app
My financial dashboard.
