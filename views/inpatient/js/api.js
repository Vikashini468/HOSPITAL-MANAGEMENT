/* ==========================================================
   NALAM AI
   In-Patient Module
   api.js
========================================================== */

/* ==========================================================
   BASE API
========================================================== */

/* ==========================================================
   COMMON FETCH
========================================================== */

async function apiRequest(url, method = "GET", data = null) {

    try {

        const options = {
            method,
            headers: {
                "Content-Type": "application/json"
            }
        };

        if (data) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(API_BASE + url, options);

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "API Error");
        }

        return result;

    } catch (error) {

        console.error("API Error:", error);

        throw error;

    }

}

/* ==========================================================
   DASHBOARD
========================================================== */

async function getDashboardStats() {
    return apiRequest("/dashboard");
}

async function getPatients() {
    return apiRequest("/patients");
}

async function getPatient(id) {
    return apiRequest(`/patient/${id}`);
}

/* ==========================================================
   ADMISSION
========================================================== */

async function admitPatient(data) {
    return apiRequest("/admit", "POST", data);
}

async function getDoctors() {
    return apiRequest("/doctors");
}

/* ==========================================================
   ROOM
========================================================== */

async function assignRoom(data) {
    return apiRequest("/assign-room", "PUT", data);
}

async function assignDoctor(data) {
    return apiRequest("/assign-doctor", "PUT", data);
}

/* ==========================================================
   TREATMENT
========================================================== */

async function addTreatment(data) {
    return apiRequest("/treatment", "POST", data);
}

async function getTreatments(patientId) {
    return apiRequest(`/treatments/${patientId}`);
}

/* ==========================================================
   LAB REPORTS
========================================================== */

async function getLabReports(patientId) {

    return apiRequest(`/lab/${patientId}`);

}

async function uploadLabReport(data) {

    return apiRequest("/lab/upload", "POST", data);

}

/* ==========================================================
   VITALS
========================================================== */

async function addVitals(data) {
    return apiRequest("/vitals", "POST", data);
}

async function getVitals(patientId) {
    return apiRequest(`/vitals/${patientId}`);
}

/* ==========================================================
   MEDICINE
========================================================== */

async function addMedicine(data) {
    return apiRequest("/medicine", "POST", data);
}

async function getMedicine(patientId) {
    return apiRequest(`/medicine/${patientId}`);
}

async function updateMedicine(data) {
    return apiRequest("/medicine/update", "PUT", data);
}

/* ==========================================================
   BILLING
========================================================== */

async function getBilling(patientId) {
    return apiRequest(`/billing/${patientId}`);
}

async function generateBill(data) {
    return apiRequest("/generate-bill", "POST", data);
}

/* ==========================================================
   DISCHARGE
========================================================== */

async function dischargePatient(data) {
    return apiRequest("/discharge", "POST", data);
}

async function getDischarge(patientId) {
    return apiRequest(`/discharge/${patientId}`);
}

/* ==========================================================
   MAINTENANCE
========================================================== */

async function createMaintenanceRequest(data) {

    return apiRequest("/maintenance-request", "POST", data);

}

/* ==========================================================
   SOCKET SAFE REFRESH
========================================================== */

async function reloadDashboard() {

    if (typeof refreshDashboard === "function") {

        await refreshDashboard();

    }

}

/* ==========================================================
   EXPORTS
========================================================== */

window.api = {

    get: (url) => apiRequest(url, "GET"),

    post: (url, data) => apiRequest(url, "POST", data),

    put: (url, data) => apiRequest(url, "PUT", data),

    delete: (url) => apiRequest(url, "DELETE"),

};

window.API = {

    getDashboardStats,

    getPatients,

    getPatient,

    admitPatient,

    getDoctors,

    assignRoom,

    assignDoctor,

    addTreatment,

    getTreatments,

    getLabReports,

    uploadLabReport,

    addVitals,

    getVitals,

    addMedicine,

    getMedicine,

    updateMedicine,

    getBilling,

    generateBill,

    dischargePatient,

    getDischarge,

    createMaintenanceRequest,

    reloadDashboard

};