# Maintenance cleanup checklist

Keep this file as the ongoing “maintenance phase” tracker.

## Reliability
- [ ] Ensure `./scripts/dev.sh` and repo-root `./dev.sh` keep working on macOS/Linux (fresh clone, empty venv).
- [ ] Add a `make dev` / `make test` (or equivalent) if the team prefers make-based workflows.
- [ ] Standardize on one repo root (outer vs inner) in docs; remove ambiguity.

## Streamlit deprecations (time-sensitive)
- [ ] Replace any `use_container_width=` calls with `width=` (`width='stretch'` / `width='content'`) before 2025-12-31.
- [ ] Audit `st.experimental_*` usage and migrate to stable APIs where available (`st.query_params`, `st.rerun`, etc.).

## Caching
- [ ] Track upstream: `streamlit-cookies-manager` still uses deprecated `@st.cache`; remove the local shim in `ui/auth.py` once the dependency updates.
- [ ] Decide a cache invalidation policy (where to call `st.cache_data.clear()` vs per-function `.clear()`).

## Database & migrations
- [ ] Confirm Postgres deploy runs `alembic upgrade head` including `0009_orders.py`.
- [ ] Review SQLite auto-upgrade helper coverage for new tables/columns (avoid drift from Alembic schema).
- [ ] Add a lightweight “schema sanity” check in CI (e.g., create DB, init, run a minimal query).

## Security
- [ ] Rotate `JWT_SECRET` policy for production and document minimum entropy/length.
- [ ] Consider adding rate-limits at the edge / reverse proxy too (in addition to app-level throttling).
- [ ] Verify session revocation semantics: server sessions, refresh token rotation, and UI session list are consistent.

## Observability
- [ ] Decide logging destination and level defaults (`INFO` vs `DEBUG`) for API and Streamlit.
- [ ] Add a simple request-id / correlation-id (optional) for tracing auth + trading operations.

## Code quality
- [ ] Address SQLAlchemy deprecation warning around `datetime.utcnow()` in schema defaults.
- [ ] Run a formatter/linter pass (black/ruff) once and enforce in CI (only if desired).

## CI/CD hygiene
- [ ] Add GitHub Actions job to run `pytest -q` with a pinned Python version.
- [ ] Pin dependencies where needed (especially Streamlit) to reduce surprise breakage.
