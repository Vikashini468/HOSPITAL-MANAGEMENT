"use strict";

let treatmentPatients = [];
let selectedTreatmentPatientId = null;

/* ==========================================================
   INITIALIZE
========================================================== */

async function initializeTreatment() {

    try {

        await loadTreatmentPatients();
        initTreatmentPatientSearch();

    } catch (err) {

        console.error("Treatment init error:", err);
        showAlert("Unable to load treatment section.", "error");

    }

}

/* ==========================================================
   LOAD PATIENTS
========================================================== */

async function loadTreatmentPatients() {

    const tbody = document.getElementById("treatmentPatientBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="text-center">Loading...</td></tr>`;

    try {

        treatmentPatients = await api.get("/patients");
        renderTreatmentPatientTable(treatmentPatients);

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">Failed to load patients.</td></tr>`;

    }

}

/* ==========================================================
   RENDER PATIENT TABLE
========================================================== */

function renderTreatmentPatientTable(data) {

    const tbody = document.getElementById("treatmentPatientBody");
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
                    onclick="selectTreatmentPatient(${p.id}, '${p.patient_name.replace(/'/g, "\\'")}')">
                    <i class="fa-solid fa-notes-medical"></i> View
                </button>
            </td>
        `;

        tbody.appendChild(tr);

    });

}

/* ==========================================================
   SELECT PATIENT & LOAD HISTORY
========================================================== */

async function selectTreatmentPatient(patientId, patientName) {

    selectedTreatmentPatientId = patientId;

    const card = document.getElementById("treatmentHistoryCard");
    const title = document.getElementById("treatmentPatientTitle");

    if (card) card.style.display = "block";
    if (title) title.innerHTML = `<i class="fa-solid fa-notes-medical"></i> Treatment History — ${patientName}`;

    await loadTreatmentHistory(patientId);

    card?.scrollIntoView({ behavior: "smooth" });

}

/* ==========================================================
   LOAD TREATMENT HISTORY
========================================================== */

async function loadTreatmentHistory(patientId) {

    const tbody = document.getElementById("treatmentHistoryBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="5" class="text-center">Loading...</td></tr>`;

    try {

        const records = await api.get(`/treatments/${patientId}`);

        if (!records.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center">No treatment records found.</td></tr>`;
            return;
        }

        tbody.innerHTML = "";

        records.forEach((r, i) => {

            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${i + 1}</td>
                <td>${formatDate(r.activity_date)}</td>
                <td>${r.activity_time || "-"}</td>
                <td>${r.doctor_name || "-"}</td>
                <td>${r.description || "-"}</td>
            `;

            tbody.appendChild(tr);

        });

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="5" class="text-center">Failed to load records.</td></tr>`;

    }

}

/* ==========================================================
   SEARCH
========================================================== */

function initTreatmentPatientSearch() {

    document.getElementById("treatmentPatientSearch")?.addEventListener("keyup", e => {

        const kw = e.target.value.toLowerCase();

        const filtered = treatmentPatients.filter(p =>
            p.patient_name.toLowerCase().includes(kw) ||
            (p.doctor_name || "").toLowerCase().includes(kw) ||
            (p.ward || "").toLowerCase().includes(kw)
        );

        renderTreatmentPatientTable(filtered);

    });

}

/* ==========================================================
   ADD TREATMENT MODAL
========================================================== */

function openAddTreatmentModal() {

    if (!selectedTreatmentPatientId) {
        showAlert("Please select a patient first.", "warning");
        return;
    }

    document.getElementById("treatmentPatientId").value = selectedTreatmentPatientId;
    document.getElementById("treatmentDate").value = new Date().toISOString().split("T")[0];
    document.getElementById("treatmentTime").value = new Date().toTimeString().slice(0, 5);
    document.getElementById("treatmentDescription").value = "";
    document.getElementById("addTreatmentModal").classList.add("show");

}

function closeAddTreatmentModal() {

    document.getElementById("addTreatmentModal")?.classList.remove("show");

}

async function submitTreatment() {

    const patient_id    = document.getElementById("treatmentPatientId").value;
    const activity_date = document.getElementById("treatmentDate").value;
    const activity_time = document.getElementById("treatmentTime").value;
    const description   = document.getElementById("treatmentDescription").value.trim();

    if (!description) {
        showAlert("Please enter a description.", "warning");
        return;
    }

    try {

        const res = await api.post("/treatment", { patient_id, activity_date, activity_time, description });

        if (!res.success) throw new Error(res.message);

        showAlert("Treatment entry added.", "success");
        closeAddTreatmentModal();
        await loadTreatmentHistory(patient_id);

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Failed to add entry.", "error");

    }

}

/* ==========================================================
   EXPORTS
========================================================== */

window.initializeTreatment       = initializeTreatment;
window.selectTreatmentPatient    = selectTreatmentPatient;
window.openAddTreatmentModal     = openAddTreatmentModal;
window.closeAddTreatmentModal    = closeAddTreatmentModal;
window.submitTreatment           = submitTreatment;
