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
window.fetch = async function () {
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
            localStorage.setItem('activeView', target);
            
            document.getElementById(target).classList.remove('hidden');
            document.getElementById(target).classList.add('active');

            loadData(target);
        });
    });

    const savedView = localStorage.getItem('activeView');
    if (savedView) {
        const btn = document.querySelector(`.nav-btn[data-target="${savedView}"]`);
        if (btn) {
            btn.click();
        }
    }

    // Importación Excel
    document.getElementById('excel-file')
        ?.addEventListener('change', handleExcelUpload);

    // Búsqueda de Productos
    document.getElementById('product-search')
        ?.addEventListener('input', (e) => {
            productSearchTerm = e.target.value.toLowerCase().trim();
            renderProducts();
        });

    // ======================================================
    //     SIDEBAR: OCULTAR / MOSTRAR CON FLECHA Y MÓVIL
    // ======================================================
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebarExpandBtn = document.getElementById('sidebar-expand-btn');

    function toggleSidebar(forceState = null) {
        if (!sidebar) return;

        if (window.innerWidth <= 768) {
            // En pantallas móviles: cerrar drawer si está abierto
            sidebar.classList.remove('open');
            sidebarOverlay?.classList.remove('active');
            if (sidebarExpandBtn) sidebarExpandBtn.classList.add('hidden');
            return;
        }

        // En escritorio: colapsar o expandir
        const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');
        const shouldCollapse = forceState !== null ? forceState : !isCurrentlyCollapsed;

        if (shouldCollapse) {
            sidebar.classList.add('collapsed');
            if (sidebarExpandBtn) sidebarExpandBtn.classList.remove('hidden');
        } else {
            sidebar.classList.remove('collapsed');
            if (sidebarExpandBtn) sidebarExpandBtn.classList.add('hidden');
        }

        localStorage.setItem('sidebar_collapsed', shouldCollapse ? 'true' : 'false');

        // Redimensionar gráficos y tablas automáticamente tras la animación
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 360);
    }

    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    if (sidebarExpandBtn) {
        sidebarExpandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    // Atajo de teclado: Ctrl + B para ocultar/mostrar menú lateral
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA' && activeTag !== 'SELECT') {
                e.preventDefault();
                toggleSidebar();
            }
        }
    });

    // Restaurar estado guardado en escritorio si estaba colapsado previamente
    if (window.innerWidth > 768 && localStorage.getItem('sidebar_collapsed') === 'true') {
        toggleSidebar(true);
    } else {
        if (sidebarExpandBtn) sidebarExpandBtn.classList.add('hidden');
    }

    if (mobileToggle && sidebar && sidebarOverlay) {
        mobileToggle.addEventListener('click', () => {
            sidebar.classList.add('open');
            sidebarOverlay.classList.add('active');
        });

        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });

        // Cerrar al hacer clic en un botón en móvil
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('open');
                    sidebarOverlay.classList.remove('active');
                }
            });
        });
    }
});

// ======================================================
//                 TOAST DE MENSAJES Y ERRORES
// ======================================================

const originalConsoleError = console.error;
window.lastErrorMsg = null;
console.error = function(...args) {
    originalConsoleError.apply(console, args);
    const err = args.find(a => a instanceof Error || (a && a.detail) || typeof a === 'string');
    if (err) {
        window.lastErrorMsg = err.message || err.detail || String(err);
    }
};

function showToast(msg, type = "success", errorObj = null) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    
    if (type === "error") {
        let errDetail = errorObj ? (errorObj.message || errorObj.detail || String(errorObj)) : window.lastErrorMsg || "";
        window.lastErrorMsg = null; // reset
        
        const fullErrText = errDetail ? `${msg}: ${errDetail}` : msg;
        const safeText = fullErrText.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        
        toast.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:5px;">
                <span style="font-weight: bold;">${msg}</span>
                ${errDetail ? `<span style="font-size: 0.8rem; opacity: 0.9; word-break: break-word;">${errDetail}</span>` : ''}
                <div style="display:flex; gap:5px; margin-top:5px; justify-content: flex-end;">
                    <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 0.75rem;" onclick="navigator.clipboard.writeText(\`${safeText}\`).then(() => { this.innerText='¡Copiado!'; setTimeout(()=>this.innerText='Copiar', 2000); }).catch(()=>alert('No se pudo copiar'))">Copiar</button>
                    <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 0.75rem;" onclick="this.closest('.toast').classList.remove('visible'); setTimeout(() => this.closest('.toast').remove(), 300)">Cerrar</button>
                </div>
            </div>
        `;
        toast.style.pointerEvents = "auto";
    } else {
        toast.innerText = msg;
    }

    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add("visible"), 50);
    
    // Solo desaparece automáticamente si no es un error
    if (type !== "error") {
        setTimeout(() => {
            toast.classList.remove("visible");
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }
}

// ======================================================
//                 CARGA DE DATOS SEGÚN VISTA
// ======================================================

async function loadData(view) {
    if (view === 'products') await fetchProducts();
    if (view === 'cash') await fetchCash();
    if (view === 'dashboard') await fetchDashboard();
    if (view === 'supplier-debts') await fetchSupplierDebts();
    if (view === 'household-bills') await fetchHouseholdBills();
    if (view === 'accounting-report') await loadAccountingReport();
    if (view === 'suppliers-global') await fetchGlobalSuppliers();
    if (view === 'price-history') await fetchGlobalPriceHistory(currentGlobalHistoryPeriod);
    if (view === 'expenses-report') {
        const cashData = state.cash || [];
        const filterEl = document.getElementById('expenses-month-filter');
        
        const months = [...new Set(cashData.map(r => r.date.slice(0, 7)))].sort().reverse();
        filterEl.innerHTML = '';
        months.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.innerText = formatMonthLiteral(m);
            filterEl.appendChild(opt);
        });
        
        if (months.length > 0) {
            if (!filterEl.value || !months.includes(filterEl.value)) {
                filterEl.value = months[0];
            }
        } else {
            const date = new Date();
            const yyyy = date.getFullYear();
            let mm = date.getMonth() + 1;
            if (mm < 10) mm = '0' + mm;
            const currentMonth = `${yyyy}-${mm}`;
            filterEl.innerHTML = `<option value="${currentMonth}">${formatMonthLiteral(currentMonth)}</option>`;
            filterEl.value = currentMonth;
        }

        await fetchExpensesReport(filterEl.value);
    }
}

// ======================================================
//                 REPORTE DE GASTOS
// ======================================================

async function fetchExpensesReport(month = null) {
    let url = '/api/reports/expenses-by-supplier';
    if (month) {
        url += `?month=${month}`;
    }
    
    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            renderExpensesReport(data);
        } else {
            showToast("Error al cargar reporte de gastos", "error");
        }
    } catch (e) {
        showToast("Error de conexión", "error");
    }
}

function renderExpensesReport(data) {
    const tbody = document.getElementById('expenses-report-body');
    const totalEl = document.getElementById('expenses-report-total');
    
    tbody.innerHTML = '';
    let total = 0;
    
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;">No hay gastos registrados.</td></tr>`;
        totalEl.innerText = `$${formatMoney(0)}`;
        return;
    }
    
    data.forEach(item => {
        const amt = parseFloat(item.total_amount || 0);
        total += amt;
        tbody.innerHTML += `
            <tr>
                <td>${item.supplier_name || 'Desconocido'}</td>
                <td style="font-weight: 500;">$${formatMoney(amt)}</td>
            </tr>
        `;
    });
    
    totalEl.innerText = `$${formatMoney(total)}`;
}

document.getElementById('expenses-month-filter')?.addEventListener('change', (e) => {
    fetchExpensesReport(e.target.value);
});

// ======================================================
//                 PRODUCTOS
// ======================================================

async function fetchProducts() {
    const res = await fetch('/api/products');
    const data = await res.json();

    state.products = data.map(p => ({
        ...p,
        cost: parseFloat(p.cost || 0),
        cost1: parseFloat(p.cost1 !== undefined ? p.cost1 : (p.cost_matiz || 0)),
        cost2: parseFloat(p.cost2 !== undefined ? p.cost2 : (p.cost_raices || 0)),
        supplier1_id: p.supplier1_id,
        supplier2_id: p.supplier2_id,
        supplier1_name: p.supplier1_name || '',
        supplier2_name: p.supplier2_name || '',
        old_price_kg: parseFloat(p.old_price_kg || 0),
        margin: parseFloat(p.margin),
        price_kg: parseFloat(p.price_kg)
    }));

    renderProducts();
}

function populateSupplierSelects() {
    const list = state.suppliers || [];
    ['prod-supplier1', 'prod-supplier2', 'prod-supplier3', 'edit-prod-supplier1', 'edit-prod-supplier2', 'edit-prod-supplier3'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">Sin Proveedor</option>';
        list.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.innerText = s.name;
            sel.appendChild(opt);
        });
        sel.value = currentVal;
    });
}

let productSearchTerm = '';

function renderProducts() {
    const tbody = document.querySelector('#products-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = state.products.filter(p => {
        if (!productSearchTerm) return true;
        const name = (p.name || '').toLowerCase();
        const type = (p.type || '').toLowerCase();
        return name.includes(productSearchTerm) || type.includes(productSearchTerm);
    });

    filtered.forEach(p => {

        const isBebida = p.type === "BEBIDAS";
        const p100 = isBebida ? "" : `$${formatMoney(p.price_100g)}`;
        const p150 = isBebida ? "" : `$${formatMoney(p.price_150g)}`;
        const p250 = isBebida ? "" : `$${formatMoney(p.price_250g)}`;
        const oldPrice = p.old_price_kg > 0 ? `$${formatMoney(p.old_price_kg)}` : '-';

        // Convert type to lowercase and replace spaces to create a safe CSS class
        const typeClass = `row-${p.type.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        // Determinar el costo más barato para destacar
        let s1Class = ''; let s2Class = ''; let s3Class = '';
        let s1Badge = ''; let s2Badge = ''; let s3Badge = '';
        
        const costs = [
            { idx: 1, val: p.cost1 },
            { idx: 2, val: p.cost2 },
            { idx: 3, val: p.cost3 }
        ].filter(c => c.val > 0);
        
        if (costs.length > 0) {
            if (costs.length === 1) {
                const badgeHtml = '<span class="cheaper-cost-badge">Único</span>';
                if (p.cost1 > 0) { s1Class = 'cheaper-cost'; s1Badge = badgeHtml; }
                if (p.cost2 > 0) { s2Class = 'cheaper-cost'; s2Badge = badgeHtml; }
                if (p.cost3 > 0) { s3Class = 'cheaper-cost'; s3Badge = badgeHtml; }
            } else {
                const minCost = Math.min(...costs.map(c => c.val));
                const maxCost = Math.max(...costs.map(c => c.val));
                
                if (minCost !== maxCost) {
                    const cheapBadge = '<span class="cheaper-cost-badge">Más barato</span>';
                    const highBadge = '<span class="higher-cost-badge">Más caro</span>';
                    
                    if (p.cost1 === minCost && p.cost1 > 0) { s1Class = 'cheaper-cost'; s1Badge = cheapBadge; }
                    else if (p.cost1 === maxCost && p.cost1 > 0) { s1Class = 'higher-cost'; s1Badge = highBadge; }
                    
                    if (p.cost2 === minCost && p.cost2 > 0) { s2Class = 'cheaper-cost'; s2Badge = cheapBadge; }
                    else if (p.cost2 === maxCost && p.cost2 > 0) { s2Class = 'higher-cost'; s2Badge = highBadge; }
                    
                    if (p.cost3 === minCost && p.cost3 > 0) { s3Class = 'cheaper-cost'; s3Badge = cheapBadge; }
                    else if (p.cost3 === maxCost && p.cost3 > 0) { s3Class = 'higher-cost'; s3Badge = highBadge; }
                }
            }
        }

        const s1Label = p.supplier1_name ? `<span style="font-size:0.8em; opacity:0.8; display:block;">${p.supplier1_name}</span>` : '';
        const s2Label = p.supplier2_name ? `<span style="font-size:0.8em; opacity:0.8; display:block;">${p.supplier2_name}</span>` : '';
        const s3Label = p.supplier3_name ? `<span style="font-size:0.8em; opacity:0.8; display:block;">${p.supplier3_name}</span>` : '';

        const tr = document.createElement('tr');
        tr.className = typeClass;
        tr.innerHTML = `
            <td class="prod-name"><strong>${p.name}</strong></td>
            <td class="prod-type">${p.type}</td>
            <td class="prod-cost1 ${s1Class}" data-value="${p.cost1}">${s1Label}$${formatMoney(p.cost1)}${s1Badge}</td>
            <td class="prod-cost2 ${s2Class}" data-value="${p.cost2}">${s2Label}$${formatMoney(p.cost2)}${s2Badge}</td>
            <td class="prod-cost3 ${s3Class}" data-value="${p.cost3}">${s3Label}$${formatMoney(p.cost3)}${s3Badge}</td>
            <td class="prod-margin" data-value="${p.margin}">${p.margin}%</td>
            <td class="prod-pricekg" data-value="${p.price_kg}"><strong>$${formatMoney(p.price_kg)}</strong></td>
            <td class="prod-oldprice" data-value="${p.old_price_kg}">${oldPrice}</td>
            <td class="prod-price100" data-value="${p.price_100g}">${p100}</td>
            <td class="prod-price150" data-value="${p.price_150g}">${p150}</td>
            <td class="prod-price250" data-value="${p.price_250g}">${p250}</td>
            <td style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" title="Historial de precios" onclick="openProductPriceHistory(${p.id}, '${p.name.replace(/'/g, "\\'")}')">📜</button>
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

    const labels = Object.keys(data).map(day => `${day} (${counts[day]})`);
    const values = Object.values(data);
    const keys = Object.keys(data);

    let maxVal = -Infinity;
    let minVal = Infinity;
    keys.forEach(day => {
        const v = data[day];
        if (v > maxVal) maxVal = v;
        if (v < minVal && v > 0) minVal = v;
    });

    const bgColors = keys.map(day => {
        const v = data[day];
        if (v === maxVal && v > 0) return "rgba(16, 185, 129, 0.7)";
        if (v === minVal && v > 0) return "rgba(239, 68, 68, 0.7)";
        return "rgba(99, 102, 241, 0.5)";
    });
    
    const borderColors = keys.map(day => {
        const v = data[day];
        if (v === maxVal && v > 0) return "rgba(16, 185, 129, 1)";
        if (v === minVal && v > 0) return "rgba(239, 68, 68, 1)";
        return "rgba(99, 102, 241, 1)";
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
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { display: false } }
        }
    });
}

// ======================================================
//                 AGREGAR PRODUCTO
// ======================================================

function updateAddProductPrice() {
    const cost1 = parseFloat(document.getElementById("prod-cost1")?.value) || 0;
    const cost2 = parseFloat(document.getElementById("prod-cost2")?.value) || 0;
    const cost3 = parseFloat(document.getElementById("prod-cost3")?.value) || 0;
    const max_cost = Math.max(cost1, cost2, cost3);
    const margin = parseFloat(document.getElementById("prod-margin").value) || 0;
    const newPrice = calculatePrices(max_cost, margin);
    document.getElementById("prod-new-price").value = newPrice;
}

function updateAddProductMargin() {
    const cost1 = parseFloat(document.getElementById("prod-cost1")?.value) || 0;
    const cost2 = parseFloat(document.getElementById("prod-cost2")?.value) || 0;
    const cost3 = parseFloat(document.getElementById("prod-cost3")?.value) || 0;
    const max_cost = Math.max(cost1, cost2, cost3);
    const newPrice = parseFloat(document.getElementById("prod-new-price").value) || 0;
    if (max_cost > 0) {
        const exactMargin = ((newPrice / max_cost) - 1) * 100;
        document.getElementById("prod-margin").value = exactMargin.toFixed(2);
    } else {
        document.getElementById("prod-margin").value = 0;
    }
}

document.getElementById("prod-cost1")?.addEventListener("input", updateAddProductPrice);
document.getElementById("prod-cost2")?.addEventListener("input", updateAddProductPrice);
document.getElementById("prod-cost3")?.addEventListener("input", updateAddProductPrice);
document.getElementById("prod-margin")?.addEventListener("input", updateAddProductPrice);
document.getElementById("prod-new-price")?.addEventListener("input", updateAddProductMargin);

document.getElementById('add-product-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Guardando...";

    const s1Val = document.getElementById('prod-supplier1').value;
    const s2Val = document.getElementById('prod-supplier2').value;
    const s3Val = document.getElementById('prod-supplier3').value;

    const payload = {
        name: document.getElementById('prod-name').value,
        type: document.getElementById('prod-type').value,
        supplier1_id: s1Val ? parseInt(s1Val) : null,
        supplier2_id: s2Val ? parseInt(s2Val) : null,
        supplier3_id: s3Val ? parseInt(s3Val) : null,
        cost1: parseFloat(document.getElementById('prod-cost1').value || 0),
        cost2: parseFloat(document.getElementById('prod-cost2').value || 0),
        cost3: parseFloat(document.getElementById('prod-cost3').value || 0),
        cost_matiz: parseFloat(document.getElementById('prod-cost1').value || 0),
        cost_raices: parseFloat(document.getElementById('prod-cost2').value || 0),
        margin: parseFloat(document.getElementById('prod-margin').value || 0)
    };

    await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const cost1 = parseFloat(document.getElementById("edit-prod-cost1")?.value) || 0;
    const cost2 = parseFloat(document.getElementById("edit-prod-cost2")?.value) || 0;
    const cost3 = parseFloat(document.getElementById("edit-prod-cost3")?.value) || 0;
    const max_cost = Math.max(cost1, cost2, cost3);
    const margin = parseFloat(document.getElementById("edit-product-margin").value) || 0;
    const newPrice = calculatePrices(max_cost, margin);
    document.getElementById("edit-product-new-price").value = newPrice;
}

function updateNewMargin() {
    const cost1 = parseFloat(document.getElementById("edit-prod-cost1")?.value) || 0;
    const cost2 = parseFloat(document.getElementById("edit-prod-cost2")?.value) || 0;
    const cost3 = parseFloat(document.getElementById("edit-prod-cost3")?.value) || 0;
    const max_cost = Math.max(cost1, cost2, cost3);
    const newPrice = parseFloat(document.getElementById("edit-product-new-price").value) || 0;
    if (max_cost > 0) {
        const exactMargin = ((newPrice / max_cost) - 1) * 100;
        document.getElementById("edit-product-margin").value = exactMargin.toFixed(2);
    } else {
        document.getElementById("edit-product-margin").value = 0;
    }
}


function openEditProduct(id) {
    const p = state.products.find(x => x.id === id);
    if (!p) return;

    populateSupplierSelects();

    document.getElementById("edit-product-id").value = p.id;
    document.getElementById("edit-product-name").value = p.name;
    document.getElementById("edit-product-type").value = p.type;
    
    if (document.getElementById("edit-prod-supplier1")) document.getElementById("edit-prod-supplier1").value = p.supplier1_id || '';
    if (document.getElementById("edit-prod-supplier2")) document.getElementById("edit-prod-supplier2").value = p.supplier2_id || '';
    if (document.getElementById("edit-prod-supplier3")) document.getElementById("edit-prod-supplier3").value = p.supplier3_id || '';
    if (document.getElementById("edit-prod-cost1")) document.getElementById("edit-prod-cost1").value = p.cost1 || 0;
    if (document.getElementById("edit-prod-cost2")) document.getElementById("edit-prod-cost2").value = p.cost2 || 0;
    if (document.getElementById("edit-prod-cost3")) document.getElementById("edit-prod-cost3").value = p.cost3 || 0;

    document.getElementById("edit-product-margin").value = p.margin;
    document.getElementById("edit-product-old-cost").value = p.cost;
    document.getElementById("edit-product-old-price").value = p.old_price_kg;

    updateNewPrice();
    toggleModal("modal-edit-product");
}

document.getElementById("edit-prod-cost1")?.addEventListener("input", updateNewPrice);
document.getElementById("edit-prod-cost2")?.addEventListener("input", updateNewPrice);
document.getElementById("edit-prod-cost3")?.addEventListener("input", updateNewPrice);
document.getElementById("edit-product-margin")?.addEventListener("input", updateNewPrice);
document.getElementById("edit-product-new-price")?.addEventListener("input", updateNewMargin);

document.getElementById("edit-product-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Guardando...";

    const id = document.getElementById("edit-product-id").value;
    const name = document.getElementById("edit-product-name").value;
    const type = document.getElementById("edit-product-type").value;
    
    const s1Val = document.getElementById('edit-prod-supplier1').value;
    const s2Val = document.getElementById('edit-prod-supplier2').value;
    const s3Val = document.getElementById('edit-prod-supplier3').value;

    const cost1 = parseFloat(document.getElementById("edit-prod-cost1").value || 0);
    const cost2 = parseFloat(document.getElementById("edit-prod-cost2").value || 0);
    const cost3 = parseFloat(document.getElementById("edit-prod-cost3").value || 0);
    const margin = parseFloat(document.getElementById("edit-product-margin").value || 0);

    const payload = {
        name,
        type,
        supplier1_id: s1Val ? parseInt(s1Val) : null,
        supplier2_id: s2Val ? parseInt(s2Val) : null,
        supplier3_id: s3Val ? parseInt(s3Val) : null,
        cost1,
        cost2,
        cost3,
        cost_matiz: cost1,
        cost_raices: cost2,
        margin
    };

    await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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

function toggleMassMarginTarget() {
    const target = document.getElementById("mass-margin-target").value;
    const container = document.getElementById("mass-margin-type-container");
    if (target === "TYPE") {
        container.classList.remove("hidden");
    } else {
        container.classList.add("hidden");
    }
}

document.getElementById("mass-margin-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = e.submitter;
    const value = parseFloat(document.getElementById("mass-margin-value").value);
    const target = document.getElementById("mass-margin-target").value;
    const type = document.getElementById("mass-margin-type").value;

    if (isNaN(value)) {
        showToast("Ingresá un número válido", "error");
        return;
    }

    btn.disabled = true;
    btn.innerText = "Aplicando...";

    try {
        // Guardar backup de los productos que van a cambiar
        lastMassUpdateBackup = state.products.filter(p => target === "ALL" || p.type === type).map(p => ({
            id: p.id,
            margin: p.margin,
            price_kg: p.price_kg
        }));

        const response = await fetch("/api/products/mass-margin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value, target, type })
        });
        
        if (!response.ok) throw new Error("Error en la respuesta del servidor");

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

    try {
        const response = await fetch("/api/products/mass-undo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                items: lastMassUpdateBackup.map(item => ({
                    id: item.id,
                    margin: item.margin
                }))
            })
        });

        if (!response.ok) throw new Error("Error en el servidor al deshacer");

        lastMassUpdateBackup = null;
        await fetchProducts();
        showToast("Se restauraron los márgenes y precios previos al aumento masivo.", "success");
    } catch (e) {
        console.error(e);
        showToast("Error deshaciendo el ajuste masivo", "error");
    }
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
        headers: { 'Content-Type': 'application/json' },
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
        if (id === 'modal-add-product' || id === 'modal-edit-product') {
            populateSupplierSelects();
        }
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

    if (!date) return;

    document.getElementById("cash-weekday").value = getWeekdayFromDate(date);
});

// =====================================================
//                 GASTOS POR PROVEEDOR EN CAJA
// =====================================================

let currentNewCashExpenseList = [];
let currentEditCashExpenseList = [];

function populateCashSupplierSelects() {
    const selects = [document.getElementById('new-cash-supplier-select'), document.getElementById('edit-cash-supplier-select')];
    selects.forEach(sel => {
        if (!sel) return;
        sel.innerHTML = '<option value="">Seleccionar proveedor...</option>';
        state.suppliers.forEach(s => {
            sel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
        });
    });
}

function toggleExpenseFields(mode) {
    const prefix = mode === 'new' ? 'new-cash' : 'edit-cash';
    const catSel = document.getElementById(`${prefix}-expense-category`);
    const supSel = document.getElementById(`${prefix}-supplier-select`);
    const descInput = document.getElementById(`${prefix}-expense-desc`);
    if (!catSel || !supSel || !descInput) return;

    if (catSel.value === 'PROVEEDORES') {
        supSel.classList.remove('hidden');
        descInput.classList.add('hidden');
    } else {
        supSel.classList.add('hidden');
        descInput.classList.remove('hidden');
    }
}

function addCashExpense(mode) {
    const prefix = mode === 'new' ? 'new-cash' : 'edit-cash';
    const catSel = document.getElementById(`${prefix}-expense-category`);
    const supSel = document.getElementById(`${prefix}-supplier-select`);
    const descInput = document.getElementById(`${prefix}-expense-desc`);
    const methodSel = document.getElementById(`${prefix}-expense-method`);
    const amt = document.getElementById(`${prefix}-supplier-amount`);
    
    const category_type = catSel ? catSel.value : 'PROVEEDORES';
    const amount = parseFloat(amt.value);
    const payment_method = methodSel ? methodSel.value : 'EFECTIVO';
    
    if (isNaN(amount) || amount <= 0) {
        alert("Por favor ingresá un monto mayor a 0");
        return;
    }
    
    let supplier_id = null;
    let description = '';
    let display_name = '';

    if (category_type === 'PROVEEDORES') {
        if (!supSel || !supSel.value) {
            alert("Por favor seleccioná un proveedor");
            return;
        }
        supplier_id = parseInt(supSel.value);
        const supplier = state.suppliers.find(s => s.id == supplier_id);
        display_name = supplier ? supplier.name : 'Proveedor';
    } else {
        description = descInput && descInput.value ? descInput.value.trim() : category_type;
        display_name = description;
    }
    
    const list = mode === 'new' ? currentNewCashExpenseList : currentEditCashExpenseList;
    list.push({
        category_type,
        supplier_id,
        supplier_name: display_name,
        description,
        payment_method,
        amount
    });
    
    amt.value = '';
    if (descInput) descInput.value = '';
    if (supSel) supSel.value = '';

    renderCashExpenseList(mode);
    calculateTotalCash(mode);
}

function removeCashExpense(mode, index) {
    const list = mode === 'new' ? currentNewCashExpenseList : currentEditCashExpenseList;
    list.splice(index, 1);
    renderCashExpenseList(mode);
    calculateTotalCash(mode);
}

function renderCashExpenseList(mode) {
    const list = mode === 'new' ? currentNewCashExpenseList : currentEditCashExpenseList;
    const tbody = document.getElementById(`${mode}-cash-expenses-list`);
    if (!tbody) return;
    
    tbody.innerHTML = '';
    let total = 0;
    
    list.forEach((exp, i) => {
        total += exp.amount;
        const cat = exp.category_type || 'PROVEEDORES';
        const concept = exp.supplier_name || exp.description || '-';
        const method = exp.payment_method || 'EFECTIVO';
        tbody.innerHTML += `
            <tr>
                <td><span class="badge badge-info">${cat}</span></td>
                <td>${concept}</td>
                <td><span style="font-size:0.8rem; color:#94a3b8;">${method}</span></td>
                <td style="font-weight:600; color:var(--danger-color);">$${formatMoney(exp.amount)}</td>
                <td><button type="button" class="btn btn-danger" style="padding:0.2rem 0.5rem;" onclick="removeCashExpense('${mode}', ${i})">✕</button></td>
            </tr>
        `;
    });
    
    const expInput = document.getElementById(mode === 'new' ? 'cash-expenses' : 'edit-cash-expenses');
    if (expInput) expInput.value = total.toFixed(2);
}

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

        const morning_ef = Number(r.morning_ef ?? 0);
        const morning_qr = Number(r.morning_qr ?? 0);
        const afternoon_ef = Number(r.afternoon_ef ?? 0);
        const afternoon_qr = Number(r.afternoon_qr ?? 0);

        const morning_sales = (morning_ef + morning_qr > 0) ? (morning_ef + morning_qr) : Number(r.morning_sales ?? 0);
        const afternoon_sales = (afternoon_ef + afternoon_qr > 0) ? (afternoon_ef + afternoon_qr) : Number(r.afternoon_sales ?? 0);

        const cash = (morning_ef + afternoon_ef > 0) ? (morning_ef + afternoon_ef) : Number(r.cash ?? 0);
        const card = (morning_qr + afternoon_qr > 0) ? (morning_qr + afternoon_qr) : Number(r.card ?? 0);

        const expenses = Number(r.expenses ?? 0);
        const notes = r.notes || '';
        const expense_list = r.expense_list || [];

        const net_income = cash + card;
        const total = net_income - expenses;

        return {
            id: r.id,
            date,
            weekday,
            morning_ef,
            morning_qr,
            afternoon_ef,
            afternoon_qr,
            morning_sales,
            afternoon_sales,
            cash,
            card,
            net_income,
            expenses,
            notes,
            total,
            expense_list
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

    if (!state.cash || state.cash.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:2rem; color:var(--text-secondary);">No hay registros de caja aún. ¡Comenzá cargando el cierre de hoy!</td></tr>`;
        return;
    }

    // Agrupar por mes
    const byMonth = {};
    state.cash.forEach(c => {
        const month = c.date.slice(0, 7); // YYYY-MM
        if (!byMonth[month]) {
            byMonth[month] = {
                rows: [],
                morningTotal: 0,
                afternoonTotal: 0,
                cashTotal: 0,
                cardTotal: 0,
                netTotal: 0,
                expensesTotal: 0,
                profitTotal: 0
            };
        }
        byMonth[month].rows.push(c);
        byMonth[month].morningTotal += c.morning_sales;
        byMonth[month].afternoonTotal += c.afternoon_sales;
        byMonth[month].cashTotal += c.cash;
        byMonth[month].cardTotal += c.card;
        byMonth[month].netTotal += c.net_income;
        byMonth[month].expensesTotal += c.expenses;
        byMonth[month].profitTotal += c.total;
    });

    const sortedMonths = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));
    const currentMonth = sortedMonths[0];

    sortedMonths.forEach(month => {
        const mData = byMonth[month];
        const isCurrent = month === currentMonth;

        const headerTr = document.createElement('tr');
        headerTr.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
        headerTr.style.cursor = 'pointer';
        headerTr.innerHTML = `
            <td colspan="2" style="font-weight: bold; font-size: 1.05em; color: var(--text-color);">
                <span style="display: inline-block; width: 20px;">${isCurrent ? '▼' : '▶'}</span>
                ${formatMonthLiteral(month)}
            </td>
            <td style="font-weight: bold;">$${formatMoney(mData.morningTotal)}</td>
            <td style="font-weight: bold;">$${formatMoney(mData.afternoonTotal)}</td>
            <td style="font-weight: bold; color:var(--primary-color);">$${formatMoney(mData.netTotal)}</td>
            <td style="font-weight: bold; color:var(--danger-color);">$${formatMoney(mData.expensesTotal)}</td>
            <td style="font-weight: bold; color: ${mData.profitTotal >= 0 ? 'var(--success-color)' : 'var(--danger-color)'};">
                $${formatMoney(mData.profitTotal)}
            </td>
            <td></td>
            <td></td>
        `;

        tbody.appendChild(headerTr);

        const monthRows = [];
        mData.rows.sort((a, b) => b.date.localeCompare(a.date));

        mData.rows.forEach(c => {
            const [y, m, d] = c.date.split('-');
            const formattedDate = `${d}/${m}/${y}`;

            const tr = document.createElement('tr');
            tr.style.display = isCurrent ? 'table-row' : 'none';
            tr.style.backgroundColor = 'transparent';
            tr.innerHTML = `
                <td style="padding-left: 1.5rem; font-weight:600;">${formattedDate}</td>
                <td>${c.weekday}</td>
                <td>
                    <b>$${formatMoney(c.morning_sales || 0)}</b>
                    <div style="font-size:0.75rem; color:#94a3b8;">EF: $${formatMoney(c.morning_ef || 0)} | QR: $${formatMoney(c.morning_qr || 0)}</div>
                </td>
                <td>
                    <b>$${formatMoney(c.afternoon_sales || 0)}</b>
                    <div style="font-size:0.75rem; color:#94a3b8;">EF: $${formatMoney(c.afternoon_ef || 0)} | QR: $${formatMoney(c.afternoon_qr || 0)}</div>
                </td>
                <td>
                    <b style="color:var(--primary-color);">$${formatMoney(c.net_income || 0)}</b>
                    <div style="font-size:0.75rem; color:#94a3b8;">EF: $${formatMoney(c.cash || 0)} | QR: $${formatMoney(c.card || 0)}</div>
                </td>
                <td style="color:var(--danger-color); font-weight:600;">$${formatMoney(c.expenses || 0)}</td>
                <td style="color: ${c.total >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}; font-weight: bold;">
                    $${formatMoney(c.total || 0)}
                </td>
                <td style="font-size:0.85rem; color:var(--text-secondary); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${c.notes || ''}">${c.notes || '-'}</td>
                <td style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-secondary" style="padding: 0.3rem 0.6rem;" onclick="openEditCash(${c.id})">✏️</button>
                    <button class="btn btn-danger" style="padding: 0.3rem 0.6rem;" onclick="deleteCash(${c.id})">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
            monthRows.push(tr);
        });

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
//                 NUEVO REGISTRO & CÁLCULOS
// =====================================================

function calculateTotalCash(mode) {
    if (mode === 'new') {
        const m_ef = parseFloat(document.getElementById('cash-morning-ef')?.value || 0);
        const m_qr = parseFloat(document.getElementById('cash-morning-qr')?.value || 0);
        const a_ef = parseFloat(document.getElementById('cash-afternoon-ef')?.value || 0);
        const a_qr = parseFloat(document.getElementById('cash-afternoon-qr')?.value || 0);

        const m_tot = m_ef + m_qr;
        const a_tot = a_ef + a_qr;
        const tot_ef = m_ef + a_ef;
        const tot_qr = m_qr + a_qr;
        const tot_ventas = tot_ef + tot_qr;

        const expenses = parseFloat(document.getElementById('cash-expenses')?.value || 0);
        const net_total = tot_ventas - expenses;

        if (document.getElementById('cash-morning')) document.getElementById('cash-morning').value = m_tot.toFixed(2);
        if (document.getElementById('cash-afternoon')) document.getElementById('cash-afternoon').value = a_tot.toFixed(2);
        if (document.getElementById('cash-total-ef')) document.getElementById('cash-total-ef').value = tot_ef.toFixed(2);
        if (document.getElementById('cash-total-qr')) document.getElementById('cash-total-qr').value = tot_qr.toFixed(2);
        if (document.getElementById('cash-cash')) document.getElementById('cash-cash').value = tot_ventas.toFixed(2);
        if (document.getElementById('cash-net-total')) document.getElementById('cash-net-total').value = net_total.toFixed(2);
    } else {
        const m_ef = parseFloat(document.getElementById('edit-cash-morning-ef')?.value || 0);
        const m_qr = parseFloat(document.getElementById('edit-cash-morning-qr')?.value || 0);
        const a_ef = parseFloat(document.getElementById('edit-cash-afternoon-ef')?.value || 0);
        const a_qr = parseFloat(document.getElementById('edit-cash-afternoon-qr')?.value || 0);

        const m_tot = m_ef + m_qr;
        const a_tot = a_ef + a_qr;
        const tot_ef = m_ef + a_ef;
        const tot_qr = m_qr + a_qr;
        const tot_ventas = tot_ef + tot_qr;

        if (document.getElementById('edit-cash-morning')) document.getElementById('edit-cash-morning').value = m_tot.toFixed(2);
        if (document.getElementById('edit-cash-afternoon')) document.getElementById('edit-cash-afternoon').value = a_tot.toFixed(2);
        if (document.getElementById('edit-cash-total-ef')) document.getElementById('edit-cash-total-ef').value = tot_ef.toFixed(2);
        if (document.getElementById('edit-cash-total-qr')) document.getElementById('edit-cash-total-qr').value = tot_qr.toFixed(2);
        if (document.getElementById('edit-cash-cash')) document.getElementById('edit-cash-cash').value = tot_ventas.toFixed(2);
    }
}

document.getElementById('cash-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn ? btn.innerText : '';
    if (btn) { btn.disabled = true; btn.innerText = "Guardando..."; }

    const date = document.getElementById('cash-date').value;
    let weekday = document.getElementById('cash-weekday').value;
    if (!weekday) weekday = getWeekdayFromDate(date);

    const m_ef = parseFloat(document.getElementById('cash-morning-ef')?.value || 0);
    const m_qr = parseFloat(document.getElementById('cash-morning-qr')?.value || 0);
    const a_ef = parseFloat(document.getElementById('cash-afternoon-ef')?.value || 0);
    const a_qr = parseFloat(document.getElementById('cash-afternoon-qr')?.value || 0);

    const payload = {
        date,
        weekday,
        morning_ef: m_ef,
        morning_qr: m_qr,
        afternoon_ef: a_ef,
        afternoon_qr: a_qr,
        morning_sales: m_ef + m_qr,
        afternoon_sales: a_ef + a_qr,
        cash: m_ef + a_ef,
        card: m_qr + a_qr,
        expenses: parseFloat(document.getElementById('cash-expenses')?.value || 0),
        notes: document.getElementById('cash-notes')?.value || '',
        expense_list: currentNewCashExpenseList
    };

    try {
        const res = await fetch('/api/cash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json();
            alert("Error al guardar caja: " + (err.detail || JSON.stringify(err)));
            return;
        }
        e.target.reset();
        currentNewCashExpenseList = [];
        renderCashExpenseList('new');
        await fetchCash();
        await fetchDashboard();
        alert("¡Cierre de caja guardado con éxito!");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = originalText; }
    }
});

// =====================================================
//                 EDITAR REGISTRO
// =====================================================

function openEditCash(id) {
    const c = state.cash.find(x => x.id == id);
    if (!c) return;

    document.getElementById('edit-cash-id').value = c.id;
    document.getElementById('edit-cash-date').value = c.date;
    document.getElementById('edit-cash-weekday').value = c.weekday || '';
    
    document.getElementById('edit-cash-morning-ef').value = c.morning_ef || 0;
    document.getElementById('edit-cash-morning-qr').value = c.morning_qr || 0;
    document.getElementById('edit-cash-afternoon-ef').value = c.afternoon_ef || 0;
    document.getElementById('edit-cash-afternoon-qr').value = c.afternoon_qr || 0;

    document.getElementById('edit-cash-morning').value = c.morning_sales || 0;
    document.getElementById('edit-cash-afternoon').value = c.afternoon_sales || 0;
    document.getElementById('edit-cash-total-ef').value = c.cash || 0;
    document.getElementById('edit-cash-total-qr').value = c.card || 0;
    document.getElementById('edit-cash-cash').value = c.net_income || 0;
    document.getElementById('edit-cash-expenses').value = c.expenses || 0;

    if (document.getElementById('edit-cash-notes')) {
        document.getElementById('edit-cash-notes').value = c.notes || '';
    }
    
    currentEditCashExpenseList = [...(c.expense_list || [])];
    renderCashExpenseList('edit');
    calculateTotalCash('edit');

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
    const originalText = btn ? btn.innerText : '';
    if (btn) { btn.disabled = true; btn.innerText = "Guardando..."; }

    const id = document.getElementById('edit-cash-id').value;
    const date = document.getElementById('edit-cash-date').value;

    let weekday = document.getElementById('edit-cash-weekday').value;
    if (!weekday) weekday = getWeekdayFromDate(date);

    const m_ef = parseFloat(document.getElementById('edit-cash-morning-ef')?.value || 0);
    const m_qr = parseFloat(document.getElementById('edit-cash-morning-qr')?.value || 0);
    const a_ef = parseFloat(document.getElementById('edit-cash-afternoon-ef')?.value || 0);
    const a_qr = parseFloat(document.getElementById('edit-cash-afternoon-qr')?.value || 0);

    const payload = {
        date,
        weekday,
        morning_ef: m_ef,
        morning_qr: m_qr,
        afternoon_ef: a_ef,
        afternoon_qr: a_qr,
        morning_sales: m_ef + m_qr,
        afternoon_sales: a_ef + a_qr,
        cash: m_ef + a_ef,
        card: m_qr + a_qr,
        expenses: parseFloat(document.getElementById('edit-cash-expenses')?.value || 0),
        notes: document.getElementById('edit-cash-notes')?.value || '',
        expense_list: currentEditCashExpenseList
    };

    try {
        const res = await fetch(`/api/cash/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json();
            alert("Error al actualizar: " + (err.detail || JSON.stringify(err)));
            return;
        }
        toggleModal('modal-edit-cash');
        await fetchCash();
        await fetchDashboard();
        alert("¡Registro de caja actualizado!");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = originalText; }
    }
});

// =====================================================
//                 ELIMINAR REGISTRO
// =====================================================

async function deleteCash(id) {
    if (confirm('¿Eliminar este registro de caja?')) {
        await fetch(`/api/cash/${id}`, { method: 'DELETE' });
        await fetchCash();
        await fetchDashboard();
    }
}


// =====================================================
//                 DASHBOARD
// =====================================================

let charts = {};
let selectedMonth = '';
let selectedCompareMonth = '';

async function fetchDashboard() {
    // We don't even need /api/dashboard anymore because we have state.cash and state.expenseCategories
    // Let's populate the month filter
    populateMonthFilter();
    renderDashboard();
}

function populateMonthFilter() {
    const cashData = state.cash || [];
    const filter = document.getElementById('dashboard-month-filter');
    const compareFilter = document.getElementById('dashboard-compare-filter');
    if (!filter) return;

    const months = [...new Set(cashData.map(r => r.date.slice(0, 7)))].sort().reverse();
    
    const oldMonth = filter.value;
    const oldCompareMonth = compareFilter ? compareFilter.value : '';

    filter.innerHTML = '';
    if (compareFilter) compareFilter.innerHTML = '';

    months.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.innerText = formatMonthLiteral(m);
        filter.appendChild(opt);
        
        if (compareFilter) {
            const opt2 = document.createElement('option');
            opt2.value = m;
            opt2.innerText = formatMonthLiteral(m);
            compareFilter.appendChild(opt2);
        }
    });

    if (months.length > 0) {
        if (oldMonth && months.includes(oldMonth)) {
            selectedMonth = oldMonth;
        } else {
            selectedMonth = months[0];
        }
        filter.value = selectedMonth;
        
        if (compareFilter) {
            if (oldCompareMonth && months.includes(oldCompareMonth)) {
                selectedCompareMonth = oldCompareMonth;
            } else if (months.length > 1) {
                selectedCompareMonth = months[1];
            } else {
                selectedCompareMonth = months[0];
            }
            compareFilter.value = selectedCompareMonth;
        }
    }

    // Safely add event listeners without duplicates by recreating elements if necessary
    const newFilter = filter.cloneNode(true);
    filter.parentNode.replaceChild(newFilter, filter);
    newFilter.addEventListener('change', (e) => {
        selectedMonth = e.target.value;
        renderDashboard();
    });
    
    if (compareFilter) {
        const newCompareFilter = compareFilter.cloneNode(true);
        compareFilter.parentNode.replaceChild(newCompareFilter, compareFilter);
        newCompareFilter.addEventListener('change', (e) => {
            selectedCompareMonth = e.target.value;
            renderDashboard();
        });
    }
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

    // Trend logic (compare selected month vs selectedCompareMonth)
    if (selectedCompareMonth && selectedCompareMonth !== selectedMonth) {
        const currentMonthStr = new Date().toISOString().slice(0, 7);
        let limitDay = 31;
        if (selectedMonth === currentMonthStr) {
            limitDay = new Date().getDate();
        }

        const prevRows = cashData.filter(r => {
            if (!r.date.startsWith(selectedCompareMonth)) return false;
            const day = parseInt(r.date.split('-')[2], 10);
            return day <= limitDay;
        });

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
        
        let compareLabel = formatMonthLiteral(selectedCompareMonth);
        if (limitDay < 31) {
            compareLabel += ` (hasta el día ${limitDay})`;
        }
        document.querySelectorAll('.compare-month-label').forEach(el => el.innerText = compareLabel);
    } else {
        document.getElementById('trend-ventas').innerText = '—';
        document.getElementById('trend-gastos').innerText = '—';
        document.getElementById('trend-ganancia').innerText = '—';
        
        document.querySelectorAll('.compare-month-label').forEach(el => el.innerText = 'Mes Seleccionado');
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

    // 4. Comparativo mensual (Todos los meses acumulando beneficio)
    renderMonthlyComparisonChart(cashData);

    // Comparativo de Turnos (Mes actual)
    renderShiftComparisonChart(currentMonthRows);

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
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
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
            data: { 
                labels, 
                datasets: [{ 
                    data: values, 
                    backgroundColor: bgColors.map(c => c + 'aa'), // Add transparency
                    borderColor: bgColors,
                    borderWidth: 1.5,
                    borderRadius: 6 
                }] 
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } }, 
                plugins: { legend: { display: false } } 
            }
        });
    }

    const totalsDiv = document.getElementById("weekly-totals");
    if (totalsDiv) {
        let html = "<div style='display:flex; justify-content:center; gap: 10px; flex-wrap:wrap;'>";
        weeklyTotals.forEach((tot, i) => {
            if (tot > 0) {
                html += `<div style="padding:0.4rem 0.8rem; background:${weekColors[i % weekColors.length]}22; border-left:4px solid ${weekColors[i % weekColors.length]}; border-radius:6px; font-size:0.9rem;">Semana ${i + 1}: <strong style="color:white">$${formatMoney(tot)}</strong></div>`;
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
    if (!canvas) return;

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
    
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.5)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.05)');

    charts.monthCompare = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Beneficio Neto',
                data: totals,
                borderColor: '#8b5cf6',
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#8b5cf6',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: '#8b5cf6',
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function renderShiftComparisonChart(rows) {
    const totalMorning = rows.reduce((acc, r) => acc + (r.morning_sales || 0), 0);
    const totalAfternoon = rows.reduce((acc, r) => acc + (r.afternoon_sales || 0), 0);

    const canvas = document.getElementById('chart-shift-compare');
    if (!canvas) return;

    charts.shiftCompare = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['Turno Mañana', 'Turno Tarde'],
            datasets: [{
                data: [totalMorning, totalAfternoon],
                backgroundColor: ['rgba(245, 158, 11, 0.8)', 'rgba(59, 130, 246, 0.8)'],
                borderColor: ['rgba(245, 158, 11, 1)', 'rgba(59, 130, 246, 1)'],
                borderWidth: 1
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    position: 'bottom',
                    labels: { color: '#94a3b8' }
                } 
            } 
        }
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
            if (totalsByWeekday[day] !== undefined) {
                totalsByWeekday[day] += r.net_income;
            }
        });

        // Convertir a array y ordenar de mayor a menor (incluyendo domingo)
        const ranking = Object.entries(totalsByWeekday)
            .map(([weekday, total]) => ({ weekday, total }))
            .sort((a, b) => b.total - a.total);

        result.push({
            month,
            ranking
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

        tr.innerHTML = `
            <td style="vertical-align:top;">${formatMonthLiteral(row.month)}</td>
            <td>${rankingList}</td>
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
        if (typeof populateCashSupplierSelects === 'function') {
            populateCashSupplierSelects();
        }
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

    document.getElementById('global-history-search')?.addEventListener('input', (e) => {
        globalHistorySearchTerm = e.target.value.toLowerCase().trim();
        renderGlobalPriceHistory();
    });
});

// =====================================================
//             HISTORIAL DE PRECIOS Y COMPRAS
// =====================================================

let currentGlobalHistoryPeriod = 'all';
let rawGlobalHistoryData = [];
let globalHistorySearchTerm = '';

async function fetchGlobalPriceHistory(period = 'all') {
    currentGlobalHistoryPeriod = period;
    try {
        const res = await fetch(`/api/products/price-history/all?period=${period}`);
        if (!res.ok) throw new Error("Error al obtener historial de precios");
        rawGlobalHistoryData = await res.json();
        renderGlobalPriceHistory();
    } catch (err) {
        console.error(err);
        showToast("Error al cargar el historial de precios", "error");
    }
}

function filterGlobalHistory(period) {
    document.querySelectorAll('.history-period-btn').forEach(btn => {
        if (btn.dataset.period === period) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    fetchGlobalPriceHistory(period);
}

function renderGlobalPriceHistory() {
    const tbody = document.querySelector('#global-history-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = rawGlobalHistoryData.filter(r => {
        if (!globalHistorySearchTerm) return true;
        return (r.product_name || '').toLowerCase().includes(globalHistorySearchTerm);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Sin registros de cambios en este período</td></tr>';
        return;
    }

    filtered.forEach(r => {
        const dateStr = r.created_at ? new Date(r.created_at).toLocaleString('es-AR') : '-';
        
        const cheapest = parseFloat(r.cheapest_cost || 0);
        const highest = parseFloat(r.highest_cost || 0);
        const oldP = parseFloat(r.old_price_kg || 0);
        const newP = parseFloat(r.new_price_kg || 0);
        
        const diffP = newP - oldP;
        let diffBadge = '—';
        if (oldP > 0) {
            if (diffP > 0) {
                diffBadge = `<span style="color:var(--danger-color); font-weight:bold;">▲ +$${formatMoney(diffP)}</span>`;
            } else if (diffP < 0) {
                diffBadge = `<span style="color:var(--success-color); font-weight:bold;">▼ -$${formatMoney(Math.abs(diffP))}</span>`;
            } else {
                diffBadge = `<span style="color:var(--text-secondary);">Sin cambio</span>`;
            }
        } else {
            diffBadge = `<span style="color:var(--success-color); font-weight:bold;">⭐ Inicial</span>`;
        }

        const cheapestStr = cheapest > 0 ? `<span class="cheaper-cost">$${formatMoney(cheapest)} <span class="cheaper-cost-badge">Más barato</span></span>` : '-';
        const highestStr = highest > 0 ? `$${formatMoney(highest)}` : '-';
        const oldPStr = oldP > 0 ? `$${formatMoney(oldP)}` : '-';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-size:0.85em; color:var(--text-secondary);">${dateStr}</td>
            <td><strong>${r.product_name}</strong></td>
            <td>${cheapestStr}</td>
            <td>${highestStr}</td>
            <td>${oldPStr}</td>
            <td><strong style="color:var(--primary-color);">$${formatMoney(newP)}</strong></td>
            <td>${diffBadge}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function openProductPriceHistory(productId, productName) {
    document.getElementById('hist-prod-name').innerText = productName;
    const tbody = document.querySelector('#product-history-table tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Cargando...</td></tr>';

    toggleModal('modal-price-history');

    try {
        const res = await fetch(`/api/products/${productId}/price-history`);
        if (!res.ok) throw new Error("Error al obtener historial del producto");
        const history = await res.json();

        if (!tbody) return;
        tbody.innerHTML = '';

        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Sin historial de modificaciones registrado</td></tr>';
            return;
        }

        history.forEach(r => {
            const dateStr = r.created_at ? new Date(r.created_at).toLocaleString('es-AR') : '-';
            const cheapest = parseFloat(r.cheapest_cost || 0);
            const highest = parseFloat(r.highest_cost || 0);
            const oldP = parseFloat(r.old_price_kg || 0);
            const newP = parseFloat(r.new_price_kg || 0);

            const cheapestStr = cheapest > 0 ? `<span class="cheaper-cost">$${formatMoney(cheapest)} <span class="cheaper-cost-badge">Más barato</span></span>` : '-';
            const highestStr = highest > 0 ? `$${formatMoney(highest)}` : '-';
            const oldPStr = oldP > 0 ? `$${formatMoney(oldP)}` : '-';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-size:0.85em; color:var(--text-secondary);">${dateStr}</td>
                <td>${oldPStr}</td>
                <td><strong style="color:var(--primary-color);">$${formatMoney(newP)}</strong></td>
                <td>${cheapestStr}</td>
                <td>${highestStr}</td>
                <td>${r.margin}%</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error(err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--danger-color);">Error al cargar historial</td></tr>';
    }
}

// ======================================================
//                 GESTIÓN DE PROVEEDORES
// ======================================================

async function loadManageSuppliers() {
    try {
        const res = await fetch('/api/suppliers');
        const data = await res.json();
        state.suppliers = data;
        renderManageSuppliers();
    } catch (e) {
        console.error("Error cargando proveedores", e);
    }
}

function renderManageSuppliers() {
    const tbody = document.querySelector('#manage-suppliers-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.suppliers.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${s.name}</td>
            <td>${s.phone || '-'}</td>
            <td>${s.email || '-'}</td>
            <td>${s.salesperson || '-'}</td>
            <td style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary" onclick="editGlobalSupplier(${s.id})">✏️</button>
                <button class="btn btn-danger" onclick="deleteGlobalSupplier(${s.id})">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openGlobalSupplierModal() {
    document.getElementById('global-supplier-modal-title').innerText = "Nuevo Proveedor";
    document.getElementById('gs-id').value = '';
    document.getElementById('global-supplier-form').reset();
    toggleModal('modal-global-supplier');
}

function editGlobalSupplier(id) {
    const s = state.suppliers.find(x => x.id === id);
    if (!s) return;
    document.getElementById('global-supplier-modal-title').innerText = "Editar Proveedor";
    document.getElementById('gs-id').value = s.id;
    document.getElementById('gs-name').value = s.name || '';
    document.getElementById('gs-phone').value = s.phone || '';
    document.getElementById('gs-email').value = s.email || '';
    document.getElementById('gs-salesperson').value = s.salesperson || '';
    toggleModal('modal-global-supplier');
}

async function deleteGlobalSupplier(id) {
    if (confirm('¿Eliminar proveedor?')) {
        await fetch('/api/suppliers/' + id, { method: 'DELETE' });
        loadManageSuppliers();
    }
}

document.getElementById('global-supplier-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Guardando...";

    const id = document.getElementById('gs-id').value;
    const payload = {
        name: document.getElementById('gs-name').value,
        phone: document.getElementById('gs-phone').value,
        email: document.getElementById('gs-email').value,
        salesperson: document.getElementById('gs-salesperson').value
    };
    
    try {
        if (id) {
            await fetch('/api/suppliers/' + id, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
        } else {
            await fetch('/api/suppliers', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
        }
        toggleModal('modal-global-supplier');
        loadManageSuppliers();
    } catch (e) {
        alert("Error al guardar el proveedor");
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
});


// ======================================================
//         MÓDULO PAGOS A PROVEEDORES DIFERIDOS
// ======================================================

async function fetchSupplierDebts() {
    try {
        const res = await fetch('/api/supplier-debts');
        if (!res.ok) return;
        state.supplierDebts = await res.json();

        let totalBalance = 0;
        let totalPaid = 0;
        let totalPurchases = 0;

        state.supplierDebts.forEach(d => {
            totalBalance += parseFloat(d.balance || 0);
            totalPaid += parseFloat(d.paid_amount || 0);
            totalPurchases += parseFloat(d.total_amount || 0);
        });

        const kpiBal = document.getElementById('kpi-debt-balance');
        const kpiPaid = document.getElementById('kpi-debt-paid');
        const kpiTot = document.getElementById('kpi-debt-total');

        if (kpiBal) kpiBal.innerText = `$${formatMoney(totalBalance)}`;
        if (kpiPaid) kpiPaid.innerText = `$${formatMoney(totalPaid)}`;
        if (kpiTot) kpiTot.innerText = `$${formatMoney(totalPurchases)}`;

        renderSupplierDebts(state.supplierDebts);
    } catch (e) {
        console.error("Error al cargar deudas de proveedores:", e);
    }
}

function renderSupplierDebts(list) {
    const tbody = document.getElementById('supplier-debts-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:2rem; color:var(--text-secondary);">No hay compras diferidas registradas. ¡Hacé clic en "+ Nueva Recepción / Factura" para cargar una!</td></tr>`;
        return;
    }

    list.forEach(d => {
        let recDate = d.reception_date || '-';
        if (recDate.includes('-')) {
            const [y, m, day] = recDate.split('-');
            recDate = `${day}/${m}/${y}`;
        }

        let dueDate = d.due_date || '-';
        if (dueDate !== '-' && dueDate.includes('-')) {
            const [y, m, day] = dueDate.split('-');
            dueDate = `${day}/${m}/${y}`;
        }

        let statusBadge = '<span class="badge badge-danger">PENDIENTE</span>';
        if (d.status === 'PAGADO') {
            statusBadge = '<span class="badge badge-success">PAGADO</span>';
        } else if (d.status === 'PARCIAL') {
            statusBadge = '<span class="badge badge-warning">PARCIAL</span>';
        }

        const balColor = parseFloat(d.balance) > 0 ? 'var(--danger-color)' : 'var(--success-color)';

        tbody.innerHTML += `
            <tr>
                <td style="font-weight:600;">${recDate}</td>
                <td><b>${d.supplier_name}</b></td>
                <td><span style="font-family:monospace; font-size:0.9rem;">${d.invoice_number || '-'}</span></td>
                <td>$${formatMoney(parseFloat(d.total_amount))}</td>
                <td style="color:var(--success-color);">$${formatMoney(parseFloat(d.paid_amount))}</td>
                <td style="font-weight:700; color:${balColor}; font-size:1.05rem;">$${formatMoney(parseFloat(d.balance))}</td>
                <td>${dueDate}</td>
                <td>${statusBadge}</td>
                <td style="display:flex; gap:0.4rem; align-items:center;">
                    ${parseFloat(d.balance) > 0.001 ? `<button class="btn btn-primary" style="padding:0.25rem 0.6rem; font-size:0.8rem;" onclick="openPaySupplierDebtModal(${d.id})">+ Pagar</button>` : ''}
                    <button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.8rem;" title="Ver pagos" onclick="openViewSupplierPaymentsModal(${d.id})">📜 Cuotas (${(d.payments || []).length})</button>
                    <button class="btn btn-danger" style="padding:0.25rem 0.5rem; font-size:0.8rem;" title="Eliminar" onclick="deleteSupplierDebt(${d.id})">🗑️</button>
                </td>
            </tr>
        `;
    });
}

function filterSupplierDebts() {
    const q = (document.getElementById('supplier-debt-search')?.value || '').toLowerCase().trim();
    if (!q) {
        renderSupplierDebts(state.supplierDebts);
        return;
    }
    const filtered = (state.supplierDebts || []).filter(d => 
        (d.supplier_name && d.supplier_name.toLowerCase().includes(q)) ||
        (d.invoice_number && d.invoice_number.toLowerCase().includes(q)) ||
        (d.notes && d.notes.toLowerCase().includes(q))
    );
    renderSupplierDebts(filtered);
}

function openAddSupplierDebtModal() {
    const supSel = document.getElementById('sd-supplier');
    if (supSel) {
        supSel.innerHTML = '<option value="">Seleccionar proveedor...</option>';
        (state.suppliers || []).forEach(s => {
            supSel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
        });
    }
    const today = new Date().toISOString().split('T')[0];
    const recInput = document.getElementById('sd-reception-date');
    if (recInput) recInput.value = today;
    toggleModal('modal-add-supplier-debt');
}

document.getElementById('add-supplier-debt-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn ? btn.innerText : '';
    if (btn) { btn.disabled = true; btn.innerText = "Guardando..."; }

    const payload = {
        supplier_id: parseInt(document.getElementById('sd-supplier').value),
        reception_date: document.getElementById('sd-reception-date').value,
        invoice_number: document.getElementById('sd-invoice-num').value.trim() || null,
        total_amount: parseFloat(document.getElementById('sd-total-amount').value),
        due_date: document.getElementById('sd-due-date').value || null,
        notes: document.getElementById('sd-notes').value.trim() || null
    };

    try {
        const res = await fetch('/api/supplier-debts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json();
            alert("Error al registrar compra: " + (err.detail || JSON.stringify(err)));
            return;
        }
        toggleModal('modal-add-supplier-debt');
        e.target.reset();
        await fetchSupplierDebts();
        alert("¡Compra diferida registrada exitosamente!");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = originalText; }
    }
});

function openPaySupplierDebtModal(debtId) {
    const debt = (state.supplierDebts || []).find(d => d.id == debtId);
    if (!debt) return;

    document.getElementById('sd-pay-debt-id').value = debt.id;
    document.getElementById('sd-pay-supplier-name').innerText = debt.supplier_name;
    document.getElementById('sd-pay-invoice-num').innerText = debt.invoice_number || 'S/N';
    document.getElementById('sd-pay-current-balance').innerText = `$${formatMoney(parseFloat(debt.balance))}`;
    document.getElementById('sd-pay-amount').value = parseFloat(debt.balance).toFixed(2);

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sd-pay-date').value = today;

    toggleModal('modal-pay-supplier-debt');
}

document.getElementById('pay-supplier-debt-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn ? btn.innerText : '';
    if (btn) { btn.disabled = true; btn.innerText = "Registrando..."; }

    const debtId = document.getElementById('sd-pay-debt-id').value;
    const impactCash = document.getElementById('sd-pay-impact-cash')?.checked ?? true;
    const payload = {
        payment_date: document.getElementById('sd-pay-date').value,
        amount: parseFloat(document.getElementById('sd-pay-amount').value),
        payment_method: document.getElementById('sd-pay-method').value,
        notes: document.getElementById('sd-pay-notes').value.trim() || null,
        impact_cash: impactCash
    };

    try {
        const res = await fetch(`/api/supplier-debts/${debtId}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json();
            alert("Error al registrar pago: " + (err.detail || JSON.stringify(err)));
            return;
        }
        toggleModal('modal-pay-supplier-debt');
        e.target.reset();
        await fetchSupplierDebts();
        if (impactCash) {
            await fetchCash();
        }
        alert(impactCash ? "¡Pago registrado e impactado en la Caja Diaria!" : "¡Pago registrado correctamente!");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = originalText; }
    }
});

function openViewSupplierPaymentsModal(debtId) {
    const debt = (state.supplierDebts || []).find(d => d.id == debtId);
    if (!debt) return;

    document.getElementById('view-pmts-supplier').innerText = debt.supplier_name;
    document.getElementById('view-pmts-invoice').innerText = debt.invoice_number || 'S/N';

    const tbody = document.getElementById('view-pmts-table-body');
    tbody.innerHTML = '';

    const pmts = debt.payments || [];
    if (pmts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:#94a3b8;">Aún no se registraron pagos para esta compra.</td></tr>`;
    } else {
        pmts.forEach(p => {
            let pDate = p.payment_date || '-';
            if (pDate.includes('-')) {
                const [y, m, day] = pDate.split('-');
                pDate = `${day}/${m}/${y}`;
            }
            tbody.innerHTML += `
                <tr>
                    <td><b>${pDate}</b></td>
                    <td style="color:var(--success-color); font-weight:700;">$${formatMoney(parseFloat(p.amount))}</td>
                    <td><span class="badge badge-info">${p.payment_method}</span></td>
                    <td style="color:#94a3b8; font-size:0.85rem;">${p.notes || '-'}</td>
                    <td>
                        <button class="btn btn-danger" style="padding:0.2rem 0.4rem; font-size:0.75rem;" onclick="deleteSupplierDebtPayment(${p.id}, ${debt.id})">Anular</button>
                    </td>
                </tr>
            `;
        });
    }

    toggleModal('modal-view-supplier-payments');
}

async function deleteSupplierDebtPayment(paymentId, debtId) {
    if (!confirm("¿Anular este pago realizado? El saldo de la deuda se recalculará automáticamente.")) return;
    try {
        const res = await fetch(`/api/supplier-debts/payments/${paymentId}`, { method: 'DELETE' });
        if (res.ok) {
            await fetchSupplierDebts();
            openViewSupplierPaymentsModal(debtId);
        }
    } catch (e) {
        alert("Error al anular pago");
    }
}

async function deleteSupplierDebt(debtId) {
    if (!confirm("¿Eliminar este registro de compra diferida y todo su historial de cuotas?")) return;
    try {
        const res = await fetch(`/api/supplier-debts/${debtId}`, { method: 'DELETE' });
        if (res.ok) {
            await fetchSupplierDebts();
        }
    } catch (e) {
        alert("Error al eliminar compra");
    }
}


// ======================================================
//         MÓDULO VENCIMIENTOS DEL HOGAR
// ======================================================

let currentBillFilter = 'pending';

async function fetchHouseholdBills() {
    try {
        const res = await fetch('/api/household-bills');
        if (!res.ok) return;
        state.householdBills = await res.json();
        renderHouseholdBillsTable();
    } catch (e) {
        console.error("Error al cargar vencimientos del hogar:", e);
    }
}

function filterHouseholdBills(filterType) {
    currentBillFilter = filterType;
    document.querySelectorAll('.bill-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filterType);
    });
    renderHouseholdBillsTable();
}

function renderHouseholdBillsTable() {
    const tbody = document.getElementById('household-bills-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const bills = state.householdBills || [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dueTodayOrOverdue = 0;
    let dueSoon = 0;
    let totalPendingAmount = 0;

    bills.forEach(b => {
        if (!b.is_paid) {
            totalPendingAmount += parseFloat(b.amount || 0);
            const [y, m, d] = b.due_date.split('-');
            const dueDate = new Date(y, parseInt(m) - 1, d);
            const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

            if (diffDays <= 0) {
                dueTodayOrOverdue++;
            } else if (diffDays <= 5) {
                dueSoon++;
            }
        }
    });

    const kpiToday = document.getElementById('kpi-bills-due-today');
    const kpiSoon = document.getElementById('kpi-bills-due-soon');
    const kpiPending = document.getElementById('kpi-bills-total-pending');

    if (kpiToday) kpiToday.innerText = dueTodayOrOverdue;
    if (kpiSoon) kpiSoon.innerText = dueSoon;
    if (kpiPending) kpiPending.innerText = `$${formatMoney(totalPendingAmount)}`;

    const searchQ = (document.getElementById('household-bills-search')?.value || '').toLowerCase().trim();

    let filtered = bills.filter(b => {
        if (currentBillFilter === 'pending' && b.is_paid) return false;
        if (currentBillFilter === 'paid' && !b.is_paid) return false;
        if (searchQ) {
            return (b.concept && b.concept.toLowerCase().includes(searchQ)) ||
                   (b.category && b.category.toLowerCase().includes(searchQ)) ||
                   (b.notes && b.notes.toLowerCase().includes(searchQ));
        }
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:2rem; color:var(--text-secondary);">No hay vencimientos para mostrar en este filtro.</td></tr>`;
        return;
    }

    filtered.forEach(b => {
        const [y, m, d] = b.due_date.split('-');
        const formattedDueDate = `${d}/${m}/${y}`;
        const dueDate = new Date(y, parseInt(m) - 1, d);
        const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

        let statusBadge = '';
        if (b.is_paid) {
            let pDate = b.payment_date || '';
            if (pDate.includes('-')) {
                const [py, pm, pd] = pDate.split('-');
                pDate = ` el ${pd}/${pm}`;
            }
            statusBadge = `<span class="badge badge-success">✓ PAGADO${pDate}</span>`;
        } else {
            if (diffDays < 0) {
                statusBadge = `<span class="badge badge-danger">🔴 VENCIDO HACE ${Math.abs(diffDays)} DÍAS</span>`;
            } else if (diffDays === 0) {
                statusBadge = `<span class="badge badge-danger">🔴 ¡VENCE HOY!</span>`;
            } else if (diffDays <= 3) {
                statusBadge = `<span class="badge badge-warning">🟡 VENCE EN ${diffDays} DÍAS</span>`;
            } else {
                statusBadge = `<span class="badge badge-info">🟢 Vence en ${diffDays} días</span>`;
            }
        }

        let catBadge = `<span class="badge badge-purple">${b.category}</span>`;
        if (b.category === 'SERVICIO') catBadge = `<span class="badge badge-info">💡 SERVICIO</span>`;
        if (b.category === 'IMPUESTO') catBadge = `<span class="badge badge-warning">🏛️ IMPUESTO</span>`;
        if (b.category === 'CREDITO') catBadge = `<span class="badge badge-danger">🏦 CRÉDITO</span>`;
        if (b.category === 'TARJETA') catBadge = `<span class="badge badge-purple">💳 TARJETA</span>`;

        tbody.innerHTML += `
            <tr style="${b.is_paid ? 'opacity:0.6;' : ''}">
                <td style="font-weight:600;">${formattedDueDate}</td>
                <td>${catBadge}</td>
                <td><b>${b.concept}</b></td>
                <td style="font-weight:700; font-size:1.05rem;">$${formatMoney(parseFloat(b.amount))}</td>
                <td>${statusBadge}</td>
                <td style="font-size:0.85rem; color:#94a3b8;">${b.notes || '-'}</td>
                <td style="display:flex; gap:0.4rem; align-items:center;">
                    <button class="btn ${b.is_paid ? 'btn-secondary' : 'btn-primary'}" style="padding:0.25rem 0.6rem; font-size:0.8rem;" onclick="toggleHouseholdBillPaid(${b.id})">
                        ${b.is_paid ? 'Desmarcar' : '✓ Pagado'}
                    </button>
                    <button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.8rem;" title="Duplicar para el próximo mes" onclick="repeatHouseholdBillNextMonth(${b.id})">
                        🔁 Mes Sig.
                    </button>
                    <button class="btn btn-danger" style="padding:0.25rem 0.5rem; font-size:0.8rem;" onclick="deleteHouseholdBill(${b.id})">🗑️</button>
                </td>
            </tr>
        `;
    });
}

async function repeatHouseholdBillNextMonth(billId) {
    try {
        const res = await fetch(`/api/household-bills/${billId}/repeat-next-month`, { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            let dueFmt = data.new_due_date || '';
            if (dueFmt.includes('-')) {
                const [y, m, d] = dueFmt.split('-');
                dueFmt = `${d}/${m}/${y}`;
            }
            await fetchHouseholdBills();
            alert(`✅ ¡Vencimiento repetido para el próximo mes con fecha ${dueFmt}!`);
        } else {
            alert("Error al repetir vencimiento.");
        }
    } catch (e) {
        alert("Error de conexión al repetir vencimiento.");
    }
}

document.getElementById('add-household-bill-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn ? btn.innerText : '';
    if (btn) { btn.disabled = true; btn.innerText = "Guardando..."; }

    const payload = {
        concept: document.getElementById('hb-concept').value.trim(),
        category: document.getElementById('hb-category').value,
        amount: parseFloat(document.getElementById('hb-amount').value),
        due_date: document.getElementById('hb-due-date').value,
        notes: document.getElementById('hb-notes').value.trim() || null
    };

    try {
        const res = await fetch('/api/household-bills', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json();
            alert("Error al guardar: " + (err.detail || JSON.stringify(err)));
            return;
        }
        toggleModal('modal-add-household-bill');
        e.target.reset();
        await fetchHouseholdBills();
        alert("¡Vencimiento guardado correctamente!");
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = originalText; }
    }
});

async function toggleHouseholdBillPaid(billId) {
    const bill = (state.householdBills || []).find(x => x.id == billId);
    const wasUnpaid = bill && !bill.is_paid;

    try {
        const res = await fetch(`/api/household-bills/${billId}/toggle-paid`, { method: 'PUT' });
        if (res.ok) {
            await fetchHouseholdBills();
            if (wasUnpaid) {
                if (confirm(`🎉 ¡Vencimiento marcado como pagado!\n\n¿Querés generar automáticamente la misma boleta para el próximo mes?`)) {
                    await repeatHouseholdBillNextMonth(billId);
                }
            }
        }
    } catch (e) {
        alert("Error al cambiar estado");
    }
}

async function deleteHouseholdBill(billId) {
    if (!confirm("¿Eliminar este vencimiento?")) return;
    try {
        const res = await fetch(`/api/household-bills/${billId}`, { method: 'DELETE' });
        if (res.ok) {
            await fetchHouseholdBills();
        }
    } catch (e) {
        alert("Error al eliminar");
    }
}


// ======================================================
//         MÓDULO TELEGRAM & ALERTAS
// ======================================================

async function loadTelegramConfig() {
    try {
        const res = await fetch('/api/telegram/config');
        if (!res.ok) return;
        const cfg = await res.json();
        const tokenInput = document.getElementById('tg-bot-token');
        const chatInput = document.getElementById('tg-chat-id');
        if (tokenInput && cfg.bot_token) {
            tokenInput.placeholder = `Actual: ${cfg.bot_token}`;
        }
        if (chatInput && cfg.chat_id) {
            chatInput.value = cfg.chat_id;
        }
    } catch (e) {
        console.error("Error al cargar config de Telegram:", e);
    }
}

document.getElementById('telegram-config-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const originalText = btn ? btn.innerText : '';
    if (btn) { btn.disabled = true; btn.innerText = "Guardando..."; }

    const payload = {
        bot_token: document.getElementById('tg-bot-token').value.trim(),
        chat_id: document.getElementById('tg-chat-id').value.trim()
    };

    try {
        const res = await fetch('/api/telegram/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            toggleModal('modal-telegram-config');
            alert("¡Configuración de Telegram guardada correctamente!");
        } else {
            alert("Error al guardar configuración");
        }
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = originalText; }
    }
});

async function testTelegramAlert() {
    const token = document.getElementById('tg-bot-token')?.value.trim();
    const chat_id = document.getElementById('tg-chat-id')?.value.trim();

    if (token || chat_id) {
        await fetch('/api/telegram/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bot_token: token || '', chat_id: chat_id || '' })
        });
    }

    try {
        const res = await fetch('/api/telegram/test', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            alert("✅ " + data.message);
        } else {
            alert("❌ Error: " + (data.detail || "No se pudo conectar con Telegram"));
        }
    } catch (e) {
        alert("Error de conexión al probar Telegram");
    }
}

async function triggerTelegramAlerts() {
    try {
        const res = await fetch('/api/telegram/send-alerts', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            alert(`✅ ¡Avisos enviados a Telegram! Items notificados: ${data.items_count || 0}`);
        } else {
            alert("❌ Error: " + (data.detail || "Verificá la configuración de tu bot de Telegram"));
        }
    } catch (e) {
        alert("Error de conexión al enviar avisos a Telegram");
    }
}


// ======================================================
//         MÓDULO BALANCE CONTABLE INTEGRAL
// ======================================================

async function loadAccountingReport() {
    const filterEl = document.getElementById('accounting-month-filter');
    if (!filterEl) return;

    // Poblar meses desde state.cash si está vacío
    if (filterEl.children.length === 0) {
        const cashData = state.cash || [];
        const months = [...new Set(cashData.map(r => r.date.slice(0, 7)))].sort().reverse();
        const date = new Date();
        const currentMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!months.includes(currentMonth)) months.unshift(currentMonth);

        months.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.innerText = formatMonthLiteral(m);
            filterEl.appendChild(opt);
        });
        filterEl.value = months[0];
    }

    const month = filterEl.value;
    try {
        const res = await fetch(`/api/reports/accounting?month=${month}`);
        if (!res.ok) return;
        const data = await res.json();

        // KPIs
        const salesTot = data.sales.total || 0;
        document.getElementById('acc-kpi-sales').innerText = `$${formatMoney(salesTot)}`;
        document.getElementById('acc-kpi-sales-ef').innerText = `$${formatMoney(data.sales.ef || 0)}`;
        document.getElementById('acc-kpi-sales-qr').innerText = `$${formatMoney(data.sales.qr || 0)}`;

        document.getElementById('acc-kpi-business-exp').innerText = `$${formatMoney(data.kpis.business_expenses || 0)}`;
        document.getElementById('acc-kpi-business-profit').innerText = `$${formatMoney(data.kpis.net_business_profit || 0)}`;

        document.getElementById('acc-summary-business-profit').innerText = `$${formatMoney(data.kpis.net_business_profit || 0)}`;
        const personalExp = (data.expenses["RETIROS PERSONALES"] || 0) + (data.expenses["GASTOS HOGAR"] || 0);
        document.getElementById('acc-summary-personal-exp').innerText = `$${formatMoney(personalExp)}`;
        document.getElementById('acc-summary-final-pocket').innerText = `$${formatMoney(data.kpis.final_cash_pocket || 0)}`;

        // Tabla Desglose
        const tbody = document.getElementById('accounting-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const pct = (val) => salesTot > 0 ? ((val / salesTot) * 100).toFixed(1) + '%' : '0.0%';

        // 1. Ingresos
        tbody.innerHTML += `
            <tr style="background:rgba(245,158,11,0.08); font-weight:600;">
                <td>💰 Ventas en Efectivo (Caja)</td>
                <td><span class="badge badge-success">INGRESO</span></td>
                <td>$${formatMoney(data.sales.ef || 0)}</td>
                <td>${pct(data.sales.ef || 0)}</td>
            </tr>
            <tr style="background:rgba(245,158,11,0.08); font-weight:600;">
                <td>📱 Ventas Digitales (QR / Transferencia)</td>
                <td><span class="badge badge-success">INGRESO</span></td>
                <td>$${formatMoney(data.sales.qr || 0)}</td>
                <td>${pct(data.sales.qr || 0)}</td>
            </tr>
            <tr style="background:rgba(245,158,11,0.15); font-weight:700;">
                <td>⭐ TOTAL INGRESOS POR VENTAS</td>
                <td><span class="badge badge-success">TOTAL INGRESOS</span></td>
                <td style="color:var(--primary-color);">$${formatMoney(salesTot)}</td>
                <td>100.0%</td>
            </tr>
        `;

        // 2. Egresos Operativos y Comerciales
        const expItems = [
            { name: "🏢 Proveedores de Mercadería (Costo de Ventas)", key: "PROVEEDORES", badge: "badge-danger", type: "COSTO DIRECTO" },
            { name: "📦 Gastos Operativos (Bolsas, film, insumos, fletes)", key: "GASTOS OPERATIVOS", badge: "badge-warning", type: "OPERATIVO" },
            { name: "💡 Gastos Fijos (Alquiler, luz, internet, seguro)", key: "GASTOS FIJOS", badge: "badge-warning", type: "FIJO" },
            { name: "👥 Sueldos de Empleados", key: "SUELDOS", badge: "badge-danger", type: "PERSONAL" },
            { name: "💼 Retiros Personales / Retiro del Titular", key: "RETIROS PERSONALES", badge: "badge-purple", type: "EXTRACCIÓN" },
            { name: "🏠 Gastos del Hogar", key: "GASTOS HOGAR", badge: "badge-purple", type: "PERSONAL" }
        ];

        expItems.forEach(item => {
            const val = data.expenses[item.key] || 0;
            tbody.innerHTML += `
                <tr>
                    <td>${item.name}</td>
                    <td><span class="badge ${item.badge}">${item.type}</span></td>
                    <td style="color:var(--danger-color); font-weight:600;">$${formatMoney(val)}</td>
                    <td style="color:#94a3b8;">${pct(val)}</td>
                </tr>
            `;
        });

    } catch (e) {
        console.error("Error al cargar reporte contable:", e);
    }
}




