# Free Hosting (Best Path) — Streamlit Cloud + Render + Neon

This repo is designed as a split app:
- **Frontend**: Streamlit (public UI)
- **Backend**: FastAPI (JSON API)
- **DB**: Postgres (recommended) via `DATABASE_URL`

This is the closest “free now, AWS-ready later” setup.

## 0) Prereqs
- GitHub repo pushed
- A Neon (free) Postgres database
- A Render (free) web service for the FastAPI backend
- A Streamlit Community Cloud app for the UI

## 1) Create a free Postgres DB (Neon)
1. Create a Neon project and database.
2. Copy the Postgres connection string (it looks like `postgresql://...`).

You’ll use it as `DATABASE_URL` for the API.

## 2) Deploy the FastAPI backend (Render)
Recommended: **Render Web Service** using the repo’s Docker API image.

1. In Render, create a new **Web Service**.
2. Connect your GitHub repo.
3. Choose **Docker** and set the Dockerfile path to `Dockerfile.api`.
4. Set environment variables:
   - `DATABASE_URL` = your Neon connection string
   - `JWT_SECRET` = a long random string
   - (optional) `API_HOST` = `0.0.0.0`
   - (optional) `API_PORT` = leave unset (Render provides `PORT` automatically)

Notes:
- The API container entrypoint honors `PORT` automatically.
- Free tiers may sleep; first request after idle can be slow.

After deploy, confirm:
- `https://<your-render-service>/health` returns `{"status":"ok"}`

## 3) Deploy the Streamlit UI (Streamlit Community Cloud)
1. Create a Streamlit Community Cloud app pointing at this repo.
2. Set the main file path to `app.py`.
3. Set Streamlit **Secrets**:

```toml
API_BASE_URL = "https://<your-render-service>"
```

That’s it — the UI will call your hosted API.

## 4) Local dev parity
Local defaults:
- UI: `http://127.0.0.1:8501`
- API: `http://127.0.0.1:8000`

Override the API URL for local UI runs:

```zsh
export API_BASE_URL="http://127.0.0.1:8000"
/Users/karthikkondajjividyaranya/Desktop/million-app/.venv/bin/streamlit run app.py
```

## 5) AWS later (high level)
This exact split maps cleanly to AWS:
- Streamlit UI: ECS/Fargate (or migrate UI to Next.js later)
- FastAPI: ECS/Fargate behind ALB
- Postgres: RDS
- Secrets: SSM/Secrets Manager
