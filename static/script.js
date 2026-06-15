// ======================================================
//                 ESTADO GLOBAL Y UTILIDADES
// ======================================================

let state = {
    products: [],
    cash: [],
    dashboard: null,
    suppliers: [],
    expenseCategories: []
};
let currentExpenseList = []; // For cash forms


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
//                 AUTH & FETCH OVERRIDE
// ======================================================

const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if (!config) config = {};
    if (!config.headers) config.headers = {};
    
    const token = localStorage.getItem('auth_token');
    if (token) {
        config.headers['Authorization'] = `Basic ${token}`;
    }
    
    const response = await originalFetch(resource, config);
    if (response.status === 401) {
        localStorage.removeItem('auth_token');
        showLogin();
    }
    return response;
};

function showLogin() {
    const login = document.getElementById('login-screen');
    const app = document.getElementById('app-screen');
    if (login) {
        login.classList.add('active');
        login.classList.remove('hidden');
    }
    if (app) {
        app.classList.add('hidden');
        app.classList.remove('active');
    }
}

function showApp() {
    const login = document.getElementById('login-screen');
    const app = document.getElementById('app-screen');
    if (login) {
        login.classList.remove('active');
        login.classList.add('hidden');
    }
    if (app) {
        app.classList.remove('hidden');
        app.classList.add('active');
    }
}

function logout() {
    localStorage.removeItem('auth_token');
    showLogin();
}

// ======================================================
//                 INICIALIZACIÓN GENERAL
// ======================================================

document.addEventListener('DOMContentLoaded', async () => {

    if (!localStorage.getItem('auth_token')) {
        showLogin();
    } else {
        showApp();
    }

    // Login Form Handler
    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = document.getElementById('login-user').value;
        const pass = document.getElementById('login-pass').value;
        const errorEl = document.getElementById('login-error');
        
        const token = btoa(`${user}:${pass}`);
        
        try {
            const res = await originalFetch('/api/products', {
                headers: { 'Authorization': `Basic ${token}` }
            });
            
            if (res.ok) {
                localStorage.setItem('auth_token', token);
                errorEl.style.display = 'none';
                e.target.reset();
                showApp();
                init();
            } else {
                errorEl.style.display = 'block';
            }
        } catch (err) {
            errorEl.innerText = "Error de conexión";
            errorEl.style.display = 'block';
        }
    });

// ======================================================
//                 INICIALIZACIÓN GENERAL
// ======================================================

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
    if (view === 'suppliers-global') await fetchGlobalSuppliers();
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

        const isBebida = p.type === "BEBIDAS";
        const p100 = isBebida ? "" : `$${formatMoney(p.price_100g)}`;
        const p150 = isBebida ? "" : `$${formatMoney(p.price_150g)}`;
        const p250 = isBebida ? "" : `$${formatMoney(p.price_250g)}`;

        // Convert type to lowercase and replace spaces to create a safe CSS class
        const typeClass = `row-${p.type.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        const tr = document.createElement('tr');
        tr.className = typeClass;
        tr.innerHTML = `
            <td class="prod-name"><strong>${p.name}</strong></td>
            <td class="prod-type">${p.type}</td>
            <td class="prod-cost" data-value="${p.cost}">$${formatMoney(p.cost)}</td>
            <td class="prod-margin" data-value="${p.margin}">${p.margin}%</td>
            <td class="prod-pricekg" data-value="${p.price_kg}"><strong>$${formatMoney(p.price_kg)}</strong></td>
            <td class="prod-price100" data-value="${p.price_100g}">${p100}</td>
            <td class="prod-price150" data-value="${p.price_150g}">${p150}</td>
            <td class="prod-price250" data-value="${p.price_250g}">${p250}</td>
            <td style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" onclick="openEditProduct(${p.id})">✏️</button>
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
            days[day] += row.net_income;
        }
    });

    return days;
}

function renderWeekdayDistribution(currentMonthRows) {
    const data = calculateWeekdayDistribution(currentMonthRows);

    const counts = {
        "LUNES": 0, "MARTES": 0, "MIÉRCOLES": 0, "JUEVES": 0,
        "VIERNES": 0, "SÁBADO": 0, "DOMINGO": 0
    };
    currentMonthRows.forEach(row => {
        const day = row.weekday ? row.weekday.toUpperCase() : "";
        if (counts[day] !== undefined) counts[day]++;
    });

    const labels = Object.keys(data).map(day => {
        const text = `${day} (${counts[day]})`;
        return day === "DOMINGO" ? `${text} (Medio Turno)` : text;
    });
    const values = Object.values(data);
    const keys = Object.keys(data);

    let maxVal = -Infinity;
    let minVal = Infinity;
    keys.forEach(day => {
        if (day !== "DOMINGO") {
            const v = data[day];
            if (v > maxVal) maxVal = v;
            if (v < minVal && v > 0) minVal = v; // only consider days with some value as min
        }
    });

    const bgColors = keys.map(day => {
        const v = data[day];
        if (day === "DOMINGO") return "rgba(156, 163, 175, 0.4)"; // muted color for medio turno
        if (v === maxVal && v > 0) return "rgba(16, 185, 129, 0.8)"; // success-color
        if (v === minVal && v > 0) return "rgba(239, 68, 68, 0.8)"; // danger-color
        return "rgba(99, 102, 241, 0.6)";
    });

    const ctx = document.getElementById("chart-weekday-distribution").getContext("2d");

    if (charts.weekday) charts.weekday.destroy();

    charts.weekday = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Ingresos por Día",
                data: values,
                backgroundColor: bgColors,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { display: false } }
        }
    });
}

// ======================================================
//                 AGREGAR PRODUCTO
// ======================================================

function updateAddProductPrice() {
    const cost = parseFloat(document.getElementById("prod-cost").value) || 0;
    const margin = parseFloat(document.getElementById("prod-margin").value) || 0;
    const newPrice = calculatePrices(cost, margin);
    document.getElementById("prod-new-price").value = newPrice;
}

function updateAddProductMargin() {
    const cost = parseFloat(document.getElementById("prod-cost").value) || 0;
    const newPrice = parseFloat(document.getElementById("prod-new-price").value) || 0;
    if (cost > 0) {
        const exactMargin = ((newPrice / cost) - 1) * 100;
        document.getElementById("prod-margin").value = exactMargin.toFixed(2);
    } else {
        document.getElementById("prod-margin").value = 0;
    }
}

document.getElementById("prod-cost").addEventListener("input", updateAddProductPrice);
document.getElementById("prod-margin").addEventListener("input", updateAddProductPrice);
document.getElementById("prod-new-price").addEventListener("input", updateAddProductMargin);

document.getElementById('add-product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Guardando...";

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

    btn.disabled = false;
    btn.innerText = originalText;
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

function updateNewMargin() {
    const cost = parseFloat(document.getElementById("edit-product-cost").value) || 0;
    const newPrice = parseFloat(document.getElementById("edit-product-new-price").value) || 0;
    if (cost > 0) {
        const exactMargin = ((newPrice / cost) - 1) * 100;
        document.getElementById("edit-product-margin").value = exactMargin.toFixed(2);
    } else {
        document.getElementById("edit-product-margin").value = 0;
    }
}


function openEditProduct(id) {
    const p = state.products.find(x => x.id === id);

    document.getElementById("edit-product-id").value = p.id;
    document.getElementById("edit-product-name").value = p.name;
    document.getElementById("edit-product-type").value = p.type;
    document.getElementById("edit-product-cost").value = p.cost;
    document.getElementById("edit-product-margin").value = p.margin;
    document.getElementById("edit-product-old-cost").value = p.cost;
    document.getElementById("edit-product-old-price").value = p.price_kg;

    updateNewPrice();
    toggleModal("modal-edit-product");
}

document.getElementById("edit-product-cost").addEventListener("input", updateNewPrice);
document.getElementById("edit-product-margin").addEventListener("input", updateNewPrice);
document.getElementById("edit-product-new-price").addEventListener("input", updateNewMargin);

document.getElementById("edit-product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Guardando...";

    const id = document.getElementById("edit-product-id").value;
    const name = document.getElementById("edit-product-name").value;
    const type = document.getElementById("edit-product-type").value;
    const cost = parseFloat(document.getElementById("edit-product-cost").value);
    const margin = parseFloat(document.getElementById("edit-product-margin").value);
    

    const payload = { name, type, cost, margin };

    await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    btn.disabled = false;
    btn.innerText = originalText;
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
    
    const sel = document.getElementById('sup-id');
    sel.innerHTML = '<option value="">Seleccionar Proveedor...</option>';
    state.suppliers.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.innerText = s.name;
        sel.appendChild(opt);
    });

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

        const dateStr = s.updated_at ? new Date(s.updated_at).toLocaleDateString('es-AR') : '-';
        tr.innerHTML = `
            <td>${isMin ? '🟢 ' : ''}${s.supplier_name}</td>
            <td style="font-weight:${isMin ? 'bold' : 'normal'}; color:${isMin ? 'var(--success-color)' : 'inherit'}">
                $${formatMoney(s.cost)}
            </td>
            <td style="font-size:0.85em; color:#666;">${dateStr}</td>
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
        supplier_id: parseInt(document.getElementById('sup-id').value),
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
//                 TOGGLE MODAL (CORREGIDO)
// =====================================================

function toggleModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    if (modal.classList.contains("hidden")) {
        modal.classList.remove("hidden");
        modal.classList.add("active");
    } else {
        modal.classList.remove("active");
        modal.classList.add("hidden");
    }
}

// =====================================================
//     FIX DEFINITIVO — FECHAS SIN DESFASE UTC
// =====================================================
function getWeekdayFromDate(dateString) {
    const [year, month, day] = dateString.split("-");
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("es-AR", { weekday: "long" }).toUpperCase();
}

// =====================================================
//                 CAJA DIARIA
// =====================================================

// --- AUTO-COMPLETAR DÍA AL ELEGIR FECHA (ALTA) ---
document.getElementById("cash-date").addEventListener("change", (e) => {
    const date = e.target.value;
    if (!date) return;

    document.getElementById("cash-weekday").value = getWeekdayFromDate(date);
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

        const weekday = (r.weekday || getWeekdayFromDate(date)).toUpperCase();

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

    if (!state.cash || state.cash.length === 0) return;

    // Agrupar por mes
    const byMonth = {};
    state.cash.forEach(c => {
        const month = c.date.slice(0, 7); // YYYY-MM
        if (!byMonth[month]) {
            byMonth[month] = {
                rows: [],
                cashTotal: 0,
                cardTotal: 0,
                netTotal: 0,
                expensesTotal: 0,
                profitTotal: 0
            };
        }
        byMonth[month].rows.push(c);
        byMonth[month].cashTotal += c.cash;
        byMonth[month].cardTotal += c.card;
        byMonth[month].netTotal += c.net_income;
        byMonth[month].expensesTotal += c.expenses;
        byMonth[month].profitTotal += c.total;
    });

    // Ordenar los meses de forma descendente (el más reciente arriba)
    const sortedMonths = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));
    const currentMonth = sortedMonths[0];

    sortedMonths.forEach(month => {
        const mData = byMonth[month];
        const isCurrent = month === currentMonth;
        
        // Crear fila cabecera del mes
        const headerTr = document.createElement('tr');
        headerTr.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
        headerTr.style.cursor = 'pointer';
        headerTr.innerHTML = `
            <td colspan="2" style="font-weight: bold; font-size: 1.1em; color: var(--text-color);">
                <span style="display: inline-block; width: 20px;">${isCurrent ? '▼' : '▶'}</span>
                ${formatMonthLiteral(month)}
            </td>
            <td style="font-weight: bold;">$${formatMoney(mData.cashTotal)}</td>
            <td style="font-weight: bold;">$${formatMoney(mData.cardTotal)}</td>
            <td style="font-weight: bold; color: var(--primary-color);">$${formatMoney(mData.netTotal)}</td>
            <td style="font-weight: bold;">$${formatMoney(mData.expensesTotal)}</td>
            <td style="font-weight: bold; font-size: 1.1em; color: ${mData.profitTotal >= 0 ? 'var(--success-color)' : 'var(--danger-color)'};">
                $${formatMoney(mData.profitTotal)}
            </td>
            <td></td>
        `;
        
        tbody.appendChild(headerTr);

        const monthRows = [];
        
        // Ordenar los días dentro del mes de forma descendente
        mData.rows.sort((a,b) => b.date.localeCompare(a.date));

        mData.rows.forEach(c => {
            const [y, m, d] = c.date.split('-');
            const formattedDate = `${d}/${m}/${y}`;

            const tr = document.createElement('tr');
            tr.style.display = isCurrent ? 'table-row' : 'none';
            // Añadir un poco de opacidad/estilo para diferenciar que son filas hijas
            tr.style.backgroundColor = 'transparent';
            tr.innerHTML = `
                <td style="padding-left: 2rem;">${formattedDate}</td>
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
                        onclick="openEditCash(${c.id})">✏️</button>
                    <button class="btn btn-danger" style="padding: 0.3rem 0.6rem;"
                        onclick="deleteCash(${c.id})">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
            monthRows.push(tr);
        });

        // Evento para expandir/colapsar
        headerTr.addEventListener('click', () => {
            const isExpanded = headerTr.querySelector('span').innerText === '▼';
            headerTr.querySelector('span').innerText = isExpanded ? '▶' : '▼';
            monthRows.forEach(tr => {
                tr.style.display = isExpanded ? 'none' : 'table-row';
            });
        });
    });
}

// =====================================================
//                 NUEVO REGISTRO
// =====================================================

document.getElementById('cash-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Guardando...";

    const date = document.getElementById('cash-date').value;
    let weekday = document.getElementById('cash-weekday').value;

    if (!weekday) weekday = getWeekdayFromDate(date);

    const payload = {
        date,
        weekday,
        cash: parseFloat(document.getElementById('cash-cash').value || 0),
        card: parseFloat(document.getElementById('cash-card').value || 0),
        expenses: parseFloat(document.getElementById('cash-expenses').value || 0)
    };

    await fetch('/api/cash', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    btn.disabled = false;
    btn.innerText = originalText;
    e.target.reset();
    fetchCash();
});

// =====================================================
//                 EDITAR REGISTRO
// =====================================================

function openEditCash(id) {
    const c = state.cash.find(x => x.id == id);
    if(!c) return;

    document.getElementById('edit-cash-id').value = c.id;
    document.getElementById('edit-cash-date').value = c.date;
    document.getElementById('edit-cash-weekday').value = c.weekday || '';
    document.getElementById('edit-cash-cash').value = c.cash;
    document.getElementById('edit-cash-card').value = c.card;
    document.getElementById('edit-cash-expenses').value = c.expenses || 0;

    toggleModal('modal-edit-cash');
}

document.getElementById("edit-cash-date").addEventListener("change", (e) => {
    const date = e.target.value;
    if (!date) return;

    document.getElementById("edit-cash-weekday").value = getWeekdayFromDate(date);
});

document.getElementById('edit-cash-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Guardando...";

    const id = document.getElementById('edit-cash-id').value;
    const date = document.getElementById('edit-cash-date').value;

    let weekday = document.getElementById('edit-cash-weekday').value;
    if (!weekday) weekday = getWeekdayFromDate(date);

    const payload = {
        date,
        weekday,
        cash: parseFloat(document.getElementById('edit-cash-cash').value || 0),
        card: parseFloat(document.getElementById('edit-cash-card').value || 0),
        expenses: parseFloat(document.getElementById('edit-cash-expenses').value || 0)
    };

    await fetch(`/api/cash/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    btn.disabled = false;
    btn.innerText = originalText;
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
let selectedMonth = '';

async function fetchDashboard() {
    // We don't even need /api/dashboard anymore because we have state.cash and state.expenseCategories
    // Let's populate the month filter
    populateMonthFilter();
    renderDashboard();
}

function populateMonthFilter() {
    const cashData = state.cash || [];
    const filter = document.getElementById('dashboard-month-filter');
    if(!filter) return;
    
    const months = [...new Set(cashData.map(r => r.date.slice(0, 7)))].sort().reverse();
    
    filter.innerHTML = '';
    months.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.innerText = formatMonthLiteral(m);
        filter.appendChild(opt);
    });
    
    // Default to most recent month
    if(months.length > 0) {
        selectedMonth = months[0];
        filter.value = selectedMonth;
    }
    
    filter.addEventListener('change', (e) => {
        selectedMonth = e.target.value;
        renderDashboard();
    });
}

function renderDashboard() {
    const cashData = state.cash || [];
    
    // Historic Calculations
    const histRevenue = cashData.reduce((acc, r) => acc + r.net_income, 0);
    const histExpenses = cashData.reduce((acc, r) => acc + r.expenses, 0);
    const histProfit = cashData.reduce((acc, r) => acc + r.total, 0);
    
    document.getElementById('hist-revenue').innerText = `$${formatMoney(histRevenue)}`;
    document.getElementById('hist-expenses').innerText = `$${formatMoney(histExpenses)}`;
    document.getElementById('hist-profit').innerText = `$${formatMoney(histProfit)}`;
    
    // Filter by selected month
    const monthRows = cashData.filter(r => r.date.startsWith(selectedMonth));
    
    // Current Month KPIs
    const rev = monthRows.reduce((acc, r) => acc + r.net_income, 0);
    const exp = monthRows.reduce((acc, r) => acc + r.expenses, 0);
    const prof = monthRows.reduce((acc, r) => acc + r.total, 0);
    
    document.getElementById('kpi-revenue').innerText = `$${formatMoney(rev)}`;
    document.getElementById('kpi-expenses').innerText = `$${formatMoney(exp)}`;
    document.getElementById('kpi-profit').innerText = `$${formatMoney(prof)}`;
    
    // Update period labels
    const periodStr = formatMonthLiteral(selectedMonth);
    document.querySelectorAll('.kpi-period').forEach(el => el.innerText = periodStr);
    
    // Trend logic (compare selected month vs previous)
    const months = [...new Set(cashData.map(r => r.date.slice(0, 7)))].sort();
    const idx = months.indexOf(selectedMonth);
    if (idx > 0) {
        const prevMonth = months[idx - 1];
        const prevRows = cashData.filter(r => r.date.startsWith(prevMonth));
        const pRev = prevRows.reduce((acc, r) => acc + r.net_income, 0);
        const pExp = prevRows.reduce((acc, r) => acc + r.expenses, 0);
        const pProf = prevRows.reduce((acc, r) => acc + r.total, 0);
        
        const diffVentas = rev - pRev;
        const diffGastos = exp - pExp;
        const diffGanancia = prof - pProf;
        
        const fmtDiff = (v) => `${v >= 0 ? '▲' : '▼'} $${formatMoney(Math.abs(v))}`;
        document.getElementById('trend-ventas').innerText = fmtDiff(diffVentas);
        document.getElementById('trend-gastos').innerText = fmtDiff(diffGastos);
        document.getElementById('trend-ganancia').innerText = fmtDiff(diffGanancia);
    } else {
        document.getElementById('trend-ventas').innerText = '—';
        document.getElementById('trend-gastos').innerText = '—';
        document.getElementById('trend-ganancia').innerText = '—';
    }

    // Limpiar gráficos
    Object.values(charts).forEach(c => c && c.destroy && c.destroy());
    charts = {};
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Inter';

    // 1. Daily Sales Chart (Mes en curso)
    const currentMonthStr = new Date().toISOString().slice(0, 7);
    const currentMonthRows = cashData.filter(r => r.date.startsWith(currentMonthStr));
    renderDailySalesChart(currentMonthRows);
    
    // 3. Efectivo vs Tarjeta (For the selected month)
    renderPaymentChart(monthRows);
    
    // 4. Comparativo mensual (Todos los meses acumulando beneficio)
    renderMonthlyComparisonChart(cashData);

    // 5. Distribución y Ranking por Día
    if (typeof renderWeekdayDistribution === 'function') {
        renderWeekdayDistribution(currentMonthRows);
    }
    if (typeof calculateMonthlyDayRanking === 'function' && typeof renderMonthlyDayRanking === 'function') {
        const stats = calculateMonthlyDayRanking(cashData);
        renderMonthlyDayRanking(stats);
    }
}

function renderDailySalesChart(rows) {
    const sorted = [...rows].sort((a,b) => a.date.localeCompare(b.date));
    const labels = sorted.map(r => {
        const day = r.date.split("-")[2];
        const initial = r.weekday ? r.weekday.charAt(0) : "";
        return `${initial} ${day}`;
    });
    const values = sorted.map(r => r.net_income);

    const weekColors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
    let currentWeekIndex = 0;
    let lastWeekday = -1;
    const bgColors = [];
    const weeklyTotals = [];

    sorted.forEach(r => {
        const dateParts = r.date.split("-");
        const date = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
        const weekday = date.getDay() === 0 ? 6 : date.getDay() - 1;
        if (lastWeekday !== -1 && weekday < lastWeekday) currentWeekIndex++;
        lastWeekday = weekday;
        
        bgColors.push(weekColors[currentWeekIndex % weekColors.length]);
        if (!weeklyTotals[currentWeekIndex]) weeklyTotals[currentWeekIndex] = 0;
        weeklyTotals[currentWeekIndex] += r.net_income;
    });

    const canvas = document.getElementById("chart-daily-sales");
    if (canvas) {
        charts.dailySales = new Chart(canvas.getContext("2d"), {
            type: "bar",
            data: { labels, datasets: [{ data: values, backgroundColor: bgColors, borderRadius: 6 }] },
            options: { responsive: true, scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } }
        });
    }

    const totalsDiv = document.getElementById("weekly-totals");
    if (totalsDiv) {
        let html = "<div style='display:flex; justify-content:center; gap: 10px; flex-wrap:wrap;'>";
        weeklyTotals.forEach((tot, i) => {
            if (tot > 0) {
                html += `<div style="padding:0.4rem 0.8rem; background:${weekColors[i%weekColors.length]}22; border-left:4px solid ${weekColors[i%weekColors.length]}; border-radius:6px; font-size:0.9rem;">Semana ${i+1}: <strong style="color:white">$${formatMoney(tot)}</strong></div>`;
            }
        });
        html += "</div>";
        totalsDiv.innerHTML = html;
    }
}



function renderPaymentChart(rows) {
    const totalCash = rows.reduce((acc, r) => acc + r.cash, 0);
    const totalCard = rows.reduce((acc, r) => acc + r.card, 0);
    
    const canvas = document.getElementById('chart-payment');
    if(!canvas) return;
    
    charts.payment = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Efectivo', 'Tarjeta'],
            datasets: [{
                data: [totalCash, totalCard],
                backgroundColor: ['#10b981', '#3b82f6'],
                borderRadius: 4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, indexAxis: 'y', barThickness: 20 }
    });
}

function renderMonthlyComparisonChart(cashData) {
    const byMonth = {};
    cashData.forEach(r => {
        const month = r.date.slice(0, 7);
        if (!byMonth[month]) byMonth[month] = { total: 0 };
        byMonth[month].total += r.total;
    });

    const months = Object.keys(byMonth).sort();
    const labels = months.map(m => formatMonthLiteral(m));
    const totals = months.map(m => byMonth[m].total);

    const canvas = document.getElementById('chart-month-compare');
    if (!canvas) return;
    
    charts.monthCompare = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Beneficio Neto',
                data: totals,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                fill: true,
                tension: 0.4
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
    });
}

// --- INICIALIZACIÓN DE LA APP ---
async function init() {
    if (!localStorage.getItem('auth_token')) return;
    await fetchExpenseCategories();
    await fetchGlobalSuppliers();
    await fetchCash(); // fetchCash also calls renderDashboard when loading
    await fetchDashboard();
    await fetchProducts();
}
window.onload = init;
// =====================================================
//                 MENÚ MÓVIL

// ---------- Ranking de días del mes ----------
function calculateMonthlyDayRanking(cashData) {
    const byMonth = {};

    // Agrupar por mes
    cashData.forEach(r => {
        const month = r.date.slice(0, 7);
        if (!byMonth[month]) byMonth[month] = [];
        byMonth[month].push(r);
    });

    const result = [];

    Object.keys(byMonth).sort().reverse().forEach(month => {
        const rows = byMonth[month];

        // Acumulador por día de la semana
        const totalsByWeekday = {
            LUNES: 0,
            MARTES: 0,
            MIÉRCOLES: 0,
            JUEVES: 0,
            VIERNES: 0,
            SÁBADO: 0,
            DOMINGO: 0
        };

        rows.forEach(r => {
            const day = r.weekday ? r.weekday.toUpperCase() : "";
            if(totalsByWeekday[day] !== undefined) {
                totalsByWeekday[day] += r.net_income;
            }
        });

        // Convertir a array y ordenar de mayor a menor (excluyendo domingo)
        const ranking = Object.entries(totalsByWeekday)
            .filter(([weekday]) => weekday !== "DOMINGO")
            .map(([weekday, total]) => ({ weekday, total }))
            .sort((a, b) => b.total - a.total);

        const domingoTotal = totalsByWeekday["DOMINGO"];

        result.push({
            month,
            ranking,
            domingoTotal
        });
    });

    return result;
}

function renderMonthlyDayRanking(stats) {
    const tbody = document.querySelector('#ranking-days-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    stats.forEach(row => {
        const tr = document.createElement('tr');

        // Crear lista ordenada de días
        const rankingList = row.ranking
            .map((r, i) => {
                const isBest = i === 0;
                const isWorst = i === row.ranking.length - 1;
                const color =
                    isBest ? "var(--success-color)" :   // mejor día
                    isWorst ? "var(--danger-color)" :    // peor día
                    "inherit";

                return `<div style="color:${color}; font-weight:${isBest || isWorst ? 'bold' : 'normal'};">
                            ${i + 1}. ${r.weekday} — $${formatMoney(r.total)}
                        </div>`;
            })
            .join("");

        const domingoText = `<div style="color:#9ca3af; font-style: italic; margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;">
                                - DOMINGO (Medio Turno) — $${formatMoney(row.domingoTotal)}
                             </div>`;

        tr.innerHTML = `
            <td style="vertical-align:top;">${formatMonthLiteral(row.month)}</td>
            <td>${rankingList}${domingoText}</td>
        `;

        tbody.appendChild(tr);
    });
}

// =====================================================
//             GASTOS Y CATEGORÍAS (FALTANTES)
// =====================================================

async function fetchExpenseCategories() {
    try {
        const res = await fetch('/api/expense-categories');
        if (!res.ok) throw new Error("Error cargando categorías de gastos");
        const data = await res.json();
        state.expenseCategories = data;
        renderExpenseCategories();
    } catch (err) {
        console.error("Error al cargar categorías de gastos:", err);
    }
}

function renderExpenseCategories() {
    const tbody = document.querySelector('#expense-categories-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    state.expenseCategories.forEach(cat => {
        const tr = document.createElement('tr');
        const deleteBtn = cat.is_custom 
            ? `<button class="btn btn-danger" onclick="deleteExpenseCategory(${cat.id})" style="padding: 0.3rem 0.6rem;">🗑️</button>` 
            : `<span style="color: #666; font-size: 0.85rem;">Predef.</span>`;
            
        tr.innerHTML = `
            <td>${cat.name}</td>
            <td style="text-align: right;">${deleteBtn}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteExpenseCategory(id) {
    if (!confirm('¿Eliminar esta categoría de gastos?')) return;
    try {
        const res = await fetch(`/api/expense-categories/${id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            showToast("Categoría eliminada", "success");
            await fetchExpenseCategories();
        } else {
            const err = await res.json();
            showToast(err.detail || "Error al eliminar la categoría", "error");
        }
    } catch (err) {
        showToast("Error de conexión", "error");
    }
}

// Escuchador de formulario de categorías
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('add-expense-category-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('new-exp-cat-name');
        const name = nameInput.value.trim();
        if (!name) return;
        
        try {
            const res = await fetch('/api/expense-categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (res.ok) {
                nameInput.value = '';
                showToast("Categoría agregada correctamente", "success");
                await fetchExpenseCategories();
            } else {
                const err = await res.json();
                showToast(err.detail || "Error al agregar categoría", "error");
            }
        } catch (err) {
            showToast("Error de conexión", "error");
        }
    });
});

// =====================================================
//             PROVEEDORES GLOBALES (FALTANTES)
// =====================================================

async function fetchGlobalSuppliers() {
    try {
        const res = await fetch('/api/suppliers');
        if (!res.ok) throw new Error("Error cargando proveedores");
        const data = await res.json();
        state.suppliers = data;
        renderGlobalSuppliers();
    } catch (err) {
        console.error("Error al cargar proveedores:", err);
    }
}

function renderGlobalSuppliers() {
    const tbody = document.querySelector('#global-suppliers-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (state.suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Sin proveedores registrados</td></tr>';
        return;
    }
    
    state.suppliers.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${s.name}</td>
            <td>${s.phone || '-'}</td>
            <td>${s.email || '-'}</td>
            <td>${s.salesperson || '-'}</td>
            <td style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" onclick="openEditGlobalSupplier(${s.id})" style="padding: 0.3rem 0.6rem;">✏️</button>
                <button class="btn btn-danger" onclick="deleteGlobalSupplier(${s.id})" style="padding: 0.3rem 0.6rem;">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openAddGlobalSupplier() {
    document.getElementById('global-supplier-modal-title').innerText = "Nuevo Proveedor";
    document.getElementById('gs-id').value = "";
    document.getElementById('gs-name').value = "";
    document.getElementById('gs-phone').value = "";
    document.getElementById('gs-email').value = "";
    document.getElementById('gs-salesperson').value = "";
    toggleModal('modal-global-supplier');
}

function openEditGlobalSupplier(id) {
    const s = state.suppliers.find(x => x.id === id);
    if (!s) return;
    document.getElementById('global-supplier-modal-title').innerText = "Editar Proveedor";
    document.getElementById('gs-id').value = s.id;
    document.getElementById('gs-name').value = s.name;
    document.getElementById('gs-phone').value = s.phone || "";
    document.getElementById('gs-email').value = s.email || "";
    document.getElementById('gs-salesperson').value = s.salesperson || "";
    toggleModal('modal-global-supplier');
}

async function deleteGlobalSupplier(id) {
    if (!confirm('¿Eliminar este proveedor de forma global?')) return;
    try {
        const res = await fetch(`/api/suppliers/${id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            showToast("Proveedor eliminado", "success");
            await fetchGlobalSuppliers();
        } else {
            showToast("Error al eliminar proveedor", "error");
        }
    } catch (err) {
        showToast("Error de conexión", "error");
    }
}

// Escuchador de formulario de proveedores
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('global-supplier-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('gs-id').value;
        const payload = {
            name: document.getElementById('gs-name').value.trim(),
            phone: document.getElementById('gs-phone').value.trim() || null,
            email: document.getElementById('gs-email').value.trim() || null,
            salesperson: document.getElementById('gs-salesperson').value.trim() || null
        };
        
        try {
            let res;
            if (id) {
                res = await fetch(`/api/suppliers/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch(`/api/suppliers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }
            
            if (res.ok) {
                showToast(id ? "Proveedor actualizado" : "Proveedor creado", "success");
                toggleModal('modal-global-supplier');
                await fetchGlobalSuppliers();
            } else {
                showToast("Error al guardar proveedor", "error");
            }
        } catch (err) {
            showToast("Error de conexión", "error");
        }
    });
});

