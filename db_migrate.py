import sqlalchemy
from sqlalchemy import create_engine, text
import urllib.parse

password = urllib.parse.quote_plus('Xeneize2531$')
# Try transaction pooler
# Try session pooler
# Try direct IPv6
uris = [
    f"postgresql+pg8000://postgres.juzwfwgonamxyuvoxgbj:{password}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
    f"postgresql+pg8000://postgres:{password}@db.juzwfwgonamxyuvoxgbj.supabase.co:5432/postgres",
]

for uri in uris:
    try:
        print(f"Trying {uri}")
        engine = create_engine(uri)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            print("SUCCESS!")
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS products(
                id SERIAL PRIMARY KEY,
                name TEXT,
                type TEXT,
                cost REAL,
                margin REAL,
                price_kg REAL,
                price_100g REAL,
                price_150g REAL,
                price_250g REAL
            )
            """))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS product_suppliers(
                id SERIAL PRIMARY KEY,
                product_id INTEGER,
                supplier_name TEXT,
                cost REAL
            )
            """))
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cash(
                id SERIAL PRIMARY KEY,
                date TEXT,
                weekday TEXT,
                cash REAL,
                card REAL,
                net_income REAL,
                expenses REAL,
                total REAL
            )
            """))
            conn.commit()
            print("Tables created!")
            break
    except Exception as e:
        print("FAILED:", str(e))
