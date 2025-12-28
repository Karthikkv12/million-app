# Contributing

## Branches

- `main`: stable, always deployable.
- `team/backend`: backend-only work (FastAPI, DB, auth, migrations).
- `team/frontend`: frontend-only work (Streamlit UI, UX, styling).
- `team/ops`: infra/devops work (Docker, CI, scripts, docs).

These `team/*` branches are *bases*, not where you commit features directly.

## Feature branch workflow

1. Update your local repo:

```bash
git checkout main
git pull --ff-only
```

2. Create a short-lived feature branch from the right base:

```bash
# Pick ONE base (backend OR frontend OR ops)
git checkout team/backend
# or: git checkout team/frontend
# or: git checkout team/ops

git pull --ff-only

git checkout -b feature/<short-description>
```

3. Commit small, focused changes:

```bash
git add -A
git commit -m "<area>: <what changed>"
```

4. Push and open a PR into `main`:

```bash
git push -u origin feature/<short-description>
```

## PR checklist

- Tests pass locally:

```bash
PYTHONPATH=$PWD pytest -q
```

- Keep migrations in sync:
  - If you changed models, add an Alembic migration under `alembic/versions/`.
  - For Postgres: run `alembic upgrade head`.

## Code owners (suggested)

- Backend: `backend_api/`, `logic/`, `database/`, `alembic/`
- Frontend: `app.py`, `ui/`, `frontend_client.py`
- Ops: `.github/`, `Dockerfile*`, `docker-compose.yml`, `scripts/`, `README.md`
