**Project Overview**
- **Purpose:** Million is a small Streamlit-based trading journal and personal finance dashboard.
- **Major components:**
  - `app.py`: Streamlit UI, CSS styling, caching, and orchestration of user actions.
  - `logic/services.py`: Database access layer (SQLAlchemy session usage) and helper functions (`save_trade`, `save_cash`, `save_budget`, `load_data`, `delete_trade`, `update_trade`).
  - `database/models.py`: SQLAlchemy declarative models and enums, DB engine setup (`sqlite:///trading_journal.db`) and `init_db()`.
  - `seed_data.py`: helper script to (re)seed the SQLite DB with example data.

**Big picture / data flow**
- UI (`app.py`) collects user input and calls functions in `logic/services.py`.
- `logic/services.py` uses a `Session` (from `get_engine()` in `database/models.py`) to CRUD rows in SQLite tables defined in `database/models.py`.
- `app.py` reads data via `load_data()` (returns three pandas DataFrames: `trades`, `cash`, `budget`) and uses Plotly + Streamlit to render charts and tables.

**Runtime & developer workflows**
- Install deps: `pip install -r requirements.txt`.
- Run the app locally: `streamlit run app.py` from the repository root where `app.py` lives.
- Seed the DB with example data: `python seed_data.py` (this clears and populates `trading_journal.db`).
- DB location: the SQLite file `trading_journal.db` is created in the working directory (as configured in `database/models.py`).

**Project-specific conventions & patterns**
- Enums are used heavily for typed DB columns (`InstrumentType`, `Action`, `OptionType`, `CashAction`, `BudgetType`) — prefer passing/handling these values using the string forms or the enum members where appropriate.
- UI vs services value casing: the UI sometimes uses uppercase strings (e.g. `"BUY"` / `"SELL"`) while `services.py` expects mixed-case inputs (e.g. `"Buy"` / `"Sell"). This is a fragile area — see "Casing gotcha" below.
- `st.cache_data` is used for caching remote ticker fetches (`get_ticker_details()` in `app.py`) with explicit cache clears after writes (`st.cache_data.clear()` after `save_*` operations).
- Styling: `app.py` embeds CSS via `st.markdown(..., unsafe_allow_html=True)`. UI behavior (form submission, rerun, toasts) is controlled from `app.py`.

**Casing gotcha (important)**
- `logic/services.save_trade()` maps the `action` argument using `Action.BUY if action == "Buy" else Action.SELL`. However, the editing UI uses `"BUY"` / `"SELL"` (uppercase) in some places. That mismatch may cause incorrect enum mapping (e.g. `"BUY"` would map to `SELL`). When modifying services, prefer case-insensitive mapping or canonicalize inputs (e.g. `action.lower()` or compare `.upper()`).

**Key files & examples to inspect when making changes**
- `app.py`: shows how user flows are wired (forms, tabs, sort buttons, `save_*` calls and `st.rerun()`). Example: `save_trade(s_sym, "Stock", s_strat, s_act, s_qty, s_price, s_date)`.
- `logic/services.py`: examples for session handling and SQLAlchemy usage. Notice `Session = sessionmaker(bind=engine)` and explicit `session.close()` in finally blocks.
- `database/models.py`: schema and enums. DB engine created by `get_engine()` returning `create_engine("sqlite:///trading_journal.db")`.
- `seed_data.py`: demonstrates programmatic creation of `Trade`, `CashFlow`, `Budget` objects and how to clear/populate the DB.

**Integration points & external dependencies**
- Streamlit (`streamlit`) — app runtime.
- Pandas (`pandas`) — data wrangling and date parsing.
- SQLAlchemy (`sqlalchemy`) — ORM and engine.
- Plotly (`plotly`) — charts.
- External data: `app.py` fetches ticker JSONs from GitHub; network failures are handled with fallback defaults.

**Testing / debugging notes**
- There are no dedicated unit tests in the repo. For quick manual testing:
  - Start with `python seed_data.py` to populate the DB.
  - Run `streamlit run app.py` and interact with the UI.
  - Use logs/printouts in `logic/services.py` functions (they currently re-raise or print errors) to diagnose DB errors.
- Keep an eye on enum mapping and date parsing (services convert dates with `pd.to_datetime`).

**When editing/integrating**
- Prefer to update `services.py` when changing DB behavior; keep business logic out of `app.py` where possible.
- If adding fields to models, update `seed_data.py` and `load_data()` SQL queries to include columns and conversion logic.

**If you need to change UI <-> services contracts**
- Document any parameter casing and expected types in `logic/services.py` function docstrings (add small examples), and update `app.py` to canonicalize values before calling services.
- The codebase now provides normalization helpers in `logic/services.py` to canonicalize UI inputs before enum conversion. Use these where possible:

```py
from logic.services import normalize_action, normalize_instrument

# Examples
normalize_action('BUY')        # -> Action.BUY
normalize_action('buy')        # -> Action.BUY
normalize_instrument('option') # -> InstrumentType.OPTION
```

If any section is unclear or you want me to expand a specific area (e.g., adding more tests or wiring the helpers into UI forms), tell me which one and I'll update the file.