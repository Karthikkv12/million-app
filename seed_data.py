import sys
import os

# --- FIX: Tell Python where to look for the 'database' folder ---
# This adds the current folder to the system path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import random
from datetime import datetime, timedelta
from database.models import (
    get_engine, Trade, CashFlow, Budget,
    InstrumentType, Action, OptionType, CashAction, BudgetType
)
from sqlalchemy.orm import sessionmaker

# Setup DB Connection
engine = get_engine()
Session = sessionmaker(bind=engine)
session = Session()

def clear_data():
    """Wipes existing data so we don't have duplicates."""
    try:
        session.query(Trade).delete()
        session.query(CashFlow).delete()
        session.query(Budget).delete()
        session.commit()
        print("🧹 Old data cleared.")
    except Exception as e:
        print(f"⚠️ Warning during clear: {e}")
        session.rollback()

def create_fake_data():
    print("🌱 Seeding data...")
    
    # --- 1. CASH DEPOSITS ---
    dates = [datetime.now() - timedelta(days=180), datetime.now() - timedelta(days=60)]
    amounts = [50000, 10000]
    
    for d, amt in zip(dates, amounts):
        cf = CashFlow(action=CashAction.DEPOSIT, amount=amt, date=d, notes="Initial Transfer")
        session.add(cf)

    # --- 2. TRADES ---
    tickers = ["NVDA", "AAPL", "TSLA", "AMD", "MSFT", "AMZN"]
    for _ in range(15):
        days_ago = random.randint(1, 90)
        trade_date = datetime.now() - timedelta(days=days_ago)
        sym = random.choice(tickers)
        qty = random.randint(10, 100)
        price = random.uniform(100, 500)
        
        trade = Trade(
            symbol=sym, quantity=qty, instrument=InstrumentType.STOCK,
            strategy="Swing Trade", action=Action.BUY,
            entry_date=trade_date, entry_price=price
        )
        session.add(trade)

    # --- 3. BUDGET ---
    categories = {
        "Salary": (BudgetType.INCOME, 8500),
        "Rent": (BudgetType.EXPENSE, 2500),
        "Groceries": (BudgetType.EXPENSE, 600),
        "Utilities": (BudgetType.EXPENSE, 150),
        "Dining Out": (BudgetType.EXPENSE, 400),
        "Investments": (BudgetType.ASSET, 1000)
    }

    for i in range(3):
        month_date = datetime.now() - timedelta(days=30 * i)
        for cat, (b_type, amt) in categories.items():
            final_amt = amt * random.uniform(0.95, 1.05) if b_type == BudgetType.EXPENSE else amt
            b = Budget(
                category=cat, type=b_type, amount=round(final_amt, 2),
                date=month_date, description=f"Monthly {cat}"
            )
            session.add(b)

    session.commit()
    print("✅ SUCCESS: Database seeded with fake data!")

if __name__ == "__main__":
    clear_data()
    create_fake_data()