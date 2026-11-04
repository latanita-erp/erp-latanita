import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
engine = create_engine(os.getenv("DATABASE_URL"))

def run_migrations():
    with engine.begin() as conn:
        print("1. Migrando tabla cash...")
        conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS morning_ef NUMERIC DEFAULT 0;"))
        conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS morning_qr NUMERIC DEFAULT 0;"))
        conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS afternoon_ef NUMERIC DEFAULT 0;"))
        conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS afternoon_qr NUMERIC DEFAULT 0;"))

        print("2. Migrando tabla expenses (categorías contables)...")
        conn.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category_type VARCHAR(50) DEFAULT 'PROVEEDORES';"))
        conn.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS description TEXT NULL;"))
        conn.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT 'EFECTIVO';"))

        print("3. Creando tablas de Pagos a Proveedores Diferidos...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS supplier_debts (
                id SERIAL PRIMARY KEY,
                supplier_id INT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
                reception_date DATE NOT NULL,
                invoice_number VARCHAR(100),
                total_amount NUMERIC NOT NULL DEFAULT 0,
                paid_amount NUMERIC NOT NULL DEFAULT 0,
                balance NUMERIC NOT NULL DEFAULT 0,
                status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
                due_date DATE NULL,
                notes TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS supplier_debt_payments (
                id SERIAL PRIMARY KEY,
                debt_id INT NOT NULL REFERENCES supplier_debts(id) ON DELETE CASCADE,
                payment_date DATE NOT NULL,
                amount NUMERIC NOT NULL,
                payment_method VARCHAR(50) DEFAULT 'EFECTIVO',
                notes TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))

        print("4. Creando tabla de Vencimientos del Hogar...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS household_bills (
                id SERIAL PRIMARY KEY,
                concept VARCHAR(150) NOT NULL,
                category VARCHAR(50) NOT NULL DEFAULT 'SERVICIO',
                amount NUMERIC NOT NULL DEFAULT 0,
                due_date DATE NOT NULL,
                is_paid BOOLEAN NOT NULL DEFAULT FALSE,
                payment_date DATE NULL,
                notes TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))

        print("5. Creando tabla de configuraciones del sistema (Telegram, etc.)...")
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key VARCHAR(100) PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """))

        print("¡Todas las migraciones se aplicaron correctamente!")

if __name__ == "__main__":
    run_migrations()

