import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
engine = create_engine(os.getenv('DATABASE_URL'))
with engine.connect() as conn:
    res = conn.execute(text("SELECT count(*) FROM expenses WHERE supplier_id IS NULL")).fetchone()
    print("NULL SUPPLIERS:", res)
    res2 = conn.execute(text("SELECT count(*) FROM expenses")).fetchone()
    print("TOTAL EXPENSES:", res2)
