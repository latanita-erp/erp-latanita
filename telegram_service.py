import os
import json
import urllib.request
import urllib.error
from datetime import datetime, date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import text

def get_app_setting(db: Session, key: str, default: str = "") -> str:
    row = db.execute(text("SELECT value FROM app_settings WHERE key = :k"), {"k": key}).fetchone()
    if row and row[0]:
        return row[0]
    return os.getenv(key.upper(), default)

def set_app_setting(db: Session, key: str, value: str):
    db.execute(text("""
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (:k, :v, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = :v, updated_at = CURRENT_TIMESTAMP
    """), {"k": key, "v": value})
    db.commit()

def send_telegram_message(bot_token: str, chat_id: str, message: str) -> dict:
    if not bot_token or not chat_id:
        return {"success": False, "error": "Bot token o Chat ID no configurados"}

    url = f"https://api.telegram.org/bot{bot_token.strip()}/sendMessage"
    payload = {
        "chat_id": chat_id.strip(),
        "text": message,
        "parse_mode": "HTML"
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))
            return {"success": True, "result": result}
    except urllib.error.HTTPError as e:
        err_content = e.read().decode("utf-8")
        try:
            err_json = json.loads(err_content)
            desc = err_json.get("description", str(e))
        except Exception:
            desc = err_content or str(e)
        return {"success": False, "error": f"Error Telegram ({e.code}): {desc}"}
    except Exception as e:
        return {"success": False, "error": f"Error de conexión: {str(e)}"}

def format_currency(val: float) -> str:
    return f"${val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

def check_and_send_due_notifications(db: Session) -> dict:
    bot_token = get_app_setting(db, "telegram_bot_token")
    chat_id = get_app_setting(db, "telegram_chat_id")

    if not bot_token or not chat_id:
        return {"success": False, "error": "Telegram no está configurado"}

    today = date.today()
    limit_date = today + timedelta(days=7)

    # 1. Vencimientos del Hogar (Impuestos, Servicios, Créditos)
    home_bills = db.execute(text("""
        SELECT concept, category, amount, due_date
        FROM household_bills
        WHERE is_paid = FALSE AND due_date <= :limit
        ORDER BY due_date ASC
    """), {"limit": limit_date}).mappings().all()

    # 2. Pagos a Proveedores diferidos próximos a vencer
    supplier_debts = db.execute(text("""
        SELECT s.name as supplier_name, d.invoice_number, d.balance, d.due_date
        FROM supplier_debts d
        JOIN suppliers s ON d.supplier_id = s.id
        WHERE d.status != 'PAGADO' AND d.due_date IS NOT NULL AND d.due_date <= :limit
        ORDER BY d.due_date ASC
    """), {"limit": limit_date}).mappings().all()

    if not home_bills and not supplier_debts:
        return {
            "success": True,
            "message": "No hay vencimientos pendientes en los próximos 7 días",
            "items_count": 0
        }

    lines = ["🔔 <b>RECORDATORIO DE VENCIMIENTOS - LA TANITA</b>\n"]

    if home_bills:
        lines.append("🏠 <b>Impuestos / Servicios / Créditos del Hogar:</b>")
        for b in home_bills:
            b_due = b["due_date"]
            if isinstance(b_due, str):
                b_due = datetime.strptime(b_due, "%Y-%m-%d").date()
            diff = (b_due - today).days

            if diff < 0:
                status = f"🔴 <b>VENCIDO HACE {abs(diff)} DÍAS</b> ({b_due.strftime('%d/%m')})"
            elif diff == 0:
                status = "🔴 <b>¡VENCE HOY!</b>"
            elif diff == 1:
                status = f"🟡 <i>Vence mañana</i> ({b_due.strftime('%d/%m')})"
            else:
                status = f"🗓️ Vence en {diff} días ({b_due.strftime('%d/%m')})"

            lines.append(f"• <b>{b['concept']}</b> [{b['category']}]: {format_currency(float(b['amount']))}\n  ↳ {status}")
        lines.append("")

    if supplier_debts:
        lines.append("🏢 <b>Pagos a Proveedores Diferidos:</b>")
        for d in supplier_debts:
            d_due = d["due_date"]
            if isinstance(d_due, str):
                d_due = datetime.strptime(d_due, "%Y-%m-%d").date()
            diff = (d_due - today).days

            if diff < 0:
                status = f"🔴 <b>VENCIDO HACE {abs(diff)} DÍAS</b> ({d_due.strftime('%d/%m')})"
            elif diff == 0:
                status = "🔴 <b>¡VENCE HOY!</b>"
            elif diff == 1:
                status = f"🟡 <i>Vence mañana</i> ({d_due.strftime('%d/%m')})"
            else:
                status = f"🗓️ Vence en {diff} días ({d_due.strftime('%d/%m')})"

            inv_txt = f" (Rem/Fact: {d['invoice_number']})" if d['invoice_number'] else ""
            lines.append(f"• <b>{d['supplier_name']}</b>{inv_txt}\n  Saldo: <b>{format_currency(float(d['balance']))}</b>\n  ↳ {status}")

    full_message = "\n".join(lines)
    send_result = send_telegram_message(bot_token, chat_id, full_message)
    return {
        "success": send_result["success"],
        "error": send_result.get("error"),
        "items_count": len(home_bills) + len(supplier_debts)
    }

