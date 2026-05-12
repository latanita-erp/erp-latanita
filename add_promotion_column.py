import sqlalchemy
from sqlalchemy import create_engine, text

DB_URI = (
    "postgresql+pg8000://postgres.juzwfwgonamxyuvoxgbj:"
    "Latanita1198!@aws-1-sa-east-1.pooler.supabase.com:6543/postgres"
)
engine = create_engine(DB_URI, pool_pre_ping=True)

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE products ADD COLUMN promotion REAL DEFAULT 0.0"))
        conn.commit()
        print("Column 'promotion' added successfully.")
    except Exception as e:
        print("Error:", e)
