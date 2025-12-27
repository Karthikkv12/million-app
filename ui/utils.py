def canonical_action(val):
    s = str(val).strip()
    return 'Buy' if s.upper().startswith('B') else 'Sell'


def canonical_instrument(val):
    s = str(val).strip()
    return 'Option' if s.upper().startswith('OPT') else 'Stock'


def canonical_budget_type(val):
    s = str(val).strip()
    up = s.upper()
    if 'INCOM' in up:
        return 'Income'
    if 'ASSET' in up:
        return 'Asset'
    return 'Expense'
