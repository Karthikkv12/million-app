# Backend (FastAPI) image for Railway. The frontend is deployed separately from web/.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DB_DIR=/data

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend_api ./backend_api
COPY database ./database
COPY logic ./logic
COPY alembic ./alembic
COPY alembic.ini ./

RUN mkdir -p /data

# Single worker: SQLite files + the in-process GEX poller expect one process.
# "::" listens on IPv4 and IPv6 so Railway's private network can reach it.
CMD ["sh", "-c", "exec uvicorn backend_api.main:app --host ${HOST:-::} --port ${PORT:-8000}"]
