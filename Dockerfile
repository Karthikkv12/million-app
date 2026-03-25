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

# Non-root user for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

# Expose the port Uvicorn will bind to
EXPOSE 8000

# Health check — ECS will use this to decide if the container is healthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Start the app (workers=2 is safe for Fargate 0.5 vCPU; bump to 4 for 1 vCPU)
CMD ["uvicorn", "backend_api.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
