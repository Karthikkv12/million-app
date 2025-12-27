from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, create_engine, ForeignKey
from sqlalchemy.orm import declarative_base
import enum
from datetime import datetime

Base = declarative_base()

# --- ENUMS ---
class InstrumentType(enum.Enum):
    STOCK = "STOCK"
    OPTION = "OPTION"

class Action(enum.Enum):
    BUY = "BUY"
    SELL = "SELL"

class OptionType(enum.Enum):
    CALL = "CALL"
    PUT = "PUT"

class CashAction(enum.Enum):
    DEPOSIT = "DEPOSIT"
    WITHDRAW = "WITHDRAW"

class BudgetType(enum.Enum):
    EXPENSE = "EXPENSE"
    INCOME = "INCOME"
    ASSET = "ASSET"

# --- TABLES ---
class Trade(Base):
    __tablename__ = 'trades'
    id = Column(Integer, primary_key=True)
    symbol = Column(String)
    quantity = Column(Integer)
    instrument = Column(Enum(InstrumentType))
    strategy = Column(String)
    action = Column(Enum(Action))
    entry_date = Column(DateTime)
    entry_price = Column(Float)
    option_type = Column(Enum(OptionType), nullable=True)
    strike_price = Column(Float, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)

class CashFlow(Base):
    __tablename__ = 'cash_flow'
    id = Column(Integer, primary_key=True)
    action = Column(Enum(CashAction))
    amount = Column(Float)
    date = Column(DateTime)
    notes = Column(String)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)

class Budget(Base):
    __tablename__ = 'budget'
    id = Column(Integer, primary_key=True)
    category = Column(String)
    type = Column(Enum(BudgetType))
    amount = Column(Float)
    date = Column(DateTime)
    description = Column(String)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    salt = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

# Database Connection Setup
def get_engine():
    return create_engine("sqlite:///trading_journal.db")

def init_db():
    engine = get_engine()
    Base.metadata.create_all(engine)
    return engine