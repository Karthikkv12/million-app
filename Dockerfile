# Backend (FastAPI) image. Used by Railway (railway.json) and the AWS ECS
# workflow (.github/workflows/deploy-backend.yml). The frontend deploys from web/.

# ── Stage 1: build / dependency install ──────────────────────────────────────
FROM python:3.13-slim AS builder

WORKDIR /app

# System deps needed to compile some packages (psycopg, cryptography)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install --prefix=/install --no-cache-dir -r requirements.txt


# ── Stage 2: lean runtime image ───────────────────────────────────────────────
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DB_DIR=/data

WORKDIR /app

# Only the runtime libs we compiled above
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY alembic/         ./alembic/
COPY alembic.ini      .
COPY backend_api/     ./backend_api/
COPY database/        ./database/
COPY logic/           ./logic/

# SQLite files live in DB_DIR (a mounted volume on Railway). Runs as root
# because Railway mounts volumes root-owned; a non-root user can't write there.
RUN mkdir -p /data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://localhost:{os.getenv(\"PORT\", \"8000\")}/health')" || exit 1

# One worker by default: SQLite + the in-process GEX poller expect a single
# process. With Postgres (ECS), set WEB_CONCURRENCY=2+ — uvicorn reads it.
# HOST defaults to "::" (IPv4 + IPv6) so Railway's private network can reach it.
CMD ["sh", "-c", "exec uvicorn backend_api.main:app --host ${HOST:-::} --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
