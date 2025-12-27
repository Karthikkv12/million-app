import pytest
from logic import services
from database.models import Action, InstrumentType, OptionType, CashAction, BudgetType


def test_normalize_action_variants():
    assert services.normalize_action('Buy') == Action.BUY
    assert services.normalize_action('BUY') == Action.BUY
    assert services.normalize_action('buy') == Action.BUY
    assert services.normalize_action('Sell') == Action.SELL
    assert services.normalize_action('SELL') == Action.SELL


def test_normalize_instrument_variants():
    assert services.normalize_instrument('Stock') == InstrumentType.STOCK
    assert services.normalize_instrument('stock') == InstrumentType.STOCK
    assert services.normalize_instrument('Option') == InstrumentType.OPTION
    assert services.normalize_instrument('option') == InstrumentType.OPTION


def test_normalize_option_type():
    assert services.normalize_option_type('Call') == OptionType.CALL
    assert services.normalize_option_type('call') == OptionType.CALL
    assert services.normalize_option_type('Put') == OptionType.PUT
    assert services.normalize_option_type(None) is None


def test_normalize_cash_action():
    assert services.normalize_cash_action('Deposit') == CashAction.DEPOSIT
    assert services.normalize_cash_action('deposit') == CashAction.DEPOSIT
    assert services.normalize_cash_action('Withdraw') == CashAction.WITHDRAW


def test_normalize_budget_type():
    assert services.normalize_budget_type('Expense') == BudgetType.EXPENSE
    assert services.normalize_budget_type('Income') == BudgetType.INCOME
    assert services.normalize_budget_type('Asset') == BudgetType.ASSET
