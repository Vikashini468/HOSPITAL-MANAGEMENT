"use strict";

let doctorPatients = [];
let doctorList = [];

/* ==========================================================
   INITIALIZE
========================================================== */

async function initializeDoctor() {

    try {

        await Promise.all([loadDoctorPatients(), loadDoctorList()]);
        initDoctorSearch();

    } catch (err) {

        console.error("Doctor init error:", err);
        showAlert("Unable to load doctor section.", "error");

    }

}

/* ==========================================================
   LOAD PATIENTS
========================================================== */

async function loadDoctorPatients() {

    const tbody = document.getElementById("doctorPatientTableBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="text-center">Loading...</td></tr>`;

    try {

        doctorPatients = await api.get("/patients");
        renderDoctorPatientTable(doctorPatients);

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">Failed to load patients.</td></tr>`;

    }

}

/* ==========================================================
   LOAD DOCTORS
========================================================== */

async function loadDoctorList() {

    try {

        doctorList = await api.get("/doctors");
        populateDoctorSelect();

    } catch (err) {

        console.error(err);

    }

}

function populateDoctorSelect() {

    const sel = document.getElementById("assignDoctorSelect");
    if (!sel) return;

    sel.innerHTML = `<option value="">Select Doctor</option>`;

    doctorList.forEach(d => {

        const opt = document.createElement("option");
        opt.value = d.id;
        opt.textContent = `${d.name} (${d.specialisation})`;
        sel.appendChild(opt);

    });

}

/* ==========================================================
   RENDER TABLE
========================================================== */

function renderDoctorPatientTable(data) {

    const tbody = document.getElementById("doctorPatientTableBody");
    if (!tbody) return;

    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">No patients found.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";

    data.forEach(p => {

        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${p.id}</td>
            <td><strong>${p.patient_name}</strong></td>
            <td>${p.ward || "-"}</td>
            <td>${p.room_no || "-"}</td>
            <td>${p.doctor_name || "<em>Not Assigned</em>"}</td>
            <td>${p.status === "Discharged"
                ? `<span class="status discharged">Discharged</span>`
                : `<span class="status admitted">Admitted</span>`}</td>
            <td>
                <button class="btn btn-primary btn-sm"
                    onclick="openAssignDoctorModal(${p.id}, '${p.patient_name.replace(/'/g, "\\'")}')">
                    <i class="fa-solid fa-user-doctor"></i> Assign
                </button>
            </td>
        `;

        tbody.appendChild(tr);

    });

}

/* ==========================================================
   SEARCH
========================================================== */

function initDoctorSearch() {

    document.getElementById("doctorPatientSearch")?.addEventListener("keyup", e => {

        const kw = e.target.value.toLowerCase();

        const filtered = doctorPatients.filter(p =>
            p.patient_name.toLowerCase().includes(kw) ||
            (p.doctor_name || "").toLowerCase().includes(kw) ||
            (p.ward || "").toLowerCase().includes(kw)
        );

        renderDoctorPatientTable(filtered);

    });

}

/* ==========================================================
   ASSIGN DOCTOR MODAL
========================================================== */

function openAssignDoctorModal(patientId, patientName) {

    document.getElementById("assignPatientId").value = patientId;
    document.getElementById("assignPatientName").value = patientName;
    document.getElementById("assignDoctorSelect").value = "";
    populateDoctorSelect();
    document.getElementById("assignDoctorModal").classList.add("show");

}

function closeAssignDoctorModal() {

    document.getElementById("assignDoctorModal")?.classList.remove("show");

}

async function submitAssignDoctor() {

    const patient_id = document.getElementById("assignPatientId").value;
    const doctor_id  = document.getElementById("assignDoctorSelect").value;

    if (!doctor_id) {
        showAlert("Please select a doctor.", "warning");
        return;
    }

    try {

        const res = await api.put("/assign-doctor", { patient_id, doctor_id });
        if (!res.success) throw new Error(res.message);
        showAlert("Doctor assigned successfully.", "success");
        closeAssignDoctorModal();
        await loadDoctorPatients();

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Assignment failed.", "error");

    }

}

/* ==========================================================
   EXPORTS
========================================================== */

window.initializeDoctor       = initializeDoctor;
window.loadDoctorSection      = loadDoctorPatients;
window.openAssignDoctorModal  = openAssignDoctorModal;
window.closeAssignDoctorModal = closeAssignDoctorModal;
window.submitAssignDoctor     = submitAssignDoctor;
