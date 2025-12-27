import traceback
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import models as dbmodels
from logic import services


def setup_inmemory_db():
    engine = create_engine('sqlite:///:memory:')
    Session = sessionmaker(bind=engine)
    dbmodels.Base.metadata.create_all(engine)
    services.engine = engine
    services.Session = Session


def run_module_tests():
    errors = []
    # normalization checks (no DB needed)
    try:
        import tests.test_services_normalization as ns
        ns.test_normalize_action_variants()
        ns.test_normalize_instrument_variants()
        ns.test_normalize_option_type()
        ns.test_normalize_cash_action()
        ns.test_normalize_budget_type()
        print('OK: normalization tests')
    except Exception:
        errors.append(traceback.format_exc())

    # DB-backed tests
    try:
        import tests.test_auth_and_isolation as ta
        # Use a fresh in-memory DB for these tests
        setup_inmemory_db()
        ta.test_create_and_auth((None, None))
        ta.test_per_user_isolation((None, None))
        print('OK: auth and isolation tests')
    except Exception:
        errors.append(traceback.format_exc())

    try:
        import tests.test_db_crud_pytest as td
        # Run CRUD tests on a fresh DB so prior tests don't interfere
        setup_inmemory_db()
        td.test_db_crud_roundtrip((None, None))
        print('OK: db crud pytest test')
    except Exception:
        errors.append(traceback.format_exc())

    if errors:
        print('\nFAILED TESTS:')
        for e in errors:
            print(e)
        raise SystemExit(1)
    print('\nALL CHECKS PASSED')


if __name__ == '__main__':
    setup_inmemory_db()
    run_module_tests()
