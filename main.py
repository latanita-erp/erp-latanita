# ============================================
#           CONFIGURACIÓN GENERAL
# ============================================

import os
import math
import datetime
import urllib.parse
import pandas as pd

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
import pdfkit
import io

app = FastAPI()

# ============================================
#        CONEXIÓN A SUPABASE (POOLER)
# ============================================

DB_URI = (
    "postgresql+pg8000://postgres.juzwfwgonamxyuvoxgbj:"
    "Latanita1198!@aws-1-sa-east-1.pooler.supabase.com:6543/postgres"
)

engine = create_engine(DB_URI, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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

# ============================================
#             MÓDULO CAJA DIARIA (FINAL)
# ============================================

@app.get("/api/cash/all")
def get_cash_all(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT 
            id,
            date,
            weekday,
            cash,
            card,
            expenses,
            (cash + card) AS net_income,
            (cash + card - expenses) AS total
        FROM cash
        ORDER BY date ASC
    """)).mappings().all()

    return [dict(r) for r in result]


@app.post("/api/cash")
def create_cash(payload: dict, db: Session = Depends(get_db)):

    date = payload["date"]
    weekday = payload["weekday"]
    cash = float(payload["cash"])
    card = float(payload["card"])
    expenses = float(payload["expenses"])

    net = cash + card
    total = net - expenses

    db.execute(text("""
        INSERT INTO cash (date, weekday, cash, card, expenses, net_income, total)
        VALUES (:date, :weekday, :cash, :card, :expenses, :net, :total)
    """), {
        "date": date,
        "weekday": weekday,
        "cash": cash,
        "card": card,
        "expenses": expenses,
        "net": net,
        "total": total
    })

    db.commit()
    return {"status": "created"}


@app.put("/api/cash/{cash_id}")
def update_cash(cash_id: int, payload: dict, db: Session = Depends(get_db)):

    cash = float(payload["cash"])
    card = float(payload["card"])
    expenses = float(payload["expenses"])

    net = cash + card
    total = net - expenses

    db.execute(text("""
        UPDATE cash
        SET 
            cash = :cash,
            card = :card,
            expenses = :expenses,
            net_income = :net,
            total = :total
        WHERE id = :id
    """), {
        "id": cash_id,
        "cash": cash,
        "card": card,
        "expenses": expenses,
        "net": net,
        "total": total
    })

    db.commit()
    return {"status": "updated"}


@app.delete("/api/cash/{cash_id}")
def delete_cash(cash_id: int, db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM cash WHERE id = :id"), {"id": cash_id})
    db.commit()
    return {"status": "deleted"}

# ============================================
#             MÓDULO PRODUCTOS (FINAL)
# ============================================

@app.get("/api/products")
def get_products(db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT id, name, type, cost, margin, promotion,
               price_kg, price_100g, price_150g, price_250g
        FROM products
        ORDER BY type ASC, name ASC
    """)).mappings().all()
    return [dict(r) for r in result]


@app.post("/api/products")
def create_product(payload: dict, db: Session = Depends(get_db)):
    prices = calculate_prices(payload["cost"], payload["margin"])

    db.execute(text("""
        INSERT INTO products (name, type, cost, margin, price_kg, price_100g, price_150g, price_250g)
        VALUES (:name, :type, :cost, :margin, :price_kg, :price_100g, :price_150g, :price_250g)
    """), {
        "name": payload["name"],
        "type": payload["type"],
        "cost": payload["cost"],
        "margin": payload["margin"],
        "price_kg": prices["price_kg"],
        "price_100g": prices["price_100g"],
        "price_150g": prices["price_150g"],
        "price_250g": prices["price_250g"]
    })

    db.commit()
    return {"status": "created"}


@app.put("/api/products/{product_id}")
def update_product(product_id: int, payload: dict, db: Session = Depends(get_db)):

    cost = float(payload.get("cost", 0))
    margin = float(payload.get("margin", 0))
    promotion = float(payload.get("promotion", 0))

    prices = calculate_prices(cost, margin)

    db.execute(text("""
        UPDATE products
        SET cost = :cost,
            margin = :margin,
            promotion = :promotion,
            price_kg = :price_kg,
            price_100g = :price_100g,
            price_150g = :price_150g,
            price_250g = :price_250g
        WHERE id = :id
    """), {
        "id": product_id,
        "cost": cost,
        "margin": margin,
        "promotion": promotion,
        "price_kg": prices["price_kg"],
        "price_100g": prices["price_100g"],
        "price_150g": prices["price_150g"],
        "price_250g": prices["price_250g"]
    })

    db.commit()
    return {"status": "updated"}


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM products WHERE id = :id"), {"id": product_id})
    db.execute(text("DELETE FROM product_suppliers WHERE product_id = :id"), {"id": product_id})
    db.commit()
    return {"status": "deleted"}


# ============================================
#        PROVEEDORES POR PRODUCTO (FINAL)
# ============================================

@app.get("/api/products/{product_id}/suppliers")
def get_product_suppliers(product_id: int, db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT id, supplier_name, cost
        FROM product_suppliers
        WHERE product_id = :pid
        ORDER BY supplier_name ASC, cost ASC
    """), {"pid": product_id}).mappings().all()

    return [dict(r) for r in result]


@app.post("/api/products/{product_id}/suppliers")
def add_supplier(product_id: int, payload: dict, db: Session = Depends(get_db)):

    supplier_name = payload["supplier_name"]
    cost = float(payload["cost"])

    db.execute(text("""
        INSERT INTO product_suppliers (product_id, supplier_name, cost)
        VALUES (:pid, :name, :cost)
    """), {
        "pid": product_id,
        "name": supplier_name,
        "cost": cost
    })

    suppliers = db.execute(text("""
        SELECT cost FROM product_suppliers WHERE product_id = :pid
    """), {"pid": product_id}).mappings().all()

    max_cost = max([s["cost"] for s in suppliers]) if suppliers else 0.0

    product = db.execute(text("""
        SELECT margin FROM products WHERE id = :pid
    """), {"pid": product_id}).mappings().first()

    if product:
        prices = calculate_prices(max_cost, product["margin"])

        db.execute(text("""
            UPDATE products
            SET cost = :cost,
                price_kg = :pkg,
                price_100g = :p100,
                price_150g = :p150,
                price_250g = :p250
            WHERE id = :id
        """), {
            "id": product_id,
            "cost": max_cost,
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
        SELECT margin FROM products WHERE id = :pid
    """), {"pid": product_id}).mappings().first()

    if product:
        prices = calculate_prices(max_cost, product["margin"])

        db.execute(text("""
            UPDATE products
            SET cost = :cost,
                price_kg = :pkg,
                price_100g = :p100,
                price_150g = :p150,
                price_250g = :p250
            WHERE id = :id
        """), {
            "id": product_id,
            "cost": max_cost,
            "pkg": prices["price_kg"],
            "p100": prices["price_100g"],
            "p150": prices["price_150g"],
            "p250": prices["price_250g"]
        })

    db.commit()
    return {"status": "deleted"}


# ============================================
#        IMPORTACIÓN DESDE EXCEL (FINAL)
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

            prices = calculate_prices(cost, margin)

            db.execute(text("""
                INSERT INTO products
                (name, type, cost, margin, price_kg, price_100g, price_150g, price_250g)
                VALUES (:name, :type, :cost, :margin, :pkg, :p100, :p150, :p250)
            """), {
                "name": str(row["name"]),
                "type": str(row["type"]),
                "cost": cost,
                "margin": margin,
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
#             MÓDULO DASHBOARD (FINAL)
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


# ============================================
#             GENERACIÓN DE PDF
# ============================================

@app.post("/api/generate-pdf")
def generate_pdf(data: dict):
    html = data.get("html", "")

    if not html:
        raise HTTPException(status_code=400, detail="HTML vacío")

    # TEMPORAL: evitar error por falta de wkhtmltopdf
    pdf_bytes = b"%PDF-1.4\n%PDF disabled temporarily\n"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=lista.pdf"}
    )


