"""optionflow/modules/catalyst/router.py — GET /catalyst/{symbol} (HTTP only)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from optionflow.core import errors
from optionflow.core.deps import get_current_user
from optionflow.modules.catalyst import service
from optionflow.modules.catalyst.schemas import CatalystsOut

router = APIRouter(prefix="/catalyst", tags=["catalyst"])


@router.get("/{symbol}", response_model=CatalystsOut)
def catalyst(symbol: str, _user=Depends(get_current_user)) -> CatalystsOut:
    """Upcoming catalysts for one stock (cached 10 minutes)."""
    try:
        return service.get_catalysts(symbol)
    except ValueError:
        raise errors.BadRequest("Invalid symbol")
    except LookupError:
        raise errors.NotFound(f"No data found for {symbol.upper()}")
