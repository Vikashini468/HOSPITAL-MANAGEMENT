const express       = require("express");
const router        = express.Router();
const dietAiService = require("../utils/dietAiService");

/* =====================================================
   SCHEMA MIGRATION
   Called once on server startup via initTables(pool).

   The table was created in a previous migration without:
     - a CHECK constraint on verification_status
     - a safe DEFAULT ('PENDING', not 'VERIFIED')
     - indexes for the three most common query patterns

   ALTER TABLE ... ADD CONSTRAINT / ADD COLUMN IF NOT EXISTS
   are idempotent — safe to run on every startup.
   No existing rows or columns are dropped or modified.
===================================================== */
async function initTables(pool) {

    /* 1. Ensure the table exists with the full column set */
    await pool.query(`
        CREATE TABLE IF NOT EXISTS diet_recommendations (
            id                  SERIAL PRIMARY KEY,
            patient_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            doctor_id           INTEGER NOT NULL REFERENCES users(id),
            visit_id            INTEGER REFERENCES patient_visits(id) ON DELETE SET NULL,
            appointment_id      INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
            recommended_diet    TEXT    NOT NULL,
            recommended_food    TEXT,
            meal_type           TEXT,
            recommendation_date TIMESTAMP NOT NULL DEFAULT NOW(),
            verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            verified_at         TIMESTAMP,
            rejected_at         TIMESTAMP,
            doctor_notes        TEXT
        )
    `);

    /* 2. Fix the column default that was shipped as 'VERIFIED' */
    await pool.query(`
        ALTER TABLE diet_recommendations
            ALTER COLUMN verification_status SET DEFAULT 'PENDING'
    `).catch(() => {});

    /* 3. Add CHECK constraint — only PENDING / VERIFIED / REJECTED allowed */
    await pool.query(`
        ALTER TABLE diet_recommendations
            ADD CONSTRAINT diet_rec_status_check
            CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED'))
    `).catch(() => {});   /* catch: constraint already exists on re-run */

    /* 4. Indexes — patient history, appointment lookup, status filter */
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_diet_rec_patient_id
            ON diet_recommendations (patient_id)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_diet_rec_appointment_id
            ON diet_recommendations (appointment_id)
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_diet_rec_patient_status
            ON diet_recommendations (patient_id, verification_status)
    `);

    console.log("✅ diet_recommendations table ready");
}

/* =====================================================
   REQUIRED FIELDS — mirrors the Python service contract
===================================================== */
const REQUIRED_NUMERIC = [
    "age", "height_cm", "weight_kg", "bmi",
    "daily_steps", "exercise_hours", "sleep_hours", "water_intake_liters",
    "fasting_glucose", "hba1c",
    "systolic_bp", "diastolic_bp",
    "total_cholesterol", "ldl", "hdl", "triglycerides",
    "daily_calorie_target"
];

const REQUIRED_CATEGORICAL = [
    "gender",                  // Male | Female
    "activity_level",          // Low | Moderate | High
    "diet_preference",         // Vegetarian | Non-Vegetarian | Vegan
    "diabetes",                // Yes | No
    "hypertension",            // Yes | No
    "cardiovascular_disease",  // Yes | No
    "goal"                     // Weight_Loss | Weight_Maintenance | Muscle_Gain | Healthy_Lifestyle
];

const OPTIONAL_FIELDS = [
    "medical_history", "symptoms", "dietary_restrictions",
    "allergies", "preferred_cuisine", "recommended_food", "meal_type"
];

/* =====================================================
   HELPERS
===================================================== */
function validatePredictBody(body) {
    const errors = [];
    for (const f of REQUIRED_NUMERIC) {
        const v = body[f];
        if (v === undefined || v === null || String(v).trim() === "")
            errors.push(`'${f}' is required.`);
        else if (isNaN(parseFloat(v)))
            errors.push(`'${f}' must be a number.`);
    }
    for (const f of REQUIRED_CATEGORICAL) {
        if (!body[f] || String(body[f]).trim() === "")
            errors.push(`'${f}' is required.`);
    }
    return errors;
}

function buildAiPayload(body) {
    const p = {};
    for (const f of REQUIRED_NUMERIC)    p[f] = parseFloat(body[f]);
    for (const f of REQUIRED_CATEGORICAL) p[f] = String(body[f]).trim();
    for (const f of OPTIONAL_FIELDS) {
        const v = body[f];
        if (v !== undefined && v !== null && String(v).trim() !== "")
            p[f] = String(v).trim();
    }
    return p;
}

/* Resolve visit_id for an appointment — returns null when no visit row exists */
async function resolveVisitId(pool, appointmentId) {
    const r = await pool.query(
        `SELECT id FROM patient_visits WHERE appointment_id = $1 LIMIT 1`,
        [appointmentId]
    ).catch(() => ({ rows: [] }));
    return r.rows[0]?.id ?? null;
}

/* =====================================================
   SERVER-SIDE AUTHORIZATION
   Confirms that:
     1. The appointment exists
     2. The appointment belongs to the stated patient
     3. The doctor_id is the treating doctor on that appointment
   Returns the appointment row on success, null on failure.
===================================================== */
async function authorizeAppointmentDoctor(pool, appointmentId, patientId, doctorId) {
    const r = await pool.query(
        `SELECT id, patient_id, doctor_id
         FROM appointments
         WHERE id = $1`,
        [appointmentId]
    );
    if (!r.rows.length) return { ok: false, reason: "Appointment not found." };

    const appt = r.rows[0];
    if (Number(appt.patient_id) !== Number(patientId))
        return { ok: false, reason: "Appointment does not belong to this patient." };
    if (Number(appt.doctor_id) !== Number(doctorId))
        return { ok: false, reason: "You are not the treating doctor for this appointment." };

    return { ok: true, appt };
}

/* =====================================================
   POST /api/diet/predict
   Stateless — runs the AI model and returns the three
   predictions. Nothing is written to the database.
   The doctor reviews the result and then calls /review.
===================================================== */
router.post("/predict", async (req, res) => {

    const body   = req.body || {};
    const errors = validatePredictBody(body);

    if (errors.length)
        return res.status(422).json({ success: false, message: "Validation failed.", errors });

    try {
        const result = await dietAiService.predictDiet(buildAiPayload(body));
        return res.json({
            success:          true,
            recommended_diet: result.recommended_diet,
            recommended_food: result.recommended_food,
            meal_type:        result.meal_type
        });
    } catch (err) {
        console.error("DIET PREDICT ERROR:", err.message);
        return res.status(502).json({ success: false, message: "Diet AI service unavailable.", error: err.message });
    }

});

/* =====================================================
   POST /api/diet/predict/:patientId
   Profile-assisted variant — merges stored vitals and
   profile from the DB before calling the AI service.
   Body fields always override DB values.
   Nothing is written to the database.
===================================================== */
router.post("/predict/:patientId", async (req, res) => {

    const pool      = req.app.locals.pool;
    const patientId = req.params.patientId;
    const body      = req.body || {};

    try {
        const profileRes = await pool.query(`
            SELECT COALESCE(p.age, u.age)       AS age,
                   COALESCE(p.gender, u.gender) AS gender,
                   p.weight, p.allergies
            FROM users u
            LEFT JOIN patients p ON p.user_id = u.id
            WHERE u.id = $1
        `, [patientId]);

        if (!profileRes.rows.length)
            return res.status(404).json({ success: false, error: "Patient not found." });

        const profile = profileRes.rows[0];

        let vitals = {};
        const vitalsRes = await pool.query(`
            SELECT pv.height_cm, pv.weight_kg, pv.bmi, pv.bp_systolic, pv.bp_diastolic
            FROM patient_visits pv
            JOIN appointments a ON a.id = pv.appointment_id
            WHERE a.patient_id = $1
            ORDER BY pv.created_at DESC LIMIT 1
        `, [patientId]).catch(() => ({ rows: [] }));
        vitals = vitalsRes.rows[0] || {};

        const merged = {
            age:         profile.age,
            height_cm:   vitals.height_cm,
            weight_kg:   vitals.weight_kg ?? profile.weight,
            bmi:         vitals.bmi,
            systolic_bp: vitals.bp_systolic,
            diastolic_bp: vitals.bp_diastolic,
            gender:      profile.gender,
            allergies:   profile.allergies,
            ...body   /* body always wins */
        };

        const errors = validatePredictBody(merged);
        if (errors.length)
            return res.status(422).json({
                success: false,
                message: "Validation failed. Supply the missing fields in the request body.",
                errors
            });

        const result = await dietAiService.predictDiet(buildAiPayload(merged));
        return res.json({
            success:          true,
            patient_id:       parseInt(patientId),
            recommended_diet: result.recommended_diet,
            recommended_food: result.recommended_food,
            meal_type:        result.meal_type
        });

    } catch (err) {
        console.error("DIET PREDICT ERROR:", err.message);
        return res.status(502).json({ success: false, message: "Diet AI service unavailable.", error: err.message });
    }

});

/* =====================================================
   POST /api/diet/review
   The single write endpoint for the doctor's verdict.

   VERIFIED  — permanently saves the recommendation to the
               patient's medical record (verified_at = NOW()).
   REJECTED  — records the rejection (rejected_at = NOW()).
               The row is stored for audit purposes but is
               never surfaced to the patient.

   Authorization rules (server-side, not trust-the-client):
     • doctor_id must be the treating doctor on appointment_id
     • patient_id must match the appointment's patient
     • recommended_diet is required for VERIFIED status

   Each call always inserts a new row — previous visits are
   never overwritten. Idempotency: a second identical VERIFIED
   submission for the same appointment returns the existing
   row rather than inserting a duplicate.

   Body:
     appointment_id   (required)
     patient_id       (required)
     doctor_id        (required)
     status           VERIFIED | REJECTED  (required)
     recommended_diet (required when VERIFIED)
     recommended_food (optional)
     meal_type        (optional)
     doctor_notes     (optional)
===================================================== */
router.post("/review", async (req, res) => {

    const pool = req.app.locals.pool;
    const {
        appointment_id, patient_id, doctor_id,
        status, recommended_diet, recommended_food,
        meal_type, doctor_notes
    } = req.body || {};

    /* ── 1. Input validation ── */
    if (!appointment_id || !patient_id || !doctor_id)
        return res.status(422).json({ success: false, message: "appointment_id, patient_id, and doctor_id are required." });

    if (!["VERIFIED", "REJECTED"].includes(status))
        return res.status(422).json({ success: false, message: "status must be VERIFIED or REJECTED." });

    if (status === "VERIFIED" && (!recommended_diet || !String(recommended_diet).trim()))
        return res.status(422).json({ success: false, message: "recommended_diet is required when verifying." });

    /* ── 2. Server-side authorization ── */
    const auth = await authorizeAppointmentDoctor(pool, appointment_id, patient_id, doctor_id);
    if (!auth.ok)
        return res.status(403).json({ success: false, message: auth.reason });

    try {
        const visitId    = await resolveVisitId(pool, appointment_id);
        const isVerified = status === "VERIFIED";

        /* ── 3. Idempotency — only for VERIFIED rows ── */
        if (isVerified) {
            const dup = await pool.query(`
                SELECT id, recommendation_date, verified_at
                FROM diet_recommendations
                WHERE appointment_id      = $1
                  AND patient_id          = $2
                  AND doctor_id           = $3
                  AND verification_status = 'VERIFIED'
                  AND recommended_diet    = $4
                  AND COALESCE(recommended_food, '') = COALESCE($5, '')
                  AND COALESCE(meal_type, '')        = COALESCE($6, '')
                ORDER BY id DESC LIMIT 1
            `, [appointment_id, patient_id, doctor_id,
                recommended_diet,
                recommended_food || null,
                meal_type        || null]);

            if (dup.rows.length) {
                return res.json({
                    success:   true,
                    duplicate: true,
                    id:        dup.rows[0].id,
                    message:   "This diet recommendation was already verified and saved."
                });
            }
        }

        /* ── 4. Insert — always a new row, never an UPDATE ── */
        const result = await pool.query(`
            INSERT INTO diet_recommendations
                (patient_id, doctor_id, visit_id, appointment_id,
                 recommended_diet, recommended_food, meal_type, doctor_notes,
                 verification_status, verified_at, rejected_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                    $10, $11)
            RETURNING id, verification_status, verified_at, rejected_at,
                      recommendation_date
        `, [
            patient_id,
            doctor_id,
            visitId,
            appointment_id,
            isVerified ? String(recommended_diet).trim() : (recommended_diet || null),
            recommended_food || null,
            meal_type        || null,
            doctor_notes     || null,
            status,
            isVerified ? new Date() : null,   /* verified_at  */
            isVerified ? null : new Date()    /* rejected_at  */
        ]);

        const row = result.rows[0];
        return res.status(201).json({
            success:     true,
            duplicate:   false,
            id:          row.id,
            status:      row.verification_status,
            verified_at: row.verified_at,
            rejected_at: row.rejected_at,
            message: isVerified
                ? "Diet recommendation verified and saved to the patient's medical record."
                : "Diet recommendation rejected and recorded for audit."
        });

    } catch (err) {
        console.error("DIET REVIEW ERROR:", err.message);
        return res.status(500).json({ success: false, message: "Unable to save the diet recommendation." });
    }

});

/* =====================================================
   PATIENT OWNERSHIP GUARD
   Verifies that:
     1. patientId exists and has role = 'patient'
     2. requesterId (from query string) matches patientId
   Returns { ok, status, message } — never throws.
===================================================== */
async function guardPatientOwnership(pool, patientId, requesterId) {
    if (!requesterId || String(requesterId) !== String(patientId))
        return { ok: false, status: 403, message: "Access denied." };

    const r = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND role = 'patient' LIMIT 1`,
        [patientId]
    ).catch(() => ({ rows: [] }));

    if (!r.rows.length)
        return { ok: false, status: 404, message: "Patient not found." };

    return { ok: true };
}

/* =====================================================
   GET /api/diet/history/:patientId
   Returns every VERIFIED recommendation for the patient,
   newest first. Rejected / pending rows are never returned.
   Each visit's recommendation is a separate row — history
   is never overwritten.
   Query param: requesterId — must equal patientId.
===================================================== */
router.get("/history/:patientId", async (req, res) => {

    const pool = req.app.locals.pool;
    const guard = await guardPatientOwnership(pool, req.params.patientId, req.query.requesterId);
    if (!guard.ok) return res.status(guard.status).json({ success: false, message: guard.message });

    try {
        const result = await pool.query(`
            SELECT
                dr.id,
                dr.patient_id,
                dr.doctor_id,
                dr.visit_id,
                dr.appointment_id,
                dr.recommended_diet,
                dr.recommended_food,
                dr.meal_type,
                dr.recommendation_date,
                dr.verification_status,
                dr.verified_at,
                dr.doctor_notes,
                u.name          AS doctor_name,
                d.specialisation AS doctor_specialisation
            FROM diet_recommendations dr
            LEFT JOIN users   u ON u.id = dr.doctor_id
            LEFT JOIN doctors d ON d.user_id = dr.doctor_id
            WHERE dr.patient_id         = $1
              AND dr.verification_status = 'VERIFIED'
            ORDER BY COALESCE(dr.verified_at, dr.recommendation_date) DESC
        `, [req.params.patientId]);

        return res.json({ success: true, recommendations: result.rows });

    } catch (err) {
        console.error("DIET HISTORY ERROR:", err.message);
        return res.status(500).json({ success: false, message: "Unable to load diet recommendation history." });
    }

});

/* =====================================================
   GET /api/diet/latest/:patientId
   Returns the single most recent VERIFIED recommendation.
   Unverified / rejected rows are never returned.
   Query param: requesterId — must equal patientId.
===================================================== */
router.get("/latest/:patientId", async (req, res) => {

    const pool = req.app.locals.pool;
    const guard = await guardPatientOwnership(pool, req.params.patientId, req.query.requesterId);
    if (!guard.ok) return res.status(guard.status).json({ success: false, message: guard.message });

    try {
        const result = await pool.query(`
            SELECT
                dr.id,
                dr.patient_id,
                dr.doctor_id,
                dr.visit_id,
                dr.appointment_id,
                dr.recommended_diet,
                dr.recommended_food,
                dr.meal_type,
                dr.recommendation_date,
                dr.verification_status,
                dr.verified_at,
                dr.doctor_notes,
                u.name          AS doctor_name,
                d.specialisation AS doctor_specialisation
            FROM diet_recommendations dr
            LEFT JOIN users   u ON u.id = dr.doctor_id
            LEFT JOIN doctors d ON d.user_id = dr.doctor_id
            WHERE dr.patient_id         = $1
              AND dr.verification_status = 'VERIFIED'
            ORDER BY COALESCE(dr.verified_at, dr.recommendation_date) DESC
            LIMIT 1
        `, [req.params.patientId]);

        return res.json({
            success:        true,
            recommendation: result.rows[0] ?? null
        });

    } catch (err) {
        console.error("DIET LATEST ERROR:", err.message);
        return res.status(500).json({ success: false, message: "Unable to load the diet recommendation." });
    }

});

/* =====================================================
   GET /api/diet/appointment/:appointmentId
   Returns all recommendations (any status) for a single
   appointment. Used by the doctor's consultation view to
   show what was generated and what was decided.
===================================================== */
router.get("/appointment/:appointmentId", async (req, res) => {

    const pool = req.app.locals.pool;

    try {
        const result = await pool.query(`
            SELECT
                dr.id,
                dr.patient_id,
                dr.doctor_id,
                dr.visit_id,
                dr.recommended_diet,
                dr.recommended_food,
                dr.meal_type,
                dr.recommendation_date,
                dr.verification_status,
                dr.verified_at,
                dr.rejected_at,
                dr.doctor_notes,
                u.name AS doctor_name
            FROM diet_recommendations dr
            LEFT JOIN users u ON u.id = dr.doctor_id
            WHERE dr.appointment_id = $1
            ORDER BY dr.id DESC
        `, [req.params.appointmentId]);

        return res.json({ success: true, recommendations: result.rows });

    } catch (err) {
        console.error("DIET APPOINTMENT FETCH ERROR:", err.message);
        return res.status(500).json({ success: false, message: "Unable to load recommendations for this appointment." });
    }

});

router.initTables = initTables;
module.exports = router;
