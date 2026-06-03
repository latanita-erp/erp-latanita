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
    
    document.getElementById('hist-revenue').innerText = `$${formatMoney(histRevenue)}`;
    document.getElementById('hist-expenses').innerText = `$${formatMoney(histExpenses)}`;
    document.getElementById('hist-profit').innerText = `$${formatMoney(histProfit)}`;
    
    const monthRows = cashData.filter(r => r.date.startsWith(selectedMonth));
    
    const rev = monthRows.reduce((acc, r) => acc + r.net_income, 0);
    const exp = monthRows.reduce((acc, r) => acc + r.expenses, 0);
    const prof = monthRows.reduce((acc, r) => acc + r.total, 0);
    
    document.getElementById('kpi-revenue').innerText = `$${formatMoney(rev)}`;
    document.getElementById('kpi-expenses').innerText = `$${formatMoney(exp)}`;
    document.getElementById('kpi-profit').innerText = `$${formatMoney(prof)}`;
    
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
//                 DATA FETCHING FUNCTIONS
// ======================================================

async function fetchExpenseCategories() {
    try {
        const res = await fetch('/api/expense-categories');
        const data = await res.json();
        state.expenseCategories = data;
    } catch (err) {
        console.error('Error fetching expense categories:', err);
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

async function fetchCash() {
    try {
        const res = await fetch('/api/cash/all');
        const raw = await res.json();

        state.cash = raw.map(r => {
            let date = r.date;
            if (date && date.includes("T")) date = date.split("T")[0];

            const weekday = r.weekday || "";
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
    } catch (err) {
        console.error('Error fetching cash:', err);
    }
}

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
    } catch (err) {
        console.error('Error fetching products:', err);
    }
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
