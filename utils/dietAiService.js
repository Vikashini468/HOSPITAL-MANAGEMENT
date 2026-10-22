/* =====================================================
   DIET AI SERVICE — Python diet model API functions
   -----------------------------------------------------
   Mirrors the pattern of aiService.js.
   All calls to the diet Python service go through here
   so no route ever touches the service URL directly.

   Python service endpoint:
     POST /predict-diet  →  { recommended_diet, recommended_food, meal_type }
   ===================================================== */

const { URL } = require("url");

const DIET_AI_URL = process.env.DIET_AI_URL || "http://localhost:5051";

/* Guard against SSRF: only allow requests to loopback addresses */
const _allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);
function _validateDietUrl(base) {
    const parsed = new URL(base);
    if (!_allowedHosts.has(parsed.hostname))
        throw new Error(`DIET_AI_URL hostname '${parsed.hostname}' is not allowed.`);
}

/* Shared fetch wrapper — same pattern as aiService.js */
async function callDietPredictor(endpoint, payload) {
    _validateDietUrl(DIET_AI_URL);
    const res = await fetch(`${DIET_AI_URL}${endpoint}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload)
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error("Diet AI service error: " + (err.error || res.status));
    }

    return res.json();
}

/* =====================================================
   DIET RECOMMENDATION  ->  POST /predict-diet
   ===================================================== */
function predictDiet(features) {
    return callDietPredictor("/predict-diet", features);
}

module.exports = {
    callDietPredictor,
    predictDiet
};
