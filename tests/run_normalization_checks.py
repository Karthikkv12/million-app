from logic import services
from database.models import Action, InstrumentType, OptionType, CashAction, BudgetType


def run_checks():
    assert services.normalize_action('Buy') == Action.BUY
    assert services.normalize_action('BUY') == Action.BUY
    assert services.normalize_action('buy') == Action.BUY
    assert services.normalize_action('Sell') == Action.SELL

    assert services.normalize_instrument('Stock') == InstrumentType.STOCK
    assert services.normalize_instrument('stock') == InstrumentType.STOCK
    assert services.normalize_instrument('Option') == InstrumentType.OPTION

    assert services.normalize_option_type('Call') == OptionType.CALL
    assert services.normalize_option_type('call') == OptionType.CALL
    assert services.normalize_option_type('Put') == OptionType.PUT
    assert services.normalize_option_type(None) is None

    assert services.normalize_cash_action('Deposit') == CashAction.DEPOSIT
    assert services.normalize_cash_action('deposit') == CashAction.DEPOSIT
    assert services.normalize_cash_action('Withdraw') == CashAction.WITHDRAW

    assert services.normalize_budget_type('Expense') == BudgetType.EXPENSE
    assert services.normalize_budget_type('Income') == BudgetType.INCOME
    assert services.normalize_budget_type('Asset') == BudgetType.ASSET

    print('OK: All normalization checks passed')


if __name__ == '__main__':
    run_checks()
