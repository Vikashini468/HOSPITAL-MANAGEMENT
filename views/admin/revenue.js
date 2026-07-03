/* =====================================================
   NALAM AI — Revenue Dashboard
===================================================== */

const BASE_URL = "http://localhost:5000";

let monthlyChart = null;
let sourceChart  = null;
let expenseChart = null;

const CHART_COLORS = [
    "#1565c0","#e53935","#2e7d32","#f57c00",
    "#6a1b9a","#00838f","#ad1457","#558b2f"
];

/* =====================================================
   INIT
===================================================== */

window.onload = () => {
    document.getElementById("currentYear").textContent = new Date().getFullYear();
    document.getElementById("refreshBtn").addEventListener("click", loadAll);
    loadAll();
    setInterval(loadAll, 30000);
};

/* =====================================================
   LOAD ALL
===================================================== */

async function loadAll() {
    await Promise.all([
        loadSummary(),
        loadMonthly(),
        loadSourceWise(),
        loadExpenseWise(),
        loadRecentRevenue(),
        loadRecentExpenses()
    ]);
    document.getElementById("lastUpdated").textContent =
        "Updated: " + new Date().toLocaleTimeString();
}

/* =====================================================
   SUMMARY CARDS
===================================================== */

async function loadSummary() {

    try {

        const res  = await fetch(BASE_URL + "/revenue/breakdown");
        const data = await res.json();

        const revenue  = Number(data.totalRevenue  || 0);
        const expenses = Number(data.totalExpenses || 0);
        const profit   = Number(data.netProfit     || 0);

        document.getElementById("totalRevenue").textContent  = "₹" + fmt(revenue);
        document.getElementById("totalExpenses").textContent = "₹" + fmt(expenses);
        document.getElementById("netProfit").textContent     = "₹" + fmt(profit);

        /* colour profit card red if loss */
        const card = document.getElementById("profitCard");
        card.classList.toggle("loss", profit < 0);

    } catch (err) {
        console.error("Summary error:", err);
    }

}

/* =====================================================
   MONTHLY LINE CHART
===================================================== */

async function loadMonthly() {

    try {

        const res  = await fetch(BASE_URL + "/revenue/monthly");
        const data = await res.json();

        const labels  = data.labels  || [];
        const revenue = data.revenue || [];

        if (monthlyChart) monthlyChart.destroy();

        const ctx = document.getElementById("monthlyChart").getContext("2d");

        monthlyChart = new Chart(ctx, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    label: "Revenue (₹)",
                    data: revenue,
                    borderColor: "#1565c0",
                    backgroundColor: "rgba(21,101,192,0.1)",
                    borderWidth: 2,
                    pointBackgroundColor: "#1565c0",
                    pointRadius: 4,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "top" }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: v => "₹" + v.toLocaleString("en-IN")
                        }
                    }
                }
            }
        });

    } catch (err) {
        console.error("Monthly chart error:", err);
    }

}

/* =====================================================
   SOURCE-WISE PIE CHART
===================================================== */

async function loadSourceWise() {

    try {

        const res  = await fetch(BASE_URL + "/revenue/source-wise");
        const data = await res.json();

        const empty = document.getElementById("sourceEmpty");
        const canvas = document.getElementById("sourceChart");

        if (!data.labels || !data.labels.length) {
            empty.style.display  = "block";
            canvas.style.display = "none";
            return;
        }

        empty.style.display  = "none";
        canvas.style.display = "block";

        if (sourceChart) sourceChart.destroy();

        const ctx = canvas.getContext("2d");

        sourceChart = new Chart(ctx, {
            type: "pie",
            data: {
                labels: data.labels,
                datasets: [{
                    data: data.data,
                    backgroundColor: CHART_COLORS.slice(0, data.labels.length),
                    borderWidth: 2,
                    borderColor: "#fff"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom", labels: { font: { size: 12 } } }
                }
            }
        });

    } catch (err) {
        console.error("Source chart error:", err);
    }

}

/* =====================================================
   EXPENSE-WISE DOUGHNUT CHART
===================================================== */

async function loadExpenseWise() {

    try {

        const res  = await fetch(BASE_URL + "/revenue/expense-wise");
        const data = await res.json();

        const empty  = document.getElementById("expenseEmpty");
        const canvas = document.getElementById("expenseChart");

        if (!data.labels || !data.labels.length) {
            empty.style.display  = "block";
            canvas.style.display = "none";
            return;
        }

        empty.style.display  = "none";
        canvas.style.display = "block";

        if (expenseChart) expenseChart.destroy();

        const ctx = canvas.getContext("2d");

        expenseChart = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: data.labels,
                datasets: [{
                    data: data.data,
                    backgroundColor: ["#e53935","#f57c00","#6a1b9a","#00838f","#ad1457"].slice(0, data.labels.length),
                    borderWidth: 2,
                    borderColor: "#fff"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom", labels: { font: { size: 12 } } }
                }
            }
        });

    } catch (err) {
        console.error("Expense chart error:", err);
    }

}

/* =====================================================
   RECENT REVENUE TABLE
===================================================== */

async function loadRecentRevenue() {

    const tbody = document.getElementById("revenueTable");

    try {

        const res  = await fetch(BASE_URL + "/revenue/recent-revenue");
        const rows = await res.json();

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="4">No data available</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${r.id}</td>
                <td><span class="badge-revenue">${r.source}</span></td>
                <td>₹${fmt(r.amount)}</td>
                <td>${fmtDate(r.revenue_date)}</td>
            </tr>
        `).join("");

    } catch (err) {
        console.error("Recent revenue error:", err);
        tbody.innerHTML = `<tr><td colspan="4">Unable to load data</td></tr>`;
    }

}

/* =====================================================
   RECENT EXPENSES TABLE
===================================================== */

async function loadRecentExpenses() {

    const tbody = document.getElementById("expenseTable");

    try {

        const res  = await fetch(BASE_URL + "/revenue/recent-expenses");
        const rows = await res.json();

        if (!rows.length) {
            tbody.innerHTML = `<tr><td colspan="4">No data available</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${r.id}</td>
                <td><span class="badge-expense">${r.category}</span></td>
                <td>₹${fmt(r.amount)}</td>
                <td>${fmtDate(r.expense_date)}</td>
            </tr>
        `).join("");

    } catch (err) {
        console.error("Recent expenses error:", err);
        tbody.innerHTML = `<tr><td colspan="4">Unable to load data</td></tr>`;
    }

}

/* =====================================================
   HELPERS
===================================================== */

function fmt(value) {
    return Number(value || 0).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function fmtDate(dateStr) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric"
    });
}
