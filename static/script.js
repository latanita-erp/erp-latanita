// ======================================================
//                 ESTADO GLOBAL Y UTILIDADES
// ======================================================

let state = {
    products: [],
    cash: [],
    dashboard: null
};

function formatMoney(val) {
    return val.toLocaleString('es-AR', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    });
}

function formatMonthLiteral(monthStr) {
    if (!monthStr || monthStr.length !== 7) return monthStr;

    const [year, month] = monthStr.split('-');
    const monthNames = [
        "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
        "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
    ];

    const index = parseInt(month, 10) - 1;
    return index >= 0 && index < 12 ? `${monthNames[index]}-${year}` : monthStr;
}

// ======================================================
//                 MOSTRAR APP DIRECTO
// ======================================================

function showApp() {
    document.getElementById('login-screen')?.classList.add('hidden');
    document.getElementById('app-screen')?.classList.remove('hidden');
}

// ======================================================
//                 INICIALIZACIÓN GENERAL
// ======================================================

document.addEventListener('DOMContentLoaded', async () => {

    showApp();

    // Navegación entre vistas
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {

            document.querySelectorAll('.nav-btn')
                .forEach(b => b.classList.remove('active'));

            e.target.classList.add('active');

            document.querySelectorAll('.view')
                .forEach(v => {
                    v.classList.remove('active');
                    v.classList.add('hidden');
                });

            const target = e.target.dataset.target;
            document.getElementById(target).classList.remove('hidden');
            document.getElementById(target).classList.add('active');

            loadData(target);
        });
    });

    // Importación Excel
    document.getElementById('excel-file')
        ?.addEventListener('change', handleExcelUpload);
});

// ======================================================
//                 TOAST DE MENSAJES
// ======================================================

function showToast(msg, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerText = msg;

    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add("visible"), 50);
    setTimeout(() => {
        toast.classList.remove("visible");
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ======================================================
//                 CARGA DE DATOS SEGÚN VISTA
// ======================================================

async function loadData(view) {
    if (view === 'products') await fetchProducts();
    if (view === 'cash') await fetchCash();
    if (view === 'dashboard') await fetchDashboard();
}

// ======================================================
//                 PRODUCTOS
// ======================================================

async function fetchProducts() {
    const res = await fetch('/api/products');
    const data = await res.json();

    state.products = data.map(p => ({
        ...p,
        cost: parseFloat(p.cost),
        margin: parseFloat(p.margin),
        price_kg: parseFloat(p.price_kg)
    }));

    renderProducts();
}

function renderProducts() {
    const tbody = document.querySelector('#products-table tbody');
    tbody.innerHTML = '';

    state.products.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="prod-name"><strong>${p.name}</strong></td>
            <td class="prod-type">${p.type}</td>
            <td class="prod-cost" data-value="${p.cost}">$${formatMoney(p.cost)}</td>
            <td class="prod-margin" data-value="${p.margin}">${p.margin}%</td>
            <td class="prod-pricekg" data-value="${p.price_kg}"><strong>$${formatMoney(p.price_kg)}</strong></td>
            <td class="prod-price100" data-value="${p.price_100g}">$${formatMoney(p.price_100g)}</td>
            <td class="prod-price150" data-value="${p.price_150g}">$${formatMoney(p.price_150g)}</td>
            <td class="prod-price250" data-value="${p.price_250g}">$${formatMoney(p.price_250g)}</td>
            <td style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" onclick="openEditProduct(${p.id})">✏️ Editar</button>
                <button class="btn btn-danger" onclick="deleteProduct(${p.id})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ======================================================
//                 DISTRIBUCIÓN SEMANAL (GRÁFICO)
// ======================================================

function calculateWeekdayDistribution(cashData) {
    const days = {
        "LUNES": 0,
        "MARTES": 0,
        "MIÉRCOLES": 0,
        "JUEVES": 0,
        "VIERNES": 0,
        "SÁBADO": 0,
        "DOMINGO": 0
    };

    cashData.forEach(row => {
        const day = row.weekday.toUpperCase();
        if (days[day] !== undefined) {
            days[day] += row.total;
        }
    });

    return days;
}

function renderWeekdayDistribution(cashData) {
    const data = calculateWeekdayDistribution(cashData);

    const labels = Object.keys(data);
    const values = Object.values(data);

    const ctx = document.getElementById("chart-weekday-distribution").getContext("2d");

    if (charts.weekday) charts.weekday.destroy();

    charts.weekday = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Ganancia por Día",
                data: values,
                backgroundColor: [
                    "#3b82f6", "#10b981", "#f59e0b",
                    "#6366f1", "#ef4444", "#8b5cf6", "#14b8a6"
                ],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            scales: { y: { beginAtZero: true } }
        }
    });
}

// ======================================================
//                 AGREGAR PRODUCTO
// ======================================================

document.getElementById('add-product-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
        name: document.getElementById('prod-name').value,
        type: document.getElementById('prod-type').value,
        cost: parseFloat(document.getElementById('prod-cost').value),
        margin: parseFloat(document.getElementById('prod-margin').value)
    };

    await fetch('/api/products', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    toggleModal('modal-add-product');
    e.target.reset();
    fetchProducts();
});

// ======================================================
//                 ELIMINAR PRODUCTO
// ======================================================

async function deleteProduct(id) {
    if (confirm('¿Eliminar producto?')) {
        await fetch(`/api/products/${id}`, { method: 'DELETE' });
        fetchProducts();
    }
}

// ======================================================
//                 IMPORTAR EXCEL
// ======================================================

async function handleExcelUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/products/import', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            alert('Productos importados correctamente.');
            fetchProducts();
        } else {
            const err = await res.json();
            alert('Error al importar: ' + err.detail);
        }
    } catch (err) {
        alert('Error de conexión.');
    }

    e.target.value = '';
}

// =====================================================
//                 EDICIÓN DE PRODUCTOS
// =====================================================

function calculatePrices(cost, margin) {
    const base = cost * (1 + margin / 100);
    return Math.ceil(base / 100) * 100;
}

function updateNewPrice() {
    const cost = parseFloat(document.getElementById("edit-product-cost").value) || 0;
    const margin = parseFloat(document.getElementById("edit-product-margin").value) || 0;
    const newPrice = calculatePrices(cost, margin);
    document.getElementById("edit-product-new-price").value = newPrice;
}

function updatePromoPrice() {
    const price250 = Number(document.getElementById("edit-product-price250").value);
    const promo = Number(document.getElementById("edit-product-promotion").value);

    if (promo > 0) {
        const final = price250 * (1 - promo / 100);
        document.getElementById("edit-product-price250-promo").value = final.toFixed(2);
    } else {
        document.getElementById("edit-product-price250-promo").value = "";
    }
}

function openEditProduct(id) {
    const p = state.products.find(x => x.id === id);

    document.getElementById("edit-product-id").value = p.id;
    document.getElementById("edit-product-name").value = p.name;
    document.getElementById("edit-product-type").value = p.type;
    document.getElementById("edit-product-cost").value = p.cost;
    document.getElementById("edit-product-margin").value = p.margin;
    document.getElementById("edit-product-old-price").value = p.price_kg;

    document.getElementById("edit-product-price250").value = p.price_250g;
    document.getElementById("edit-product-promotion").value = p.promotion || 0;

    if (p.promotion > 0) {
        const final = p.price_250g * (1 - p.promotion / 100);
        document.getElementById("edit-product-price250-promo").value = final.toFixed(2);
    } else {
        document.getElementById("edit-product-price250-promo").value = "";
    }

    updateNewPrice();
    toggleModal("modal-edit-product");
}

document.getElementById("edit-product-cost").addEventListener("input", updateNewPrice);
document.getElementById("edit-product-margin").addEventListener("input", updateNewPrice);
document.getElementById("edit-product-promotion").addEventListener("input", updatePromoPrice);

document.getElementById("edit-product-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("edit-product-id").value;
    const cost = parseFloat(document.getElementById("edit-product-cost").value);
    const margin = parseFloat(document.getElementById("edit-product-margin").value);
    const promotion = Number(document.getElementById("edit-product-promotion").value);

    const payload = { cost, margin, promotion };

    await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    toggleModal('modal-edit-product');
    fetchProducts();
});

// =====================================================
//                 AJUSTE MASIVO DE MÁRGENES
// =====================================================

let lastMassUpdateBackup = null;

document.getElementById("mass-margin-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = e.submitter;
    const value = parseFloat(document.getElementById("mass-margin-value").value);

    if (isNaN(value)) {
        showToast("Ingresá un número válido", "error");
        return;
    }

    btn.disabled = true;
    btn.innerText = "Aplicando...";

    try {
        lastMassUpdateBackup = state.products.map(p => ({
            id: p.id,
            margin: p.margin,
            price_kg: p.price_kg
        }));

        for (const p of state.products) {
            const newMargin = p.margin + value;

            await fetch(`/api/products/${p.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ margin: newMargin })
            });
        }

        await fetchProducts();
        toggleModal("modal-mass-margin");
        showToast(`Ajuste aplicado correctamente (+${value}%)`, "success");

    } catch (err) {
        console.error(err);
        showToast("Error aplicando el ajuste", "error");
    }

    btn.disabled = false;
    btn.innerText = "Aplicar Aumento";
});

// =====================================================
//                 DESHACER AJUSTE MASIVO
// =====================================================

async function undoMassMargin() {
    if (!lastMassUpdateBackup) {
        alert("No hay un aumento masivo previo para deshacer.");
        return;
    }

    for (const item of lastMassUpdateBackup) {
        await fetch(`/api/products/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                margin: item.margin,
                price_kg: item.price_kg
            })
        });
    }

    lastMassUpdateBackup = null;
    fetchProducts();
    alert("Se restauraron los márgenes y precios previos al aumento masivo.");
}

// =====================================================
//                 LISTADO 100g (FIAMBRES Y QUESOS)
// =====================================================

function generatePriceList100g() {

    const filtered = state.products.filter(p =>
        p.type.toLowerCase() === "fiambre" ||
        p.type.toLowerCase() === "queso"
    );

    const sorted = [...filtered].sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.name.localeCompare(b.name);
    });

    function formatAr(num) {
        return Number(num).toLocaleString("es-AR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    let html = `
    <html>
    <head>
        <title>Lista 100g</title>
    </head>
    <body style="font-family: Arial, sans-serif; padding:20px;">

        <h1 style="text-align:center; font-size:20px; margin-bottom:4px;">
            Lista de precios por 100 gramos
        </h1>

        <h3 style="text-align:center; font-size:14px; margin-top:0; margin-bottom:12px;">
            Fiambres y Quesos – La Tanita
        </h3>

        <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
                <tr>
                    <th style="text-align:left; padding:6px; border-bottom:1px solid #aaa;">Producto</th>
                    <th style="text-align:left; padding:6px; border-bottom:1px solid #aaa;">Tipo</th>
                    <th style="text-align:right; padding:6px; border-bottom:1px solid #aaa;">100 g</th>
                </tr>
            </thead>
            <tbody>
    `;

    sorted.forEach(p => {
        const price100 = p.price_100g ? p.price_100g : (p.price_kg / 10);

        html += `
            <tr>
                <td style="padding:6px;">${p.name}</td>
                <td style="padding:6px;">${p.type}</td>
                <td style="padding:6px; text-align:right;">$${formatAr(price100)}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>

        <script>
            window.onload = function() { window.print(); };
        </script>

    </body>
    </html>
    `;

    const newWindow = window.open("", "_blank");
    newWindow.document.open();
    newWindow.document.write(html);
    newWindow.document.close();
}

// =====================================================
//                 LISTADO TÉCNICO
// =====================================================

function generateTechnicalList() {

    const sorted = [...state.products].sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.name.localeCompare(b.name);
    });

    function formatAr(num) {
        return Number(num).toLocaleString("es-AR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    let html = `
    <html>
    <head>
        <title>Lista Técnica</title>
    </head>
    <body style="font-family: Arial, sans-serif; padding:20px;">

        <h1 style="text-align:center; font-size:20px; margin-bottom:4px;">
            Lista Técnica de Productos
        </h1>

        <h3 style="text-align:center; font-size:14px; margin-top:0; margin-bottom:12px;">
            Costo – Precio por Kilo – Margen
        </h3>

        <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
                <tr>
                    <th style="text-align:left; padding:6px; border-bottom:1px solid #aaa;">Producto</th>
                    <th style="text-align:left; padding:6px; border-bottom:1px solid #aaa;">Tipo</th>
                    <th style="text-align:right; padding:6px; border-bottom:1px solid #aaa;">Costo</th>
                    <th style="text-align:right; padding:6px; border-bottom:1px solid #aaa;">Precio KG</th>
                    <th style="text-align:right; padding:6px; border-bottom:1px solid #aaa;">Margen</th>
                </tr>
            </thead>
            <tbody>
    `;

    sorted.forEach(p => {
        html += `
            <tr>
                <td style="padding:6px;">${p.name}</td>
                <td style="padding:6px;">${p.type}</td>
                <td style="padding:6px; text-align:right;">$${formatAr(p.cost)}</td>
                <td style="padding:6px; text-align:right;">$${formatAr(p.price_kg)}</td>
                <td style="padding:6px; text-align:right;">${Math.round(p.margin)} %</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>

        <script>
            window.onload = function() { window.print(); };
        </script>

    </body>
    </html>
    `;

    const newWindow = window.open("", "_blank");
    newWindow.document.open();
    newWindow.document.write(html);
    newWindow.document.close();
}

// --- PROVEEDORES ---
async function openSuppliers(productId, productName) {
    document.getElementById('sup-prod-name').innerText = productName;
    document.getElementById('sup-prod-id').value = productId;
    await fetchSuppliers(productId);
    toggleModal('modal-suppliers');
}

async function fetchSuppliers(productId) {
    const res = await fetch(`/api/products/${productId}/suppliers`);
    const suppliers = await res.json();

    const tbody = document.querySelector('#suppliers-table tbody');
    tbody.innerHTML = '';

    if (suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center;">Sin proveedores</td></tr>';
        return;
    }

    const minCost = Math.min(...suppliers.map(s => s.cost));

    suppliers.forEach(s => {
        const isMin = s.cost === minCost;
        const tr = document.createElement('tr');
        if (isMin) tr.style.background = 'rgba(16, 185, 129, 0.1)';

        tr.innerHTML = `
            <td>${isMin ? '🟢 ' : ''}${s.supplier_name}</td>
            <td style="font-weight:${isMin ? 'bold' : 'normal'}; color:${isMin ? 'var(--success-color)' : 'inherit'}">
                $${formatMoney(s.cost)}
            </td>
            <td>
                <button class="btn btn-danger" onclick="deleteSupplier(${productId}, ${s.id})" style="padding: 0.3rem 0.6rem;">
                    ❌
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('add-supplier-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const productId = document.getElementById('sup-prod-id').value;

    const payload = {
        supplier_name: document.getElementById('sup-name').value,
        cost: parseFloat(document.getElementById('sup-cost').value)
    };

    await fetch(`/api/products/${productId}/suppliers`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    e.target.reset();
    await fetchSuppliers(productId);
    fetchProducts();
});

async function deleteSupplier(productId, supplierId) {
    if (confirm('¿Eliminar proveedor?')) {
        await fetch(`/api/products/${productId}/suppliers/${supplierId}`, { method: 'DELETE' });
        await fetchSuppliers(productId);
        fetchProducts();
    }
}

// =====================================================
//                 CAJA DIARIA
// =====================================================

// --- AUTO-COMPLETAR DÍA AL ELEGIR FECHA (ALTA) ---
document.getElementById("cash-date").addEventListener("change", (e) => {
    const date = e.target.value;
    if (!date) return;

    const weekday = new Date(date).toLocaleDateString("es-AR", { weekday: "long" });
    document.getElementById("cash-weekday").value = weekday.toUpperCase();
});

// =====================================================
//                 FETCH + NORMALIZACIÓN
// =====================================================

async function fetchCash() {
    const res = await fetch('/api/cash/all');
    const raw = await res.json();

    state.cash = raw.map(r => {
        let date = r.date;
        if (date && date.includes("T")) date = date.split("T")[0];

        const weekday = (r.weekday ||
            new Date(date).toLocaleDateString("es-AR", { weekday: "long" })
        ).toUpperCase();

        const cash = Number(r.cash ?? 0);
        const card = Number(r.card ?? 0);
        const expenses = Number(r.expenses ?? 0);

        const net_income = cash + card;
        const total = net_income - expenses;

        return {
            id: r.id,
            date,
            weekday,
            cash,
            card,
            net_income,
            expenses,
            total
        };
    });

    renderCash();
}

// =====================================================
//                 RENDER TABLA
// =====================================================

function renderCash() {
    const tbody = document.getElementById('cash-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    state.cash.forEach(c => {
        const [y, m, d] = c.date.split('-');
        const formattedDate = `${d}/${m}/${y}`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formattedDate}</td>
            <td>${c.weekday}</td>
            <td>$${formatMoney(c.cash)}</td>
            <td>$${formatMoney(c.card)}</td>
            <td>$${formatMoney(c.net_income)}</td>
            <td>$${formatMoney(c.expenses)}</td>
            <td style="color: ${c.total >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}; font-weight: bold;">
                $${formatMoney(c.total)}
            </td>
            <td style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" style="padding: 0.3rem 0.6rem;"
                    onclick="openEditCash(${c.id}, '${c.date}', ${c.cash}, ${c.card}, ${c.expenses})">✏️</button>
                <button class="btn btn-danger" style="padding: 0.3rem 0.6rem;"
                    onclick="deleteCash(${c.id})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// =====================================================
//                 NUEVO REGISTRO
// =====================================================

document.getElementById('cash-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const date = document.getElementById('cash-date').value;

    let weekday = document.getElementById('cash-weekday').value;
    if (!weekday) {
        weekday = new Date(date).toLocaleDateString("es-AR", { weekday: "long" }).toUpperCase();
    }

    const payload = {
        date,
        weekday,
        cash: parseFloat(document.getElementById('cash-cash').value),
        card: parseFloat(document.getElementById('cash-card').value),
        expenses: parseFloat(document.getElementById('cash-expenses').value)
    };

    await fetch('/api/cash', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    e.target.reset();
    fetchCash();
});

// =====================================================
//                 EDITAR REGISTRO
// =====================================================

function openEditCash(id, date, cash, card, expenses) {
    document.getElementById('edit-cash-id').value = id;

    // Setear fecha en formato YYYY-MM-DD
    document.getElementById('edit-cash-date').value = date;

    // Autocompletar día
    const weekday = new Date(date).toLocaleDateString("es-AR", { weekday: "long" });
    document.getElementById('edit-cash-weekday').value = weekday.toUpperCase();

    // Valores numéricos
    document.getElementById('edit-cash-cash').value = cash;
    document.getElementById('edit-cash-card').value = card;
    document.getElementById('edit-cash-expenses').value = expenses;

    toggleModal('modal-edit-cash');
}

// --- AUTO-COMPLETAR DÍA EN EDICIÓN ---
document.getElementById("edit-cash-date").addEventListener("change", (e) => {
    const date = e.target.value;
    if (!date) return;

    const weekday = new Date(date).toLocaleDateString("es-AR", { weekday: "long" });
    document.getElementById("edit-cash-weekday").value = weekday.toUpperCase();
});

// --- GUARDAR EDICIÓN ---
document.getElementById('edit-cash-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('edit-cash-id').value;
    const date = document.getElementById('edit-cash-date').value;

    let weekday = document.getElementById('edit-cash-weekday').value;
    if (!weekday) {
        weekday = new Date(date).toLocaleDateString("es-AR", { weekday: "long" }).toUpperCase();
    }

    const payload = {
        date,
        weekday,
        cash: parseFloat(document.getElementById('edit-cash-cash').value),
        card: parseFloat(document.getElementById('edit-cash-card').value),
        expenses: parseFloat(document.getElementById('edit-cash-expenses').value)
    };

    await fetch(`/api/cash/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    toggleModal('modal-edit-cash');
    fetchCash();
});

// =====================================================
//                 ELIMINAR REGISTRO
// =====================================================

async function deleteCash(id) {
    if (confirm('¿Eliminar este registro de caja?')) {
        await fetch(`/api/cash/${id}`, { method: 'DELETE' });
        fetchCash();
    }
}

// =====================================================
//                 DASHBOARD
// =====================================================

let charts = {};

async function fetchDashboard() {
    const res = await fetch('/api/dashboard');
    state.dashboard = await res.json();
    renderDashboard();
}

// ---------- Cálculos de resumen mensual ----------

function calculateMonthlySummary(cashData) {
    if (!cashData || cashData.length === 0) {
        return {
            total_vendido: 0,
            gastos: 0,
            ganancia: 0,
            mejor_dia: null,
            peor_dia: null,
            promedio_diario: 0,
            dias_trabajados: 0
        };
    }

    // Tomamos el último mes con datos como "mes actual" lógico
    const months = [...new Set(cashData.map(r => r.date.slice(0, 7)))].sort();
    const currentMonth = months[months.length - 1];

    const monthRows = cashData.filter(r => r.date.startsWith(currentMonth));

    const total_vendido = monthRows.reduce((acc, r) => acc + r.net_income, 0);
    const gastos = monthRows.reduce((acc, r) => acc + r.expenses, 0);
    const ganancia = monthRows.reduce((acc, r) => acc + r.total, 0);
    const dias_trabajados = monthRows.length;
    const promedio_diario = dias_trabajados > 0 ? ganancia / dias_trabajados : 0;

    let mejor = null;
    let peor = null;

    monthRows.forEach(r => {
        if (!mejor || r.total > mejor.total) mejor = r;
        if (!peor || r.total < peor.total) peor = r;
    });

    return {
        total_vendido,
        gastos,
        ganancia,
        mejor_dia: mejor,
        peor_dia: peor,
        promedio_diario,
        dias_trabajados
    };
}

function renderMonthlySummary(summary) {
    document.getElementById('sum-total-vendido').innerText = `$${formatMoney(summary.total_vendido)}`;
    document.getElementById('sum-gastos').innerText = `$${formatMoney(summary.gastos)}`;
    document.getElementById('sum-ganancia').innerText = `$${formatMoney(summary.ganancia)}`;
    document.getElementById('sum-promedio').innerText = `$${formatMoney(summary.promedio_diario)}`;
    document.getElementById('sum-dias').innerText = summary.dias_trabajados;

    if (summary.mejor_dia) {
        const [y, m, d] = summary.mejor_dia.date.split('-');
        document.getElementById('sum-mejor-dia').innerText =
            `${d}/${m}/${y} ($${formatMoney(summary.mejor_dia.total)})`;
    } else {
        document.getElementById('sum-mejor-dia').innerText = '—';
    }

    if (summary.peor_dia) {
        const [y, m, d] = summary.peor_dia.date.split('-');
        document.getElementById('sum-peor-dia').innerText =
            `${d}/${m}/${y} ($${formatMoney(summary.peor_dia.total)})`;
    } else {
        document.getElementById('sum-peor-dia').innerText = '—';
    }
}

// ---------- Estadísticas mejor/peor día por mes ----------

function calculateMonthlyDayStats(cashData) {
    const byMonth = {};

    cashData.forEach(r => {
        const month = r.date.slice(0, 7);
        if (!byMonth[month]) byMonth[month] = [];
        byMonth[month].push(r);
    });

    const result = [];

    Object.keys(byMonth).sort().forEach(month => {
        const rows = byMonth[month];
        let best = null;
        let worst = null;

        rows.forEach(r => {
            if (!best || r.total > best.total) best = r;
            if (!worst || r.total < worst.total) worst = r;
        });

        result.push({
            month,
            best,
            worst
        });
    });

    return result;
}

function renderBestWorstTable(stats) {
    const tbody = document.querySelector('#best-worst-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    stats.forEach(row => {
        const [by, bm, bd] = row.best.date.split('-');
        const [wy, wm, wd] = row.worst.date.split('-');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatMonthLiteral(row.month)}</td>
            <td>${bd}/${bm}/${by} ($${formatMoney(row.best.total)})</td>
            <td>${wd}/${wm}/${wy} ($${formatMoney(row.worst.total)})</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---------- Comparativo mensual ----------

function renderMonthlyComparisonChart(cashData) {
    const byMonth = {};

    cashData.forEach(r => {
        const month = r.date.slice(0, 7);
        if (!byMonth[month]) {
            byMonth[month] = { total: 0, cash: 0, card: 0, expenses: 0 };
        }
        byMonth[month].total += r.total;
        byMonth[month].cash += r.cash;
        byMonth[month].card += r.card;
        byMonth[month].expenses += r.expenses;
    });

    const months = Object.keys(byMonth).sort();
    const labels = months.map(m => formatMonthLiteral(m));
    const totals = months.map(m => byMonth[m].total);

    const ctx = document.getElementById('chart-month-compare').getContext('2d');

    if (charts.monthCompare) charts.monthCompare.destroy();

    charts.monthCompare = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Beneficio Neto por Mes',
                data: totals,
                backgroundColor: '#6366f1',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } }
        }
    });
}

// ---------- Render principal del Dashboard ----------

function renderDashboard() {
    const d = state.dashboard;

    // KPIs
    document.getElementById('kpi-revenue').innerText = `$${formatMoney(d.kpis.total_revenue)}`;
    document.getElementById('kpi-expenses').innerText = `$${formatMoney(d.kpis.total_expenses)}`;
    document.getElementById('kpi-profit').innerText = `$${formatMoney(d.kpis.total_profit)}`;

    // Resumen del mes (desde state.cash)
    const summary = calculateMonthlySummary(state.cash);
    renderMonthlySummary(summary);

    // Tendencia mensual (simple: comparación último vs anterior)
    const trendVentasEl = document.getElementById('trend-ventas');
    const trendGastosEl = document.getElementById('trend-gastos');
    const trendGananciaEl = document.getElementById('trend-ganancia');

    if (d.monthly && d.monthly.length >= 2) {
        const sorted = [...d.monthly].sort((a, b) => a.month.localeCompare(b.month));
        const prev = sorted[sorted.length - 2];
        const curr = sorted[sorted.length - 1];

        const diffVentas = curr.total - prev.total;
        const diffGastos = (curr.expenses ?? 0) - (prev.expenses ?? 0);
        const diffGanancia = curr.total - (prev.total ?? 0);

        const fmtDiff = (v) => `${v >= 0 ? '▲' : '▼'} $${formatMoney(Math.abs(v))}`;

        trendVentasEl.innerText = fmtDiff(diffVentas);
        trendGastosEl.innerText = fmtDiff(diffGastos);
        trendGananciaEl.innerText = fmtDiff(diffGanancia);
    } else {
        trendVentasEl.innerText = '—';
        trendGastosEl.innerText = '—';
        trendGananciaEl.innerText = '—';
    }

    // Limpiar gráficos previos
    Object.values(charts).forEach(c => c.destroy && c.destroy());
    charts = {};

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Inter';

    // 1. Ventas por mes
    const ctxMonthly = document.getElementById('chart-monthly').getContext('2d');
    charts.monthly = new Chart(ctxMonthly, {
        type: 'bar',
        data: {
            labels: d.monthly.map(m => formatMonthLiteral(m.month)),
            datasets: [{
                label: 'Beneficio Neto',
                data: d.monthly.map(m => m.total),
                backgroundColor: '#3b82f6',
                borderRadius: 4
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
    });

    // 2. Efectivo vs Tarjeta
    const ctxPayment = document.getElementById('chart-payment').getContext('2d');
    charts.payment = new Chart(ctxPayment, {
        type: 'bar',
        data: {
            labels: d.monthly.map(m => formatMonthLiteral(m.month)),
            datasets: [
                {
                    label: 'Efectivo',
                    data: d.monthly.map(m => m.cash),
                    backgroundColor: '#10b981',
                    borderRadius: 4
                },
                {
                    label: 'Tarjeta',
                    data: d.monthly.map(m => m.card),
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }
            ]
        },
        options: { responsive: true }
    });

    // 3. Desglose semanal
    const container = document.getElementById('weekly-breakdown-container');
    container.innerHTML = '';

    if (!d.weekly_breakdown || Object.keys(d.weekly_breakdown).length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary);">No hay datos semanales.</p>';
    } else {
        const months = Object.keys(d.weekly_breakdown).sort().reverse();
        months.forEach(month => {
            const monthDiv = document.createElement('div');
            monthDiv.style.background = 'rgba(255,255,255,0.02)';
            monthDiv.style.padding = '1.5rem';
            monthDiv.style.borderRadius = '12px';
            monthDiv.style.border = '1px solid var(--glass-border)';

            let html = `<h4 style="margin-bottom: 1rem; color: var(--primary-color); font-size: 1.1rem;">Mes: ${formatMonthLiteral(month)}</h4>`;
            html += `<table class="table" style="font-size: 0.95rem;"><tbody>`;
            d.weekly_breakdown[month].forEach(w => {
                html += `<tr>
                            <td>Semana del <strong>${w.week}</strong></td>
                            <td style="text-align: right; font-weight: bold; color: ${w.total >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}">
                                $${formatMoney(w.total)}
                            </td>
                         </tr>`;
            });
            html += `</tbody></table>`;
            monthDiv.innerHTML = html;
            container.appendChild(monthDiv);
        });
    }

    // 4. Mejor/Peor día por mes
    const stats = calculateMonthlyDayStats(state.cash);
    renderBestWorstTable(stats);

    // 5. Comparativo mensual
    renderMonthlyComparisonChart(state.cash);

    // 6. Distribución por día de la semana
    renderWeekdayDistribution(state.cash);
}

// --- INICIALIZACIÓN DE LA APP ---
async function init() {
    await fetchCash();
    await fetchDashboard();
    await fetchProducts();
}

window.onload = init;

