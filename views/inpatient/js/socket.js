/* ==========================================================
   NALAM AI
   In-Patient Module
   socket.js
========================================================== */

/* ==========================================================
   SOCKET INITIALIZATION
========================================================== */

let socket = null;

function initializeSocket() {

    if (socket) return socket;

    socket = io({

        transports: ["websocket", "polling"],

        reconnection: true,

        reconnectionAttempts: Infinity,

        reconnectionDelay: 1000,

        timeout: 20000

    });

    window.socket = socket;

    registerSocketEvents();

    return socket;

}

/* ==========================================================
   SOCKET EVENTS
========================================================== */

function registerSocketEvents() {

    socket.on("connect", () => {

        console.log("🟢 Socket Connected");

        updateConnectionStatus(true);

    });

    socket.on("disconnect", () => {

        console.log("🔴 Socket Disconnected");

        updateConnectionStatus(false);

    });

    socket.on("reconnect", () => {

        console.log("🟢 Socket Reconnected");

        updateConnectionStatus(true);

        if (typeof refreshDashboard === "function") {

            refreshDashboard();

        }

    });

    socket.on("connect_error", (error) => {

        console.error(error);

    });

    /* =====================================================
       INPATIENT EVENTS
    ===================================================== */

    socket.on("patientAdmitted", (patient) => {

        console.log("Patient Admitted", patient);

        notify(
            "Patient Admitted",
            `${patient.patient_name} admitted`
        );

        safeRefresh();

    });

    socket.on("roomChanged", (data) => {

        console.log("Room Changed", data);

        notify(
            "Room Updated",
            "Room allocation changed"
        );

        safeRefresh();

    });

    socket.on("doctorAssigned", (data) => {

        console.log("Doctor Assigned", data);

        notify(
            "Doctor Assigned",
            "Doctor assignment updated"
        );

        safeRefresh();

    });

    socket.on("treatmentUpdated", (data) => {

        console.log("Treatment Updated", data);

        notify(
            "Treatment Updated",
            "Treatment history updated"
        );

        safeRefresh();

    });

    socket.on("labReportUploaded", (data) => {

        console.log("Lab Uploaded", data);

        notify(
            "Lab Report",
            "New report uploaded"
        );

        safeRefresh();

    });

    socket.on("medicineUpdated", (data) => {

        console.log("Medicine Updated", data);

        notify(
            "Medicine Updated",
            "Medicine schedule changed"
        );

        safeRefresh();

    });

    socket.on("vitalsUpdated", (data) => {

        console.log("Vitals Updated", data);

        notify(
            "Vitals Updated",
            "Patient vitals recorded"
        );

        safeRefresh();

    });

    socket.on("billGenerated", (data) => {

        console.log("Bill Generated", data);

        notify(
            "Billing",
            "Bill generated successfully"
        );

        safeRefresh();

    });

    socket.on("patientDischarged", (data) => {

        console.log("Patient Discharged", data);

        notify(
            "Discharged",
            "Patient discharged"
        );

        safeRefresh();

    });

}

/* ==========================================================
   SAFE DASHBOARD REFRESH
========================================================== */

function safeRefresh() {

    if (typeof refreshDashboard === "function") {

        refreshDashboard();

    }

}

/* ==========================================================
   CONNECTION STATUS
========================================================== */

function updateConnectionStatus(connected) {

    const indicator = document.getElementById("socketStatus");

    if (!indicator) return;

    if (connected) {

        indicator.innerHTML = `
            <i class="fa-solid fa-circle"></i>
            Connected
        `;

        indicator.classList.remove("offline");

        indicator.classList.add("online");

    }

    else {

        indicator.innerHTML = `
            <i class="fa-solid fa-circle"></i>
            Offline
        `;

        indicator.classList.remove("online");

        indicator.classList.add("offline");

    }

}

/* ==========================================================
   NOTIFICATION
========================================================== */

function notify(title, message) {

    if (typeof showAlert === "function") {

        showAlert(message, "success");

    }

    if (typeof addActivity === "function") {

        addActivity(

            "fa-solid fa-bell",

            title,

            message

        );

    }

}

/* ==========================================================
   EMIT FUNCTIONS
========================================================== */

function emitPatientAdmitted(patient) {

    socket.emit("patientAdmitted", patient);

}

function emitRoomChanged(data) {

    socket.emit("roomChanged", data);

}

function emitDoctorAssigned(data) {

    socket.emit("doctorAssigned", data);

}

function emitTreatmentUpdated(data) {

    socket.emit("treatmentUpdated", data);

}

function emitLabUploaded(data) {

    socket.emit("labReportUploaded", data);

}

function emitMedicineUpdated(data) {

    socket.emit("medicineUpdated", data);

}

function emitVitalsUpdated(data) {

    socket.emit("vitalsUpdated", data);

}

function emitBillGenerated(data) {

    socket.emit("billGenerated", data);

}

function emitPatientDischarged(data) {

    socket.emit("patientDischarged", data);

}

/* ==========================================================
   EXPORTS
========================================================== */

window.initializeSocket = initializeSocket;

window.emitPatientAdmitted = emitPatientAdmitted;

window.emitRoomChanged = emitRoomChanged;

window.emitDoctorAssigned = emitDoctorAssigned;

window.emitTreatmentUpdated = emitTreatmentUpdated;

window.emitLabUploaded = emitLabUploaded;

window.emitMedicineUpdated = emitMedicineUpdated;

window.emitVitalsUpdated = emitVitalsUpdated;

window.emitBillGenerated = emitBillGenerated;

window.emitPatientDischarged = emitPatientDischarged;

