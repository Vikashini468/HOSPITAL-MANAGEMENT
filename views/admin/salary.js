/* =====================================================
   NALAM AI - Salary Management
===================================================== */

const BASE_URL = "http://localhost:5000";

const employeeTable = document.getElementById("employeeTable");

let employees = [];
let currentEmployee = null;

/* =====================================================
   INITIAL LOAD
===================================================== */

window.onload = () => {
    loadEmployees();
    loadStats();
};

/* =====================================================
   LOAD EMPLOYEES
===================================================== */

async function loadEmployees() {

    try {

        const res = await fetch(BASE_URL + "/salary/employees");
        employees = await res.json();
        renderEmployees();

    } catch (err) {

        console.error(err);
        employeeTable.innerHTML =
            `<tr><td colspan="7">Unable to load employees.</td></tr>`;

    }

}

/* =====================================================
   RENDER TABLE
===================================================== */

function renderEmployees(list) {

    const data = list || employees;

    if (!data.length) {
        employeeTable.innerHTML =
            `<tr><td colspan="7">No Employees Found</td></tr>`;
        return;
    }

    employeeTable.innerHTML = "";

    data.forEach(emp => {

        const net = Number(emp.total_salary || emp.basic_salary || 0);
        const status = emp.payment_status || "Pending";
        const statusClass = status === "Paid" ? "badge-success" : "badge-warning";

        employeeTable.innerHTML +=
        `<tr>
            <td>${emp.id}</td>
            <td>${emp.name}</td>
            <td>${emp.role}</td>
            <td>₹${Number(emp.basic_salary || 0).toLocaleString()}</td>
            <td>₹${net.toLocaleString()}</td>
            <td><span class="${statusClass}">${status}</span></td>
            <td>
                <button class="edit-btn" onclick="selectEmployee(${emp.id})">
                    View
                </button>
            </td>
        </tr>`;

    });

}

/* =====================================================
   SEARCH
===================================================== */

function searchEmployee() {

    const query = document.getElementById("searchEmployee").value.toLowerCase();
    const filtered = employees.filter(e =>
        e.name.toLowerCase().includes(query) ||
        e.role.toLowerCase().includes(query)
    );
    renderEmployees(filtered);

}

/* =====================================================
   LOAD STATS
===================================================== */

async function loadStats() {

    try {

        const res = await fetch(BASE_URL + "/salary/stats");
        const data = await res.json();

        document.getElementById("totalEmployees").innerText =
            data.totalEmployees || 0;

        document.getElementById("monthlyPayroll").innerText =
            "₹" + Number(data.monthlyPayroll || 0).toLocaleString();

        document.getElementById("paidEmployees").innerText =
            data.paidEmployees || 0;

        document.getElementById("pendingEmployees").innerText =
            data.pendingEmployees || 0;

    } catch (err) {
        console.error(err);
    }

}

/* =====================================================
   SELECT EMPLOYEE
===================================================== */

function selectEmployee(id) {

    currentEmployee = employees.find(e => e.id === id);
    if (!currentEmployee) return;

    document.getElementById("empName").innerText = currentEmployee.name;
    document.getElementById("empRole").innerText = currentEmployee.role;
    document.getElementById("empDepartment").innerText = currentEmployee.department || "-";
    document.getElementById("empEmail").innerText = currentEmployee.email || "-";
    document.getElementById("empMobile").innerText = currentEmployee.mobile || "-";

    document.getElementById("employeeDetails").style.display = "block";
    document.getElementById("salaryFormCard").style.display = "none";
    document.getElementById("paymentCard").style.display = "none";
    document.getElementById("historyCard").style.display = "none";

}

/* =====================================================
   OPEN SALARY FORM
===================================================== */

function openSalaryForm() {

    if (!currentEmployee) return;

    document.getElementById("salaryEmployeeName").innerText = currentEmployee.name;
    document.getElementById("salaryEmployeeRole").innerText = currentEmployee.role;
    document.getElementById("basicSalary").value = currentEmployee.basic_salary || 0;
    document.getElementById("hra").value = currentEmployee.hra || 0;
    document.getElementById("allowance").value = currentEmployee.allowance || 0;
    document.getElementById("bonus").value = currentEmployee.bonus || 0;
    document.getElementById("deduction").value = currentEmployee.deduction || 0;

    calculateSalary();

    document.getElementById("salaryFormCard").style.display = "block";

}

function cancelSalaryEdit() {
    document.getElementById("salaryFormCard").style.display = "none";
}

/* =====================================================
   CALCULATE NET SALARY
===================================================== */

function calculateSalary() {

    const basic    = parseFloat(document.getElementById("basicSalary").value) || 0;
    const hra      = parseFloat(document.getElementById("hra").value) || 0;
    const allowance = parseFloat(document.getElementById("allowance").value) || 0;
    const bonus    = parseFloat(document.getElementById("bonus").value) || 0;
    const deduction = parseFloat(document.getElementById("deduction").value) || 0;

    document.getElementById("netSalary").value =
        (basic + hra + allowance + bonus - deduction).toFixed(2);

}

/* =====================================================
   SAVE SALARY
===================================================== */

async function saveSalary() {

    if (!currentEmployee) return;

    const payload = {
        employeeId: currentEmployee.id,
        basicSalary: parseFloat(document.getElementById("basicSalary").value) || 0,
        hra:         parseFloat(document.getElementById("hra").value) || 0,
        allowance:   parseFloat(document.getElementById("allowance").value) || 0,
        bonus:       parseFloat(document.getElementById("bonus").value) || 0,
        deduction:   parseFloat(document.getElementById("deduction").value) || 0
    };

    try {

        const res = await fetch(BASE_URL + "/salary/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (data.success) {
            alert("Salary updated successfully.");
            cancelSalaryEdit();
            loadEmployees();
        } else {
            alert(data.message || "Unable to update salary.");
        }

    } catch (err) {
        console.error(err);
        alert("Server Error");
    }

}

/* =====================================================
   PAY SALARY
===================================================== */

function paySalary() {

    if (!currentEmployee) return;

    document.getElementById("paymentEmployee").innerText = currentEmployee.name;
    document.getElementById("paymentRole").innerText = currentEmployee.role;
    document.getElementById("paymentSalary").innerText =
        "₹" + Number(currentEmployee.total_salary || currentEmployee.basic_salary || 0).toLocaleString();

    document.getElementById("paymentCard").style.display = "block";

}

function cancelPayment() {
    document.getElementById("paymentCard").style.display = "none";
}

async function confirmSalaryPayment() {

    if (!currentEmployee) return;

    const payload = {
        employeeId: currentEmployee.id,
        month:  document.getElementById("salaryMonth").value,
        year:   document.getElementById("salaryYear").value,
        status: document.getElementById("paymentStatus").value
    };

    try {

        const res = await fetch(BASE_URL + "/salary/pay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (data.success) {
            alert("Payment recorded successfully.");
            cancelPayment();
            loadEmployees();
            loadStats();
        } else {
            alert(data.message || "Unable to record payment.");
        }

    } catch (err) {
        console.error(err);
        alert("Server Error");
    }

}

/* =====================================================
   SALARY HISTORY
===================================================== */

async function viewHistory() {

    if (!currentEmployee) return;

    try {

        const res = await fetch(BASE_URL + "/salary/history/" + currentEmployee.id);
        const history = await res.json();
        const tbody = document.getElementById("salaryHistoryTable");

        if (!history.length) {
            tbody.innerHTML = `<tr><td colspan="5">No history found.</td></tr>`;
        } else {
            tbody.innerHTML = "";
            history.forEach(h => {
                tbody.innerHTML +=
                `<tr>
                    <td>${h.month}</td>
                    <td>${h.year}</td>
                    <td>₹${Number(h.salary || 0).toLocaleString()}</td>
                    <td>${h.payment_date ? new Date(h.payment_date).toLocaleDateString() : "-"}</td>
                    <td>${h.status}</td>
                </tr>`;
            });
        }

        document.getElementById("historyCard").style.display = "block";

    } catch (err) {
        console.error(err);
        alert("Unable to load history.");
    }

}

async function downloadSalaryHistory() {

    if (!currentEmployee) return;
    window.open(BASE_URL + "/salary/history/" + currentEmployee.id + "/download");

}
