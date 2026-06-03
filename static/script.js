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
let currentExpenseList = [];

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

function toggleModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.toggle('hidden');
    modal.classList.toggle('active');
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

document.addEventListener('DOMContentLoaded', async () => {
    if (!localStorage.getItem('auth_token')) {
        showLogin();
    } else {
        showApp();
    }

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

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (e.target.dataset.target) {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                document.querySelectorAll('.view').forEach(v => {
                    v.classList.remove('active');
                    v.classList.add('hidden');
                });
                const target = e.target.dataset.target;
                const view = document.getElementById(target);
                if (view) {
                    view.classList.remove('hidden');
                    view.classList.add('active');
                    loadData(target);
                }
            }
        });
    });

    document.getElementById('excel-file')?.addEventListener('change', handleExcelUpload);
});

// ======================================================
//                 DASHBOARD - MAIN FUNCTIONS
// ======================================================

let charts = {};
let selectedMonth = '';

async function fetchDashboard() {
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
    
    const histRevenue = cashData.reduce((acc, r) => acc + r.net_income, 0);
    const histExpenses = cashData.reduce((acc, r) => acc + r.expenses, 0);
    const histProfit = cashData.reduce((acc, r) => acc + r.total, 0);
    
    const histEl = document.getElementById('hist-revenue');
    if (histEl) {
        document.getElementById('hist-revenue').innerText = `$${formatMoney(histRevenue)}`;
        document.getElementById('hist-expenses').innerText = `$${formatMoney(histExpenses)}`;
        document.getElementById('hist-profit').innerText = `$${formatMoney(histProfit)}`;
    }
    
    const monthRows = cashData.filter(r => r.date.startsWith(selectedMonth));
    
    const rev = monthRows.reduce((acc, r) => acc + r.net_income, 0);
    const exp = monthRows.reduce((acc, r) => acc + r.expenses, 0);
    const prof = monthRows.reduce((acc, r) => acc + r.total, 0);
    
    const kpiEl = document.getElementById('kpi-revenue');
    if (kpiEl) {
        document.getElementById('kpi-revenue').innerText = `$${formatMoney(rev)}`;
        document.getElementById('kpi-expenses').innerText = `$${formatMoney(exp)}`;
        document.getElementById('kpi-profit').innerText = `$${formatMoney(prof)}`;
    }
    
    const periodStr = formatMonthLiteral(selectedMonth);
    document.querySelectorAll('.kpi-period').forEach(el => el.innerText = periodStr);
    
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

    Object.values(charts).forEach(c => c && c.destroy && c.destroy());
    charts = {};
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Inter';

    renderDailySalesChart(monthRows);
    renderPaymentChart(monthRows);
    renderMonthlyComparisonChart(cashData);
    renderWeekdayDistribution(monthRows);
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
                html += `<div style="padding:0.4rem 0.8rem; background:${weekColors[i%weekColors.length]}22; border-left:4px solid ${weekColors[i%weekColors.length]}; border-radius:6px; font-size:0.9em;">Semana ${i+1}: $${formatMoney(tot)}</div>`;
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
        options: { responsive: true, plugins: { legend: { display: false } }, indexAxis: 'y', scales: { x: { max: Math.max(totalCash, totalCard) * 1.2 } } }
    });
}

function renderMonthlyComparisonChart(cashData) {
    const byMonth = {};
    cashData.forEach(r => {
        const month = r.date.slice(0, 7);
        if (!byMonth[month]) byMonth[month] = { revenue: 0, expenses: 0, netProfit: 0 };
        byMonth[month].revenue += r.net_income;
        byMonth[month].expenses += r.expenses;
        byMonth[month].netProfit += r.total;
    });

    const months = Object.keys(byMonth).sort();
    const labels = months.map(m => formatMonthLiteral(m));
    const revenues = months.map(m => byMonth[m].revenue);
    const expenses = months.map(m => byMonth[m].expenses);
    const netProfits = months.map(m => byMonth[m].netProfit);

    const canvas = document.getElementById('chart-month-compare');
    if (!canvas) return;
    
    charts.monthCompare = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Ventas',
                    data: revenues,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: false,
                    tension: 0.4,
                    borderWidth: 2
                },
                {
                    label: 'Gastos',
                    data: expenses,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    fill: false,
                    tension: 0.4,
                    borderWidth: 2
                },
                {
                    label: 'Beneficio Neto',
                    data: netProfits,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.2)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2
                }
            ]
        },
        options: { responsive: true, plugins: { legend: { display: true, position: 'top' } }, scales: { y: { beginAtZero: true } } }
    });
}

function renderWeekdayDistribution(cashData) {
    const data = calculateWeekdayDistribution(cashData);

    const counts = {
        "LUNES": 0, "MARTES": 0, "MIÉRCOLES": 0, "JUEVES": 0,
        "VIERNES": 0, "SÁBADO": 0, "DOMINGO": 0
    };
    cashData.forEach(row => {
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
            if (v < minVal && v > 0) minVal = v;
        }
    });

    const bgColors = keys.map(day => {
        const v = data[day];
        if (day === "DOMINGO") return "rgba(156, 163, 175, 0.4)";
        if (v === maxVal && v > 0) return "rgba(16, 185, 129, 0.8)";
        if (v === minVal && v > 0) return "rgba(239, 68, 68, 0.8)";
        return "rgba(99, 102, 241, 0.6)";
    });

    const ctx = document.getElementById("chart-weekday-distribution");
    if (!ctx) return;

    if (charts.weekday) charts.weekday.destroy();

    charts.weekday = new Chart(ctx.getContext("2d"), {
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
        const day = row.weekday ? row.weekday.toUpperCase() : "";
        if (days[day] !== undefined) {
            days[day] += row.net_income;
        }
    });

    return days;
}

// ======================================================
//                 PRODUCTOS
// ======================================================

async function fetchProducts() {
    try {
        const res = await fetch('/api/products');
        const data = await res.json();
        state.products = data.map(p => ({
            ...p,
            cost: parseFloat(p.cost),
            margin: parseFloat(p.margin),
            price_kg: parseFloat(p.price_kg)
        }));
        renderProducts();
    } catch (err) {
        console.error('Error fetching products:', err);
    }
}

function renderProducts() {
    const tbody = document.querySelector('#products-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    state.products.forEach(p => {
        const isBebida = p.type === "BEBIDAS";
        const p100 = isBebida ? "" : `$${formatMoney(p.price_100g)}`;
        const p150 = isBebida ? "" : `$${formatMoney(p.price_150g)}`;
        const p250 = isBebida ? "" : `$${formatMoney(p.price_250g)}`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${p.name}</strong></td>
            <td>${p.type}</td>
            <td>$${formatMoney(p.cost)}</td>
            <td>${p.margin}%</td>
            <td><strong>$${formatMoney(p.price_kg)}</strong></td>
            <td>${p100}</td>
            <td>${p150}</td>
            <td>${p250}</td>
            <td style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" onclick="openSuppliers(${p.id}, '${p.name.replace(/'/g, "\\'")}')">🚚</button>
                <button class="btn btn-secondary" onclick="openEditProduct(${p.id})">✏️</button>
                <button class="btn btn-danger" onclick="deleteProduct(${p.id})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteProduct(id) {
    if (confirm('¿Eliminar producto?')) {
        await fetch(`/api/products/${id}`, { method: 'DELETE' });
        fetchProducts();
    }
}

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

function calculatePrices(cost, margin) {
    const base = cost * (1 + margin / 100);
    return Math.ceil(base / 100) * 100;
}

function openEditProduct(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;

    document.getElementById("edit-product-id").value = p.id;
    document.getElementById("edit-product-name").value = p.name;
    document.getElementById("edit-product-type").value = p.type;
    document.getElementById("edit-product-cost").value = p.cost;
    document.getElementById("edit-product-margin").value = p.margin;

    toggleModal("modal-edit-product");
}

document.getElementById("edit-product-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Guardando...";

    const id = document.getElementById("edit-product-id").value;
    const payload = {
        name: document.getElementById("edit-product-name").value,
        type: document.getElementById("edit-product-type").value,
        cost: parseFloat(document.getElementById("edit-product-cost").value),
        margin: parseFloat(document.getElementById("edit-product-margin").value)
    };

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

document.getElementById("add-product-form")?.addEventListener("submit", async (e) => {
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
//                 PROVEEDORES
// ======================================================

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
    if (!tbody) return;
    tbody.innerHTML = '';

    if (suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Sin proveedores</td></tr>';
        return;
    }

    const minCost = Math.min(...suppliers.map(s => s.cost));

    suppliers.forEach(s => {
        const isMin = s.cost === minCost;
        const tr = document.createElement('tr');
        if (isMin) tr.style.background = 'rgba(16, 185, 129, 0.1)';

        tr.innerHTML = `
            <td>${isMin ? '🟢 ' : ''}${s.supplier_name}</td>
            <td style="font-weight:${isMin ? 'bold' : 'normal'}; color:${isMin ? 'var(--success-color)' : 'inherit'}">$${formatMoney(s.cost)}</td>
            <td></td>
            <td>
                <button class="btn btn-danger" onclick="deleteSupplier(${document.getElementById('sup-prod-id').value}, ${s.id})" style="padding: 0.3rem 0.6rem;">❌</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('add-supplier-form')?.addEventListener('submit', async (e) => {
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

async function fetchGlobalSuppliers() {
    try {
        const res = await fetch('/api/suppliers');
        const data = await res.json();
        state.suppliers = data;
    } catch (err) {
        console.error('Error fetching suppliers:', err);
    }
}

// ======================================================
//                 CAJA DIARIA
// ======================================================

function getWeekdayFromDate(dateString) {
    const [year, month, day] = dateString.split("-");
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("es-AR", { weekday: "long" }).toUpperCase();
}

async function fetchCash() {
    try {
        const res = await fetch('/api/cash/all');
        const raw = await res.json();

        state.cash = raw.map(r => {
            let date = r.date;
            if (date && date.includes("T")) date = date.split("T")[0];

            const weekday = r.weekday || getWeekdayFromDate(date);
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
                total,
                expense_list: r.expense_list || []
            };
        });
        renderCash();
    } catch (err) {
        console.error('Error fetching cash:', err);
    }
}

function renderCash() {
    const tbody = document.getElementById('cash-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!state.cash || state.cash.length === 0) return;

    const byMonth = {};
    state.cash.forEach(c => {
        const month = c.date.slice(0, 7);
        if (!byMonth[month]) {
            byMonth[month] = { rows: [], cashTotal: 0, cardTotal: 0, netTotal: 0, expensesTotal: 0, profitTotal: 0 };
        }
        byMonth[month].rows.push(c);
        byMonth[month].cashTotal += c.cash;
        byMonth[month].cardTotal += c.card;
        byMonth[month].netTotal += c.net_income;
        byMonth[month].expensesTotal += c.expenses;
        byMonth[month].profitTotal += c.total;
    });

    const sortedMonths = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));

    sortedMonths.forEach(month => {
        const mData = byMonth[month];
        const headerTr = document.createElement('tr');
        headerTr.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
        headerTr.style.cursor = 'pointer';
        headerTr.innerHTML = `
            <td colspan="2" style="font-weight: bold;"><span>▼</span> ${formatMonthLiteral(month)}</td>
            <td style="font-weight: bold;">$${formatMoney(mData.cashTotal)}</td>
            <td style="font-weight: bold;">$${formatMoney(mData.cardTotal)}</td>
            <td style="font-weight: bold;">$${formatMoney(mData.netTotal)}</td>
            <td style="font-weight: bold;">$${formatMoney(mData.expensesTotal)}</td>
            <td style="font-weight: bold; color: ${mData.profitTotal >= 0 ? 'var(--success-color)' : 'var(--danger-color)'};">$${formatMoney(mData.profitTotal)}</td>
            <td></td>
        `;
        
        tbody.appendChild(headerTr);

        const monthRows = [];
        mData.rows.sort((a,b) => b.date.localeCompare(a.date));

        mData.rows.forEach(c => {
            const [y, m, d] = c.date.split('-');
            const formattedDate = `${d}/${m}/${y}`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding-left: 2rem;">${formattedDate}</td>
                <td>${c.weekday}</td>
                <td>$${formatMoney(c.cash)}</td>
                <td>$${formatMoney(c.card)}</td>
                <td>$${formatMoney(c.net_income)}</td>
                <td>$${formatMoney(c.expenses)}</td>
                <td style="color: ${c.total >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}; font-weight: bold;">$${formatMoney(c.total)}</td>
                <td style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-secondary" onclick="openEditCash(${c.id})" style="padding: 0.3rem 0.6rem;">✏️</button>
                    <button class="btn btn-danger" onclick="deleteCash(${c.id})" style="padding: 0.3rem 0.6rem;">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
            monthRows.push(tr);
        });

        headerTr.addEventListener('click', () => {
            const span = headerTr.querySelector('span');
            const isExpanded = span.innerText === '▼';
            span.innerText = isExpanded ? '▶' : '▼';
            monthRows.forEach(tr => {
                tr.style.display = isExpanded ? 'none' : 'table-row';
            });
        });
    });
}

document.getElementById("cash-date")?.addEventListener("change", (e) => {
    const date = e.target.value;
    if (!date) return;
    document.getElementById("cash-weekday").value = getWeekdayFromDate(date);
});

document.getElementById('cash-form')?.addEventListener('submit', async (e) => {
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
        expense_list: currentExpenseList
    };

    await fetch('/api/cash', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });

    btn.disabled = false;
    btn.innerText = originalText;
    e.target.reset();
    currentExpenseList = [];
    renderExpenseItems('cash');
    fetchCash();
});

function openEditCash(id) {
    const c = state.cash.find(x => x.id === id);
    if(!c) return;

    document.getElementById('edit-cash-id').value = c.id;
    document.getElementById('edit-cash-date').value = c.date;
    document.getElementById('edit-cash-weekday').value = c.weekday;
    document.getElementById('edit-cash-cash').value = c.cash;
    document.getElementById('edit-cash-card').value = c.card;

    currentExpenseList = JSON.parse(JSON.stringify(c.expense_list || []));
    renderExpenseItems('edit');

    toggleModal('modal-edit-cash');
}

document.getElementById("edit-cash-date")?.addEventListener("change", (e) => {
    const date = e.target.value;
    if (!date) return;
    document.getElementById("edit-cash-weekday").value = getWeekdayFromDate(date);
});

document.getElementById('edit-cash-form')?.addEventListener('submit', async (e) => {
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
        expense_list: currentExpenseList
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

async function deleteCash(id) {
    if (confirm('¿Eliminar este registro de caja?')) {
        await fetch(`/api/cash/${id}`, { method: 'DELETE' });
        fetchCash();
    }
}

async function fetchExpenseCategories() {
    try {
        const res = await fetch('/api/expense-categories');
        const data = await res.json();
        state.expenseCategories = data;
        renderExpenseCategories();
    } catch (err) {
        console.error('Error fetching expense categories:', err);
    }
}

function renderExpenseCategories() {
    const select = document.getElementById('cash-expense-category');
    if (!select) return;
    
    select.innerHTML = '<option value="">Seleccionar Categoría...</option>';
    state.expenseCategories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.innerText = cat.name;
        select.appendChild(opt);
    });
}

function addExpenseItem(context) {
    const categorySelect = document.getElementById('cash-expense-category');
    if (!categorySelect || categorySelect.value === '') {
        alert('Selecciona una categoría');
        return;
    }
    
    const categoryId = parseInt(categorySelect.value);
    const categoryName = categorySelect.options[categorySelect.selectedIndex].text;
    const amount = parseFloat(prompt('Monto del gasto:'));
    
    if (isNaN(amount) || amount <= 0) {
        alert('Monto inválido');
        return;
    }
    
    currentExpenseList.push({
        category_id: categoryId,
        category_name: categoryName,
        amount: amount
    });
    
    renderExpenseItems(context);
}

function removeExpenseItem(index) {
    currentExpenseList.splice(index, 1);
    renderExpenseItems('cash');
}

function renderExpenseItems(context) {
    const listId = context === 'edit' ? 'edit-cash-expenses-list' : 'cash-expenses-list';
    const totalId = context === 'edit' ? 'edit-cash-total-expenses' : 'cash-total-expenses';
    
    const listDiv = document.getElementById(listId);
    const totalSpan = document.getElementById(totalId);
    
    if (!listDiv) return;
    
    listDiv.innerHTML = '';
    let total = 0;
    
    currentExpenseList.forEach((exp, idx) => {
        const expDiv = document.createElement('div');
        expDiv.style.cssText = 'display:flex; justify-content:space-between; padding:0.5rem; background:#f0f0f0; border-radius:4px; margin-bottom:5px;';
        expDiv.innerHTML = `
            <span>${exp.category_name}: $${formatMoney(exp.amount)}</span>
            <button type="button" class="btn btn-danger" style="padding:0.2rem 0.5rem; font-size:0.8em;" onclick="removeExpenseItem(${idx})">Quitar</button>
        `;
        listDiv.appendChild(expDiv);
        total += exp.amount;
    });
    
    if (totalSpan) totalSpan.innerText = formatMoney(total);
}

// ======================================================
//                 LOAD DATA POR VISTA
// ======================================================

async function loadData(view) {
    if (view === 'products') await fetchProducts();
    if (view === 'cash') await fetchCash();
    if (view === 'dashboard') await fetchDashboard();
    if (view === 'suppliers-global') await fetchGlobalSuppliers();
}

// ======================================================
//                 APP INITIALIZATION
// ======================================================

async function init() {
    if (!localStorage.getItem('auth_token')) return;
    await fetchExpenseCategories();
    await fetchGlobalSuppliers();
    await fetchCash();
    await fetchDashboard();
    await fetchProducts();
}

window.onload = init;
