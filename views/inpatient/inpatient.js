/* ==========================================================
   NALAM AI
   Inpatient Dashboard
   inpatient.js
========================================================== */

/* ==========================================================
   GLOBAL VARIABLES
========================================================== */

const contentArea = document.getElementById("content-area");
const sidebar = document.getElementById("sidebar");
const pageTitle = document.getElementById("pageTitle");
const loadingOverlay = document.getElementById("loadingOverlay");
const alertBox = document.getElementById("alertBox");

let currentPage = "dashboard";
let currentPatient = null;

/* ==========================================================
   PAGE CONFIGURATION
========================================================== */

const pages = {

    dashboard: {
        title: "In-Patient Dashboard",
        file: "sections/dashboard.html"
    },

    admission: {
        title: "Patient Admission",
        file: "sections/admission.html"
    },

    room: {
        title: "Room Allocation",
        file: "sections/room.html"
    },

    doctor: {
        title: "Assigned Doctor",
        file: "sections/doctor.html"
    },

    treatment: {
        title: "Treatment Progress",
        file: "sections/treatment.html"
    },

    lab: {
        title: "Laboratory Reports",
        file: "sections/lab.html"
    },

    medicine: {
        title: "Medicine Schedule",
        file: "sections/medicine.html"
    },

    vitals: {
        title: "Daily Vitals",
        file: "sections/vitals.html"
    },

    billing: {
        title: "Billing",
        file: "sections/billing.html"
    },

    discharge: {
        title: "Discharge Summary",
        file: "sections/discharge.html"
    }

};

/* ==========================================================
   INITIALIZE SIDEBAR
========================================================== */

function initializeSidebar() {

    const links = document.querySelectorAll(".menu-link");

    links.forEach(link => {

        link.addEventListener("click", async (e) => {

            e.preventDefault();

            const page = link.dataset.page;

            if (!page) return;

            await loadSection(page);

            links.forEach(item =>
                item.classList.remove("active")
            );

            link.classList.add("active");

            if (window.innerWidth < 992) {

                sidebar.classList.remove("show");

            }

        });

    });

}

/* ==========================================================
   LOAD HTML SECTION
========================================================== */

async function loadSection(section) {

    try {

        if (!pages[section]) return;

        currentPage = section;

        showLoading();

        const response = await fetch(pages[section].file);

        if (!response.ok) {

            throw new Error("Unable to load section");

        }

        const html = await response.text();

        contentArea.innerHTML = html;

        pageTitle.textContent = pages[section].title;

        await initializeSection(section);

        hideLoading();

    }

    catch (error) {

        console.error(error);

        hideLoading();

        showAlert(
            "Unable to load page.",
            "error"
        );

    }

}

/* ==========================================================
   INITIALIZE SECTION JS
========================================================== */

async function initializeSection(section) {

    switch (section) {

        case "dashboard":

            if (typeof initializeDashboard === "function") {

                await initializeDashboard();

            }

            break;

        case "admission":

            if (typeof initializeAdmission === "function") {

                await initializeAdmission();

            }

            break;

        case "room":

            if (typeof initializeRoom === "function") {

                await initializeRoom();

            }

            break;

        case "doctor":

            if (typeof initializeDoctor === "function") {

                await initializeDoctor();

            }

            break;

        case "treatment":

            if (typeof initializeTreatment === "function") {

                await initializeTreatment();

            }

            break;

        case "lab":

            if (typeof initializeLab === "function") {

                await initializeLab();

            }

            break;

        case "medicine":

            if (typeof initializeMedicine === "function") {

                await initializeMedicine();

            }

            break;

        case "vitals":

            if (typeof initializeVitals === "function") {

                await initializeVitals();

            }

            break;

        case "billing":

            if (typeof initializeBilling === "function") {

                await initializeBilling();

            }

            break;

        case "discharge":

            if (typeof initializeDischarge === "function") {

                await initializeDischarge();

            }

            break;

    }

}

/* ==========================================================
   MOBILE MENU
========================================================== */

const menuButton = document.getElementById("menuToggle");

if (menuButton) {

    menuButton.addEventListener("click", () => {

        sidebar.classList.toggle("show");

    });

}

/* ==========================================================
   CLOSE SIDEBAR WHEN CLICKING OUTSIDE
========================================================== */

document.addEventListener("click", (event) => {

    if (window.innerWidth > 992) return;

    if (
        !sidebar.contains(event.target) &&
        !event.target.closest("#menuToggle")
    ) {

        sidebar.classList.remove("show");

    }

});

/* ==========================================================
   WINDOW RESIZE
========================================================== */

window.addEventListener("resize", () => {

    if (window.innerWidth >= 992) {

        sidebar.classList.remove("show");

    }

});
/* ==========================================================
   LOADING OVERLAY
========================================================== */

function showLoading() {

    if (!loadingOverlay) return;

    loadingOverlay.classList.remove("hidden");

}

function hideLoading() {

    if (!loadingOverlay) return;

    loadingOverlay.classList.add("hidden");

}

/* ==========================================================
   ALERTS
========================================================== */

function showAlert(message, type = "success") {

    if (!alertBox) return;

    alertBox.className = "";

    alertBox.classList.add("alert-box");

    switch (type) {

        case "success":

            alertBox.classList.add("alert-success");

            break;

        case "warning":

            alertBox.classList.add("alert-warning");

            break;

        default:

            alertBox.classList.add("alert-error");

    }

    alertBox.textContent = message;

    alertBox.classList.remove("hidden");

    setTimeout(() => {

        alertBox.classList.add("hidden");

    }, 3500);

}

/* ==========================================================
   STATUS BADGE CLASS
========================================================== */

function getStatusBadge(status) {

    if (!status) return "badge-info";

    switch (status.toLowerCase()) {

        case "admitted":
            return "badge-success";

        case "discharged":
            return "badge-danger";

        case "icu":
            return "badge-warning";

        case "critical":
            return "badge-danger";

        default:
            return "badge-info";

    }

}

/* ==========================================================
   MODAL HANDLING
========================================================== */

const commonModal = document.getElementById("commonModal");
const modalBody = document.getElementById("modalBody");
const modalTitle = document.getElementById("modalTitle");
const closeModalBtn = document.getElementById("closeModal");

function openModal(title, html) {

    if (!commonModal) return;

    modalTitle.textContent = title;
    modalBody.innerHTML = html;

    commonModal.classList.remove("hidden");

}

function closeModal() {

    if (!commonModal) return;

    commonModal.classList.add("hidden");

}

if (closeModalBtn) {

    closeModalBtn.addEventListener("click", closeModal);

}

window.addEventListener("click", (event) => {

    if (event.target === commonModal) {

        closeModal();

    }

});

/* ==========================================================
   CONFIRM DIALOG
========================================================== */

const confirmDialog = document.getElementById("confirmDialog");
const confirmMessage = document.getElementById("confirmMessage");
const confirmYes = document.getElementById("confirmYes");
const confirmNo = document.getElementById("confirmNo");

function showConfirm(message) {

    return new Promise((resolve) => {

        confirmMessage.textContent = message;

        confirmDialog.classList.remove("hidden");

        confirmYes.onclick = () => {

            confirmDialog.classList.add("hidden");

            resolve(true);

        };

        confirmNo.onclick = () => {

            confirmDialog.classList.add("hidden");

            resolve(false);

        };

    });

}

/* ==========================================================
   ACTIVITY FEED
========================================================== */

function addActivity(icon, title, description) {

    const activityFeed = document.getElementById("activityFeed");

    if (!activityFeed) return;

    const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });

    const item = document.createElement("div");

    item.className = "activity-item fade-in";

    item.innerHTML = `

        <div class="activity-icon">

            <i class="${icon}"></i>

        </div>

        <div class="activity-content">

            <h4>${title}</h4>

            <p>${description}</p>

            <div class="activity-time">${time}</div>

        </div>

    `;

    activityFeed.prepend(item);

    while (activityFeed.children.length > 20) {

        activityFeed.removeChild(activityFeed.lastChild);

    }

}

/* ==========================================================
   NOTIFICATION COUNTER
========================================================== */

const notificationCount =
    document.getElementById("notificationCount");

let unreadNotifications = 0;

function increaseNotification() {

    unreadNotifications++;

    if (notificationCount) {

        notificationCount.textContent = unreadNotifications;

    }

}

function clearNotifications() {

    unreadNotifications = 0;

    if (notificationCount) {

        notificationCount.textContent = "0";

    }

}

/* ==========================================================
   PATIENT SELECTION
========================================================== */

function setCurrentPatient(patientId) {

    currentPatient = patientId;

}

function getCurrentPatient() {

    return currentPatient;

}

/* ==========================================================
   FORMATTERS
========================================================== */

function formatDate(date) {

    if (!date) return "-";

    return new Date(date).toLocaleDateString();

}

function formatDateTime(date) {

    if (!date) return "-";

    return new Date(date).toLocaleString();

}

function formatCurrency(value) {

    return Number(value || 0).toLocaleString("en-IN", {

        style: "currency",

        currency: "INR"

    });

}

/* ==========================================================
   EMPTY STATE
========================================================== */

function emptyState(message) {

    return `

        <div class="empty-state">

            <i class="fa-solid fa-box-open"></i>

            <h3>No Records Found</h3>

            <p>${message}</p>

        </div>

    `;

}

/* ==========================================================
   TABLE LOADER
========================================================== */

function tableLoading(columns = 5) {

    return `

        <tr>

            <td colspan="${columns}"

                style="text-align:center;padding:30px;">

                Loading...

            </td>

        </tr>

    `;

}

/* ==========================================================
   DOWNLOAD FILE
========================================================== */

function downloadFile(url) {

    const link = document.createElement("a");

    link.href = url;

    link.target = "_blank";

    link.click();

}

/* ==========================================================
   PRINT CURRENT PAGE
========================================================== */

function printPage() {

    window.print();

}

/* ==========================================================
   LOGOUT
========================================================== */

async function logout() {
await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include"
});

window.location.href = "/";

}
/* ==========================================================
   NALAM AI
   SOCKET.IO EVENTS
   Registers activity-feed listeners on the socket
   created by socket.js initializeSocket()
========================================================== */

function registerInpatientSocketEvents() {

    if (!window.socket) {

        console.warn("Socket not ready for inpatient events.");

        return;

    }

    const s = window.socket;

    s.on("patientAdmitted", (patient) => {

        addActivity(
            "fa-solid fa-user-plus",
            "Patient Admitted",
            `${patient.patient_name} admitted to Ward ${patient.ward}`
        );

        increaseNotification();

        refreshDashboard();

    });

    s.on("roomChanged", (data) => {

        addActivity(
            "fa-solid fa-bed",
            "Room Changed",
            `Patient moved to Room ${data.room_no}`
        );

        increaseNotification();

        refreshDashboard();

    });

    s.on("doctorAssigned", () => {

        addActivity(
            "fa-solid fa-user-doctor",
            "Doctor Assigned",
            "Doctor assignment updated."
        );

        increaseNotification();

    });

    s.on("treatmentUpdated", () => {

        addActivity(
            "fa-solid fa-notes-medical",
            "Treatment Updated",
            "Treatment history has been updated."
        );

        increaseNotification();

    });

    s.on("labReportUploaded", () => {

        addActivity(
            "fa-solid fa-flask",
            "Lab Report Uploaded",
            "A new laboratory report is available."
        );

        increaseNotification();

    });

    s.on("medicineUpdated", () => {

        addActivity(
            "fa-solid fa-pills",
            "Medicine Updated",
            "Medicine schedule updated."
        );

        increaseNotification();

    });

    s.on("vitalsUpdated", () => {

        addActivity(
            "fa-solid fa-heart-pulse",
            "Vitals Updated",
            "Patient vitals recorded."
        );

        increaseNotification();

    });

    s.on("billGenerated", (bill) => {

        addActivity(
            "fa-solid fa-file-invoice-dollar",
            "Bill Generated",
            `Bill Amount : ₹${bill.total}`
        );

        increaseNotification();

    });

    s.on("patientDischarged", () => {

        addActivity(
            "fa-solid fa-door-open",
            "Patient Discharged",
            "Patient discharge completed."
        );

        increaseNotification();

        refreshDashboard();

    });

}

/* ==========================================================
   KEYBOARD SHORTCUTS
========================================================== */

document.addEventListener("keydown", (event) => {

    /* ESC closes modal */

    if (event.key === "Escape") {

        closeModal();

    }

    /* Ctrl + P */

    if (event.ctrlKey && event.key === "p") {

        event.preventDefault();

        printPage();

    }

});

/* ==========================================================
   PAGE VISIBILITY
========================================================== */

document.addEventListener("visibilitychange", () => {

    if (!document.hidden) {

        refreshDashboard();

    }

});

/* ==========================================================
   ONLINE / OFFLINE
========================================================== */

window.addEventListener("offline", () => {

    showAlert(
        "No internet connection.",
        "warning"
    );

});

window.addEventListener("online", () => {

    showAlert(
        "Connection restored.",
        "success"
    );

    refreshDashboard();

});

/* ==========================================================
   APPLICATION STARTUP
========================================================== */

document.addEventListener("DOMContentLoaded", async () => {

    try {

        showLoading();

        initializeSidebar();

        initializeSocket();              /* socket.js — creates the socket */

        registerInpatientSocketEvents(); /* inpatient.js — activity feed listeners */

        await loadSection("dashboard");

        hideLoading();

        console.log("In-Patient Dashboard Ready");

    }

    catch (error) {

        console.error(error);

        hideLoading();

        showAlert(
            "Application failed to initialize.",
            "error"
        );

    }

});

/* ==========================================================
   GLOBAL EXPORTS
========================================================== */

window.loadSection = loadSection;

window.showLoading = showLoading;

window.hideLoading = hideLoading;

window.showAlert = showAlert;

window.openModal = openModal;

window.closeModal = closeModal;

window.showConfirm = showConfirm;

window.setCurrentPatient = setCurrentPatient;

window.getCurrentPatient = getCurrentPatient;

window.formatDate = formatDate;

window.formatDateTime = formatDateTime;

window.formatCurrency = formatCurrency;

window.downloadFile = downloadFile;

window.printPage = printPage;
