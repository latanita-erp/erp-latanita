// --- ESTADO GLOBAL ---
let state = {
    token: null,
    products: [],
    cash: [],
    dashboard: null
};

function formatMoney(val) {
    return val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMonthLiteral(monthStr) {
    if (!monthStr || monthStr.length !== 7) return monthStr;
    const [year, month] = monthStr.split('-');
    const monthNames = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
    const monthIndex = parseInt(month, 10) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
        return `${monthNames[monthIndex]}-${year}`;
    }
    return monthStr;
}

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    // Check if already logged in (mock)
    if (localStorage.getItem('erp_token')) {
        state.token = localStorage.getItem('erp_token');
        showApp();
    }

    // Nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            document.querySelectorAll('.view').forEach(v => {
                v.classList.remove('active');
                v.classList.add('hidden');
            });
            document.getElementById(e.target.dataset.target).classList.remove('hidden');
            document.getElementById(e.target.dataset.target).classList.add('active');
            
            loadData(e.target.dataset.target);
        });
    });

    // Excel upload listener
    document.getElementById('excel-file').addEventListener('change', handleExcelUpload);
});

// --- UI UTILS ---
function toggleModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;

    modal.classList.toggle("active");
}

// --- LOGIN ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username: u, password: p})
        });
        if (res.ok) {
            const data = await res.json();
            localStorage.setItem('erp_token', data.token);
            state.token = data.token;
            showApp();
        } else {
            document.getElementById('login-error').innerText = 'Credenciales incorrectas';
        }
    } catch (err) {
        document.getElementById('login-error').innerText = 'Error de conexión';
    }
});

function showApp() {
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    loadData('dashboard'); // default view
}

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('erp_token');
    window.location.reload();
});

// --- TOAST DE MENSAJES (ÉXITO / ERROR) ---
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


// --- CARGA DE DATOS ---
async function loadData(view) {
    if (view === 'products') await fetchProducts();
    if (view === 'cash') await fetchCash();
    if (view === 'dashboard') await fetchDashboard();
}

// --- PRODUCTOS ---
async function fetchProducts() {
    const res = await fetch('/api/products');
    const data = await res.json();

    // Convertir cost y margin a número SIEMPRE
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

// --- AGREGAR PRODUCTO ---
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

// --- ELIMINAR PRODUCTO ---
async function deleteProduct(id) {
    if(confirm('¿Eliminar producto?')) {
        await fetch(`/api/products/${id}`, { method: 'DELETE' });
        fetchProducts();
    }
}

// --- IMPORTAR EXCEL ---
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
    e.target.value = ''; // reset input
}

// --- EDITAR PRODUCTO (NUEVO) ---
function calculatePrices(cost, margin) {
    const base = cost * (1 + margin / 100);
    const priceKg = Math.ceil(base / 100) * 100;
    return priceKg;
}

function updateNewPrice() {
    const cost = parseFloat(document.getElementById("edit-product-cost").value) || 0;
    const margin = parseFloat(document.getElementById("edit-product-margin").value) || 0;

    const newPrice = calculatePrices(cost, margin);
    document.getElementById("edit-product-new-price").value = newPrice;
}

// NUEVO: calcular precio promo automáticamente
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

    // NUEVO: cargar precio 250 g
    document.getElementById("edit-product-price250").value = p.price_250g;

    // NUEVO: cargar promoción
    document.getElementById("edit-product-promotion").value = p.promotion || 0;

    // NUEVO: calcular precio promo si existe
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

// NUEVO: escuchar cambios en el % de descuento
document.getElementById("edit-product-promotion").addEventListener("input", updatePromoPrice);

document.getElementById("edit-product-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("edit-product-id").value;
    const cost = parseFloat(document.getElementById("edit-product-cost").value);
    const margin = parseFloat(document.getElementById("edit-product-margin").value);
    const promotion = Number(document.getElementById("edit-product-promotion").value);

    // NUEVO: incluir promoción en el payload
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
// ⭐ BACKUP DEL ÚLTIMO AUMENTO MASIVO
// =====================================================
let lastMassUpdateBackup = null;

// --- AJUSTE MASIVO DE MÁRGENES (MEJORADO) ---
document.getElementById("mass-margin-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = e.submitter;
    const value = parseFloat(document.getElementById("mass-margin-value").value);

    if (isNaN(value)) {
        showToast("Ingresá un número válido", "error");
        return;
    }

    // 🔒 Deshabilitar botón para evitar doble clic
    btn.disabled = true;
    btn.innerText = "Aplicando...";

    try {
        // Guardar backup antes de modificar
        window.massBackup = state.products.map(p => ({
            id: p.id,
            oldMargin: p.margin,
            oldPriceKg: p.price_kg
        }));

        // Aplicar aumento a cada producto
        for (const p of state.products) {
            const newMargin = p.margin + value;
            const newPriceKg = p.cost * (1 + newMargin / 100);

            await fetch(`/api/products/${p.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${state.token}`
                },
                body: JSON.stringify({
                    margin: newMargin,
                    price_kg: newPriceKg
                })
            });
        }

        // 🔄 Recargar productos
        await loadData("products");

        // ✔ Cerrar modal
        toggleModal("modal-mass-margin");

        // ✔ Mostrar mensaje de éxito
        showToast(`Ajuste aplicado correctamente (+${value}%)`, "success");

        // 🔊 Sonido opcional
        const audio = new Audio("static/success.mp3");
        audio.volume = 0.3;
        audio.play();

    } catch (err) {
        console.error(err);
        showToast("Error aplicando el ajuste", "error");
    }

    // 🔓 Restaurar botón
    btn.disabled = false;
    btn.innerText = "Aplicar Aumento";
});


// =====================================================
// ⭐ DESHACER ÚLTIMO AUMENTO MASIVO
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

// --- LISTADO 100g (FIAMBRES Y QUESOS) – A4 COMPACTO ---
function generatePriceList100g() {

    // Filtrar solo FIAMBRES y QUESOS
    const filtered = state.products.filter(p =>
        p.type.toLowerCase() === "fiambre" ||
        p.type.toLowerCase() === "queso"
    );

    // Ordenar por tipo y luego por nombre
    const sorted = [...filtered].sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.name.localeCompare(b.name);
    });

    // Formato argentino
    function formatAr(num) {
        return Number(num).toLocaleString("es-AR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    // 👉 ARMAMOS EL HTML COMPLETO ANTES DE ABRIR LA VENTANA
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

    // 👉 ACA SE AGREGAN LOS DATOS
    sorted.forEach(p => {

        // Si existe price_100g lo usamos, si no lo calculamos
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
            window.onload = function() {
                window.print();
            };
        </script>

    </body>
    </html>
    `;

    // 👉 ABRIMOS LA VENTANA Y ESCRIBIMOS EL HTML COMPLETO
    const newWindow = window.open("", "_blank");
    newWindow.document.open();
    newWindow.document.write(html);
    newWindow.document.close();
}

// --- LISTADO TÉCNICO (COSTO / PRECIO KG / MARGEN) – BASADO EN LA GENERAL ---
function generateTechnicalList() {

    // Ordenar igual que la general
    const sorted = [...state.products].sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.name.localeCompare(b.name);
    });

    // Formato argentino
    function formatAr(num) {
        return Number(num).toLocaleString("es-AR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    // 👉 ARMAMOS EL HTML COMPLETO ANTES DE ABRIR LA VENTANA
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

    // 👉 ACA SE AGREGAN LOS DATOS (ANTES NO SE ESTABAN INSERTANDO)
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
            window.onload = function() {
                window.print();
            };
        </script>

    </body>
    </html>
    `;

    // 👉 AHORA SÍ: ABRIMOS LA VENTANA Y ESCRIBIMOS EL HTML COMPLETO
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
        if(isMin) tr.style.background = 'rgba(16, 185, 129, 0.1)';
        tr.innerHTML = `
            <td>${isMin ? '🟢 ' : ''}${s.supplier_name}</td>
            <td style="font-weight: ${isMin ? 'bold' : 'normal'}; color: ${isMin ? 'var(--success-color)' : 'inherit'}">$${formatMoney(s.cost)}</td>
            <td><button class="btn btn-danger" onclick="deleteSupplier(${productId}, ${s.id})" style="padding: 0.3rem 0.6rem;">❌</button></td>
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
    if(confirm('¿Eliminar proveedor?')) {
        await fetch(`/api/products/${productId}/suppliers/${supplierId}`, { method: 'DELETE' });
        await fetchSuppliers(productId);
        fetchProducts();
    }
}

// --- CAJA ---
async function fetchCash() {
    const res = await fetch('/api/cash');
    const raw = await res.json();

    state.cash = raw.map(r => {
        // Normalizar fecha
        let date = r.date || r.fecha || r.fecha_dt;
        if (date.includes("T")) date = date.split("T")[0]; // cortar hora si viene

        const weekday = r.weekday || r.dia || new Date(date).toLocaleDateString("es-AR", { weekday: "long" }).toUpperCase();

        const cash = r.cash ?? r.efectivo ?? 0;
        const card = r.card ?? r.electronico ?? 0;
        const expenses = r.expenses ?? r.gastos ?? 0;

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

function renderCash() {
    const tbody = document.querySelector('#cash-table tbody');
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
                <button class="btn btn-secondary" style="padding: 0.3rem 0.6rem;" onclick="openEditCash(${c.id}, '${c.date}', ${c.cash}, ${c.card}, ${c.expenses})">✏️</button>
                <button class="btn btn-danger" style="padding: 0.3rem 0.6rem;" onclick="deleteCash(${c.id})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('cash-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        date: document.getElementById('cash-date').value,
        weekday: document.getElementById('cash-weekday').value,
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

function openEditCash(id, date, cash, card, expenses) {
    document.getElementById('edit-cash-id').value = id;
    const [y, m, d] = date.split('-');
    document.getElementById('edit-cash-date').innerText = `${d}/${m}/${y}`;
    document.getElementById('edit-cash-cash').value = cash;
    document.getElementById('edit-cash-card').value = card;
    document.getElementById('edit-cash-expenses').value = expenses;
    toggleModal('modal-edit-cash');
}

document.getElementById('edit-cash-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-cash-id').value;
    const payload = {
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

async function deleteCash(id) {
    if(confirm('¿Eliminar este registro de caja?')) {
        await fetch(`/api/cash/${id}`, { method: 'DELETE' });
        fetchCash();
    }
}

// --- DASHBOARD (CHART.JS) ---
let charts = {};

async function fetchDashboard() {
    const res = await fetch('/api/dashboard');
    state.dashboard = await res.json();
    renderDashboard();
}

function renderDashboard() {
    const d = state.dashboard;
    
    // KPIs
    document.getElementById('kpi-revenue').innerText = `$${formatMoney(d.kpis.total_revenue)}`;
    document.getElementById('kpi-expenses').innerText = `$${formatMoney(d.kpis.total_expenses)}`;
    document.getElementById('kpi-profit').innerText = `$${formatMoney(d.kpis.total_profit)}`;

    // Destroy old charts if exist
    Object.values(charts).forEach(c => c.destroy());

    // Config global Chart.js
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Inter';
    Chart.defaults.plugins.tooltip.callbacks.label = function(context) {
        let label = context.dataset.label || '';
        if (label) { label += ': '; }
        if (context.parsed.y !== null && typeof context.parsed.y !== 'undefined') {
            label += '$' + formatMoney(context.parsed.y);
        } else if (context.parsed !== null && typeof context.parsed !== 'undefined') {
            label += '$' + formatMoney(context.parsed);
        }
        return label;
    };

    // 1. Mensual (Bar)
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

    // 2. Métodos de pago (Bar comparativo por mes)
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
        options: { 
            responsive: true,
            plugins: {
                legend: { position: 'top', labels: { color: '#94a3b8' } }
            },
            scales: {
                x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });

    // 3. Semanal (Breakdown por mes)
    const container = document.getElementById('weekly-breakdown-container');
    container.innerHTML = '';
    
    if (Object.keys(d.weekly_breakdown).length === 0) {
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
            html += `<table class="table" style="font-size: 0.95rem;">
                        <tbody>`;
            d.weekly_breakdown[month].forEach(w => {
                html += `<tr>
                            <td>Semana del <strong>${w.week}</strong></td>
                            <td style="text-align: right; font-weight: bold; color: ${w.total >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}">
                                $${formatMoney(w.total)}
                            </td>
                         </tr>`;
            });
            html += `   </tbody>
                     </table>`;
            monthDiv.innerHTML = html;
            container.appendChild(monthDiv);
        });
    }

    // ⭐ 4. Mejor y Peor Día por Mes (USANDO state.cash REAL)
    const stats = calculateMonthlyDayStats(state.cash);
    renderBestWorstTable(stats);

    // ⭐ 5. Comparativo Mensual (USANDO state.cash REAL)
    renderMonthlyComparisonChart(state.cash);
}

// --- CALCULAR MEJOR Y PEOR DÍA POR MES (COMPATIBLE CON TU JSON REAL) ---
function calculateMonthlyDayStats(cashData) {
    const months = {};

    cashData.forEach(row => {
        const [y, m] = row.date.split("-");
        const monthKey = `${y}-${m}`;
        const weekday = row.weekday.toUpperCase();
        const gain = row.total;

        if (!months[monthKey]) months[monthKey] = {};
        if (!months[monthKey][weekday]) months[monthKey][weekday] = 0;

        months[monthKey][weekday] += gain;
    });

    return months;
}

// --- RENDER TABLA MEJOR/PEOR DÍA ---
function renderBestWorstTable(stats) {
    const tbody = document.querySelector("#best-worst-table tbody");
    tbody.innerHTML = "";

    Object.keys(stats).sort().forEach(month => {
        const days = stats[month];
        const entries = Object.entries(days);

        const best = entries.reduce((a,b) => a[1] > b[1] ? a : b);
        const worst = entries.reduce((a,b) => a[1] < b[1] ? a : b);

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${month}</td>
            <td>${best[0]} ($${formatMoney(best[1])})</td>
            <td>${worst[0]} ($${formatMoney(worst[1])})</td>
        `;
        tbody.appendChild(tr);
    });
}

// --- GRÁFICO COMPARATIVO MENSUAL (COMPATIBLE CON TU JSON REAL) ---
function renderMonthlyComparisonChart(cashData) {
    const monthly = {};

    cashData.forEach(row => {
        const [y, m] = row.date.split("-");
        const key = `${y}-${m}`;

        if (!monthly[key]) monthly[key] = 0;
        monthly[key] += row.total;
    });

    const labels = Object.keys(monthly).sort();
    const values = labels.map(m => monthly[m]);

    new Chart(document.getElementById("chart-month-compare"), {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Ganancia por Mes",
                data: values,
                backgroundColor: "rgba(0, 150, 255, 0.6)"
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

