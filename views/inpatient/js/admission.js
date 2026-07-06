/* ==========================================================
   NALAM AI
   admission.js
   PART 1
========================================================== */

"use strict";

/* ==========================================================
   GLOBAL VARIABLES
========================================================== */

let admissionForm = null;

let patientTableBody = null;

let doctorDropdown = null;

let admittedPatients = [];

let doctors = [];

let admissionRefreshTimer = null;

/* ==========================================================
   INITIALIZE ADMISSION PAGE
========================================================== */

async function initializeAdmission() {

    admissionForm = document.getElementById("admissionForm");

    patientTableBody = document.getElementById("patientTableBody");

    doctorDropdown = document.getElementById("doctor_id");

    try {

        setAdmissionDate();

        await loadDoctors();

        await loadPatients();

        initializeAdmissionSearch();

        initializeAdmissionValidation();

        initializeAdmissionEvents();

        startAdmissionAutoRefresh();

        console.log("Admission Module Loaded");

    }

    catch (error) {

        console.error(
            "Admission Initialization Error:",
            error
        );

        showAlert(
            "Unable to load Admission Module",
            "error"
        );

    }

}

/* ==========================================================
   DEFAULT DATE
========================================================== */

function setAdmissionDate() {

    const dateInput =
        document.getElementById("admission_date");

    if (!dateInput) return;

    const today =
        new Date().toISOString().split("T")[0];

    dateInput.value = today;

}

/* ==========================================================
   LOAD DOCTORS
========================================================== */

async function loadDoctors() {

    try {

        const response =
            await api.get("/doctors");

        doctors = response || [];

        renderDoctors();

    }

    catch (error) {

        console.error(error);

        if (doctorDropdown) {

            doctorDropdown.innerHTML = `

                <option value="">

                    Unable to Load Doctors

                </option>

            `;

        }

    }

}

/* ==========================================================
   RENDER DOCTORS
========================================================== */

function renderDoctors() {

    if (!doctorDropdown) return;

    doctorDropdown.innerHTML = "";

    const defaultOption =
        document.createElement("option");

    defaultOption.value = "";

    defaultOption.textContent =
        "Select Doctor";

    doctorDropdown.appendChild(defaultOption);

    doctors.forEach((doctor) => {

        const option =
            document.createElement("option");

        option.value = doctor.id;

        option.textContent =
            `${doctor.name} (${doctor.specialisation})`;

        doctorDropdown.appendChild(option);

    });

}

/* ==========================================================
   LOAD PATIENTS
========================================================== */

async function loadPatients() {

    if (!patientTableBody) return;

    try {

        patientTableBody.innerHTML = `

            <tr>

                <td colspan="10" class="text-center">

                    Loading Patients...

                </td>

            </tr>

        `;

        admittedPatients =
            await api.get("/patients");

        renderPatientTable();

        updateAdmissionSummary();

    }

    catch (error) {

        console.error(error);

        patientTableBody.innerHTML = `

            <tr>

                <td colspan="10" class="text-center">

                    Failed to Load Patients

                </td>

            </tr>

        `;

    }

}

/* ==========================================================
   REFRESH PATIENT LIST
========================================================== */

async function refreshPatients() {

    await loadPatients();

}

/* ==========================================================
   AUTO REFRESH
========================================================== */

function startAdmissionAutoRefresh() {

    stopAdmissionAutoRefresh();

    admissionRefreshTimer =

        setInterval(async () => {

            await refreshPatients();

        }, 30000);

}

function stopAdmissionAutoRefresh() {

    if (admissionRefreshTimer) {

        clearInterval(admissionRefreshTimer);

        admissionRefreshTimer = null;

    }

}
/* ==========================================================
   NALAM AI
   admission.js
   PART 2
========================================================== */

/* ==========================================================
   RENDER PATIENT TABLE
========================================================== */

function renderPatientTable() {

    if (!patientTableBody) return;

    if (!admittedPatients.length) {

        patientTableBody.innerHTML = `

            <tr>

                <td colspan="10" class="text-center">

                    No admitted patients found.

                </td>

            </tr>

        `;

        return;

    }

    patientTableBody.innerHTML = "";

    admittedPatients.forEach((patient) => {

        const row = document.createElement("tr");

        row.innerHTML = `

            <td>${patient.id}</td>

            <td>

                <div class="patient-cell">

                    <strong>${patient.patient_name}</strong>

                    <span class="small-text">

                        ${patient.phone || "-"}

                    </span>

                </div>

            </td>

            <td>

                ${patient.doctor_name || "-"}

            </td>

            <td>

                ${patient.ward || "-"}

            </td>

            <td>

                ${patient.room_no || "-"}

            </td>

            <td>

                ${patient.bed_no || "-"}

            </td>

            <td>

                ${formatDate(patient.admission_date)}

            </td>

            <td>

                <span class="badge blue">

                    ${patient.admission_type}

                </span>

            </td>

            <td>

                ${renderStatus(patient)}

            </td>

            <td>

                <div class="action-buttons">

                    <button
                        class="btn btn-primary btn-sm"
                        onclick="viewPatient(${patient.id})">

                        <i class="fa fa-eye"></i>

                    </button>

                    <button
                        class="btn btn-success btn-sm"
                        onclick="openTransferModal(${patient.id})">

                        <i class="fa fa-bed"></i>

                    </button>

                    <button
                        class="btn btn-danger btn-sm"
                        onclick="openDischargeModal(${patient.id})">

                        <i class="fa fa-right-from-bracket"></i>

                    </button>

                </div>

            </td>

        `;

        patientTableBody.appendChild(row);

    });

}

/* ==========================================================
   STATUS BADGE
========================================================== */

function renderStatus(patient) {

    if (patient.status === "Discharged") {

        return `<span class="status discharged">
                    Discharged
                </span>`;

    }

    if (patient.admission_type === "ICU") {

        return `<span class="status icu">
                    ICU
                </span>`;

    }

    return `<span class="status admitted">
                Admitted
            </span>`;

}

/* ==========================================================
   SEARCH
========================================================== */

function searchPatients(keyword) {

    keyword = keyword.toLowerCase();

    const filtered = admittedPatients.filter((patient) => {

        return (

            patient.patient_name.toLowerCase().includes(keyword)

            ||

            (patient.phone || "").includes(keyword)

            ||

            (patient.room_no || "")
                .toLowerCase()
                .includes(keyword)

            ||

            (patient.ward || "")
                .toLowerCase()
                .includes(keyword)

            ||

            (patient.doctor_name || "")
                .toLowerCase()
                .includes(keyword)

        );

    });

    renderFilteredPatients(filtered);

}

/* ==========================================================
   RENDER FILTERED TABLE
========================================================== */

function renderFilteredPatients(data) {

    if (!patientTableBody) return;

    patientTableBody.innerHTML = "";

    if (!data.length) {

        patientTableBody.innerHTML = `

            <tr>

                <td colspan="10" class="text-center">

                    No matching patients found.

                </td>

            </tr>

        `;

        return;

    }

    data.forEach((patient) => {

        const row = document.createElement("tr");

        row.innerHTML = `

            <td>${patient.id}</td>

            <td>

                <strong>${patient.patient_name}</strong>

            </td>

            <td>${patient.doctor_name || "-"}</td>

            <td>${patient.ward}</td>

            <td>${patient.room_no}</td>

            <td>${patient.bed_no}</td>

            <td>${formatDate(patient.admission_date)}</td>

            <td>${patient.admission_type}</td>

            <td>${renderStatus(patient)}</td>

            <td>

                <div class="action-buttons">

                    <button
                        class="btn btn-primary btn-sm"
                        onclick="viewPatient(${patient.id})">

                        <i class="fa fa-eye"></i>

                    </button>

                    <button
                        class="btn btn-success btn-sm"
                        onclick="openTransferModal(${patient.id})">

                        <i class="fa fa-bed"></i>

                    </button>

                    <button
                        class="btn btn-danger btn-sm"
                        onclick="openDischargeModal(${patient.id})">

                        <i class="fa fa-right-from-bracket"></i>

                    </button>

                </div>

            </td>

        `;

        patientTableBody.appendChild(row);

    });

}

/* ==========================================================
   SUMMARY
========================================================== */

function updateAdmissionSummary() {

    const summaryAdmissions = document.getElementById("summaryAdmissions");
    const summaryOccupied = document.getElementById("summaryOccupied");
    const summaryICU = document.getElementById("summaryICU");
    const summaryDoctors = document.getElementById("summaryDoctors");

    if (summaryAdmissions)
        summaryAdmissions.textContent = admittedPatients.length;

    if (summaryOccupied)
        summaryOccupied.textContent =
            admittedPatients.filter(
                p => p.status === "Admitted"
            ).length;

    if (summaryICU)
        summaryICU.textContent =
            admittedPatients.filter(
                p => p.admission_type === "ICU"
            ).length;

    const uniqueDoctors = [

        ...new Set(

            admittedPatients.map(
                p => p.doctor_id
            )

        )

    ];

    if (summaryDoctors)
        summaryDoctors.textContent = uniqueDoctors.length;

}

/* ==========================================================
   SEARCH INITIALIZATION
========================================================== */

function initializeAdmissionSearch() {

    const input =
        document.getElementById("patientSearch");

    if (!input) return;

    input.addEventListener(

        "keyup",

        debounce((event) => {

            searchPatients(

                event.target.value

            );

        }, 300)

    );

}
/* ==========================================================
   NALAM AI
   admission.js
   PART 3A
========================================================== */

/* ==========================================================
   FORM VALIDATION
========================================================== */

function validateAdmissionForm() {

    const requiredFields = [

        "patient_name",
        "age",
        "gender",
        "phone",
        "emergency_contact",
        "doctor_id",
        "ward",
        "room_no",
        "bed_no",
        "admission_date",
        "admission_type"

    ];

    let valid = true;

    requiredFields.forEach((id) => {

        const field = document.getElementById(id);

        if (!field) return;

        field.classList.remove("error");

        if (!field.value || field.value.trim() === "") {

            field.classList.add("error");

            valid = false;

        }

    });

    /* Phone validation */

    const phone =
        document.getElementById("phone").value.trim();

    if (!/^[6-9]\d{9}$/.test(phone)) {

        document
            .getElementById("phone")
            .classList.add("error");

        valid = false;

    }

    /* Emergency Contact validation */

    const emergency =
        document
            .getElementById("emergency_contact")
            .value
            .trim();

    if (!/^[6-9]\d{9}$/.test(emergency)) {

        document
            .getElementById("emergency_contact")
            .classList.add("error");

        valid = false;

    }

    /* Age */

    const age =
        Number(
            document
                .getElementById("age")
                .value
        );

    if (age < 0 || age > 120) {

        document
            .getElementById("age")
            .classList.add("error");

        valid = false;

    }

    return valid;

}

/* ==========================================================
   SUBMIT ADMISSION FORM
========================================================== */

async function submitAdmission(event) {

    event.preventDefault();

    if (!validateAdmissionForm()) {

        showAlert(

            "Please fill all required fields correctly.",

            "warning"

        );

        return;

    }

    const submitButton =

        admissionForm.querySelector(

            'button[type="submit"]'

        );

    const originalText = submitButton.innerHTML;

    try {

        submitButton.disabled = true;

        submitButton.innerHTML = `

            <i class="fa-solid fa-spinner fa-spin"></i>

            Admitting...

        `;

        const payload = {

            patient_name:
                document.getElementById("patient_name").value.trim(),

            age:
                Number(
                    document.getElementById("age").value
                ),

            gender:
                document.getElementById("gender").value,

            blood_group:
                document.getElementById("blood_group").value,

            phone:
                document.getElementById("phone").value.trim(),

            address:
                document.getElementById("address").value.trim(),

            disease:
                document.getElementById("disease").value.trim(),

            emergency_contact:
                document.getElementById("emergency_contact").value.trim(),

            doctor_id:
                Number(
                    document.getElementById("doctor_id").value
                ),

            ward:
                document.getElementById("ward").value,

            room_no:
                document.getElementById("room_no").value.trim(),

            bed_no:
                document.getElementById("bed_no").value.trim(),

            admission_date:
                document.getElementById("admission_date").value,

            admission_type:
                document.getElementById("admission_type").value

        };

        const response = await api.post(

            "/admit",

            payload

        );

        if (!response.success) {

            throw new Error(

                response.message ||

                "Unable to admit patient."

            );

        }

        showAlert(

            "Patient admitted successfully.",

            "success"

        );

        resetAdmissionForm();

        await loadPatients();

    }

    catch (error) {

        console.error(error);

        showAlert(

            error.message ||

            "Admission failed.",

            "error"

        );

    }

    finally {

        submitButton.disabled = false;

        submitButton.innerHTML = originalText;

    }

}
/* ==========================================================
   NALAM AI
   admission.js
   PART 3B
========================================================== */

/* ==========================================================
   RESET ADMISSION FORM
========================================================== */

function resetAdmissionForm() {

    if (!admissionForm) return;

    admissionForm.reset();

    /* Restore today's admission date */

    setAdmissionDate();

    /* Remove validation styles */

    admissionForm
        .querySelectorAll(".error")
        .forEach((element) => {

            element.classList.remove("error");

        });

}

/* ==========================================================
   LIVE VALIDATION
========================================================== */

function initializeAdmissionValidation() {

    if (!admissionForm) return;

    const fields = admissionForm.querySelectorAll(

        "input, select, textarea"

    );

    fields.forEach((field) => {

        field.addEventListener("input", () => {

            if (

                field.value !== "" &&

                field.classList.contains("error")

            ) {

                field.classList.remove("error");

            }

        });

        field.addEventListener("change", () => {

            if (

                field.value !== "" &&

                field.classList.contains("error")

            ) {

                field.classList.remove("error");

            }

        });

    });

}

/* ==========================================================
   CLEAR SEARCH
========================================================== */

function clearPatientSearch() {

    const searchBox =

        document.getElementById("patientSearch");

    if (!searchBox) return;

    searchBox.value = "";

    renderPatientTable();

}

/* ==========================================================
   REFRESH PAGE
========================================================== */

async function refreshAdmissionPage() {

    await loadDoctors();

    await loadPatients();

}

/* ==========================================================
   FORM EVENTS
========================================================== */

function initializeAdmissionEvents() {

    if (!admissionForm) return;

    admissionForm.addEventListener(

        "submit",

        submitAdmission

    );

}

/* ==========================================================
   EXPORTS
========================================================== */

window.loadPatients = loadPatients;

window.refreshPatients = refreshPatients;

window.searchPatients = searchPatients;

window.submitAdmission = submitAdmission;

window.resetAdmissionForm = resetAdmissionForm;

window.refreshAdmissionPage = refreshAdmissionPage;

window.initializeAdmission = initializeAdmission;
/* ==========================================================
   NALAM AI
   admission.js
   PART 4A
========================================================== */

/* ==========================================================
   VIEW PATIENT DETAILS
========================================================== */

async function viewPatient(patientId) {

    try {

        const modal =
            document.getElementById("patientModal");

        const body =
            document.getElementById("patientModalBody");

        if (!modal || !body) return;

        /* Loading */

        body.innerHTML = `

            <div class="loading-state">

                <div class="spinner"></div>

                <p>Loading patient details...</p>

            </div>

        `;

        modal.classList.add("show");

        modal.dataset.patientId = patientId;

        /* Fetch patient */

        const patient = await api.get(

            `/patient/${patientId}`

        );

        renderPatientDetails(patient);

    }

    catch (error) {

        console.error(error);

        const body = document.getElementById("patientModalBody");

        if (body) {

            body.innerHTML = `

                <div class="empty-state">

                    <i class="fa-solid fa-circle-exclamation"></i>

                    <h3>

                        Unable to load patient details

                    </h3>

                    <p>

                        Please try again later.

                    </p>

                </div>

            `;

        }

    }

}

/* ==========================================================
   RENDER PATIENT DETAILS
========================================================== */

function renderPatientDetails(patient) {

    const body =
        document.getElementById("patientModalBody");

    if (!body) return;

    body.innerHTML = `

<div class="patient-details-grid">

    <div class="detail-card">

        <h4>

            <i class="fa-solid fa-user"></i>

            Patient Information

        </h4>

        <div class="detail-row">
            <span>Name</span>
            <span>${patient.patient_name}</span>
        </div>

        <div class="detail-row">
            <span>Age</span>
            <span>${patient.age}</span>
        </div>

        <div class="detail-row">
            <span>Gender</span>
            <span>${patient.gender}</span>
        </div>

        <div class="detail-row">
            <span>Blood Group</span>
            <span>${patient.blood_group || "-"}</span>
        </div>

        <div class="detail-row">
            <span>Phone</span>
            <span>${patient.phone}</span>
        </div>

        <div class="detail-row">
            <span>Emergency</span>
            <span>${patient.emergency_contact}</span>
        </div>

    </div>

    <div class="detail-card">

        <h4>

            <i class="fa-solid fa-hospital-user"></i>

            Admission Details

        </h4>

        <div class="detail-row">
            <span>Disease</span>
            <span>${patient.disease || "-"}</span>
        </div>

        <div class="detail-row">
            <span>Admission</span>
            <span>${formatDate(patient.admission_date)}</span>
        </div>

        <div class="detail-row">
            <span>Type</span>
            <span>${patient.admission_type}</span>
        </div>

        <div class="detail-row">
            <span>Status</span>
            <span>${patient.status}</span>
        </div>

        <div class="detail-row">
            <span>Ward</span>
            <span>${patient.ward}</span>
        </div>

        <div class="detail-row">
            <span>Room</span>
            <span>${patient.room_no}</span>
        </div>

        <div class="detail-row">
            <span>Bed</span>
            <span>${patient.bed_no}</span>
        </div>

    </div>

    <div class="detail-card">

        <h4>

            <i class="fa-solid fa-user-doctor"></i>

            Assigned Doctor

        </h4>

        <div class="detail-row">
            <span>Name</span>
            <span>${patient.doctor_name || "-"}</span>
        </div>

        <div class="detail-row">
            <span>Department</span>
            <span>${patient.doctor_dept || "-"}</span>
        </div>

        <div class="detail-row">
            <span>Consultation Fee</span>
            <span>

                ₹ ${Number(

                    patient.consultation_fee || 0

                ).toFixed(2)}

            </span>
        </div>

    </div>

    <div class="detail-card">

        <h4>

            <i class="fa-solid fa-location-dot"></i>

            Address

        </h4>

        <p>

            ${patient.address || "-"}

        </p>

    </div>

</div>

`;

}
/* ==========================================================
   NALAM AI
   admission.js
   PART 4B
========================================================== */

/* ==========================================================
   CLOSE PATIENT MODAL
========================================================== */

function closePatientModal() {

    const modal =
        document.getElementById("patientModal");

    if (!modal) return;

    modal.classList.remove("show");

}

/* ==========================================================
   REFRESH CURRENT PATIENT DETAILS
========================================================== */

async function refreshPatientDetails() {

    const modal =
        document.getElementById("patientModal");

    if (!modal || !modal.dataset.patientId) return;

    try {

        const patient = await api.get(
            `/patient/${modal.dataset.patientId}`
        );

        renderPatientDetails(patient);

    }

    catch (error) {

        console.error(error);

    }

}

/* ==========================================================
   CLOSE MODAL WHEN CLICKING BACKGROUND
========================================================== */

document.addEventListener("click", (event) => {

    const modal =
        document.getElementById("patientModal");

    if (!modal) return;

    if (event.target === modal) {

        closePatientModal();

    }

});

/* ==========================================================
   SOCKET REFRESH
========================================================== */

if (typeof socket !== "undefined") {

    socket.on("roomChanged", refreshPatientDetails);

    socket.on("doctorAssigned", refreshPatientDetails);

    socket.on("patientDischarged", closePatientModal);

}

/* ==========================================================
   EXPORTS
========================================================== */

window.viewPatient = viewPatient;

window.closePatientModal = closePatientModal;

window.refreshPatientDetails = refreshPatientDetails;

/* ==========================================================
   TRANSFER MODAL
========================================================== */

function openTransferModal(patientId) {

    const modal = document.getElementById("transferModal");

    if (!modal) return;

    document.getElementById("transfer_patient_id").value = patientId;

    modal.classList.add("show");

    const form = document.getElementById("transferForm");

    if (form) {

        form.onsubmit = async (e) => {

            e.preventDefault();

            await submitTransfer();

        };

    }

}

function closeTransferModal() {

    const modal = document.getElementById("transferModal");

    if (modal) modal.classList.remove("show");

}

async function submitTransfer() {

    const patient_id = document.getElementById("transfer_patient_id").value;
    const ward       = document.getElementById("transfer_ward").value;
    const room_no    = document.getElementById("transfer_room").value.trim();
    const bed_no     = document.getElementById("transfer_bed").value.trim();

    if (!ward || !room_no || !bed_no) {

        showAlert("Please fill all transfer fields.", "warning");

        return;

    }

    try {

        const response = await api.put("/assign-room", { patient_id, ward, room_no, bed_no });

        if (!response.success) throw new Error(response.message || "Transfer failed.");

        showAlert("Patient transferred successfully.", "success");

        closeTransferModal();

        await loadPatients();

    }

    catch (error) {

        console.error(error);

        showAlert(error.message || "Transfer failed.", "error");

    }

}

/* ==========================================================
   DISCHARGE MODAL
========================================================== */

function openDischargeModal(patientId) {

    const modal = document.getElementById("dischargeModal");

    if (!modal) return;

    document.getElementById("discharge_patient_id").value = patientId;

    modal.classList.add("show");

}

function closeDischargeModal() {

    const modal = document.getElementById("dischargeModal");

    if (modal) modal.classList.remove("show");

}

async function confirmDischarge() {

    const patient_id = document.getElementById("discharge_patient_id").value;

    try {

        const response = await api.post("/discharge", { patient_id });

        if (!response.success) throw new Error(response.message || "Discharge failed.");

        showAlert("Patient discharged successfully.", "success");

        closeDischargeModal();

        await loadPatients();

    }

    catch (error) {

        console.error(error);

        showAlert(error.message || "Discharge failed.", "error");

    }

}

window.openTransferModal  = openTransferModal;
window.closeTransferModal = closeTransferModal;
window.openDischargeModal  = openDischargeModal;
window.closeDischargeModal = closeDischargeModal;
window.confirmDischarge    = confirmDischarge;
