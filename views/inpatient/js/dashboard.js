/* ==========================================================
   NALAM AI
   dashboard.js
   PART 1
========================================================== */

let dashboardStats = {};
let inpatientList = [];

/* ==========================================================
   INITIALIZE DASHBOARD
========================================================== */

async function initializeDashboard() {

    try {

        showLoading();

        await loadDashboard();

        hideLoading();

    }

    catch (error) {

        console.error(error);

        hideLoading();

        showAlert(
            "Unable to load dashboard.",
            "error"
        );

    }

}

/* ==========================================================
   LOAD COMPLETE DASHBOARD
========================================================== */

async function loadDashboard() {

    await Promise.all([

        loadDashboardStats(),

        loadPatients()

    ]);

}

/* ==========================================================
   REFRESH
========================================================== */

async function refreshDashboard() {

    await loadDashboard();

}

/* ==========================================================
   LOAD DASHBOARD STATS
========================================================== */

async function loadDashboardStats() {

    try {

        dashboardStats = await API.getDashboardStats();

        updateDashboardCards();

        updateBedOccupancy();

    }

    catch (error) {

        console.error(error);

    }

}

/* ==========================================================
   UPDATE DASHBOARD CARDS
========================================================== */

function updateDashboardCards() {

    document.getElementById("totalPatients").textContent =
        dashboardStats.total_patients || 0;

    document.getElementById("availableBeds").textContent =
        dashboardStats.available_beds || 0;

    document.getElementById("occupiedBeds").textContent =
        dashboardStats.occupied_beds || 0;

    document.getElementById("todayAdmissions").textContent =
        dashboardStats.today_admissions || 0;

    document.getElementById("todayDischarges").textContent =
        dashboardStats.today_discharges || 0;

    document.getElementById("criticalPatients").textContent =
        dashboardStats.critical_patients || 0;

}

/* ==========================================================
   BED OCCUPANCY
========================================================== */

function updateBedOccupancy() {

    const occupied =
        Number(dashboardStats.occupied_beds || 0);

    const available =
        Number(dashboardStats.available_beds || 0);

    const total = occupied + available;

    let percent = 0;

    if (total > 0) {

        percent = Math.round((occupied / total) * 100);

    }

    const progress =
        document.getElementById("bedProgress");

    const label =
        document.getElementById("bedPercent");

    if (progress) {

        progress.style.width = percent + "%";

    }

    if (label) {

        label.textContent = percent + "%";

    }

}

/* ==========================================================
   LOAD PATIENTS
========================================================== */

async function loadPatients() {

    try {

        inpatientList = await API.getPatients();

        renderRecentAdmissions();

        renderCriticalPatients();

    }

    catch (error) {

        console.error(error);

    }

}
/* ==========================================================
   RECENT ADMISSIONS
========================================================== */

function renderRecentAdmissions() {

    const tbody =
        document.getElementById("recentAdmissionsBody");

    if (!tbody) return;

    tbody.innerHTML = "";

    if (!inpatientList.length) {

        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center">
                    No admissions found.
                </td>
            </tr>
        `;

        return;

    }

    const recentPatients = inpatientList.slice(0, 10);

    recentPatients.forEach(patient => {

        tbody.appendChild(createAdmissionRow(patient));

    });

}

/* ==========================================================
   CREATE TABLE ROW
========================================================== */

function createAdmissionRow(patient) {

    const tr = document.createElement("tr");

    tr.innerHTML = `

        <td>

            <div class="patient-cell">

                <strong>${patient.patient_name}</strong>

                <div class="small-text">

                    ${patient.gender || "-"} |
                    ${patient.age || "-"}

                </div>

            </div>

        </td>

        <td>

            ${patient.ward || "-"}

        </td>

        <td>

            ${patient.room_no || "-"} /
            ${patient.bed_no || "-"}

        </td>

        <td>

            ${patient.doctor_name || "-"}

        </td>

        <td>

            ${statusBadge(patient)}

        </td>

    `;

    tr.style.cursor = "pointer";

    tr.addEventListener("click", () => {

        openPatient(patient.id);

    });

    return tr;

}

/* ==========================================================
   STATUS BADGE
========================================================== */

function statusBadge(patient) {

    if (
        patient.status === "Discharged"
    ) {

        return `
            <span class="status discharged">
                Discharged
            </span>
        `;

    }

    if (
        patient.admission_type === "ICU"
    ) {

        return `
            <span class="status icu">
                ICU
            </span>
        `;

    }

    return `
        <span class="status admitted">
            Admitted
        </span>
    `;

}

/* ==========================================================
   OPEN PATIENT
========================================================== */

async function openPatient(patientId) {

    try {

        setCurrentPatient(patientId);

        await loadSection("doctor");

    }

    catch (error) {

        console.error(error);

    }

}

/* ==========================================================
   SEARCH RECENT ADMISSIONS
========================================================== */

function searchAdmissions(keyword) {

    keyword = keyword.toLowerCase();

    const rows =
        document.querySelectorAll(
            "#recentAdmissionsBody tr"
        );

    rows.forEach(row => {

        const text =
            row.textContent.toLowerCase();

        row.style.display =
            text.includes(keyword)
                ? ""
                : "none";

    });

}

/* ==========================================================
   SORT RECENT ADMISSIONS
========================================================== */

function sortAdmissions() {

    inpatientList.sort((a, b) => {

        return new Date(b.admission_date) -
               new Date(a.admission_date);

    });

    renderRecentAdmissions();

}
/* ==========================================================
   NALAM AI
   dashboard.js
   PART 3
========================================================== */

/* ==========================================================
   CRITICAL PATIENTS
========================================================== */

function renderCriticalPatients() {

    const container =
        document.getElementById("criticalPatientList");

    if (!container) return;

    container.innerHTML = "";

    const criticalPatients = inpatientList.filter(patient =>

        patient.admission_type === "ICU" &&
        patient.status === "Admitted"

    );

    if (!criticalPatients.length) {

        container.innerHTML = `

            <div class="empty-state">

                <i class="fa-solid fa-circle-check"></i>

                <h3>No Critical Patients</h3>

                <p>There are currently no ICU patients.</p>

            </div>

        `;

        return;

    }

    criticalPatients.forEach(patient => {

        const card = document.createElement("div");

        card.className = "patient-item";

        card.innerHTML = `

            <div class="patient-info">

                <h4>${patient.patient_name}</h4>

                <p>

                    Room ${patient.room_no || "-"} |
                    Bed ${patient.bed_no || "-"}

                </p>

                <p>

                    Doctor :
                    ${patient.doctor_name || "-"}

                </p>

            </div>

            <button
                class="btn btn-primary btn-sm">

                View

            </button>

        `;

        card.querySelector("button")
            .addEventListener("click", () => {

                openPatient(patient.id);

            });

        container.appendChild(card);

    });

}

/* ==========================================================
   SUMMARY
========================================================== */

function dashboardSummary() {

    return {

        totalPatients:
            inpatientList.length,

        admitted:
            inpatientList.filter(p =>
                p.status === "Admitted"
            ).length,

        discharged:
            inpatientList.filter(p =>
                p.status === "Discharged"
            ).length,

        icu:
            inpatientList.filter(p =>
                p.admission_type === "ICU" &&
                p.status === "Admitted"
            ).length

    };

}

/* ==========================================================
   UPDATE ACTIVITY FEED
========================================================== */

function dashboardActivity(title, description) {

    if (typeof addActivity !== "function") return;

    addActivity(

        "fa-solid fa-hospital-user",

        title,

        description

    );

}

/* ==========================================================
   TODAY ADMISSIONS
========================================================== */

function todayAdmissionsList() {

    const today =
        new Date().toISOString().split("T")[0];

    return inpatientList.filter(patient =>

        patient.admission_date &&
        patient.admission_date.startsWith(today)

    );

}

/* ==========================================================
   ICU COUNT
========================================================== */

function getICUPatients() {

    return inpatientList.filter(patient =>

        patient.admission_type === "ICU" &&
        patient.status === "Admitted"

    );

}

/* ==========================================================
   BED AVAILABILITY
========================================================== */

function availableBeds() {

    return Number(
        dashboardStats.available_beds || 0
    );

}

function occupiedBeds() {

    return Number(
        dashboardStats.occupied_beds || 0
    );

}

/* ==========================================================
   RECENT PATIENT
========================================================== */

function latestAdmission() {

    if (!inpatientList.length) return null;

    return inpatientList[0];

}

/* ==========================================================
   QUICK ACTIONS
========================================================== */

function openAdmissionForm() {

    loadSection("admission");

}

function openBilling() {

    loadSection("billing");

}

function openDischarge() {

    loadSection("discharge");

}

/* ==========================================================
   DASHBOARD REFRESH TIMER
========================================================== */

let dashboardTimer = null;

function startDashboardRefresh() {

    stopDashboardRefresh();

    dashboardTimer = setInterval(() => {

        refreshDashboard();

    }, 30000);

}

function stopDashboardRefresh() {

    if (dashboardTimer) {

        clearInterval(dashboardTimer);

        dashboardTimer = null;

    }

}
/* ==========================================================
   NALAM AI
   dashboard.js
   PART 4 (FINAL)
========================================================== */

/* ==========================================================
   SOCKET.IO LIVE UPDATES
========================================================== */

function initializeDashboardSocket() {

    if (typeof socket === "undefined" || !socket) {

        console.warn("Socket.IO not initialized.");

        return;

    }

    socket.on("patientAdmitted", async () => {

        dashboardActivity(
            "Patient Admitted",
            "A new patient has been admitted."
        );

        await refreshDashboard();

    });

    socket.on("roomChanged", async () => {

        dashboardActivity(
            "Room Allocation",
            "Patient room allocation updated."
        );

        await refreshDashboard();

    });

    socket.on("doctorAssigned", async () => {

        dashboardActivity(
            "Doctor Assigned",
            "Doctor assignment updated."
        );

        await refreshDashboard();

    });

    socket.on("treatmentUpdated", async () => {

        dashboardActivity(
            "Treatment Updated",
            "Treatment history modified."
        );

    });

    socket.on("labReportUploaded", async () => {

        dashboardActivity(
            "Lab Report",
            "A laboratory report has been uploaded."
        );

    });

    socket.on("medicineUpdated", async () => {

        dashboardActivity(
            "Medicine Updated",
            "Medicine schedule updated."
        );

    });

    socket.on("vitalsUpdated", async () => {

        dashboardActivity(
            "Vitals Updated",
            "Patient vitals recorded."
        );

    });

    socket.on("billGenerated", async () => {

        dashboardActivity(
            "Billing",
            "Patient bill generated."
        );

    });

    socket.on("patientDischarged", async () => {

        dashboardActivity(
            "Patient Discharged",
            "Patient discharge completed."
        );

        await refreshDashboard();

    });

}

/* ==========================================================
   WINDOW EVENTS
========================================================== */

window.addEventListener("focus", () => {

    refreshDashboard();

});

document.addEventListener("visibilitychange", () => {

    if (!document.hidden) {

        refreshDashboard();

    }

});

/* ==========================================================
   SEARCH
========================================================== */

function initializeDashboardSearch() {

    const searchBox =
        document.getElementById("dashboardSearch");

    if (!searchBox) return;

    searchBox.addEventListener(

        "keyup",

        debounce((event) => {

            searchAdmissions(

                event.target.value

            );

        }, 300)

    );

}

/* ==========================================================
   AUTO REFRESH
========================================================== */

function initializeAutoRefresh() {

    startDashboardRefresh();

}

window.addEventListener("beforeunload", () => {

    stopDashboardRefresh();

});

/* ==========================================================
   INITIALIZATION
========================================================== */

async function initDashboard() {

    try {

        await initializeDashboard();

        initializeDashboardSocket();

        initializeDashboardSearch();

        initializeAutoRefresh();

        console.log(
            "Dashboard Loaded Successfully"
        );

    }

    catch (error) {

        console.error(error);

    }

}

/* ==========================================================
   EXPORTS
========================================================== */

window.initDashboard = initDashboard;

window.refreshDashboard = refreshDashboard;

window.loadDashboard = loadDashboard;

window.loadDashboardStats = loadDashboardStats;

window.renderRecentAdmissions =
    renderRecentAdmissions;

window.renderCriticalPatients =
    renderCriticalPatients;

window.searchAdmissions =
    searchAdmissions;

window.sortAdmissions =
    sortAdmissions;

window.dashboardSummary =
    dashboardSummary;

window.openAdmissionForm =
    openAdmissionForm;

window.openBilling =
    openBilling;

window.openDischarge =
    openDischarge;

/* ==========================================================
   START DASHBOARD
========================================================== */

// initializeDashboard is called by inpatient.js initializeSection()
// Do NOT auto-run on DOMContentLoaded here.