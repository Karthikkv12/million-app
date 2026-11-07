"""
Full ledger audit for all holdings (user_id=1).
Compares stored adj_basis vs what the PremiumLedger says it should be.
Also cross-checks ledger rows vs actual OptionPosition data.
"""
import sys
sys.path.insert(0, ".")

from logic.services import _portfolio_session
from database.models import StockHolding, PremiumLedger, OptionPosition, OptionPositionStatus

sess = _portfolio_session()

REALIZED_STATUSES = {
    OptionPositionStatus.CLOSED,
    OptionPositionStatus.EXPIRED,
    OptionPositionStatus.ASSIGNED,
    OptionPositionStatus.ROLLED,
}

holdings = (
    sess.query(StockHolding)
    .filter(StockHolding.user_id == 1)
    .order_by(StockHolding.symbol)
    .all()
)

print(f"{'SYM':<6} {'SH':>5} {'COST':>7} {'ADJ_DB':>8} {'REALIZED_LEDGER':>15} {'UNREALIZED_LEDGER':>17} {'EXPECTED_ADJ':>12} {'OK?':>5}")
print("-" * 80)

issues = []
ledger_vs_pos_issues = []

for h in holdings:
    ledger_rows = sess.query(PremiumLedger).filter(PremiumLedger.holding_id == h.id).all()
    total_realized   = sum(r.realized_premium   for r in ledger_rows)
    total_unrealized = sum(r.unrealized_premium for r in ledger_rows)

    if h.shares > 0:
        expected_adj = round(h.cost_basis - total_realized / h.shares, 4)
    else:
        expected_adj = round(h.cost_basis, 4)

    match = abs(expected_adj - h.adjusted_cost_basis) < 0.005
    flag = " OK" if match else " MISMATCH"
    if not match:
        issues.append((h.symbol, h.status, h.adjusted_cost_basis, expected_adj, total_realized, h.shares))

    print(f"{h.symbol:<6} {h.shares:>5.0f} {h.cost_basis:>7.2f} {h.adjusted_cost_basis:>8.4f} {total_realized:>15.2f} {total_unrealized:>17.2f} {expected_adj:>12.4f} {flag}")

    # Cross-check each ledger row vs the actual position
    for row in ledger_rows:
        pos = sess.query(OptionPosition).filter(OptionPosition.id == row.position_id).first()
        if pos is None:
            ledger_vs_pos_issues.append(f"  {h.symbol}: ledger row pos_id={row.position_id} has NO matching position!")
            continue

        # Recompute expected realized/unrealized from the position
        prem_in  = (pos.premium_in  or 0.0) * pos.contracts * 100
        prem_out = (pos.premium_out or 0.0) * pos.contracts * 100
        gross    = max(0.0, prem_in + prem_out)

        if pos.status in REALIZED_STATUSES:
            exp_realized   = round(gross, 4)
            exp_unrealized = 0.0
        else:
            exp_realized   = 0.0
            exp_unrealized = round(prem_in, 4)

        r_ok = abs(row.realized_premium   - exp_realized)   < 0.01
        u_ok = abs(row.unrealized_premium - exp_unrealized) < 0.01

        if not r_ok or not u_ok:
            ledger_vs_pos_issues.append(
                f"  {h.symbol} pos_id={pos.id} status={pos.status.value} "
                f"prem_in=${pos.premium_in} prem_out={pos.premium_out} contracts={pos.contracts} | "
                f"ledger realized={row.realized_premium} (expected {exp_realized}) "
                f"unrealized={row.unrealized_premium} (expected {exp_unrealized})"
            )

print()

if issues:
    print(f"ADJ BASIS MISMATCHES ({len(issues)}):")
    for sym, status, stored, expected, realized, shares in issues:
        diff = stored - expected
        print(f"  {sym} [{status}]: stored={stored:.4f}  expected={expected:.4f}  diff={diff:+.4f}  realized=${realized:.2f} / {shares:.0f} sh")
else:
    print("All adj bases match ledger. OK.")

print()

if ledger_vs_pos_issues:
    print(f"LEDGER vs POSITION MISMATCHES ({len(ledger_vs_pos_issues)}):")
    for msg in ledger_vs_pos_issues:
        print(msg)
else:
    print("All ledger rows match their positions. OK.")

sess.close()
