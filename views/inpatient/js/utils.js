/* ==========================================================
   NALAM AI
   In-Patient Module
   utils.js
========================================================== */

/* ==========================================================
   DATE HELPERS
========================================================== */

function formatDate(date) {

    if (!date) return "-";

    return new Date(date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });

}

function formatDateTime(date) {

    if (!date) return "-";

    return new Date(date).toLocaleString("en-IN");

}

function formatTime(date) {

    if (!date) return "-";

    return new Date(date).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit"
    });

}

/* ==========================================================
   CURRENCY
========================================================== */

function formatCurrency(amount) {

    return Number(amount || 0).toLocaleString("en-IN", {
        style: "currency",
        currency: "INR"
    });

}

/* ==========================================================
   NUMBER FORMAT
========================================================== */

function formatNumber(value) {

    return Number(value || 0).toLocaleString("en-IN");

}

/* ==========================================================
   VALIDATION
========================================================== */

function isEmpty(value) {

    return value === null ||
           value === undefined ||
           value === "";

}

function isPhone(phone) {

    return /^[6-9]\d{9}$/.test(phone);

}

function isEmail(email) {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

}

function validateRequired(form) {

    const fields = form.querySelectorAll("[required]");

    for (const field of fields) {

        if (!field.value.trim()) {

            field.focus();

            return {
                valid: false,
                message: `${field.name || field.id} is required`
            };

        }

    }

    return {
        valid: true
    };

}

/* ==========================================================
   SEARCH FILTER
========================================================== */

function filterTable(searchText, tableId) {

    const table = document.getElementById(tableId);

    if (!table) return;

    const rows = table.querySelectorAll("tbody tr");

    searchText = searchText.toLowerCase();

    rows.forEach(row => {

        const text = row.textContent.toLowerCase();

        row.style.display =
            text.includes(searchText)
                ? ""
                : "none";

    });

}

/* ==========================================================
   PAGINATION
========================================================== */

function paginateTable(tableId, page = 1, rowsPerPage = 10) {

    const table = document.getElementById(tableId);

    if (!table) return;

    const rows =
        table.querySelectorAll("tbody tr");

    const start =
        (page - 1) * rowsPerPage;

    const end =
        start + rowsPerPage;

    rows.forEach((row, index) => {

        row.style.display =
            index >= start && index < end
                ? ""
                : "none";

    });

}

/* ==========================================================
   DEBOUNCE
========================================================== */

function debounce(func, delay = 300) {

    let timeout;

    return (...args) => {

        clearTimeout(timeout);

        timeout = setTimeout(() => {

            func(...args);

        }, delay);

    };

}

/* ==========================================================
   DOWNLOAD FILE
========================================================== */

function downloadFile(url, filename = "") {

    const link =
        document.createElement("a");

    link.href = url;

    if (filename) {

        link.download = filename;

    }

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

}

/* ==========================================================
   PRINT
========================================================== */

function printElement(elementId) {

    const content =
        document.getElementById(elementId);

    if (!content) return;

    const win =
        window.open("", "_blank");

    win.document.write(`
        <html>
        <head>
            <title>Print</title>
        </head>
        <body>
            ${content.innerHTML}
        </body>
        </html>
    `);

    win.document.close();

    win.print();

}

/* ==========================================================
   LOCAL STORAGE
========================================================== */

function saveLocal(key, value) {

    localStorage.setItem(
        key,
        JSON.stringify(value)
    );

}

function getLocal(key) {

    const data =
        localStorage.getItem(key);

    return data
        ? JSON.parse(data)
        : null;

}

function removeLocal(key) {

    localStorage.removeItem(key);

}

/* ==========================================================
   UUID
========================================================== */

function generateUUID() {

    return crypto.randomUUID();

}

/* ==========================================================
   LOADING
========================================================== */

function showLoader(id) {

    const el =
        document.getElementById(id);

    if (el) {

        el.classList.remove("hidden");

    }

}

function hideLoader(id) {

    const el =
        document.getElementById(id);

    if (el) {

        el.classList.add("hidden");

    }

}

/* ==========================================================
   ALERTS
========================================================== */

function success(message) {

    if (typeof showAlert === "function") {

        showAlert(message, "success");

    }

}

function error(message) {

    if (typeof showAlert === "function") {

        showAlert(message, "error");

    }

}

function warning(message) {

    if (typeof showAlert === "function") {

        showAlert(message, "warning");

    }

}

/* ==========================================================
   EXPORTS
========================================================== */

window.Utils = {

    formatDate,
    formatDateTime,
    formatTime,

    formatCurrency,
    formatNumber,

    isEmpty,
    isPhone,
    isEmail,
    validateRequired,

    filterTable,
    paginateTable,

    debounce,

    downloadFile,
    printElement,

    saveLocal,
    getLocal,
    removeLocal,

    generateUUID,

    showLoader,
    hideLoader,

    success,
    error,
    warning

};