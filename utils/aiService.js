/* =====================================================
   AI SERVICE — reusable Python model API functions
   -----------------------------------------------------
   Central place for every call to the Python Flask AI
   service. Each disease has its own function that calls
   its corresponding endpoint, so the rest of the backend
   never touches the model service URL directly.
   ===================================================== */

const AI_SERVICE_URL = "http://localhost:5050";

/* Shared fetch wrapper — every model call goes through here */
async function callPredictor(endpoint, payload) {
    const res = await fetch(`${AI_SERVICE_URL}${endpoint}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error("Model service error: " + (err.error || res.status));
    }

    return res.json();
}

/* =====================================================
   DIABETES  ->  POST /predict/diabetes
   ===================================================== */
function predictDiabetes(features) {
    return callPredictor("/predict/diabetes", features);
}

/* =====================================================
   HYPERTENSION  ->  POST /predict/hypertension
   ===================================================== */
function predictHypertension(features) {
    return callPredictor("/predict/hypertension", features);
}

/* =====================================================
   CARDIOVASCULAR  ->  POST /predict/cardiovascular
   ===================================================== */
function predictCardiovascular(features) {
    return callPredictor("/predict/cardiovascular", features);
}

module.exports = {
    callPredictor,
    predictDiabetes,
    predictHypertension,
    predictCardiovascular
};
