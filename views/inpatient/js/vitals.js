"use strict";

let vitalsPatients = [];
let selectedVitalsPatientId = null;

/* ==========================================================
   INITIALIZE
========================================================== */

async function initializeVitals() {

    try {

        await loadVitalsPatients();
        initVitalsPatientSearch();

    } catch (err) {

        console.error("Vitals init error:", err);
        showAlert("Unable to load vitals section.", "error");

    }

}

/* ==========================================================
   LOAD PATIENTS
========================================================== */

async function loadVitalsPatients() {

    const tbody = document.getElementById("vitalsPatientBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="text-center">Loading...</td></tr>`;

    try {

        vitalsPatients = await api.get("/patients");
        renderVitalsPatientTable(vitalsPatients);

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">Failed to load patients.</td></tr>`;

    }

}

/* ==========================================================
   RENDER PATIENT TABLE
========================================================== */

function renderVitalsPatientTable(data) {

    const tbody = document.getElementById("vitalsPatientBody");
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
                    onclick="selectVitalsPatient(${p.id}, '${p.patient_name.replace(/'/g, "\\'")}')">
                    <i class="fa-solid fa-heart-pulse"></i> View
                </button>
            </td>
        `;

        tbody.appendChild(tr);

    });

}

/* ==========================================================
   SELECT PATIENT & LOAD VITALS
========================================================== */

async function selectVitalsPatient(patientId, patientName) {

    selectedVitalsPatientId = patientId;

    const card  = document.getElementById("vitalsHistoryCard");
    const title = document.getElementById("vitalsPatientTitle");

    if (card) card.style.display = "block";
    if (title) title.innerHTML = `<i class="fa-solid fa-heart-pulse"></i> Vitals History — ${patientName}`;

    await loadVitalsHistory(patientId);

    card?.scrollIntoView({ behavior: "smooth" });

}

/* ==========================================================
   LOAD VITALS HISTORY
========================================================== */

async function loadVitalsHistory(patientId) {

    const tbody = document.getElementById("vitalsHistoryBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="8" class="text-center">Loading...</td></tr>`;

    try {

        const records = await api.get(`/vitals/${patientId}`);

        if (!records.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center">No vitals recorded.</td></tr>`;
            return;
        }

        tbody.innerHTML = "";

        records.forEach((v, i) => {

            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${i + 1}</td>
                <td>${formatDateTime(v.recorded_at)}</td>
                <td>${v.temperature ?? "-"}</td>
                <td>${v.bp || "-"}</td>
                <td>${v.pulse ?? "-"}</td>
                <td>${v.oxygen ?? "-"}</td>
                <td>${v.sugar ?? "-"}</td>
                <td>${v.weight ?? "-"}</td>
            `;

            tbody.appendChild(tr);

        });

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="8" class="text-center">Failed to load vitals.</td></tr>`;

    }

}

/* ==========================================================
   SEARCH
========================================================== */

function initVitalsPatientSearch() {

    document.getElementById("vitalsPatientSearch")?.addEventListener("keyup", e => {

        const kw = e.target.value.toLowerCase();

        const filtered = vitalsPatients.filter(p =>
            p.patient_name.toLowerCase().includes(kw) ||
            (p.doctor_name || "").toLowerCase().includes(kw) ||
            (p.ward || "").toLowerCase().includes(kw)
        );

        renderVitalsPatientTable(filtered);

    });

}

/* ==========================================================
   RECORD VITALS MODAL
========================================================== */

function openRecordVitalsModal() {

    if (!selectedVitalsPatientId) {
        showAlert("Please select a patient first.", "warning");
        return;
    }

    document.getElementById("vitalsPatientId").value = selectedVitalsPatientId;

    ["vitalTemp", "vitalBP", "vitalPulse", "vitalRespiration",
     "vitalOxygen", "vitalSugar", "vitalWeight", "vitalHeight"]
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });

    document.getElementById("recordVitalsModal").classList.add("show");

}

function closeRecordVitalsModal() {

    document.getElementById("recordVitalsModal")?.classList.remove("show");

}

async function submitVitals() {

    const patient_id  = document.getElementById("vitalsPatientId").value;
    const temperature = document.getElementById("vitalTemp").value || null;
    const bp          = document.getElementById("vitalBP").value.trim() || null;
    const pulse       = document.getElementById("vitalPulse").value || null;
    const respiration = document.getElementById("vitalRespiration").value || null;
    const oxygen      = document.getElementById("vitalOxygen").value || null;
    const sugar       = document.getElementById("vitalSugar").value || null;
    const weight      = document.getElementById("vitalWeight").value || null;
    const height      = document.getElementById("vitalHeight").value || null;

    try {

        const res = await api.post("/vitals", {
            patient_id, temperature, bp, pulse,
            respiration, oxygen, sugar, weight, height
        });

        if (!res.success) throw new Error(res.message);

        showAlert("Vitals recorded.", "success");
        closeRecordVitalsModal();
        await loadVitalsHistory(patient_id);

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Failed to record vitals.", "error");

    }

}

/* ==========================================================
   EXPORTS
========================================================== */

window.initializeVitals       = initializeVitals;
window.selectVitalsPatient    = selectVitalsPatient;
window.openRecordVitalsModal  = openRecordVitalsModal;
window.closeRecordVitalsModal = closeRecordVitalsModal;
window.submitVitals           = submitVitals;
