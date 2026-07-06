"use strict";

let billingPatients = [];
let selectedBillingPatientId = null;

/* ==========================================================
   INITIALIZE
========================================================== */

async function initializeBilling() {

    try {

        await loadBillingPatients();
        initBillingPatientSearch();
        initBillingLiveCalc();

    } catch (err) {

        console.error("Billing init error:", err);
        showAlert("Unable to load billing section.", "error");

    }

}

/* ==========================================================
   LOAD PATIENTS
========================================================== */

async function loadBillingPatients() {

    const tbody = document.getElementById("billingPatientBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="text-center">Loading...</td></tr>`;

    try {

        billingPatients = await api.get("/patients");
        renderBillingPatientTable(billingPatients);

    } catch (err) {

        console.error(err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">Failed to load patients.</td></tr>`;

    }

}

/* ==========================================================
   RENDER PATIENT TABLE
========================================================== */

function renderBillingPatientTable(data) {

    const tbody = document.getElementById("billingPatientBody");
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
                    onclick="selectBillingPatient(${p.id}, '${p.patient_name.replace(/'/g, "\\'")}')">
                    <i class="fa-solid fa-file-invoice-dollar"></i> Bill
                </button>
            </td>
        `;

        tbody.appendChild(tr);

    });

}

/* ==========================================================
   SELECT PATIENT & LOAD BILL
========================================================== */

async function selectBillingPatient(patientId, patientName) {

    selectedBillingPatientId = patientId;

    const card  = document.getElementById("billingFormCard");
    const title = document.getElementById("billingPatientTitle");

    if (card) card.style.display = "block";
    if (title) title.innerHTML = `<i class="fa-solid fa-file-invoice-dollar"></i> Generate Bill — ${patientName}`;

    document.getElementById("billingPatientId").value = patientId;

    await loadExistingBill(patientId);

    card?.scrollIntoView({ behavior: "smooth" });

}

/* ==========================================================
   LOAD EXISTING BILL
========================================================== */

async function loadExistingBill(patientId) {

    try {

        const bill = await api.get(`/billing/${patientId}`);

        const fields = {
            billRoomCharge:    bill.room_charge    || 0,
            billDoctorFee:     bill.doctor_fee     || 0,
            billMedicineFee:   bill.medicine_fee   || 0,
            billLabFee:        bill.lab_fee        || 0,
            billMaintenanceFee:bill.maintenance_fee|| 0,
            billOtherFee:      bill.other_fee      || 0,
            billDiscount:      bill.discount       || 0,
            billGST:           bill.gst            || 0
        };

        Object.entries(fields).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });

        calculateBill();

    } catch (err) {

        console.error(err);

    }

}

/* ==========================================================
   SEARCH
========================================================== */

function initBillingPatientSearch() {

    document.getElementById("billingPatientSearch")?.addEventListener("keyup", e => {

        const kw = e.target.value.toLowerCase();

        const filtered = billingPatients.filter(p =>
            p.patient_name.toLowerCase().includes(kw) ||
            (p.doctor_name || "").toLowerCase().includes(kw) ||
            (p.ward || "").toLowerCase().includes(kw)
        );

        renderBillingPatientTable(filtered);

    });

}

/* ==========================================================
   LIVE CALCULATION
========================================================== */

function initBillingLiveCalc() {

    ["billRoomCharge", "billDoctorFee", "billMedicineFee",
     "billLabFee", "billMaintenanceFee", "billOtherFee",
     "billDiscount", "billGST"].forEach(id => {

        document.getElementById(id)?.addEventListener("input", calculateBill);

    });

}

function calculateBill() {

    const val = id => Number(document.getElementById(id)?.value || 0);

    const subtotal = val("billRoomCharge") + val("billDoctorFee") +
                     val("billMedicineFee") + val("billLabFee") +
                     val("billMaintenanceFee") + val("billOtherFee");

    const discount     = val("billDiscount");
    const gstPercent   = val("billGST");
    const afterDiscount = subtotal - discount;
    const gstAmount    = afterDiscount * gstPercent / 100;
    const total        = afterDiscount + gstAmount;

    const fmt = n => `₹ ${Number(n).toFixed(2)}`;

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    set("billSubtotal",        fmt(subtotal));
    set("billDiscountDisplay", `- ${fmt(discount)}`);
    set("billGSTDisplay",      `+ ${fmt(gstAmount)}`);
    set("billTotal",           fmt(total));

}

/* ==========================================================
   SUBMIT BILL
========================================================== */

async function submitBill() {

    const patient_id     = document.getElementById("billingPatientId").value;
    const room_charge    = document.getElementById("billRoomCharge").value;
    const doctor_fee     = document.getElementById("billDoctorFee").value;
    const medicine_fee   = document.getElementById("billMedicineFee").value;
    const lab_fee        = document.getElementById("billLabFee").value;
    const maintenance_fee= document.getElementById("billMaintenanceFee").value;
    const other_fee      = document.getElementById("billOtherFee").value;
    const discount       = document.getElementById("billDiscount").value;
    const gst            = document.getElementById("billGST").value;

    if (!patient_id) {
        showAlert("Please select a patient first.", "warning");
        return;
    }

    try {

        const res = await api.post("/generate-bill", {
            patient_id, room_charge, doctor_fee, medicine_fee,
            lab_fee, maintenance_fee, other_fee, discount, gst
        });

        if (!res.success) throw new Error(res.message);

        showAlert(`Bill generated. Total: ₹ ${Number(res.total).toFixed(2)}`, "success");

    } catch (err) {

        console.error(err);
        showAlert(err.message || "Failed to generate bill.", "error");

    }

}

/* ==========================================================
   EXPORTS
========================================================== */

window.initializeBilling      = initializeBilling;
window.selectBillingPatient   = selectBillingPatient;
window.calculateBill          = calculateBill;
window.submitBill             = submitBill;
