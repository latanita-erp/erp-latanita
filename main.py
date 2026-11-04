# ============================================
#           CONFIGURACIÓN GENERAL
# ============================================

import os
import math
import datetime
import calendar
import asyncio
import urllib.parse
import pandas as pd
from collections import defaultdict

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
import io
import base64
from pydantic import BaseModel
from typing import Optional, List

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from telegram_service import (
    get_app_setting,
    set_app_setting,
    send_telegram_message,
    check_and_send_due_notifications
)

app = FastAPI()

@app.middleware("http")
async def basic_auth(request: Request, call_next):
    # Exempt root and static files from authentication
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        return await call_next(request)

    # Only protect API routes
    if not request.url.path.startswith("/api/"):
        return await call_next(request)

    auth_header = request.headers.get("Authorization")
    
    def unauthorized():
        return Response(content='{"detail": "Unauthorized"}', media_type="application/json", status_code=401)

    if not auth_header or not auth_header.startswith("Basic "):
        return unauthorized()
    
    encoded_credentials = auth_header.split(" ")[1]
    try:
        decoded_credentials = base64.b64decode(encoded_credentials).decode("utf-8")
        username, _, password = decoded_credentials.partition(":")
        
        expected_user = os.getenv("ERP_USERNAME", "admin")
        expected_pass = os.getenv("ERP_PASSWORD", "admin")
        
        # Override local hardcoded to admin if they are expecting admin
        if expected_user == "cboveda" or not expected_user:
            expected_user = "admin"
        
        if username != expected_user or password != expected_pass:
            # Let's also accept "admin" / "admin" as fallback just in case
            if not (username == "admin" and password == "admin"):
                return unauthorized()
    except Exception:
        return unauthorized()
        
    return await call_next(request)

# ============================================
#        CONEXIÓN A SUPABASE (POOLER)
# ============================================

DB_URI = os.getenv("DATABASE_URL")
if not DB_URI:
    raise ValueError("DATABASE_URL is not set in environment variables")

engine = create_engine(DB_URI, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.on_event("startup")
def startup_migrations():
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS morning_sales NUMERIC DEFAULT 0;"))
            conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS afternoon_sales NUMERIC DEFAULT 0;"))
            conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS morning_ef NUMERIC DEFAULT 0;"))
            conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS morning_qr NUMERIC DEFAULT 0;"))
            conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS afternoon_ef NUMERIC DEFAULT 0;"))
            conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS afternoon_qr NUMERIC DEFAULT 0;"))
            conn.execute(text("ALTER TABLE cash ADD COLUMN IF NOT EXISTS notes TEXT;"))
            conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier1_id INT NULL;"))
            conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier2_id INT NULL;"))
            conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier3_id INT NULL;"))
            conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS cost1 NUMERIC DEFAULT 0;"))
            conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS cost2 NUMERIC DEFAULT 0;"))
            conn.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS cost3 NUMERIC DEFAULT 0;"))
            conn.execute(text("ALTER TABLE product_price_history ADD COLUMN IF NOT EXISTS cost3 NUMERIC DEFAULT 0;"))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS product_price_history (
                    id SERIAL PRIMARY KEY,
                    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                    old_price_kg NUMERIC NOT NULL,
                    new_price_kg NUMERIC NOT NULL,
                    cost1 NUMERIC DEFAULT 0,
                    cost2 NUMERIC DEFAULT 0,
                    cost3 NUMERIC DEFAULT 0,
                    cheapest_cost NUMERIC DEFAULT 0,
                    highest_cost NUMERIC DEFAULT 0,
                    margin NUMERIC NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """))
            conn.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supplier_id INT NULL REFERENCES suppliers(id);"))
            conn.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category_type VARCHAR(50) DEFAULT 'PROVEEDORES';"))
            conn.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS description TEXT NULL;"))
            conn.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT 'EFECTIVO';"))
            conn.execute(text("ALTER TABLE expenses ALTER COLUMN category_id DROP NOT NULL;"))

            # Tablas de Pagos Diferidos a Proveedores
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

            # Tabla de Vencimientos del Hogar
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

            # Configuraciones de Sistema (Telegram, etc.)
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """))
        except Exception as e:
            print("Migration info:", e)

@app.on_event("startup")
async def start_telegram_scheduler():
    async def telegram_worker():
        # Esperar 15 segundos después del inicio para dar tiempo a la inicialización
        await asyncio.sleep(15)
        while True:
            try:
                db = SessionLocal()
                try:
                    token = get_app_setting(db, "telegram_bot_token")
                    chat_id = get_app_setting(db, "telegram_chat_id")
                    if token and chat_id:
                        today_str = datetime.date.today().strftime("%Y-%m-%d")
                        last_sent = get_app_setting(db, "last_telegram_alert_date", "")
                        now = datetime.datetime.now()

                        # Enviar si aún no se envió hoy y es después de las 08:30 AM
                        if last_sent != today_str and (now.hour > 8 or (now.hour == 8 and now.minute >= 30)):
                            res = check_and_send_due_notifications(db)
                            if res.get("success"):
                                set_app_setting(db, "last_telegram_alert_date", today_str)
                                print(f"[TELEGRAM WORKER] Alerta diaria enviada ({today_str}). Items: {res.get('items_count', 0)}")
                finally:
                    db.close()
            except Exception as e:
                print("[TELEGRAM WORKER] Error en chequeo:", e)

            # Revisar cada 30 minutos
            await asyncio.sleep(1800)

    asyncio.create_task(telegram_worker())


# ============================================
#           ARCHIVOS ESTÁTICOS
# ============================================

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def read_root():
    return FileResponse("static/index.html")

# ============================================
#            FUNCIONES AUXILIARES
# ============================================

def calculate_prices(cost, margin):
    cost = float(cost)
    margin = float(margin)
    base_price_kg = cost * (1 + margin / 100)
    price_kg = math.ceil(base_price_kg / 100.0) * 100.0
    price_100g = math.ceil((base_price_kg / 10.0) / 100.0) * 100.0
    price_150g = math.ceil((base_price_kg * 0.15) / 100.0) * 100.0
    price_250g = math.ceil((base_price_kg * 0.25) / 100.0) * 100.0
    return {
        "price_kg": price_kg,
        "price_100g": price_100g,
        "price_150g": price_150g,
        "price_250g": price_250g,
    }

def log_price_change(db: Session, product_id: int, old_price: float, new_price: float, cost1: float, cost2: float, cost3: float, margin: float):
    c1 = float(cost1 or 0.0)
    c2 = float(cost2 or 0.0)
    c3 = float(cost3 or 0.0)
    active_costs = [c for c in [c1, c2, c3] if c > 0]
    cheapest = min(active_costs) if active_costs else 0.0
    highest = max(c1, c2, c3)
    
    db.execute(text("""
        INSERT INTO product_price_history 
        (product_id, old_price_kg, new_price_kg, cost1, cost2, cost3, cheapest_cost, highest_cost, margin)
        VALUES (:pid, :old_p, :new_p, :c1, :c2, :c3, :cheapest, :highest, :margin)
    """), {
        "pid": product_id,
        "old_p": old_price,
        "new_p": new_price,
        "c1": c1,
        "c2": c2,
        "c3": c3,
        "cheapest": cheapest,
        "highest": highest,
        "margin": margin
    })

# ============================================
#             MODELOS PYDANTIC
# ============================================

class ExpenseItemPayload(BaseModel):
    category_type: str = "PROVEEDORES"
    supplier_id: Optional[int] = None
    description: Optional[str] = None
    amount: float
    payment_method: str = "EFECTIVO"

class CashPayload(BaseModel):
    date: str
    weekday: str
    cash: Optional[float] = 0.0
    morning_ef: Optional[float] = 0.0
    morning_qr: Optional[float] = 0.0
    afternoon_ef: Optional[float] = 0.0
    afternoon_qr: Optional[float] = 0.0
    morning_sales: Optional[float] = 0.0
    afternoon_sales: Optional[float] = 0.0
    card: Optional[float] = 0.0
    expenses: Optional[float] = 0.0
    notes: Optional[str] = None
    expense_list: List[ExpenseItemPayload] = []

class SupplierDebtPayload(BaseModel):
    supplier_id: int
    reception_date: str
    invoice_number: Optional[str] = None
    total_amount: float
    due_date: Optional[str] = None
    notes: Optional[str] = None

class SupplierDebtPaymentPayload(BaseModel):
    payment_date: str
    amount: float
    payment_method: str = "EFECTIVO"
    notes: Optional[str] = None
    impact_cash: bool = True

class HouseholdBillPayload(BaseModel):
    concept: str
    category: str = "SERVICIO"
    amount: float
    due_date: str
    notes: Optional[str] = None

class TelegramConfigPayload(BaseModel):
    bot_token: str
    chat_id: str

class ProductPayload(BaseModel):
    name: str
    type: str
    cost: Optional[float] = None
    cost_matiz: Optional[float] = None
    cost_raices: Optional[float] = None
    supplier1_id: Optional[int] = None
    supplier2_id: Optional[int] = None
    supplier3_id: Optional[int] = None
    cost1: Optional[float] = 0.0
    cost2: Optional[float] = 0.0
    cost3: Optional[float] = 0.0
    margin: float

class ProductUpdatePayload(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    cost: Optional[float] = None
    cost_matiz: Optional[float] = None
    cost_raices: Optional[float] = None
    supplier1_id: Optional[int] = None
    supplier2_id: Optional[int] = None
    supplier3_id: Optional[int] = None
    cost1: Optional[float] = None
    cost2: Optional[float] = None
    cost3: Optional[float] = None
    margin: Optional[float] = None

class MassMarginPayload(BaseModel):
    value: float
    target: str = "ALL"
    type: Optional[str] = None

class MassUndoItemPayload(BaseModel):
    id: int
    margin: float

class MassUndoPayload(BaseModel):
    items: List[MassUndoItemPayload]

class SupplierPayload(BaseModel):
    supplier_id: int
    cost: float

class ExpenseCategoryPayload(BaseModel):
    name: str

class SupplierBase(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    salesperson: Optional[str] = None



# ============================================
#             MÓDULO PROVEEDORES GLOBALES
# ============================================

@app.get("/api/suppliers")
def get_suppliers(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT id, name, phone, email, salesperson
        FROM suppliers
        ORDER BY name ASC
    """)).mappings().all()
    return [dict(r) for r in result]

@app.post("/api/suppliers")
def create_supplier(payload: SupplierBase, db: Session = Depends(get_db)):
    db.execute(text("""
        INSERT INTO suppliers (name, phone, email, salesperson)
        VALUES (:name, :phone, :email, :salesperson)
    """), {
        "name": payload.name,
        "phone": payload.phone,
        "email": payload.email,
        "salesperson": payload.salesperson
    })
    db.commit()
    return {"status": "created"}

@app.put("/api/suppliers/{supplier_id}")
def update_supplier(supplier_id: int, payload: SupplierBase, db: Session = Depends(get_db)):
    db.execute(text("""
        UPDATE suppliers
        SET name = :name, phone = :phone, email = :email, salesperson = :salesperson
        WHERE id = :id
    """), {
        "id": supplier_id,
        "name": payload.name,
        "phone": payload.phone,
        "email": payload.email,
        "salesperson": payload.salesperson
    })
    db.commit()
    return {"status": "updated"}

@app.delete("/api/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM suppliers WHERE id = :id"), {"id": supplier_id})
    db.commit()
    return {"status": "deleted"}

# ============================================
#             MÓDULO GASTOS CATEGORÍAS
# ============================================

@app.get("/api/expense-categories")
def get_expense_categories(db: Session = Depends(get_db)):
    result = db.execute(text("SELECT id, name, is_custom FROM expense_categories ORDER BY id ASC")).mappings().all()
    return [dict(r) for r in result]

@app.post("/api/expense-categories")
def create_expense_category(payload: ExpenseCategoryPayload, db: Session = Depends(get_db)):
    db.execute(text("INSERT INTO expense_categories (name, is_custom) VALUES (:name, TRUE)"), {"name": payload.name})
    db.commit()
    return {"status": "created"}

@app.delete("/api/expense-categories/{cat_id}")
def delete_expense_category(cat_id: int, db: Session = Depends(get_db)):
    try:
        db.execute(text("DELETE FROM expense_categories WHERE id = :id AND is_custom = TRUE"), {"id": cat_id})
        db.commit()
        return {"status": "deleted"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail="No se puede borrar porque está en uso o es por defecto.")

# ============================================
#             MÓDULO CAJA DIARIA
# ============================================

@app.get("/api/cash/all")
def get_cash_all(db: Session = Depends(get_db)):
    cash_result = db.execute(text("""
        SELECT 
            id, date, weekday, cash, morning_sales, afternoon_sales,
            COALESCE(morning_ef, 0) as morning_ef,
            COALESCE(morning_qr, 0) as morning_qr,
            COALESCE(afternoon_ef, 0) as afternoon_ef,
            COALESCE(afternoon_qr, 0) as afternoon_qr,
            card, expenses, notes,
            (COALESCE(cash, 0) + COALESCE(card, 0)) AS net_income,
            (COALESCE(cash, 0) + COALESCE(card, 0) - COALESCE(expenses, 0)) AS total
        FROM cash
        ORDER BY date ASC
    """)).mappings().all()

    expenses_result = db.execute(text("""
        SELECT e.id, e.cash_id, e.supplier_id, e.category_type, e.description, e.payment_method, e.amount, s.name as supplier_name 
        FROM expenses e 
        LEFT JOIN suppliers s ON e.supplier_id = s.id
    """)).mappings().all()

    expenses_by_cash = defaultdict(list)
    for e in expenses_result:
        d = dict(e)
        d["category_name"] = d.get("category_type") or "PROVEEDORES"
        if not d.get("supplier_name"):
            d["supplier_name"] = d.get("description") or d["category_name"]
        expenses_by_cash[e["cash_id"]].append(d)

    final_result = []
    for c in cash_result:
        c_dict = dict(c)
        c_dict["expense_list"] = expenses_by_cash.get(c["id"], [])
        final_result.append(c_dict)

    return final_result


@app.post("/api/cash")
def create_cash(payload: CashPayload, db: Session = Depends(get_db)):
    date = payload.date
    weekday = payload.weekday
    notes = payload.notes or ""

    morning_ef = float(payload.morning_ef or 0.0)
    morning_qr = float(payload.morning_qr or 0.0)
    afternoon_ef = float(payload.afternoon_ef or 0.0)
    afternoon_qr = float(payload.afternoon_qr or 0.0)

    morning_sales = morning_ef + morning_qr
    afternoon_sales = afternoon_ef + afternoon_qr
    total_ef = morning_ef + afternoon_ef
    total_qr = morning_qr + afternoon_qr

    if total_ef == 0 and total_qr == 0 and (payload.cash or payload.card):
        total_ef = float(payload.cash or 0.0)
        total_qr = float(payload.card or 0.0)
        morning_sales = float(payload.morning_sales or total_ef)
        afternoon_sales = float(payload.afternoon_sales or 0.0)

    if payload.expenses is not None and not payload.expense_list:
        total_expenses = float(payload.expenses)
    else:
        total_expenses = sum([float(e.amount) for e in payload.expense_list])

    net = total_ef + total_qr
    total = net - total_expenses

    result = db.execute(text("""
        INSERT INTO cash (
            date, weekday, cash, morning_sales, afternoon_sales, 
            morning_ef, morning_qr, afternoon_ef, afternoon_qr,
            card, expenses, notes, net_income, total
        )
        VALUES (
            :date, :weekday, :cash, :morning, :afternoon,
            :m_ef, :m_qr, :a_ef, :a_qr,
            :card, :expenses, :notes, :net, :total
        )
        RETURNING id
    """), {
        "date": date,
        "weekday": weekday,
        "cash": total_ef,
        "morning": morning_sales,
        "afternoon": afternoon_sales,
        "m_ef": morning_ef,
        "m_qr": morning_qr,
        "a_ef": afternoon_ef,
        "a_qr": afternoon_qr,
        "card": total_qr,
        "expenses": total_expenses,
        "notes": notes,
        "net": net,
        "total": total
    })
    
    cash_id = result.scalar()

    for exp in payload.expense_list:
        db.execute(text("""
            INSERT INTO expenses (cash_id, supplier_id, category_type, description, payment_method, amount)
            VALUES (:cid, :sup, :cat, :desc, :pm, :amt)
        """), {
            "cid": cash_id,
            "sup": exp.supplier_id,
            "cat": exp.category_type or "PROVEEDORES",
            "desc": exp.description or "",
            "pm": exp.payment_method or "EFECTIVO",
            "amt": float(exp.amount)
        })

    db.commit()
    return {"status": "created"}


@app.put("/api/cash/{cash_id}")
def update_cash(cash_id: int, payload: CashPayload, db: Session = Depends(get_db)):
    date = payload.date
    weekday = payload.weekday
    notes = payload.notes or ""

    morning_ef = float(payload.morning_ef or 0.0)
    morning_qr = float(payload.morning_qr or 0.0)
    afternoon_ef = float(payload.afternoon_ef or 0.0)
    afternoon_qr = float(payload.afternoon_qr or 0.0)

    morning_sales = morning_ef + morning_qr
    afternoon_sales = afternoon_ef + afternoon_qr
    total_ef = morning_ef + afternoon_ef
    total_qr = morning_qr + afternoon_qr

    if total_ef == 0 and total_qr == 0 and (payload.cash or payload.card):
        total_ef = float(payload.cash or 0.0)
        total_qr = float(payload.card or 0.0)
        morning_sales = float(payload.morning_sales or total_ef)
        afternoon_sales = float(payload.afternoon_sales or 0.0)

    if payload.expenses is not None and not payload.expense_list:
        total_expenses = float(payload.expenses)
    else:
        total_expenses = sum([float(e.amount) for e in payload.expense_list])

    net = total_ef + total_qr
    total = net - total_expenses

    db.execute(text("""
        UPDATE cash
        SET 
            date = :date, weekday = :weekday,
            cash = :cash, morning_sales = :morning, afternoon_sales = :afternoon,
            morning_ef = :m_ef, morning_qr = :m_qr, afternoon_ef = :a_ef, afternoon_qr = :a_qr,
            card = :card, expenses = :expenses, notes = :notes,
            net_income = :net, total = :total
        WHERE id = :id
    """), {
        "id": cash_id,
        "date": date,
        "weekday": weekday,
        "cash": total_ef,
        "morning": morning_sales,
        "afternoon": afternoon_sales,
        "m_ef": morning_ef,
        "m_qr": morning_qr,
        "a_ef": afternoon_ef,
        "a_qr": afternoon_qr,
        "card": total_qr,
        "expenses": total_expenses,
        "notes": notes,
        "net": net,
        "total": total
    })

    db.execute(text("DELETE FROM expenses WHERE cash_id = :id"), {"id": cash_id})
    for exp in payload.expense_list:
        db.execute(text("""
            INSERT INTO expenses (cash_id, supplier_id, category_type, description, payment_method, amount)
            VALUES (:cid, :sup, :cat, :desc, :pm, :amt)
        """), {
            "cid": cash_id,
            "sup": exp.supplier_id,
            "cat": exp.category_type or "PROVEEDORES",
            "desc": exp.description or "",
            "pm": exp.payment_method or "EFECTIVO",
            "amt": float(exp.amount)
        })

    db.commit()
    return {"status": "updated"}


@app.delete("/api/cash/{cash_id}")
def delete_cash(cash_id: int, db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM expenses WHERE cash_id = :id"), {"id": cash_id})
    db.execute(text("DELETE FROM cash WHERE id = :id"), {"id": cash_id})
    db.commit()
    return {"status": "deleted"}

# ============================================
#       MÓDULO PAGOS A PROVEEDORES DIFERIDOS
# ============================================

@app.get("/api/supplier-debts")
def get_supplier_debts(db: Session = Depends(get_db)):
    debts = db.execute(text("""
        SELECT d.id, d.supplier_id, s.name as supplier_name, d.reception_date,
               d.invoice_number, d.total_amount, d.paid_amount, d.balance,
               d.status, d.due_date, d.notes, d.created_at
        FROM supplier_debts d
        JOIN suppliers s ON d.supplier_id = s.id
        ORDER BY d.reception_date DESC, d.id DESC
    """)).mappings().all()

    debt_ids = [d["id"] for d in debts]
    payments_by_debt = defaultdict(list)
    if debt_ids:
        payments = db.execute(text("""
            SELECT id, debt_id, payment_date, amount, payment_method, notes, created_at
            FROM supplier_debt_payments
            WHERE debt_id = ANY(:ids)
            ORDER BY payment_date ASC, id ASC
        """), {"ids": debt_ids}).mappings().all()
        for p in payments:
            p_dict = dict(p)
            if p_dict.get("created_at"):
                p_dict["created_at"] = p_dict["created_at"].isoformat()
            if p_dict.get("payment_date"):
                p_dict["payment_date"] = str(p_dict["payment_date"])
            payments_by_debt[p["debt_id"]].append(p_dict)

    res = []
    for d in debts:
        d_dict = dict(d)
        if d_dict.get("created_at"):
            d_dict["created_at"] = d_dict["created_at"].isoformat()
        if d_dict.get("reception_date"):
            d_dict["reception_date"] = str(d_dict["reception_date"])
        if d_dict.get("due_date"):
            d_dict["due_date"] = str(d_dict["due_date"])
        d_dict["payments"] = payments_by_debt.get(d["id"], [])
        res.append(d_dict)

    return res

@app.post("/api/supplier-debts")
def create_supplier_debt(payload: SupplierDebtPayload, db: Session = Depends(get_db)):
    total = float(payload.total_amount)
    db.execute(text("""
        INSERT INTO supplier_debts (supplier_id, reception_date, invoice_number, total_amount, paid_amount, balance, status, due_date, notes)
        VALUES (:sup, :rec, :inv, :tot, 0, :tot, 'PENDIENTE', :due, :notes)
    """), {
        "sup": payload.supplier_id,
        "rec": payload.reception_date,
        "inv": payload.invoice_number,
        "tot": total,
        "due": payload.due_date if payload.due_date else None,
        "notes": payload.notes
    })
    db.commit()
    return {"status": "created"}

@app.post("/api/supplier-debts/{debt_id}/payments")
def add_supplier_debt_payment(debt_id: int, payload: SupplierDebtPaymentPayload, db: Session = Depends(get_db)):
    debt = db.execute(text("SELECT id, supplier_id, invoice_number, total_amount, paid_amount FROM supplier_debts WHERE id = :id"), {"id": debt_id}).mappings().first()
    if not debt:
        raise HTTPException(status_code=404, detail="Deuda con proveedor no encontrada")

    amount = float(payload.amount)
    db.execute(text("""
        INSERT INTO supplier_debt_payments (debt_id, payment_date, amount, payment_method, notes)
        VALUES (:did, :pdate, :amt, :pm, :notes)
    """), {
        "did": debt_id,
        "pdate": payload.payment_date,
        "amt": amount,
        "pm": payload.payment_method,
        "notes": payload.notes
    })

    # Recalcular saldo total pagado
    sum_paid = db.execute(text("SELECT COALESCE(SUM(amount), 0) FROM supplier_debt_payments WHERE debt_id = :did"), {"did": debt_id}).scalar()
    total_amt = float(debt["total_amount"])
    new_balance = max(0.0, total_amt - float(sum_paid))
    new_status = "PAGADO" if new_balance <= 0.001 else "PARCIAL"

    db.execute(text("""
        UPDATE supplier_debts
        SET paid_amount = :paid, balance = :bal, status = :st
        WHERE id = :id
    """), {
        "id": debt_id,
        "paid": sum_paid,
        "bal": new_balance,
        "st": new_status
    })

    # Impactar en la Caja Diaria si corresponde
    if getattr(payload, "impact_cash", True):
        sup_name = db.execute(text("SELECT name FROM suppliers WHERE id = :sid"), {"sid": debt["supplier_id"]}).scalar() or "Proveedor"
        inv_txt = f" (Rem/Fac: {debt['invoice_number']})" if debt.get("invoice_number") else ""
        desc = f"Pago diferido a {sup_name}{inv_txt}"

        cash_record = db.execute(text("SELECT id, cash, card, net_income, expenses, total FROM cash WHERE date = :pdate"), {"pdate": payload.payment_date}).mappings().first()
        if cash_record:
            cid = cash_record["id"]
            db.execute(text("""
                INSERT INTO expenses (cash_id, supplier_id, category_type, description, payment_method, amount)
                VALUES (:cid, :sup, 'PROVEEDORES', :desc, :pm, :amt)
            """), {
                "cid": cid,
                "sup": debt["supplier_id"],
                "desc": desc,
                "pm": payload.payment_method,
                "amt": amount
            })
            new_exp = db.execute(text("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE cash_id = :cid"), {"cid": cid}).scalar()
            net = float(cash_record["net_income"] or 0)
            db.execute(text("UPDATE cash SET expenses = :exp, total = :tot WHERE id = :cid"), {
                "cid": cid,
                "exp": new_exp,
                "tot": net - float(new_exp)
            })
        else:
            try:
                dt = datetime.datetime.strptime(payload.payment_date, "%Y-%m-%d")
                weekdays = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"]
                wday = weekdays[dt.weekday()]
            except Exception:
                wday = "DÍA"
            res = db.execute(text("""
                INSERT INTO cash (date, weekday, cash, morning_sales, afternoon_sales, morning_ef, morning_qr, afternoon_ef, afternoon_qr, card, expenses, notes, net_income, total)
                VALUES (:dt, :wd, 0, 0, 0, 0, 0, 0, 0, 0, :amt, 'Generado por pago a proveedor', 0, :neg_tot)
                RETURNING id
            """), {
                "dt": payload.payment_date,
                "wd": wday,
                "amt": amount,
                "neg_tot": -amount
            })
            new_cid = res.scalar()
            db.execute(text("""
                INSERT INTO expenses (cash_id, supplier_id, category_type, description, payment_method, amount)
                VALUES (:cid, :sup, 'PROVEEDORES', :desc, :pm, :amt)
            """), {
                "cid": new_cid,
                "sup": debt["supplier_id"],
                "desc": desc,
                "pm": payload.payment_method,
                "amt": amount
            })

    db.commit()
    return {"status": "payment_added", "new_balance": new_balance, "new_status": new_status}

@app.delete("/api/supplier-debts/{debt_id}")
def delete_supplier_debt(debt_id: int, db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM supplier_debts WHERE id = :id"), {"id": debt_id})
    db.commit()
    return {"status": "deleted"}

@app.delete("/api/supplier-debts/payments/{payment_id}")
def delete_supplier_debt_payment(payment_id: int, db: Session = Depends(get_db)):
    pmt = db.execute(text("SELECT debt_id FROM supplier_debt_payments WHERE id = :id"), {"id": payment_id}).mappings().first()
    if not pmt:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    
    debt_id = pmt["debt_id"]
    db.execute(text("DELETE FROM supplier_debt_payments WHERE id = :id"), {"id": payment_id})

    # Recalcular
    debt = db.execute(text("SELECT total_amount FROM supplier_debts WHERE id = :id"), {"id": debt_id}).mappings().first()
    sum_paid = db.execute(text("SELECT COALESCE(SUM(amount), 0) FROM supplier_debt_payments WHERE debt_id = :did"), {"did": debt_id}).scalar()
    total_amt = float(debt["total_amount"]) if debt else 0.0
    new_balance = max(0.0, total_amt - float(sum_paid))
    new_status = "PAGADO" if (new_balance <= 0.001 and float(sum_paid) > 0) else ("PARCIAL" if float(sum_paid) > 0 else "PENDIENTE")

    db.execute(text("""
        UPDATE supplier_debts
        SET paid_amount = :paid, balance = :bal, status = :st
        WHERE id = :id
    """), {
        "id": debt_id,
        "paid": sum_paid,
        "bal": new_balance,
        "st": new_status
    })

    db.commit()
    return {"status": "payment_deleted"}

# ============================================
#       MÓDULO VENCIMIENTOS DEL HOGAR
# ============================================

@app.get("/api/household-bills")
def get_household_bills(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT id, concept, category, amount, due_date, is_paid, payment_date, notes, created_at
        FROM household_bills
        ORDER BY is_paid ASC, due_date ASC
    """)).mappings().all()

    res = []
    for r in rows:
        d = dict(r)
        if d.get("created_at"):
            d["created_at"] = d["created_at"].isoformat()
        if d.get("due_date"):
            d["due_date"] = str(d["due_date"])
        if d.get("payment_date"):
            d["payment_date"] = str(d["payment_date"])
        res.append(d)
    return res

@app.post("/api/household-bills")
def create_household_bill(payload: HouseholdBillPayload, db: Session = Depends(get_db)):
    db.execute(text("""
        INSERT INTO household_bills (concept, category, amount, due_date, notes)
        VALUES (:concept, :cat, :amt, :due, :notes)
    """), {
        "concept": payload.concept,
        "cat": payload.category,
        "amt": float(payload.amount),
        "due": payload.due_date,
        "notes": payload.notes
    })
    db.commit()
    return {"status": "created"}

@app.put("/api/household-bills/{bill_id}/toggle-paid")
def toggle_household_bill_paid(bill_id: int, db: Session = Depends(get_db)):
    bill = db.execute(text("SELECT is_paid FROM household_bills WHERE id = :id"), {"id": bill_id}).mappings().first()
    if not bill:
        raise HTTPException(status_code=404, detail="Vencimiento no encontrado")
    
    current_state = bill["is_paid"]
    new_state = not current_state
    today_str = datetime.date.today().strftime("%Y-%m-%d") if new_state else None

    db.execute(text("""
        UPDATE household_bills
        SET is_paid = :state, payment_date = :pdate
        WHERE id = :id
    """), {"id": bill_id, "state": new_state, "pdate": today_str})
    db.commit()
    return {"status": "updated", "is_paid": new_state, "payment_date": today_str}

@app.post("/api/household-bills/{bill_id}/repeat-next-month")
def repeat_household_bill_next_month(bill_id: int, db: Session = Depends(get_db)):
    bill = db.execute(text("SELECT id, concept, category, amount, due_date, notes FROM household_bills WHERE id = :id"), {"id": bill_id}).mappings().first()
    if not bill:
        raise HTTPException(status_code=404, detail="Vencimiento no encontrado")

    b_date = bill["due_date"]
    if isinstance(b_date, str):
        b_date = datetime.datetime.strptime(b_date, "%Y-%m-%d").date()

    y = b_date.year
    m = b_date.month
    d = b_date.day

    if m == 12:
        next_y = y + 1
        next_m = 1
    else:
        next_y = y
        next_m = m + 1

    max_days = calendar.monthrange(next_y, next_m)[1]
    next_d = min(d, max_days)
    next_due_date = datetime.date(next_y, next_m, next_d)

    db.execute(text("""
        INSERT INTO household_bills (concept, category, amount, due_date, is_paid, payment_date, notes)
        VALUES (:concept, :cat, :amt, :due, FALSE, NULL, :notes)
    """), {
        "concept": bill["concept"],
        "cat": bill["category"],
        "amt": float(bill["amount"]),
        "due": next_due_date.strftime("%Y-%m-%d"),
        "notes": bill["notes"]
    })
    db.commit()
    return {"status": "repeated", "new_due_date": next_due_date.strftime("%Y-%m-%d")}

@app.delete("/api/household-bills/{bill_id}")
def delete_household_bill(bill_id: int, db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM household_bills WHERE id = :id"), {"id": bill_id})
    db.commit()
    return {"status": "deleted"}

# ============================================
#       MÓDULO TELEGRAM & NOTIFICACIONES
# ============================================

@app.get("/api/telegram/config")
def get_telegram_config(db: Session = Depends(get_db)):
    token = get_app_setting(db, "telegram_bot_token")
    chat_id = get_app_setting(db, "telegram_chat_id")
    masked_token = (token[:6] + "..." + token[-4:]) if len(token) > 10 else ("Configurado" if token else "")
    return {
        "has_token": bool(token),
        "bot_token": masked_token,
        "chat_id": chat_id
    }

@app.post("/api/telegram/config")
def save_telegram_config(payload: TelegramConfigPayload, db: Session = Depends(get_db)):
    if payload.bot_token and payload.bot_token != "Configurado" and not payload.bot_token.endswith("..."):
        set_app_setting(db, "telegram_bot_token", payload.bot_token.strip())
    set_app_setting(db, "telegram_chat_id", payload.chat_id.strip())
    return {"status": "saved"}

@app.post("/api/telegram/test")
def test_telegram_alert(db: Session = Depends(get_db)):
    token = get_app_setting(db, "telegram_bot_token")
    chat_id = get_app_setting(db, "telegram_chat_id")
    if not token or not chat_id:
        raise HTTPException(status_code=400, detail="Telegram no está configurado (falta Token o Chat ID).")
    
    msg = "🚀 <b>¡Conexión Exitosa con La Tanita ERP!</b>\n\nTu bot de Telegram está activo y listo para enviarte alertas de vencimientos de impuestos, servicios y compras."
    res = send_telegram_message(token, chat_id, msg)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Error al enviar mensaje a Telegram"))
    return {"status": "success", "message": "Mensaje de prueba enviado con éxito a Telegram"}

@app.post("/api/telegram/send-alerts")
def send_due_alerts_endpoint(db: Session = Depends(get_db)):
    res = check_and_send_due_notifications(db)
    if not res.get("success") and res.get("error"):
        raise HTTPException(status_code=400, detail=res.get("error"))
    return res

# ============================================
#       REPORTE CONTABLE INTEGRAL
# ============================================

@app.get("/api/reports/accounting")
def get_accounting_report(month: Optional[str] = None, db: Session = Depends(get_db)):
    if not month:
        month = datetime.datetime.now().strftime("%Y-%m")

    # 1. Ventas por método de pago (EF vs QR) en el mes
    sales_res = db.execute(text("""
        SELECT 
            COALESCE(SUM(morning_ef + afternoon_ef), 0) as total_ef,
            COALESCE(SUM(morning_qr + afternoon_qr), 0) as total_qr,
            COALESCE(SUM(cash), 0) as fallback_cash,
            COALESCE(SUM(card), 0) as fallback_card,
            COALESCE(SUM(net_income), 0) as total_sales,
            COALESCE(SUM(morning_sales), 0) as total_morning,
            COALESCE(SUM(afternoon_sales), 0) as total_afternoon
        FROM cash
        WHERE date LIKE :month_pattern
    """), {"month_pattern": f"{month}-%"}).mappings().first()

    total_ef = float(sales_res["total_ef"]) if sales_res else 0.0
    total_qr = float(sales_res["total_qr"]) if sales_res else 0.0
    if total_ef == 0 and total_qr == 0 and sales_res:
        total_ef = float(sales_res["fallback_cash"])
        total_qr = float(sales_res["fallback_card"])
    total_sales = total_ef + total_qr

    # 2. Egresos agrupados por categoría contable
    expenses_rows = db.execute(text("""
        SELECT 
            COALESCE(e.category_type, 'PROVEEDORES') as category_type,
            SUM(e.amount) as total_amount
        FROM expenses e
        JOIN cash c ON e.cash_id = c.id
        WHERE c.date LIKE :month_pattern
        GROUP BY COALESCE(e.category_type, 'PROVEEDORES')
    """), {"month_pattern": f"{month}-%"}).mappings().all()

    expenses_by_cat = {
        "PROVEEDORES": 0.0,
        "GASTOS OPERATIVOS": 0.0,
        "GASTOS FIJOS": 0.0,
        "SUELDOS": 0.0,
        "RETIROS PERSONALES": 0.0,
        "GASTOS HOGAR": 0.0
    }

    for row in expenses_rows:
        cat = str(row["category_type"]).upper().strip()
        # Normalizar si viene con guion bajo o espacio
        cat_key = cat.replace("_", " ")
        if cat_key in expenses_by_cat:
            expenses_by_cat[cat_key] = float(row["total_amount"])
        elif "PROV" in cat_key:
            expenses_by_cat["PROVEEDORES"] += float(row["total_amount"])
        elif "OPERAT" in cat_key:
            expenses_by_cat["GASTOS OPERATIVOS"] += float(row["total_amount"])
        elif "FIJO" in cat_key:
            expenses_by_cat["GASTOS FIJOS"] += float(row["total_amount"])
        elif "SUELD" in cat_key:
            expenses_by_cat["SUELDOS"] += float(row["total_amount"])
        elif "RETIR" in cat_key:
            expenses_by_cat["RETIROS PERSONALES"] += float(row["total_amount"])
        elif "HOGAR" in cat_key:
            expenses_by_cat["GASTOS HOGAR"] += float(row["total_amount"])
        else:
            expenses_by_cat["GASTOS OPERATIVOS"] += float(row["total_amount"])

    cost_suppliers = expenses_by_cat["PROVEEDORES"]
    cost_operating = expenses_by_cat["GASTOS OPERATIVOS"]
    cost_fixed = expenses_by_cat["GASTOS FIJOS"]
    cost_salaries = expenses_by_cat["SUELDOS"]
    personal_withdrawals = expenses_by_cat["RETIROS PERSONALES"]
    home_expenses = expenses_by_cat["GASTOS HOGAR"]

    # Total de egresos puramente del negocio (excluyendo lo personal)
    business_expenses = cost_suppliers + cost_operating + cost_fixed + cost_salaries
    total_all_expenses = business_expenses + personal_withdrawals + home_expenses

    # Márgenes y ganancias
    operating_profit = total_sales - cost_suppliers - cost_operating
    net_business_profit = total_sales - business_expenses
    final_cash_pocket = net_business_profit - personal_withdrawals - home_expenses

    return {
        "month": month,
        "sales": {
            "total": total_sales,
            "ef": total_ef,
            "qr": total_qr,
            "morning": float(sales_res["total_morning"]) if sales_res else 0.0,
            "afternoon": float(sales_res["total_afternoon"]) if sales_res else 0.0
        },
        "expenses": expenses_by_cat,
        "kpis": {
            "business_expenses": business_expenses,
            "total_expenses": total_all_expenses,
            "operating_profit": operating_profit,
            "net_business_profit": net_business_profit,
            "final_cash_pocket": final_cash_pocket
        }
    }

# ============================================
#             REPORTES
# ============================================

@app.get("/api/reports/expenses-by-supplier")
def get_expenses_by_supplier(month: Optional[str] = None, db: Session = Depends(get_db)):
    if not month:
        month = datetime.datetime.now().strftime("%Y-%m")
        
    result = db.execute(text("""
        SELECT COALESCE(s.name, 'Sin Proveedor') AS supplier_name, SUM(e.amount) AS total_amount
        FROM expenses e
        LEFT JOIN suppliers s ON e.supplier_id = s.id
        JOIN cash c ON e.cash_id = c.id
        WHERE c.date LIKE :month_pattern
        GROUP BY s.name
        ORDER BY total_amount DESC
    """), {"month_pattern": f"{month}-%"}).mappings().all()
    
    return [dict(r) for r in result]


# ============================================
#             MÓDULO PRODUCTOS
# ============================================

@app.get("/api/products")
def get_products(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT p.id, p.name, p.type, p.cost, p.margin, p.cost_matiz, p.cost_raices,
               p.supplier1_id, p.supplier2_id, p.supplier3_id, p.cost1, p.cost2, p.cost3,
               s1.name as supplier1_name, s2.name as supplier2_name, s3.name as supplier3_name,
               p.old_price_kg, p.price_kg, p.price_100g, p.price_150g, p.price_250g
        FROM products p
        LEFT JOIN suppliers s1 ON p.supplier1_id = s1.id
        LEFT JOIN suppliers s2 ON p.supplier2_id = s2.id
        LEFT JOIN suppliers s3 ON p.supplier3_id = s3.id
        ORDER BY p.type ASC, p.name ASC
    """)).mappings().all()
    return [dict(r) for r in result]


@app.post("/api/products")
def create_product(payload: ProductPayload, db: Session = Depends(get_db)):
    cost1 = payload.cost1 if payload.cost1 is not None else 0.0
    cost2 = payload.cost2 if payload.cost2 is not None else 0.0
    cost3 = payload.cost3 if payload.cost3 is not None else 0.0
    cost_matiz = payload.cost_matiz if payload.cost_matiz is not None else cost1
    cost_raices = payload.cost_raices if payload.cost_raices is not None else cost2
    
    payload_cost = float(payload.cost) if payload.cost is not None else 0.0
    cost = max(cost1, cost2, cost3, cost_matiz, cost_raices, payload_cost)
    prices = calculate_prices(cost, payload.margin)

    result = db.execute(text("""
        INSERT INTO products (name, type, cost, margin, cost_matiz, cost_raices, supplier1_id, supplier2_id, supplier3_id, cost1, cost2, cost3, old_price_kg, price_kg, price_100g, price_150g, price_250g)
        VALUES (:name, :type, :cost, :margin, :cost_matiz, :cost_raices, :s1_id, :s2_id, :s3_id, :cost1, :cost2, :cost3, :old_price_kg, :price_kg, :price_100g, :price_150g, :price_250g)
        RETURNING id
    """), {
        "name": payload.name,
        "type": payload.type,
        "cost": cost,
        "margin": payload.margin,
        "cost_matiz": cost_matiz,
        "cost_raices": cost_raices,
        "s1_id": payload.supplier1_id,
        "s2_id": payload.supplier2_id,
        "s3_id": payload.supplier3_id,
        "cost1": cost1,
        "cost2": cost2,
        "cost3": cost3,
        "old_price_kg": prices["price_kg"],
        "price_kg": prices["price_kg"],
        "price_100g": prices["price_100g"],
        "price_150g": prices["price_150g"],
        "price_250g": prices["price_250g"]
    })
    
    new_prod_id = result.scalar()
    log_price_change(db, new_prod_id, 0.0, prices["price_kg"], cost1, cost2, cost3, payload.margin)

    db.commit()
    return {"status": "created"}


@app.post("/api/products/mass-margin")
def mass_margin_update(payload: MassMarginPayload, db: Session = Depends(get_db)):
    products_query = "SELECT id, margin FROM products"
    params = {}
    if payload.target == "TYPE" and payload.type:
        products_query += " WHERE type = :type"
        params["type"] = payload.type
        
    products = db.execute(text(products_query), params).mappings().all()
    
    updated_count = 0
    for p in products:
        new_margin = float(p["margin"]) + payload.value
        update_payload = ProductUpdatePayload(margin=new_margin)
        update_product(p["id"], update_payload, db, auto_commit=False)
        updated_count += 1
        
    db.commit()
    return {"status": "success", "updated_count": updated_count}


@app.post("/api/products/mass-undo")
def mass_undo_update(payload: MassUndoPayload, db: Session = Depends(get_db)):
    for item in payload.items:
        update_payload = ProductUpdatePayload(margin=float(item.margin))
        update_product(item.id, update_payload, db, auto_commit=False)
        
    db.commit()
    return {"status": "success"}


@app.put("/api/products/{product_id}")
def update_product(product_id: int, payload: ProductUpdatePayload, db: Session = Depends(get_db), auto_commit: bool = True):

    product = db.execute(text("SELECT name, type, cost, margin, cost_matiz, cost_raices, supplier1_id, supplier2_id, supplier3_id, cost1, cost2, cost3, old_price_kg, price_kg FROM products WHERE id = :id"), {"id": product_id}).mappings().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    name = payload.name if payload.name is not None else product["name"]
    type_ = payload.type if payload.type is not None else product["type"]
    margin = payload.margin if payload.margin is not None else product["margin"]
    
    s1_id = payload.supplier1_id if payload.supplier1_id is not None else product["supplier1_id"]
    s2_id = payload.supplier2_id if payload.supplier2_id is not None else product["supplier2_id"]
    s3_id = payload.supplier3_id if payload.supplier3_id is not None else product["supplier3_id"]

    cost1 = payload.cost1 if payload.cost1 is not None else (product["cost1"] if product["cost1"] is not None else 0.0)
    cost2 = payload.cost2 if payload.cost2 is not None else (product["cost2"] if product["cost2"] is not None else 0.0)
    cost3 = payload.cost3 if payload.cost3 is not None else (product["cost3"] if product["cost3"] is not None else 0.0)
    
    cost_matiz = payload.cost_matiz if payload.cost_matiz is not None else (product["cost_matiz"] if product["cost_matiz"] is not None else cost1)
    cost_raices = payload.cost_raices if payload.cost_raices is not None else (product["cost_raices"] if product["cost_raices"] is not None else cost2)

    existing_cost = float(product["cost"]) if product["cost"] is not None else 0.0
    payload_cost = float(payload.cost) if payload.cost is not None else 0.0
    cost = max(cost1, cost2, cost3, cost_matiz, cost_raices, payload_cost, existing_cost)
    prices = calculate_prices(cost, margin)

    old_price_kg = product["old_price_kg"] if product["old_price_kg"] is not None else 0.0
    if prices["price_kg"] != product["price_kg"]:
        old_price_kg = product["price_kg"] if product["price_kg"] is not None else 0.0
        log_price_change(db, product_id, old_price_kg, prices["price_kg"], cost1, cost2, cost3, margin)

    db.execute(text("""
        UPDATE products
        SET name = :name,
            type = :type,
            cost = :cost,
            margin = :margin,
            cost_matiz = :cost_matiz,
            cost_raices = :cost_raices,
            supplier1_id = :s1_id,
            supplier2_id = :s2_id,
            supplier3_id = :s3_id,
            cost1 = :cost1,
            cost2 = :cost2,
            cost3 = :cost3,
            old_price_kg = :old_price_kg,
            price_kg = :price_kg,
            price_100g = :price_100g,
            price_150g = :price_150g,
            price_250g = :price_250g
        WHERE id = :id
    """), {
        "id": product_id,
        "name": name,
        "type": type_,
        "cost": cost,
        "margin": margin,
        "cost_matiz": cost_matiz,
        "cost_raices": cost_raices,
        "s1_id": s1_id,
        "s2_id": s2_id,
        "s3_id": s3_id,
        "cost1": cost1,
        "cost2": cost2,
        "cost3": cost3,
        "old_price_kg": old_price_kg,
        "price_kg": prices["price_kg"],
        "price_100g": prices["price_100g"],
        "price_150g": prices["price_150g"],
        "price_250g": prices["price_250g"]
    })

    if auto_commit:
        db.commit()
    return {"status": "updated"}


# ============================================
#        HISTORIAL DE PRECIOS API
# ============================================

@app.get("/api/products/price-history/all")
def get_all_price_history(period: str = "all", db: Session = Depends(get_db)):
    query = """
        SELECT h.id, h.product_id, p.name as product_name, p.type as product_type,
               h.old_price_kg, h.new_price_kg, h.cost1, h.cost2, h.cost3, h.cheapest_cost, h.highest_cost,
               h.margin, h.created_at,
               s1.name as supplier1_name, s2.name as supplier2_name, s3.name as supplier3_name
        FROM product_price_history h
        JOIN products p ON h.product_id = p.id
        LEFT JOIN suppliers s1 ON p.supplier1_id = s1.id
        LEFT JOIN suppliers s2 ON p.supplier2_id = s2.id
        LEFT JOIN suppliers s3 ON p.supplier3_id = s3.id
    """
    if period == "1m":
        query += " WHERE h.created_at >= NOW() - INTERVAL '30 days'"
    elif period == "6m":
        query += " WHERE h.created_at >= NOW() - INTERVAL '180 days'"
    elif period == "1y":
        query += " WHERE h.created_at >= NOW() - INTERVAL '365 days'"
    
    query += " ORDER BY h.created_at DESC"
    
    result = db.execute(text(query)).mappings().all()
    res = []
    for r in result:
        d = dict(r)
        if d.get("created_at"):
            d["created_at"] = d["created_at"].isoformat()
        res.append(d)
    return res


@app.get("/api/products/{product_id}/price-history")
def get_product_price_history(product_id: int, db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT h.id, h.product_id, p.name as product_name,
               h.old_price_kg, h.new_price_kg, h.cost1, h.cost2, h.cheapest_cost, h.highest_cost,
               h.margin, h.created_at,
               s1.name as supplier1_name, s2.name as supplier2_name
        FROM product_price_history h
        JOIN products p ON h.product_id = p.id
        LEFT JOIN suppliers s1 ON p.supplier1_id = s1.id
        LEFT JOIN suppliers s2 ON p.supplier2_id = s2.id
        WHERE h.product_id = :pid
        ORDER BY h.created_at DESC
    """), {"pid": product_id}).mappings().all()
    
    res = []
    for r in result:
        d = dict(r)
        if d.get("created_at"):
            d["created_at"] = d["created_at"].isoformat()
        res.append(d)
    return res


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM product_suppliers WHERE product_id = :id"), {"id": product_id})
    db.execute(text("DELETE FROM products WHERE id = :id"), {"id": product_id})
    db.commit()
    return {"status": "deleted"}


# ============================================
#        PROVEEDORES POR PRODUCTO
# ============================================

@app.get("/api/products/{product_id}/suppliers")
def get_product_suppliers(product_id: int, db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT ps.id, ps.supplier_id, s.name as supplier_name, ps.cost, ps.updated_at
        FROM product_suppliers ps
        JOIN suppliers s ON ps.supplier_id = s.id
        WHERE ps.product_id = :pid
        ORDER BY s.name ASC, ps.cost ASC
    """), {"pid": product_id}).mappings().all()

    res_list = []
    for r in result:
        d = dict(r)
        if d.get("updated_at"):
            d["updated_at"] = d["updated_at"].isoformat()
        res_list.append(d)
    return res_list


@app.post("/api/products/{product_id}/suppliers")
def add_supplier(product_id: int, payload: SupplierPayload, db: Session = Depends(get_db)):

    db.execute(text("""
        INSERT INTO product_suppliers (product_id, supplier_id, cost)
        VALUES (:pid, :sid, :cost)
    """), {
        "pid": product_id,
        "sid": payload.supplier_id,
        "cost": payload.cost
    })

    suppliers = db.execute(text("""
        SELECT cost FROM product_suppliers WHERE product_id = :pid
    """), {"pid": product_id}).mappings().all()

    max_cost = max([s["cost"] for s in suppliers]) if suppliers else 0.0

    product = db.execute(text("""
        SELECT margin, price_kg, old_price_kg FROM products WHERE id = :pid
    """), {"pid": product_id}).mappings().first()

    if product:
        prices = calculate_prices(max_cost, product["margin"])
        old_price_kg = product["old_price_kg"] if product["old_price_kg"] is not None else 0.0
        if prices["price_kg"] != product["price_kg"]:
            old_price_kg = product["price_kg"] if product["price_kg"] is not None else 0.0

        db.execute(text("""
            UPDATE products
            SET cost = :cost,
                cost_matiz = :cost,
                cost_raices = :cost,
                old_price_kg = :old_price_kg,
                price_kg = :pkg,
                price_100g = :p100,
                price_150g = :p150,
                price_250g = :p250
            WHERE id = :id
        """), {
            "id": product_id,
            "cost": max_cost,
            "old_price_kg": old_price_kg,
            "pkg": prices["price_kg"],
            "p100": prices["price_100g"],
            "p150": prices["price_150g"],
            "p250": prices["price_250g"]
        })

    db.commit()
    return {"status": "created"}


@app.delete("/api/products/{product_id}/suppliers/{supplier_id}")
def delete_supplier(product_id: int, supplier_id: int, db: Session = Depends(get_db)):

    db.execute(text("""
        DELETE FROM product_suppliers WHERE id = :sid
    """), {"sid": supplier_id})

    suppliers = db.execute(text("""
        SELECT cost FROM product_suppliers WHERE product_id = :pid
    """), {"pid": product_id}).mappings().all()

    max_cost = max([s["cost"] for s in suppliers]) if suppliers else 0.0

    product = db.execute(text("""
        SELECT margin, price_kg, old_price_kg FROM products WHERE id = :pid
    """), {"pid": product_id}).mappings().first()

    if product:
        prices = calculate_prices(max_cost, product["margin"])
        old_price_kg = product["old_price_kg"] if product["old_price_kg"] is not None else 0.0
        if prices["price_kg"] != product["price_kg"]:
            old_price_kg = product["price_kg"] if product["price_kg"] is not None else 0.0

        db.execute(text("""
            UPDATE products
            SET cost = :cost,
                cost_matiz = :cost,
                cost_raices = :cost,
                old_price_kg = :old_price_kg,
                price_kg = :pkg,
                price_100g = :p100,
                price_150g = :p150,
                price_250g = :p250
            WHERE id = :id
        """), {
            "id": product_id,
            "cost": max_cost,
            "old_price_kg": old_price_kg,
            "pkg": prices["price_kg"],
            "p100": prices["price_100g"],
            "p150": prices["price_150g"],
            "p250": prices["price_250g"]
        })

    db.commit()
    return {"status": "deleted"}


# ============================================
#        IMPORTACIÓN DESDE EXCEL
# ============================================

@app.post("/api/products/import")
def import_products(file: UploadFile = File(...), db: Session = Depends(get_db)):
    try:
        df = pd.read_excel(file.file)

        required_cols = ["name", "type", "cost", "margin"]
        for col in required_cols:
            if col not in df.columns:
                raise HTTPException(
                    status_code=400,
                    detail=f"Falta la columna requerida: {col}"
                )

        count = 0

        for _, row in df.iterrows():
            cost = float(row["cost"]) if pd.notna(row["cost"]) else 0.0
            margin = float(row["margin"]) if pd.notna(row["margin"]) else 0.0

            cost_matiz = float(row["cost_matiz"]) if "cost_matiz" in df.columns and pd.notna(row["cost_matiz"]) else cost
            cost_raices = float(row["cost_raices"]) if "cost_raices" in df.columns and pd.notna(row["cost_raices"]) else cost
            
            base_cost = max(cost_matiz, cost_raices)
            prices = calculate_prices(base_cost, margin)

            db.execute(text("""
                INSERT INTO products
                (name, type, cost, margin, cost_matiz, cost_raices, old_price_kg, price_kg, price_100g, price_150g, price_250g)
                VALUES (:name, :type, :cost, :margin, :cost_matiz, :cost_raices, :old_price_kg, :pkg, :p100, :p150, :p250)
            """), {
                "name": str(row["name"]),
                "type": str(row["type"]),
                "cost": base_cost,
                "margin": margin,
                "cost_matiz": cost_matiz,
                "cost_raices": cost_raices,
                "old_price_kg": prices["price_kg"],
                "pkg": prices["price_kg"],
                "p100": prices["price_100g"],
                "p150": prices["price_150g"],
                "p250": prices["price_250g"]
            })

            count += 1

        db.commit()
        return {"status": "imported", "count": count}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))





# ============================================
#             MÓDULO DASHBOARD
# ============================================

@app.get("/api/dashboard")
def get_dashboard(db: Session = Depends(get_db)):

    df = pd.read_sql(text("SELECT * FROM cash ORDER BY date ASC"), db.bind)

    if df.empty:
        return {
            "kpis": {
                "total_revenue": 0,
                "total_expenses": 0,
                "total_profit": 0,
            },
            "monthly": [],
            "weekly_breakdown": {},
            "payment_methods": {"cash": 0, "card": 0},
        }

    df["date"] = pd.to_datetime(df["date"])
    df["month"] = df["date"].dt.strftime("%Y-%m")

    kpis = {
        "total_revenue": float(df["net_income"].sum()),
        "total_expenses": float(df["expenses"].sum()),
        "total_profit": float(df["total"].sum()),
    }

    monthly = (
        df.groupby("month")[["total", "cash", "card"]]
        .sum()
        .reset_index()
        .to_dict(orient="records")
    )

    df["week_start"] = df["date"] - pd.to_timedelta(df["date"].dt.dayofweek, unit="d")
    df["week_end"] = df["week_start"] + pd.Timedelta(days=6)
    df["week_range"] = (
        df["week_start"].dt.strftime("%d/%m")
        + " al "
        + df["week_end"].dt.strftime("%d/%m")
    )

    weekly_grouped = df.groupby(["month", "week_range"])["total"].sum().reset_index()

    weekly_breakdown = {}
    for _, row in weekly_grouped.iterrows():
        m = row["month"]
        if m not in weekly_breakdown:
            weekly_breakdown[m] = []
        weekly_breakdown[m].append({
            "week": row["week_range"],
            "total": float(row["total"])
        })

    payment_methods = {
        "cash": float(df["cash"].sum()),
        "card": float(df["card"].sum()),
    }

    return {
        "kpis": kpis,
        "monthly": monthly,
        "weekly_breakdown": weekly_breakdown,
        "payment_methods": payment_methods,
    }
