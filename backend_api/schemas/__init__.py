"""backend_api/schemas/__init__.py — Re-export shim.

All existing imports of the form:
    from ..schemas import SomeModel
    from backend_api.schemas import SomeModel

continue to work unchanged. New code should import directly from the
domain module (e.g. `from backend_api.schemas.trades import TradeOut`).
"""

from backend_api.schemas.auth import (  # noqa: F401
    AdminCreateUserRequest,
    AdminPatchUserRequest,
    AdminUserOut,
    AuthChangePasswordRequest,
    AuthEventOut,
    AuthLoginRequest,
    AuthLogoutRequest,
    AuthMeResponse,
    AuthRefreshRequest,
    AuthResponse,
    AuthSessionOut,
    AuthSignupRequest,
)

from backend_api.schemas.trades import (  # noqa: F401
    AccountCreateRequest,
    AccountOut,
    HoldingOut,
    HoldingUpsertRequest,
    TradeCloseRequest,
    TradeCreateRequest,
    TradeOut,
    TradeUpdateRequest,
)

from backend_api.schemas.budget import (  # noqa: F401
    BudgetCreateOut,
    BudgetCreateRequest,
    BudgetOut,
    BudgetOverrideOut,
    BudgetOverrideRequest,
    CashCreateOut,
    CashCreateRequest,
    CashOut,
    CashUpdateRequest,
    CreditCardWeekOut,
    CreditCardWeekRequest,
)

from backend_api.schemas.portfolio import (  # noqa: F401
    AssignmentCreateRequest,
    AssignmentUpdateRequest,
    PortfolioSnapshotCreateRequest,
    PortfolioSnapshotOut,
    PositionCreateRequest,
    PositionUpdateRequest,
    StockHoldingCreateRequest,
    StockHoldingUpdateRequest,
    WeekCompleteRequest,
    WeekCreateRequest,
    WeekUpdateRequest,
)
