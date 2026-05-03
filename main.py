import sqlite3
import pandas as pd
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
from datetime import datetime
import math

app = FastAPI()

DB_FILE = "erp.db"

def get_db():
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS products(
        id INTEGER PRIMARY KEY,
        name TEXT,
        type TEXT,
        cost REAL,
        margin REAL,
        price_kg REAL,
        price_100g REAL,
        price_150g REAL,
        price_250g REAL
    )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS product_suppliers(
        id INTEGER PRIMARY KEY,
        product_id INTEGER,
        supplier_name TEXT,
        cost REAL
    )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS cash(
        id INTEGER PRIMARY KEY,
        date TEXT,
        weekday TEXT,
        cash REAL,
        card REAL,
        net_income REAL,
        expenses REAL,
        total REAL
    )
    """)
    conn.commit()

init_db()

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
    if data.username == "admin" and data.password == "admin123":
        return {"success": True, "token": "fake-jwt-token-123"}
    raise HTTPException(status_code=401, detail="Credenciales incorrectas")

def calculate_prices(cost, margin):
    base_price_kg = cost * (1 + margin / 100)
    
    # Redondear para arriba al múltiplo de 100 más cercano
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
    conn = get_db()
    products = conn.execute("SELECT * FROM products").fetchall()
    return [dict(p) for p in products]

@app.post("/api/products")
def create_product(p: Product):
    conn = get_db()
    c = conn.cursor()
    prices = calculate_prices(p.cost, p.margin)
    c.execute(
        "INSERT INTO products (name, type, cost, margin, price_kg, price_100g, price_150g, price_250g) VALUES (?,?,?,?,?,?,?,?)",
        (p.name, p.type, p.cost, p.margin, prices['price_kg'], prices['price_100g'], prices['price_150g'], prices['price_250g'])
    )
    conn.commit()
    return {"success": True, "id": c.lastrowid}

@app.delete("/api/products/{id}")
def delete_product(id: int):
    conn = get_db()
    conn.execute("DELETE FROM products WHERE id=?", (id,))
    conn.execute("DELETE FROM product_suppliers WHERE product_id=?", (id,))
    conn.commit()
    return {"success": True}

@app.get("/api/products/{id}/suppliers")
def get_product_suppliers(id: int):
    conn = get_db()
    suppliers = conn.execute("SELECT * FROM product_suppliers WHERE product_id=?", (id,)).fetchall()
    return [dict(s) for s in suppliers]

@app.post("/api/products/{id}/suppliers")
def add_supplier(id: int, s: Supplier):
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO product_suppliers (product_id, supplier_name, cost) VALUES (?,?,?)", (id, s.supplier_name, s.cost))
    
    suppliers = c.execute("SELECT cost FROM product_suppliers WHERE product_id=?", (id,)).fetchall()
    max_cost = max([sup['cost'] for sup in suppliers]) if suppliers else 0.0
    
    product = c.execute("SELECT margin FROM products WHERE id=?", (id,)).fetchone()
    if product:
        prices = calculate_prices(max_cost, product['margin'])
        c.execute("""
            UPDATE products 
            SET cost=?, price_kg=?, price_100g=?, price_150g=?, price_250g=? 
            WHERE id=?
        """, (max_cost, prices['price_kg'], prices['price_100g'], prices['price_150g'], prices['price_250g'], id))
        
    conn.commit()
    return {"success": True}

@app.delete("/api/products/{product_id}/suppliers/{supplier_id}")
def delete_supplier(product_id: int, supplier_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM product_suppliers WHERE id=?", (supplier_id,))
    
    suppliers = c.execute("SELECT cost FROM product_suppliers WHERE product_id=?", (product_id,)).fetchall()
    
    product = c.execute("SELECT margin, cost FROM products WHERE id=?", (product_id,)).fetchone()
    if product:
        max_cost = max([s['cost'] for s in suppliers]) if suppliers else 0.0
        prices = calculate_prices(max_cost, product['margin'])
        c.execute("""
            UPDATE products 
            SET cost=?, price_kg=?, price_100g=?, price_150g=?, price_250g=? 
            WHERE id=?
        """, (max_cost, prices['price_kg'], prices['price_100g'], prices['price_150g'], prices['price_250g'], product_id))
        
    conn.commit()
    return {"success": True}

@app.post("/api/products/import")
def import_products(file: UploadFile = File(...)):
    try:
        df = pd.read_excel(file.file)
        # Se espera que el excel tenga columnas: Nombre, Tipo, Costo, Margen
        required_cols = ["Nombre", "Tipo", "Costo", "Margen"]
        for col in required_cols:
            if col not in df.columns:
                raise HTTPException(status_code=400, detail=f"Falta la columna requerida: {col}")
                
        conn = get_db()
        c = conn.cursor()
        
        # Limpiar tabla actual si se quiere (opcional), aquí añadimos.
        count = 0
        for _, row in df.iterrows():
            cost = float(row['Costo']) if pd.notna(row['Costo']) else 0.0
            margin = float(row['Margen']) if pd.notna(row['Margen']) else 0.0
            prices = calculate_prices(cost, margin)
            
            c.execute(
                "INSERT INTO products (name, type, cost, margin, price_kg, price_100g, price_150g, price_250g) VALUES (?,?,?,?,?,?,?,?)",
                (str(row['Nombre']), str(row['Tipo']), cost, margin, prices['price_kg'], prices['price_100g'], prices['price_150g'], prices['price_250g'])
            )
            count += 1
            
        conn.commit()
        return {"success": True, "imported_count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/cash")
def get_cash():
    conn = get_db()
    cash = conn.execute("SELECT * FROM cash ORDER BY date DESC LIMIT 100").fetchall()
    return [dict(c) for c in cash]

@app.post("/api/cash")
def create_cash(c: CashRecord):
    conn = get_db()
    cursor = conn.cursor()
    net = c.cash + c.card
    total = net - c.expenses
    cursor.execute(
        "INSERT INTO cash (date, weekday, cash, card, net_income, expenses, total) VALUES (?,?,?,?,?,?,?)",
        (c.date, c.weekday, c.cash, c.card, net, c.expenses, total)
    )
    conn.commit()
    return {"success": True}

@app.put("/api/cash/{id}")
def update_cash(id: int, c: CashUpdate):
    conn = get_db()
    cursor = conn.cursor()
    net = c.cash + c.card
    total = net - c.expenses
    cursor.execute(
        "UPDATE cash SET cash=?, card=?, net_income=?, expenses=?, total=? WHERE id=?",
        (c.cash, c.card, net, c.expenses, total, id)
    )
    conn.commit()
    return {"success": True}

@app.delete("/api/cash/{id}")
def delete_cash(id: int):
    conn = get_db()
    conn.execute("DELETE FROM cash WHERE id=?", (id,))
    conn.commit()
    return {"success": True}

@app.get("/api/dashboard")
def get_dashboard():
    conn = get_db()
    df = pd.read_sql("SELECT * FROM cash", conn)
    
    if df.empty:
        return {
            "kpis": {"total_revenue": 0, "total_expenses": 0, "total_profit": 0},
            "monthly": [],
            "weekly_breakdown": {},
            "payment_methods": {"cash": 0, "card": 0}
        }
        
    df["date"] = pd.to_datetime(df["date"])
    
    # KPIs
    kpis = {
        "total_revenue": float(df["net_income"].sum()),
        "total_expenses": float(df["expenses"].sum()),
        "total_profit": float(df["total"].sum())
    }
    
    # Mensual
    df["month"] = df["date"].dt.strftime('%Y-%m')
    monthly = df.groupby("month")[["total", "cash", "card"]].sum().reset_index().to_dict(orient="records")
    
    # Semanal Desglosado por Mes
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
    
    # Metodos de pago
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
