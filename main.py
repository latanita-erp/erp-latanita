import pandas as pd
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import math
import urllib.parse
from sqlalchemy import create_engine, text

app = FastAPI()

password = urllib.parse.quote_plus('Xeneize2531$')
DB_URI = f"postgresql+pg8000://postgres.juzwfwgonamxyuvoxgbj:{password}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"


engine = create_engine(DB_URI, pool_pre_ping=True)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def read_root():
    return FileResponse("static/index.html")

# --- API MODELS ---
class Product(BaseModel):
    name: str
    type: str = ""
    cost: float = 0.0
    margin: float = 0.0

class Supplier(BaseModel):
    supplier_name: str
    cost: float

class CashRecord(BaseModel):
    date: str
    weekday: str
    cash: float = 0.0
    card: float = 0.0
    expenses: float = 0.0

class CashUpdate(BaseModel):
    cash: float
    card: float
    expenses: float

class Login(BaseModel):
    username: str
    password: str

# --- API ENDPOINTS ---

@app.post("/api/login")
def login(data: Login):
    if data.username == "cboveda" and data.password == "Xeneize1198$":
        return {"success": True, "token": "fake-jwt-token-123"}
    raise HTTPException(status_code=401, detail="Credenciales incorrectas")

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
        "price_250g": price_250g
    }

@app.get("/api/products")
def get_products():
    with engine.connect() as conn:
        res = conn.execute(text("SELECT * FROM products ORDER BY id DESC")).mappings().all()
        return [dict(r) for r in res]

@app.post("/api/products")
def create_product(p: Product):
    prices = calculate_prices(p.cost, p.margin)
    with engine.connect() as conn:
        res = conn.execute(
            text("INSERT INTO products (name, type, cost, margin, price_kg, price_100g, price_150g, price_250g) VALUES (:name, :type, :cost, :margin, :pkg, :p100, :p150, :p250) RETURNING id"),
            {"name": p.name, "type": p.type, "cost": p.cost, "margin": p.margin, "pkg": prices['price_kg'], "p100": prices['price_100g'], "p150": prices['price_150g'], "p250": prices['price_250g']}
        )
        conn.commit()
        return {"success": True, "id": res.scalar()}

@app.delete("/api/products/{id}")
def delete_product(id: int):
    with engine.connect() as conn:
        conn.execute(text("DELETE FROM products WHERE id=:id"), {"id": id})
        conn.execute(text("DELETE FROM product_suppliers WHERE product_id=:id"), {"id": id})
        conn.commit()
    return {"success": True}

@app.get("/api/products/{id}/suppliers")
def get_product_suppliers(id: int):
    with engine.connect() as conn:
        res = conn.execute(text("SELECT * FROM product_suppliers WHERE product_id=:id"), {"id": id}).mappings().all()
        return [dict(r) for r in res]

@app.post("/api/products/{id}/suppliers")
def add_supplier(id: int, s: Supplier):
    with engine.connect() as conn:
        conn.execute(text("INSERT INTO product_suppliers (product_id, supplier_name, cost) VALUES (:id, :name, :cost)"), {"id": id, "name": s.supplier_name, "cost": s.cost})
        
        suppliers = conn.execute(text("SELECT cost FROM product_suppliers WHERE product_id=:id"), {"id": id}).mappings().all()
        max_cost = max([sup['cost'] for sup in suppliers]) if suppliers else 0.0
        
        product = conn.execute(text("SELECT margin FROM products WHERE id=:id"), {"id": id}).mappings().first()
        if product:
            prices = calculate_prices(max_cost, product['margin'])
            conn.execute(text("""
                UPDATE products 
                SET cost=:cost, price_kg=:pkg, price_100g=:p100, price_150g=:p150, price_250g=:p250 
                WHERE id=:id
            """), {"cost": max_cost, "pkg": prices['price_kg'], "p100": prices['price_100g'], "p150": prices['price_150g'], "p250": prices['price_250g'], "id": id})
            
        conn.commit()
    return {"success": True}

@app.delete("/api/products/{product_id}/suppliers/{supplier_id}")
def delete_supplier(product_id: int, supplier_id: int):
    with engine.connect() as conn:
        conn.execute(text("DELETE FROM product_suppliers WHERE id=:sid"), {"sid": supplier_id})
        
        suppliers = conn.execute(text("SELECT cost FROM product_suppliers WHERE product_id=:pid"), {"pid": product_id}).mappings().all()
        
        product = conn.execute(text("SELECT margin, cost FROM products WHERE id=:pid"), {"pid": product_id}).mappings().first()
        if product:
            max_cost = max([s['cost'] for s in suppliers]) if suppliers else 0.0
            prices = calculate_prices(max_cost, product['margin'])
            conn.execute(text("""
                UPDATE products 
                SET cost=:cost, price_kg=:pkg, price_100g=:p100, price_150g=:p150, price_250g=:p250 
                WHERE id=:id
            """), {"cost": max_cost, "pkg": prices['price_kg'], "p100": prices['price_100g'], "p150": prices['price_150g'], "p250": prices['price_250g'], "id": product_id})
            
        conn.commit()
    return {"success": True}

@app.post("/api/products/import")
def import_products(file: UploadFile = File(...)):
    try:
        df = pd.read_excel(file.file)
        required_cols = ["Nombre", "Tipo", "Costo", "Margen"]
        for col in required_cols:
            if col not in df.columns:
                raise HTTPException(status_code=400, detail=f"Falta la columna requerida: {col}")
                
        with engine.connect() as conn:
            count = 0
            for _, row in df.iterrows():
                cost = float(row['Costo']) if pd.notna(row['Costo']) else 0.0
                margin = float(row['Margen']) if pd.notna(row['Margen']) else 0.0
                prices = calculate_prices(cost, margin)
                
                conn.execute(
                    text("INSERT INTO products (name, type, cost, margin, price_kg, price_100g, price_150g, price_250g) VALUES (:name, :type, :cost, :margin, :pkg, :p100, :p150, :p250)"),
                    {"name": str(row['Nombre']), "type": str(row['Tipo']), "cost": cost, "margin": margin, "pkg": prices['price_kg'], "p100": prices['price_100g'], "p150": prices['price_150g'], "p250": prices['price_250g']}
                )
                count += 1
            conn.commit()
        return {"success": True, "imported_count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cash")
def get_cash():
    with engine.connect() as conn:
        res = conn.execute(text("SELECT * FROM cash ORDER BY date DESC LIMIT 100")).mappings().all()
        return [dict(r) for r in res]

@app.post("/api/cash")
def create_cash(c: CashRecord):
    net = c.cash + c.card
    total = net - c.expenses
    with engine.connect() as conn:
        conn.execute(
            text("INSERT INTO cash (date, weekday, cash, card, net_income, expenses, total) VALUES (:date, :weekday, :cash, :card, :net, :expenses, :total)"),
            {"date": c.date, "weekday": c.weekday, "cash": c.cash, "card": c.card, "net": net, "expenses": c.expenses, "total": total}
        )
        conn.commit()
    return {"success": True}

@app.put("/api/cash/{id}")
def update_cash(id: int, c: CashUpdate):
    net = c.cash + c.card
    total = net - c.expenses
    with engine.connect() as conn:
        conn.execute(
            text("UPDATE cash SET cash=:cash, card=:card, net_income=:net, expenses=:expenses, total=:total WHERE id=:id"),
            {"cash": c.cash, "card": c.card, "net": net, "expenses": c.expenses, "total": total, "id": id}
        )
        conn.commit()
    return {"success": True}

@app.delete("/api/cash/{id}")
def delete_cash(id: int):
    with engine.connect() as conn:
        conn.execute(text("DELETE FROM cash WHERE id=:id"), {"id": id})
        conn.commit()
    return {"success": True}

@app.get("/api/dashboard")
def get_dashboard():
    with engine.connect() as conn:
        df = pd.read_sql(text("SELECT * FROM cash"), conn)
    
    if df.empty:
        return {
            "kpis": {"total_revenue": 0, "total_expenses": 0, "total_profit": 0},
            "monthly": [],
            "weekly_breakdown": {},
            "payment_methods": {"cash": 0, "card": 0}
        }
        
    df["date"] = pd.to_datetime(df["date"])
    
    kpis = {
        "total_revenue": float(df["net_income"].sum()),
        "total_expenses": float(df["expenses"].sum()),
        "total_profit": float(df["total"].sum())
    }
    
    df["month"] = df["date"].dt.strftime('%Y-%m')
    monthly = df.groupby("month")[["total", "cash", "card"]].sum().reset_index().to_dict(orient="records")
    
    df["week_start"] = df["date"] - pd.to_timedelta(df["date"].dt.dayofweek, unit='d')
    df["week_end"] = df["week_start"] + pd.Timedelta(days=6)
    df["week_range"] = df["week_start"].dt.strftime('%d/%m') + " al " + df["week_end"].dt.strftime('%d/%m')
    
    weekly_grouped = df.groupby(["month", "week_range"])["total"].sum().reset_index()
    monthly_breakdown = {}
    for _, row in weekly_grouped.iterrows():
        m = row["month"]
        if m not in monthly_breakdown:
            monthly_breakdown[m] = []
        monthly_breakdown[m].append({
            "week": row["week_range"],
            "total": float(row["total"])
        })
    
    payment_methods = {
        "cash": float(df["cash"].sum()),
        "card": float(df["card"].sum())
    }
    
    return {
        "kpis": kpis,
        "monthly": monthly,
        "weekly_breakdown": monthly_breakdown,
        "payment_methods": payment_methods
    }
