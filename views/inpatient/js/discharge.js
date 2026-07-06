"use strict";

let dischargePatients = [];
let selectedDischargePatientId = null;
let pendingDischargeCallback = null;

/* ==========================================================
   INITIALIZE
========================================================== */

async function initializeDischarge() {

    try {

        await loadDischargePatients();
        initDischargePatientSearch();

    } catch (err) {

        console.error("Discharge init error:", err);
        showAlert("Unable to load discharge section.", "error");

    }

}

/* ==========================================================
   LOAD PATIENTS
========================================================== */

async function loadDischargePatients() {

    const tbody = document.getElementById("dischargePatientBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="text-center">Loading...</td></tr>`;

    try {

        dischargePatients = await api.get("/patients");
        renderDischargePatientTable(dischargePatients);

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">Failed to load patients.</td></tr>`;

    }

}

/* ==========================================================
   RENDER PATIENT TABLE
========================================================== */

function renderDischargePatientTable(data) {

    const tbody = document.getElementById("dischargePatientBody");
    if (!tbody) return;

    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">No patients found.</td></tr>`;
        return;
    }

    tbody.innerHTML = "";

    data.forEach(p => {

        const isAlreadyDischarged = p.status === "Discharged";

        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${p.id}</td>
            <td><strong>${p.patient_name}</strong></td>
            <td>${p.doctor_name || "-"}</td>
            <td>${p.ward || "-"}</td>
            <td>${formatDate(p.admission_date)}</td>
            <td>${isAlreadyDischarged
                ? `<span class="status discharged">Discharged</span>`
                : `<span class="status admitted">Admitted</span>`}</td>
            <td>
                ${isAlreadyDischarged
                    ? `<button class="btn btn-secondary btn-sm" onclick="viewDischargeSummary(${p.id})">
                           <i class="fa-solid fa-file-waveform"></i> Summary
                       </button>`
                    : `<button class="btn btn-danger btn-sm"
                           onclick="openDischargeForm(${p.id}, '${p.patient_name.replace(/'/g, "\\'")}', ${p.doctor_id || "null"})">
                           <i class="fa-solid fa-right-from-bracket"></i> Discharge
                       </button>`}
            </td>
        `;

        tbody.appendChild(tr);

    });

}

/* ==========================================================
   OPEN DISCHARGE FORM
========================================================== */

async function openDischargeForm(patientId, patientName, doctorId) {

    selectedDischargePatientId = patientId;

    const card  = document.getElementById("dischargeFormCard");
    const title = document.getElementById("dischargePatientTitle");

    if (card) card.style.display = "block";
    if (title) title.innerHTML = `<i class="fa-solid fa-file-waveform"></i> Discharge — ${patientName}`;

    document.getElementById("dischargeFormPatientId").value = patientId;
    document.getElementById("dischargeFormDoctorId").value  = doctorId || "";
    document.getElementById("dischargeSummary").value       = "";
    document.getElementById("dischargeInstructions").value  = "";
    document.getElementById("dischargeFollowUp").value      = "";
    document.getElementById("dischargeTotalBill").value     = 0;
    document.getElementById("dischargePaidAmount").value    = 0;

    /* Pre-fill total bill from billing record */
    try {

        const bill = await api.get(`/billing/${patientId}`);
        if (bill && bill.total) {
            document.getElementById("dischargeTotalBill").value = bill.total;
        }

    } catch (_) { /* ignore */ }

    /* Render patient info */
    const patient = dischargePatients.find(p => p.id === patientId);
    if (patient) renderDischargePatientInfo(patient);

    card?.scrollIntoView({ behavior: "smooth" });

}

/* ==========================================================
   RENDER PATIENT INFO BLOCK
========================================================== */

function renderDischargePatientInfo(p) {

    const container = document.getElementById("dischargePatientInfo");
    if (!container) return;

    container.innerHTML = `
        <div class="detail-card">
            <div class="detail-row"><span>Name</span><span>${p.patient_name}</span></div>
            <div class="detail-row"><span>Age / Gender</span><span>${p.age || "-"} / ${p.gender || "-"}</span></div>
            <div class="detail-row"><span>Ward</span><span>${p.ward || "-"}</span></div>
            <div class="detail-row"><span>Room / Bed</span><span>${p.room_no || "-"} / ${p.bed_no || "-"}</span></div>
            <div class="detail-row"><span>Doctor</span><span>${p.doctor_name || "-"}</span></div>
            <div class="detail-row"><span>Admission Date</span><span>${formatDate(p.admission_date)}</span></div>
            <div class="detail-row"><span>Diagnosis</span><span>${p.disease || "-"}</span></div>
        </div>
    `;

}

/* ==========================================================
   CANCEL FORM
========================================================== */

function cancelDischargeForm() {

    const card = document.getElementById("dischargeFormCard");
    if (card) card.style.display = "none";
    selectedDischargePatientId = null;

}

/* ==========================================================
   SUBMIT DISCHARGE
========================================================== */

async function submitDischarge() {

    const patient_id    = document.getElementById("dischargeFormPatientId").value;
    const doctor_id     = document.getElementById("dischargeFormDoctorId").value || null;
    const summary       = document.getElementById("dischargeSummary").value.trim();
    const instructions  = document.getElementById("dischargeInstructions").value.trim();
    const follow_up     = document.getElementById("dischargeFollowUp").value || null;
    const total_bill    = document.getElementById("dischargeTotalBill").value || 0;
    const paid_amount   = document.getElementById("dischargePaidAmount").value || 0;

    if (!summary) {
        showAlert("Please enter a discharge summary.", "warning");
        return;
    }

    /* Show confirmation modal */
    const modal = document.getElementById("dischargeConfirmModal");
    if (modal) {

        modal.classList.add("show");

        document.getElementById("confirmDischargeBtn").onclick = async () => {

            modal.classList.remove("show");

            try {

                const res = await api.post("/discharge", {
                    patient_id, doctor_id, summary, instructions,
                    follow_up, total_bill, paid_amount
                });

                if (!res.success) throw new Error(res.message);

                showAlert("Patient discharged successfully.", "success");
                cancelDischargeForm();
                await loadDischargePatients();

            } catch (err) {

                console.error(err);
                showAlert(err.message || "Discharge failed.", "error");

            }

        };

    }

}

/* ==========================================================
   CLOSE CONFIRM MODAL
========================================================== */

function closeDischargeConfirmModal() {

    document.getElementById("dischargeConfirmModal")?.classList.remove("show");

}

/* ==========================================================
   VIEW DISCHARGE SUMMARY
========================================================== */

async function viewDischargeSummary(patientId) {

    try {

        const data = await api.get(`/discharge/${patientId}`);

        if (!data || !data.patient_name) {
            showAlert("No discharge summary found.", "warning");
            return;
        }

        openModal("Discharge Summary", `
            <div class="detail-card">
                <div class="detail-row"><span>Patient</span><span>${data.patient_name}</span></div>
                <div class="detail-row"><span>Doctor</span><span>${data.doctor_name || "-"}</span></div>
                <div class="detail-row"><span>Discharge Date</span><span>${formatDateTime(data.discharge_date)}</span></div>
                <div class="detail-row"><span>Follow-up</span><span>${formatDate(data.follow_up)}</span></div>
                <div class="detail-row"><span>Total Bill</span><span>₹ ${Number(data.total_bill || 0).toFixed(2)}</span></div>
                <div class="detail-row"><span>Paid</span><span>₹ ${Number(data.paid_amount || 0).toFixed(2)}</span></div>
            </div>
            <div class="form-group" style="margin-top:12px;">
                <label>Summary</label>
                <p>${data.summary || "-"}</p>
            </div>
            <div class="form-group">
                <label>Instructions</label>
                <p>${data.instructions || "-"}</p>
            </div>
        `);

    } catch (err) {

        console.error(err);
        showAlert("Failed to load discharge summary.", "error");

    }

}

/* ==========================================================
   SEARCH
========================================================== */

function initDischargePatientSearch() {

    document.getElementById("dischargePatientSearch")?.addEventListener("keyup", e => {

        const kw = e.target.value.toLowerCase();

        const filtered = dischargePatients.filter(p =>
            p.patient_name.toLowerCase().includes(kw) ||
            (p.doctor_name || "").toLowerCase().includes(kw) ||
            (p.ward || "").toLowerCase().includes(kw)
        );

        renderDischargePatientTable(filtered);

    });

}

/* ==========================================================
   EXPORTS
========================================================== */

window.initializeDischarge        = initializeDischarge;
window.openDischargeForm          = openDischargeForm;
window.cancelDischargeForm        = cancelDischargeForm;
window.submitDischarge            = submitDischarge;
window.closeDischargeConfirmModal = closeDischargeConfirmModal;
window.viewDischargeSummary       = viewDischargeSummary;
