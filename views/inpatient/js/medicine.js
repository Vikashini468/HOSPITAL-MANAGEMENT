"use strict";

let medicinePatients = [];
let selectedMedicinePatientId = null;

/* ==========================================================
   INITIALIZE
========================================================== */

async function initializeMedicine() {

    try {

        await loadMedicinePatients();
        initMedicinePatientSearch();

    } catch (err) {

        console.error("Medicine init error:", err);
        showAlert("Unable to load medicine section.", "error");

    }

}

/* ==========================================================
   LOAD PATIENTS
========================================================== */

async function loadMedicinePatients() {

    const tbody = document.getElementById("medicinePatientBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="text-center">Loading...</td></tr>`;

    try {

        medicinePatients = await api.get("/patients");
        renderMedicinePatientTable(medicinePatients);

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">Failed to load patients.</td></tr>`;

    }

}

/* ==========================================================
   RENDER PATIENT TABLE
========================================================== */

function renderMedicinePatientTable(data) {

    const tbody = document.getElementById("medicinePatientBody");
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
                    onclick="selectMedicinePatient(${p.id}, '${p.patient_name.replace(/'/g, "\\'")}')">
                    <i class="fa-solid fa-pills"></i> View
                </button>
            </td>
        `;

        tbody.appendChild(tr);

    });

}

/* ==========================================================
   SELECT PATIENT & LOAD SCHEDULE
========================================================== */

async function selectMedicinePatient(patientId, patientName) {

    selectedMedicinePatientId = patientId;

    const card  = document.getElementById("medicineScheduleCard");
    const title = document.getElementById("medicinePatientTitle");

    if (card) card.style.display = "block";
    if (title) title.innerHTML = `<i class="fa-solid fa-pills"></i> Medicine Schedule — ${patientName}`;

    await loadMedicineSchedule(patientId);

    card?.scrollIntoView({ behavior: "smooth" });

}

/* ==========================================================
   LOAD MEDICINE SCHEDULE
========================================================== */

async function loadMedicineSchedule(patientId) {

    const tbody = document.getElementById("medicineScheduleBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="text-center">Loading...</td></tr>`;

    try {

        const medicines = await api.get(`/medicine/${patientId}`);

        if (!medicines.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center">No medicines added.</td></tr>`;
            return;
        }

        tbody.innerHTML = "";

        medicines.forEach((m, i) => {

            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${i + 1}</td>
                <td><strong>${m.medicine}</strong></td>
                <td>${m.morning  ? `<span class="badge green">Yes</span>` : `<span class="badge grey">No</span>`}</td>
                <td>${m.afternoon ? `<span class="badge green">Yes</span>` : `<span class="badge grey">No</span>`}</td>
                <td>${m.night    ? `<span class="badge green">Yes</span>` : `<span class="badge grey">No</span>`}</td>
                <td>
                    <span class="badge ${m.status === "Given" ? "green" : m.status === "Skipped" ? "red" : "blue"}">
                        ${m.status || "Pending"}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-success btn-sm" onclick="updateMedicineStatus(${m.id}, 'Given', ${m.morning}, ${m.afternoon}, ${m.night})">
                            Given
                        </button>
                        <button class="btn btn-warning btn-sm" onclick="updateMedicineStatus(${m.id}, 'Skipped', ${m.morning}, ${m.afternoon}, ${m.night})">
                            Skip
                        </button>
                    </div>
                </td>
            `;

            tbody.appendChild(tr);

        });

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">Failed to load schedule.</td></tr>`;

    }

}

/* ==========================================================
   SEARCH
========================================================== */

function initMedicinePatientSearch() {

    document.getElementById("medicinePatientSearch")?.addEventListener("keyup", e => {

        const kw = e.target.value.toLowerCase();

        const filtered = medicinePatients.filter(p =>
            p.patient_name.toLowerCase().includes(kw) ||
            (p.doctor_name || "").toLowerCase().includes(kw) ||
            (p.ward || "").toLowerCase().includes(kw)
        );

        renderMedicinePatientTable(filtered);

    });

}

/* ==========================================================
   ADD MEDICINE MODAL
========================================================== */

function openAddMedicineModal() {

    if (!selectedMedicinePatientId) {
        showAlert("Please select a patient first.", "warning");
        return;
    }

    document.getElementById("medicinePatientId").value = selectedMedicinePatientId;
    document.getElementById("medicineName").value = "";
    document.getElementById("medicineMorning").value = "false";
    document.getElementById("medicineAfternoon").value = "false";
    document.getElementById("medicineNight").value = "false";
    document.getElementById("addMedicineModal").classList.add("show");

}

function closeAddMedicineModal() {

    document.getElementById("addMedicineModal")?.classList.remove("show");

}

async function submitMedicine() {

    const patient_id = document.getElementById("medicinePatientId").value;
    const medicine   = document.getElementById("medicineName").value.trim();
    const morning    = document.getElementById("medicineMorning").value === "true";
    const afternoon  = document.getElementById("medicineAfternoon").value === "true";
    const night      = document.getElementById("medicineNight").value === "true";

    if (!medicine) {
        showAlert("Please enter a medicine name.", "warning");
        return;
    }

    try {

        const res = await api.post("/medicine", { patient_id, medicine, morning, afternoon, night });

        if (!res.success) throw new Error(res.message);

        showAlert("Medicine added.", "success");
        closeAddMedicineModal();
        await loadMedicineSchedule(patient_id);

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Failed to add medicine.", "error");

    }

}

/* ==========================================================
   UPDATE MEDICINE STATUS
========================================================== */

async function updateMedicineStatus(id, status, morning, afternoon, night) {

    try {

        const res = await api.put("/medicine/update", { id, status, morning, afternoon, night });

        if (!res.success) throw new Error(res.message);

        showAlert(`Medicine marked as ${status}.`, "success");

        if (selectedMedicinePatientId) await loadMedicineSchedule(selectedMedicinePatientId);

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Update failed.", "error");

    }

}

/* ==========================================================
   EXPORTS
========================================================== */

window.initializeMedicine      = initializeMedicine;
window.selectMedicinePatient   = selectMedicinePatient;
window.openAddMedicineModal    = openAddMedicineModal;
window.closeAddMedicineModal   = closeAddMedicineModal;
window.submitMedicine          = submitMedicine;
window.updateMedicineStatus    = updateMedicineStatus;
