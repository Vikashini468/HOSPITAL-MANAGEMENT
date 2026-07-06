"use strict";

let labPatients = [];
let selectedLabPatientId = null;

/* ==========================================================
   INITIALIZE
========================================================== */

async function initializeLab() {

    try {

        await loadLabPatients();
        initLabPatientSearch();

    } catch (err) {

        console.error("Lab init error:", err);
        showAlert("Unable to load lab section.", "error");

    }

}

/* ==========================================================
   LOAD PATIENTS
========================================================== */

async function loadLabPatients() {

    const tbody = document.getElementById("labPatientBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="text-center">Loading...</td></tr>`;

    try {

        labPatients = await api.get("/patients");
        renderLabPatientTable(labPatients);

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">Failed to load patients.</td></tr>`;

    }

}

/* ==========================================================
   RENDER PATIENT TABLE
========================================================== */

function renderLabPatientTable(data) {

    const tbody = document.getElementById("labPatientBody");
    if (!tbody) return;

    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">No patients found.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";

    data.forEach(p => {

        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${p.id}</td>
            <td><strong>${p.patient_name}</strong></td>
            <td>${p.doctor_name || "-"}</td>
            <td>${p.ward || "-"}</td>
            <td>${p.status === "Discharged"
                ? `<span class="status discharged">Discharged</span>`
                : `<span class="status admitted">Admitted</span>`}</td>
            <td>
                <button class="btn btn-primary btn-sm"
                    onclick="selectLabPatient(${p.id}, '${p.patient_name.replace(/'/g, "\\'")}')">
                    <i class="fa-solid fa-flask"></i> View
                </button>
            </td>
        `;

        tbody.appendChild(tr);

    });

}

/* ==========================================================
   SELECT PATIENT & LOAD REPORTS
========================================================== */

async function selectLabPatient(patientId, patientName) {

    selectedLabPatientId = patientId;

    const card  = document.getElementById("labReportsCard");
    const title = document.getElementById("labPatientTitle");

    if (card) card.style.display = "block";
    if (title) title.innerHTML = `<i class="fa-solid fa-flask"></i> Lab Reports — ${patientName}`;

    await loadLabReports(patientId);

    card?.scrollIntoView({ behavior: "smooth" });

}

/* ==========================================================
   LOAD LAB REPORTS
========================================================== */

async function loadLabReports(patientId) {

    const tbody = document.getElementById("labReportsBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="5" class="text-center">Loading...</td></tr>`;

    try {

        const reports = await api.get(`/lab/${patientId}`);

        if (!reports.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center">No reports found.</td></tr>`;
            return;
        }

        tbody.innerHTML = "";

        reports.forEach((r, i) => {

            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${i + 1}</td>
                <td>${r.report_type || "-"}</td>
                <td>${r.report_name || "-"}</td>
                <td>${formatDateTime(r.uploaded_at)}</td>
                <td>
                    <div class="action-buttons">
                        ${r.report_file
                            ? `<a class="btn btn-primary btn-sm" href="${r.report_file}" target="_blank">
                                <i class="fa-solid fa-eye"></i>
                               </a>`
                            : ""}
                        <button class="btn btn-danger btn-sm" onclick="deleteLabReport(${r.id})">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;

            tbody.appendChild(tr);

        });

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="5" class="text-center">Failed to load reports.</td></tr>`;

    }

}

/* ==========================================================
   SEARCH
========================================================== */

function initLabPatientSearch() {

    document.getElementById("labPatientSearch")?.addEventListener("keyup", e => {

        const kw = e.target.value.toLowerCase();

        const filtered = labPatients.filter(p =>
            p.patient_name.toLowerCase().includes(kw) ||
            (p.doctor_name || "").toLowerCase().includes(kw) ||
            (p.ward || "").toLowerCase().includes(kw)
        );

        renderLabPatientTable(filtered);

    });

}

/* ==========================================================
   UPLOAD MODAL
========================================================== */

function openUploadLabModal() {

    if (!selectedLabPatientId) {
        showAlert("Please select a patient first.", "warning");
        return;
    }

    document.getElementById("labUploadPatientId").value = selectedLabPatientId;
    document.getElementById("labReportType").value = "";
    document.getElementById("labReportName").value = "";
    document.getElementById("labReportFile").value = "";
    document.getElementById("uploadLabModal").classList.add("show");

}

function closeUploadLabModal() {

    document.getElementById("uploadLabModal")?.classList.remove("show");

}

async function submitLabReport() {

    const patient_id  = document.getElementById("labUploadPatientId").value;
    const report_type = document.getElementById("labReportType").value;
    const report_name = document.getElementById("labReportName").value.trim();
    const report_file = document.getElementById("labReportFile").value.trim();

    if (!report_type || !report_name) {
        showAlert("Please fill report type and name.", "warning");
        return;
    }

    try {

        const res = await api.post("/lab/upload", { patient_id, report_type, report_name, report_file });

        if (!res.success) throw new Error(res.message);

        showAlert("Lab report uploaded.", "success");
        closeUploadLabModal();
        await loadLabReports(patient_id);

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Upload failed.", "error");

    }

}

/* ==========================================================
   DELETE REPORT
========================================================== */

async function deleteLabReport(reportId) {

    if (!confirm("Delete this lab report?")) return;

    try {

        const res = await api.delete(`/lab/${reportId}`);

        if (!res.success) throw new Error(res.message);

        showAlert("Report deleted.", "success");

        if (selectedLabPatientId) await loadLabReports(selectedLabPatientId);

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Delete failed.", "error");

    }

}

/* ==========================================================
   EXPORTS
========================================================== */

window.initializeLab       = initializeLab;
window.selectLabPatient    = selectLabPatient;
window.openUploadLabModal  = openUploadLabModal;
window.closeUploadLabModal = closeUploadLabModal;
window.submitLabReport     = submitLabReport;
window.deleteLabReport     = deleteLabReport;
