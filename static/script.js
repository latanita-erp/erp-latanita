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
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        modal.classList.add('active'); // modal overlay has display:flex when active
    } else {
        modal.classList.add('hidden');
        modal.classList.remove('active');
    }
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

// --- CARGA DE DATOS ---
async function loadData(view) {
    if (view === 'products') await fetchProducts();
    if (view === 'cash') await fetchCash();
    if (view === 'dashboard') await fetchDashboard();
}

// --- PRODUCTOS ---
async function fetchProducts() {
    const res = await fetch('/api/products');
    state.products = await res.json();
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

function openEditProduct(id) {
    const p = state.products.find(x => x.id === id);

    document.getElementById("edit-product-id").value = p.id;
    document.getElementById("edit-product-name").value = p.name;
    document.getElementById("edit-product-type").value = p.type;
    document.getElementById("edit-product-cost").value = p.cost;
    document.getElementById("edit-product-margin").value = p.margin;
    document.getElementById("edit-product-old-price").value = p.price_kg;

    updateNewPrice();
    toggleModal("modal-edit-product");
}

document.getElementById("edit-product-cost").addEventListener("input", updateNewPrice);
document.getElementById("edit-product-margin").addEventListener("input", updateNewPrice);

document.getElementById("edit-product-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = document.getElementById("edit-product-id").value;
    const cost = parseFloat(document.getElementById("edit-product-cost").value);
    const margin = parseFloat(document.getElementById("edit-product-margin").value);

    const payload = { cost, margin };

    await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    toggleModal('modal-edit-product');
    fetchProducts();
});


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
    state.cash = await res.json();
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

    // 2. Metodos de pago (Bar comparativo por mes)
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
        // Ordenar meses de más reciente a más antiguo
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
}
