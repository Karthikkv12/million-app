"""logic/services.py — Thin re-export shim.

The business logic now lives in:
  - logic/auth_services.py      (auth, users, tokens, rate-limiting)
  - logic/trade_services.py     (orders, trades, accounts, holdings, load_data)
  - logic/budget_services.py    (cash, budget, overrides, CC weeks, ledger)
  - logic/portfolio_services.py (portfolio value history)

This shim keeps every existing import of `logic.services` working unchanged.

IMPORTANT — monkeypatching compatibility:
  Tests use `monkeypatch.setattr(logic.services, "engine", fake_engine)`.
  The `engine = None` sentinel MUST remain here so that attribute exists on
  this module object. Each domain module reads it at call-time via
  `import logic.services as _svc; getattr(_svc, "engine", None)`.
"""

from database.models import (
    get_users_session,
    get_trades_session,
    get_budget_session,
    get_portfolio_session,
    get_markets_session,
    get_engine,
    get_users_engine,
    get_trades_engine,
    get_budget_engine,
    get_portfolio_engine,
    get_markets_engine,
)

# ── Monkeypatch anchor (do NOT remove) ───────────────────────────────────────
engine = None
Session = None

# ── Domain re-exports ─────────────────────────────────────────────────────────
from logic.auth_services import *          # noqa: F401, F403, E402
from logic.trade_services import *         # noqa: F401, F403, E402
from logic.budget_services import *        # noqa: F401, F403, E402
from logic.portfolio_services import *     # noqa: F401, F403, E402

# Re-export session helpers explicitly so code importing them from logic.services works.
from logic.auth_services import _users_session                           # noqa: F401, E402
from logic.trade_services import get_session, _get_portfolio_session     # noqa: F401, E402
from logic.budget_services import _budget_session                        # noqa: F401, E402
from logic.portfolio_services import _portfolio_session                  # noqa: F401, E402

# Re-export normalizers explicitly (used across routers).
from logic.trade_services import (                                        # noqa: F401, E402
    normalize_instrument,
    normalize_action,
    normalize_option_type,
)
from logic.budget_services import (                                       # noqa: F401, E402
    normalize_cash_action,
    normalize_budget_type,
)
