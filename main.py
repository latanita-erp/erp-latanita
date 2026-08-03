# ============================================
#           CONFIGURACIÓN GENERAL
# ============================================

import os
import math
import datetime
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
            conn.execute(text("ALTER TABLE expenses ALTER COLUMN category_id DROP NOT NULL;"))
        except Exception as e:
            print("Migration info:", e)


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
    supplier_id: Optional[int] = None
    amount: float

class CashPayload(BaseModel):
    date: str
    weekday: str
    cash: float
    morning_sales: Optional[float] = 0.0
    afternoon_sales: Optional[float] = 0.0
    card: float
    expenses: Optional[float] = 0.0
    notes: Optional[str] = None
    expense_list: List[ExpenseItemPayload] = []

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
            id, date, weekday, cash, morning_sales, afternoon_sales, card, expenses, notes,
            (cash + card) AS net_income,
            (cash + card - expenses) AS total
        FROM cash
        ORDER BY date ASC
    """)).mappings().all()

    expenses_result = db.execute(text("""
        SELECT e.id, e.cash_id, e.supplier_id, e.amount, s.name as supplier_name 
        FROM expenses e JOIN suppliers s ON e.supplier_id = s.id
    """)).mappings().all()

    expenses_by_cash = defaultdict(list)
    for e in expenses_result:
        # Convert to dict and handle None supplier_id gracefully just in case
        d = dict(e)
        d["category_name"] = d.pop("supplier_name", "Desconocido") # Keep frontend compat or rename in frontend
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
    cash = payload.cash
    card = payload.card
    notes = payload.notes or ""

    if payload.expenses is not None and not payload.expense_list:
        total_expenses = payload.expenses
    else:
        total_expenses = sum([e.amount for e in payload.expense_list])

    net = cash + card
    total = net - total_expenses

    result = db.execute(text("""
        INSERT INTO cash (date, weekday, cash, morning_sales, afternoon_sales, card, expenses, notes, net_income, total)
        VALUES (:date, :weekday, :cash, :morning, :afternoon, :card, :expenses, :notes, :net, :total)
        RETURNING id
    """), {
        "date": date,
        "weekday": weekday,
        "cash": cash,
        "morning": payload.morning_sales,
        "afternoon": payload.afternoon_sales,
        "card": card,
        "expenses": total_expenses,
        "notes": notes,
        "net": net,
        "total": total
    })
    
    cash_id = result.scalar()

    for exp in payload.expense_list:
        if exp.supplier_id:
            db.execute(text("""
                INSERT INTO expenses (cash_id, supplier_id, amount)
                VALUES (:cid, :sup, :amt)
            """), {"cid": cash_id, "sup": exp.supplier_id, "amt": exp.amount})

    db.commit()
    return {"status": "created"}


@app.put("/api/cash/{cash_id}")
def update_cash(cash_id: int, payload: CashPayload, db: Session = Depends(get_db)):

    date = payload.date
    weekday = payload.weekday
    cash = payload.cash
    card = payload.card
    notes = payload.notes or ""

    if payload.expenses is not None and not payload.expense_list:
        total_expenses = payload.expenses
    else:
        total_expenses = sum([e.amount for e in payload.expense_list])

    net = cash + card
    total = net - total_expenses

    db.execute(text("""
        UPDATE cash
        SET 
            date = :date, weekday = :weekday,
            cash = :cash, morning_sales = :morning, afternoon_sales = :afternoon, card = :card, expenses = :expenses, notes = :notes,
            net_income = :net, total = :total
        WHERE id = :id
    """), {
        "id": cash_id,
        "date": date,
        "weekday": weekday,
        "cash": cash,
        "morning": payload.morning_sales,
        "afternoon": payload.afternoon_sales,
        "card": card,
        "expenses": total_expenses,
        "notes": notes,
        "net": net,
        "total": total
    })

    db.execute(text("DELETE FROM expenses WHERE cash_id = :id"), {"id": cash_id})
    for exp in payload.expense_list:
        if exp.supplier_id:
            db.execute(text("""
                INSERT INTO expenses (cash_id, supplier_id, amount)
                VALUES (:cid, :sup, :amt)
            """), {"cid": cash_id, "sup": exp.supplier_id, "amt": exp.amount})

    db.commit()
    return {"status": "updated"}


@app.delete("/api/cash/{cash_id}")
def delete_cash(cash_id: int, db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM expenses WHERE cash_id = :id"), {"id": cash_id})
    db.execute(text("DELETE FROM cash WHERE id = :id"), {"id": cash_id})
    db.commit()
    return {"status": "deleted"}

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
    
    cost = max(cost1, cost2, cost3, cost_matiz, cost_raices)
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


@app.put("/api/products/{product_id}")
def update_product(product_id: int, payload: ProductUpdatePayload, db: Session = Depends(get_db)):

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

    cost = max(cost1, cost2, cost3, cost_matiz, cost_raices)
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
