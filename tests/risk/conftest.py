import pytest


@pytest.fixture(autouse=True)
def _fresh_holdings_cache():
    """risk.book caches holdings per user id; test databases reuse ids, so start and end every test clean."""
    from optionflow.modules.risk import book
    book.clear_cache()
    yield
    book.clear_cache()
