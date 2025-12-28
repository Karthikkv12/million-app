#!/usr/bin/env sh
set -eu

: "${API_HOST:=0.0.0.0}"
: "${API_PORT:=${PORT:-8000}}"

# Run migrations for non-SQLite databases (Postgres in docker-compose / prod).
# For SQLite, the app can auto-create tables in dev.
if [ "${DATABASE_URL:-}" != "" ] && printf '%s' "$DATABASE_URL" | grep -qi '^sqlite'; then
  echo "DATABASE_URL is SQLite; skipping alembic migration step"
elif [ "${DATABASE_URL:-}" != "" ]; then
  echo "Running Alembic migrations..."
  alembic upgrade head
else
  echo "DATABASE_URL not set; using default SQLite; skipping alembic migration step"
fi

exec python -m uvicorn backend_api.main:app --host "$API_HOST" --port "$API_PORT"
