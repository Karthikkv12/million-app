import pandas as pd
from sqlalchemy.orm import sessionmaker
from database.models import (
    Trade, CashFlow, Budget, 
    InstrumentType, OptionType, Action, CashAction, BudgetType, 
    get_engine
)

engine = get_engine()
Session = sessionmaker(bind=engine)

def save_trade(symbol, instrument, strategy, action, qty, price, date, o_type=None, strike=None, expiry=None):
    session = Session()
    try:
        inst_enum = InstrumentType.OPTION if instrument == "Option" else InstrumentType.STOCK
        act_enum = Action.BUY if action == "Buy" else Action.SELL
        opt_enum = OptionType.CALL if o_type == "Call" else (OptionType.PUT if o_type == "Put" else None)
        
        new_trade = Trade(
            symbol=symbol.upper(), quantity=int(qty), instrument=inst_enum, strategy=strategy,
            action=act_enum, entry_date=pd.to_datetime(date), entry_price=float(price),
            option_type=opt_enum, strike_price=float(strike) if strike else None, 
            expiry_date=pd.to_datetime(expiry) if expiry else None
        )
        session.add(new_trade)
        session.commit()
    except Exception as e:
        raise e
    finally:
        session.close()

def save_cash(action, amount, date, notes):
    session = Session()
    try:
        new_cash = CashFlow(
            action=CashAction.DEPOSIT if action == "Deposit" else CashAction.WITHDRAW,
            amount=float(amount), date=pd.to_datetime(date), notes=notes
        )
        session.add(new_cash)
        session.commit()
    except Exception as e:
        raise e
    finally:
        session.close()

def save_budget(category, b_type, amount, date, desc):
    session = Session()
    try:
        try:
            type_enum = BudgetType[b_type.upper()]
        except:
            type_enum = BudgetType.EXPENSE
            
        new_item = Budget(
            category=category, type=type_enum, amount=float(amount), 
            date=pd.to_datetime(date), description=desc
        )
        session.add(new_item)
        session.commit()
    except Exception as e:
        raise e
    finally:
        session.close()

def load_data():
    try:
        trades = pd.read_sql("SELECT * FROM trades", engine)
        cash = pd.read_sql("SELECT * FROM cash_flow", engine)
        budget = pd.read_sql("SELECT * FROM budget", engine)
        
        if not trades.empty: trades['entry_date'] = pd.to_datetime(trades['entry_date'])
        if not cash.empty: cash['date'] = pd.to_datetime(cash['date'])
        if not budget.empty: budget['date'] = pd.to_datetime(budget['date'])
        
        return trades, cash, budget
    except Exception:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()
    
def delete_trade(trade_id):
    session = Session()
    try:
        # Find the trade by ID and delete it
        trade_to_delete = session.query(Trade).filter(Trade.id == trade_id).first()
        if trade_to_delete:
            session.delete(trade_to_delete)
            session.commit()
            return True
        return False
    except Exception as e:
        session.rollback()
        print(f"Error deleting trade: {e}")
        return False
    finally:
        session.close()
def update_trade(trade_id, symbol, strategy, action, qty, price, date):
    session = Session()
    try:
        trade = session.query(Trade).filter(Trade.id == trade_id).first()
        if trade:
            # Update fields
            trade.symbol = symbol.upper()
            trade.strategy = strategy
            trade.action = Action.BUY if action == "Buy" else Action.SELL
            trade.quantity = int(qty)
            trade.entry_price = float(price)
            trade.entry_date = pd.to_datetime(date)
            session.commit()
            return True
        return False
    except Exception as e:
        session.rollback()
        print(f"Error updating trade: {e}")
        return False
    finally:
        session.close()