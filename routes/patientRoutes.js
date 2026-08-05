const express = require("express");
const router = express.Router();
const aiService = require("../utils/aiService");

/* =====================================================
   PATIENT PROFILE
===================================================== */

router.get("/api/patient/profile/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(
            `
            SELECT
                u.id,
                u.name,
                u.username,
                u.email,
                u.mobile,
                u.role,

                COALESCE(p.age, u.age) as age,
                COALESCE(p.gender, u.gender) as gender,
                COALESCE(p.blood_group, 'Not Provided') as blood_group,
                p.weight,
                p.allergies,
                p.previous_hospital,
                p.address,
                p.photo,

                phi.health_id,

                pmh.family_history,
                pmh.existing_conditions,
                pmh.current_medication,
                pmh.medication_details,
                pmh.allergy_details,

                pl.smoking,
                pl.alcohol,
                pl.physical_activity,
                pl.sleep_hours,
                pl.diet,
                pl.food_habits,
                pl.water_intake,
                pl.stress_level,
                pl.occupation

            FROM users u

            LEFT JOIN patients p
                ON u.id = p.user_id

            LEFT JOIN patient_health_ids phi
                ON phi.user_id = u.id

            LEFT JOIN patient_medical_history pmh
                ON pmh.user_id = u.id

            LEFT JOIN patient_lifestyle pl
                ON pl.user_id = u.id

            WHERE u.id=$1
            `,
            [req.params.id]
        );

        if(result.rows.length===0){

            return res.status(404).json({
                error:"Patient not found"
            });

        }

        const row=result.rows[0];

        res.json({

            user:{
                id:row.id,
                name:row.name,
                username:row.username,
                email:row.email,
                mobile:row.mobile,
                role:row.role
            },

            patient:{
                health_id:row.health_id,
                age:row.age,
                gender:row.gender,
                blood_group:row.blood_group,
                weight:row.weight,
                allergies:row.allergies,
                previous_hospital:row.previous_hospital,
                address:row.address,
                photo:row.photo
            },

            medical_history:{
                family_history:row.family_history,
                existing_conditions:row.existing_conditions,
                current_medication:row.current_medication,
                medication_details:row.medication_details,
                allergy_details:row.allergy_details
            },

            lifestyle:{
                smoking:row.smoking,
                alcohol:row.alcohol,
                physical_activity:row.physical_activity,
                sleep_hours:row.sleep_hours,
                diet:row.diet,
                food_habits:row.food_habits,
                water_intake:row.water_intake,
                stress_level:row.stress_level,
                occupation:row.occupation
            }

        });

    }

    catch(err){

        console.log(err);

        res.status(500).json({
            error:"Server Error"
        });

    }

});


/* =====================================================
   BOOK APPOINTMENT
===================================================== */

router.post("/patient/book-appointment", async (req,res)=>{

    const pool=req.app.locals.pool;

    const{

        doctorId,
        patientId,
        appointmentDate,
        appointmentTime,
        appointmentDay,
        symptoms

    }=req.body || {};

    /* validation */

    if(
        !doctorId ||
        !patientId ||
        !appointmentDate ||
        !appointmentTime
    ){

        return res.status(400).json({

            success:false,
            message:"Missing required fields"

        });

    }

    const client = await pool.connect();

    try{

        /* One transaction per booking. The advisory lock (keyed on
           doctor + date) serializes bookings for the same doctor/day so
           the slot check, queue-number generation and insert are atomic —
           two patients cannot take the same slot or receive the same
           queue number. */

        await client.query("BEGIN");
        await client.query(
            `SELECT pg_advisory_xact_lock(hashtext($1 || '|' || $2))`,
            [String(doctorId), String(appointmentDate)]
        );

        /* Check whether this time slot is already booked on the selected date */

        const slotCheck = await client.query(
            `SELECT id FROM appointments
             WHERE doctor_id = $1
             AND appointment_date = $2
             AND appointment_time = $3
             AND UPPER(status) NOT IN ('CANCELLED')
             FOR UPDATE`,
            [doctorId, appointmentDate, appointmentTime]
        );

        if (slotCheck.rows.length > 0) {

            await client.query("ROLLBACK");
            return res.status(409).json({

                success: false,
                message: "This time slot is already booked. Please choose another slot."

            });

        }

        /* Generate the Queue Number for this doctor + date:
           one more than the highest already booked in appointment order */

        const queueResult = await client.query(`
            SELECT COALESCE(MAX(token_no), 0) + 1 AS queue_no
            FROM appointments
            WHERE doctor_id = $1
            AND appointment_date = $2
        `, [doctorId, appointmentDate]);
        const queueNo = queueResult.rows[0].queue_no;

        /* Department = the doctor's specialisation */

        const deptResult = await client.query(`
            SELECT COALESCE(d.specialisation, 'General') AS department
            FROM users u
            LEFT JOIN doctors d ON d.user_id = u.id
            WHERE u.id = $1
        `, [doctorId]);
        const department = (deptResult.rows[0] && deptResult.rows[0].department) || 'General';

        await client.query(`
            INSERT INTO appointments
            (
                patient_id,
                doctor_id,
                department,
                appointment_date,
                appointment_time,
                token_no,
                status,
                symptoms,
                appointment_day,
                created_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,'Waiting',$7,$8,NOW())
        `, [
            patientId,
            doctorId,
            department,
            appointmentDate,
            appointmentTime,
            queueNo,
            symptoms,
            appointmentDay || null
        ]);

        await client.query("COMMIT");

        res.json({

            success:true,
            token:queueNo,
            queue_no:queueNo

        });

    }

    catch(err){

        try { await client.query("ROLLBACK"); } catch(_){}

        console.log(err);

        res.status(500).json({

            success:false,
            message:"Unable to book appointment"

        });

    }

    finally {

        client.release();

    }

});


/* =====================================================
   MY APPOINTMENTS
===================================================== */

router.get("/patient/appointments/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    const all  = req.query.all === "true";

    try {
        const result = await pool.query(`
            SELECT
    a.id,
    a.doctor_id,
    a.patient_id,
    a.department,
    a.appointment_date,
    a.appointment_time,
    a.token_no,
    a.status,
    a.symptoms,
    a.created_at,
    u.name AS doctor_name
FROM appointments a
JOIN users u
ON u.id = a.doctor_id
WHERE a.patient_id = $1
${all ? "" : "AND UPPER(a.status) NOT IN ('COMPLETED', 'REVIEWED', 'LAB_COMPLETED', 'INPROGRESS', 'CONSULTING')"}
ORDER BY a.appointment_date DESC,
         a.appointment_time DESC;
        `, [req.params.id]);

        res.json(result.rows);

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Server Error" });
    }
});

/* =====================================================
   CANCEL APPOINTMENT (patient)
   Only allowed before the scheduled appointment time.
   Status is set to CANCELLED — the row is kept (history
   is never deleted).
   POST /patient/appointments/cancel/:id  { patientId }
===================================================== */
router.post("/patient/appointments/cancel/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    const appointmentId = parseInt(req.params.id);
    const patientId     = Number((req.body || {}).patientId);

    if (!appointmentId || !patientId) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    try {
        const apptRes = await pool.query(
            `SELECT id, patient_id, appointment_date, appointment_time, status
             FROM appointments WHERE id = $1`,
            [appointmentId]
        );

        if (apptRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Appointment not found" });
        }

        const appt = apptRes.rows[0];

        if (appt.patient_id !== patientId) {
            return res.status(403).json({ success: false, message: "You can only cancel your own appointments" });
        }

        const st = String(appt.status || "").toUpperCase();
        if (st === "CANCELLED" || st === "CANCELED") {
            return res.status(409).json({ success: false, message: "This appointment is already cancelled" });
        }
        if (st === "COMPLETED" || st === "REVIEWED" || st === "LAB_COMPLETED") {
            return res.status(409).json({ success: false, message: "Completed appointments cannot be cancelled" });
        }
        if (st === "CONSULTING" || st === "INPROGRESS") {
            return res.status(409).json({ success: false, message: "Consultation already started; cannot be cancelled" });
        }

        /* Only allow cancellation before the scheduled appointment time */
        const scheduled = new Date(appt.appointment_date);
        const [hh, mm, ss] = String(appt.appointment_time).split(":").map(Number);
        scheduled.setHours(hh, mm, ss || 0, 0);

        if (scheduled.getTime() <= Date.now()) {
            return res.status(400).json({
                success: false,
                message: "This appointment time has already passed and can no longer be cancelled"
            });
        }

        await pool.query(`UPDATE appointments SET status = 'CANCELLED' WHERE id = $1`, [appointmentId]);

        res.json({ success: true, message: "Appointment cancelled" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Unable to cancel appointment" });
    }
});
router.get("/patient/prescriptions/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        /* dispensing_records is lazily created by the pharmacy module;
           guard so patient history still works before it exists */
        let hasDispensing = false;
        try {
            const chk = await pool.query(`SELECT to_regclass('dispensing_records') AS t`);
            hasDispensing = !!(chk.rows[0] && chk.rows[0].t);
        } catch (e) { hasDispensing = false; }

        const dispensingAgg = hasDispensing
            ? `(
                SELECT COALESCE(json_agg(sub ORDER BY sub.id), '[]'::json)
                FROM (
                    SELECT
                        dr.id,
                        dr.quantity_prescribed,
                        dr.quantity_dispensed,
                        dr.medicine_availability,
                        dr.remarks,
                        dr.dispensing_date,
                        ph.name AS pharmacist_name,
                        m.medicine_name
                    FROM dispensing_records dr
                    JOIN users ph     ON ph.id = dr.pharmacist_id
                    JOIN medicines m  ON m.id = dr.medicine_id
                    WHERE dr.prescription_id = p.id
                ) sub
            ) AS dispensing`
            : `'[]'::json AS dispensing`;

        const dispensedCols = hasDispensing
            ? `'dispensed_qty', COALESCE(dr.quantity_dispensed, 0),
               'availability',  COALESCE(dr.medicine_availability, '')`
            : `'dispensed_qty', 0,
               'availability',  ''`;

        const dispensingJoin = hasDispensing
            ? `LEFT JOIN dispensing_records dr ON dr.prescription_medicine_id = pm.id`
            : ``;

        const result = await pool.query(
            `
            SELECT
                p.id,
                p.created_at,
                p.visit_id,
                p.status,
                u.name                  AS doctor_name,
                d.specialisation        AS doctor_specialisation,
                a.appointment_date,
                a.symptoms,
                ${dispensingAgg},
                json_agg(
                    json_build_object(
                        'medicine_name', m.medicine_name,
                        'dosage',        pm.dosage,
                        'frequency',     pm.frequency,
                        'quantity',      pm.quantity,
                        'duration',      pm.duration,
                        'food_timing',   pm.food_timing,
                        'morning',       pm.morning,
                        'afternoon',     pm.afternoon,
                        'night',         pm.night,
                        'special_instructions', pm.special_instructions,
                        ${dispensedCols}
                    )
                    ORDER BY pm.id
                ) AS medicines

            FROM prescriptions p

            JOIN users u
                ON u.id = p.doctor_id

            LEFT JOIN doctors d
                ON d.user_id = p.doctor_id

            LEFT JOIN appointments a
                ON a.id = p.appointment_id

            JOIN prescription_medicines pm
                ON pm.prescription_id = p.id

            JOIN medicines m
                ON m.id = pm.medicine_id

            ${dispensingJoin}

            WHERE p.patient_id = $1

            GROUP BY p.id, u.name, d.specialisation, a.appointment_date, a.symptoms

            ORDER BY p.created_at DESC
            `,
            [req.params.id]
        );

        res.json(result.rows);

    } catch (err) {

        console.log(err);
        res.status(500).json([]);

    }

});
router.get("/patient/billing/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await pool.query(`
            SELECT
                a.id AS appointment_id,
                a.appointment_date,
                du.name AS doctor_name,
                COALESCE(ds.consultation_fee, 0) AS consultation_fee,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'medicine', m.medicine_name,
                            'quantity', pm.quantity,
                            'price', m.price,
                            'total', pm.quantity * m.price
                        )
                    ) FILTER (WHERE m.id IS NOT NULL), '[]'
                ) AS medicines
            FROM appointments a
            JOIN users du ON du.id = a.doctor_id
            LEFT JOIN doctor_schedule ds ON ds.doctor_id = a.doctor_id
            LEFT JOIN prescriptions p ON p.appointment_id = a.id
            LEFT JOIN prescription_medicines pm ON pm.prescription_id = p.id
            LEFT JOIN medicines m ON m.id = pm.medicine_id
            WHERE a.patient_id = $1
            AND UPPER(a.status) IN ('COMPLETED','REVIEWED','LAB_COMPLETED')
            GROUP BY a.id, a.appointment_date, du.name, ds.consultation_fee
            ORDER BY a.appointment_date DESC
        `, [req.params.id]);
        res.json(result.rows);
    } catch(err) {
        console.error(err);
        res.status(500).json([]);
    }
});

router.get("/patient/details/:id", async (req, res) => {
    const pool = req.app.locals.pool;

    const result = await pool.query(
        `
        SELECT
            u.id,
            u.name,
            p.age,
            p.gender,
            p.blood_group
        FROM users u
        LEFT JOIN patients p
            ON u.id = p.user_id
        WHERE u.id = $1
        `,
        [req.params.id]
    );

    if (result.rows.length === 0) {
        return res.status(404).json({ message: "Patient not found" });
    }

    res.json(result.rows[0]);
});

/* =====================================================
   UPDATE PROFILE — mobile + address only
   PATCH /patient/profile/:id
===================================================== */
router.patch("/patient/profile/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    const { mobile, address } = req.body;
    try {
        if (mobile) {
            await pool.query(`UPDATE users SET mobile=$1 WHERE id=$2`, [mobile, req.params.id]);
        }
        if (address !== undefined) {
            await pool.query(
                `UPDATE patients SET address=$1 WHERE user_id=$2`,
                [address, req.params.id]
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error("PROFILE UPDATE ERROR:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   DIABETES PREDICTION
   POST /patient/predict-diabetes/:id
   Body (optional overrides): { glucose_mg_dl, hba1c_percent,
     total_cholesterol_mg_dl, hdl_mg_dl, ldl_mg_dl,
     triglycerides_mg_dl, family_history_diabetes,
     smoking, alcohol, physical_activity, diet_quality,
     sleep_hours, fatigue, excessive_thirst, frequent_urination }
===================================================== */
router.post("/patient/predict-diabetes/:id", async (req, res) => {

    const pool      = req.app.locals.pool;
    const patientId = req.params.id;
    const overrides = req.body || {};

    try {

        /* Pull profile + latest vitals */
        const profileResult = await pool.query(`
            SELECT
                COALESCE(p.age, u.age)       AS age,
                COALESCE(p.gender, u.gender) AS gender
            FROM users u
            LEFT JOIN patients p ON p.user_id = u.id
            WHERE u.id = $1
        `, [patientId]);

        if (!profileResult.rows.length)
            return res.status(404).json({ error: "Patient not found" });

        const profile = profileResult.rows[0];

        const hasVitalsTbl = await pool.query(`SELECT to_regclass('patient_visits') AS t`)
            .then(r => !!r.rows[0].t)
            .catch(() => false);

        let vitals = {};
        if (hasVitalsTbl) {
            const vitalsResult = await pool.query(`
                SELECT pv.bmi, pv.bp_systolic, pv.bp_diastolic, pv.heart_rate
                FROM patient_visits pv
                JOIN appointments a ON a.id = pv.appointment_id
                WHERE a.patient_id = $1
                ORDER BY pv.created_at DESC
                LIMIT 1
            `, [patientId]);
            vitals = vitalsResult.rows[0] || {};
        }

        /* Build feature payload — DB values as defaults, overrides win */
        const payload = {
            age:                     parseFloat(profile.age)          || null,
            gender:                  profile.gender                   || "Unknown",
            bmi:                     parseFloat(vitals.bmi)           || null,
            systolic_bp:             parseInt(vitals.bp_systolic)     || null,
            diastolic_bp:            parseInt(vitals.bp_diastolic)    || null,
            heart_rate:              parseInt(vitals.heart_rate)      || null,
            /* lab / lifestyle fields — must come from overrides */
            glucose_mg_dl:           overrides.glucose_mg_dl           ?? null,
            hba1c_percent:           overrides.hba1c_percent           ?? null,
            total_cholesterol_mg_dl: overrides.total_cholesterol_mg_dl ?? null,
            hdl_mg_dl:               overrides.hdl_mg_dl               ?? null,
            ldl_mg_dl:               overrides.ldl_mg_dl               ?? null,
            triglycerides_mg_dl:     overrides.triglycerides_mg_dl     ?? null,
            family_history_diabetes: overrides.family_history_diabetes ?? "No",
            smoking:                 overrides.smoking                 ?? "No",
            alcohol:                 overrides.alcohol                 ?? "No",
            physical_activity:       overrides.physical_activity       ?? "Moderate",
            diet_quality:            overrides.diet_quality            ?? "Average",
            sleep_hours:             overrides.sleep_hours             ?? null,
            fatigue:                 overrides.fatigue                 ?? 0,
            excessive_thirst:        overrides.excessive_thirst        ?? 0,
            frequent_urination:      overrides.frequent_urination      ?? 0
        };

        /* Call Python Flask model service */
        const result = await aiService.predictDiabetes(payload);

        /* Confidence = how sure the model is of the returned class.
           Derived from the same probability output — no model retraining. */
        const probPct   = Number(result.probability) || 0;
        const confidence = Math.round(Math.max(probPct, 100 - probPct) * 100) / 100;
        const doctorId  = req.body.doctor_id || null;

        /* Create table if not exists, then store prediction permanently */
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_predictions (
                id           SERIAL PRIMARY KEY,
                patient_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                model_type   VARCHAR(50) NOT NULL DEFAULT 'diabetes',
                prediction   VARCHAR(20) NOT NULL,
                probability  NUMERIC(5,2),
                confidence   NUMERIC(5,2),
                doctor_id    INTEGER REFERENCES users(id),
                disease      VARCHAR(100),
                input_data   JSONB,
                explanation  JSONB,
                predicted_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`
            ALTER TABLE ai_predictions ADD COLUMN IF NOT EXISTS confidence  NUMERIC(5,2),
                                        ADD COLUMN IF NOT EXISTS doctor_id   INTEGER REFERENCES users(id),
                                        ADD COLUMN IF NOT EXISTS disease     VARCHAR(100),
                                        ADD COLUMN IF NOT EXISTS explanation JSONB
        `).catch(() => {});

        await pool.query(`
            INSERT INTO ai_predictions (patient_id, model_type, disease, prediction, probability, confidence, doctor_id, input_data, explanation)
            VALUES ($1, 'diabetes', 'Diabetes', $2, $3, $4, $5, $6, $7)
        `, [
            patientId,
            result.prediction,
            result.probability,
            confidence,
            doctorId,
            JSON.stringify(payload),
            JSON.stringify({
                top_features:       result.top_features || [],
                feature_importance: result.feature_importance || [],
                explanation:        result.explanation || ""
            })
        ]);

        res.json({
            patient_id:  parseInt(patientId),
            prediction:  result.prediction,
            probability: result.probability,
            confidence:  confidence,
            threshold:   result.threshold,
            input_used:  payload
        });

    } catch (err) {
        console.error("PREDICT ERROR:", err.message);
        res.status(500).json({ error: err.message });
    }
});

/* =====================================================
   GET PREDICTION HISTORY
   GET /patient/predictions/:id
===================================================== */
router.get("/patient/predictions/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        /* Lazy table + columns so the endpoint is safe on first load */
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_predictions (
                id             SERIAL PRIMARY KEY,
                patient_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                model_type     VARCHAR(50) NOT NULL DEFAULT 'diabetes',
                prediction     VARCHAR(20) NOT NULL,
                probability    NUMERIC(5,2),
                confidence     NUMERIC(5,2),
                doctor_id      INTEGER REFERENCES users(id),
                input_data     JSONB,
                predicted_at   TIMESTAMP DEFAULT NOW()
            )
        `).catch(() => {});
        await pool.query(`
            ALTER TABLE ai_predictions
                ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS visit_id       INTEGER REFERENCES patient_visits(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS doctor_id      INTEGER REFERENCES users(id),
                ADD COLUMN IF NOT EXISTS disease        VARCHAR(100),
                ADD COLUMN IF NOT EXISTS confidence     NUMERIC(5,2),
                ADD COLUMN IF NOT EXISTS explanation    JSONB
        `).catch(() => {});

        const result = await pool.query(`
            SELECT * FROM (
                SELECT DISTINCT ON (COALESCE(ap.appointment_id, 0), COALESCE(ap.disease, ap.model_type, ''))
                    ap.id,
                    ap.appointment_id,
                    ap.visit_id,
                    ap.doctor_id,
                    ap.model_type,
                    ap.disease,
                    ap.prediction,
                    ap.probability,
                    ap.confidence,
                    ap.predicted_at,
                    ap.explanation,
                    u.name AS doctor_name
                FROM ai_predictions ap
                LEFT JOIN users u ON u.id = ap.doctor_id
                WHERE ap.patient_id = $1
                ORDER BY COALESCE(ap.appointment_id, 0), COALESCE(ap.disease, ap.model_type, ''), ap.predicted_at DESC
            ) dedup
            ORDER BY dedup.predicted_at DESC
        `, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        console.error("PREDICTIONS FETCH ERROR:", err.message);
        res.status(500).json([]);
    }
});

/* =====================================================
   AI SUMMARY — collect all patient data for prediction
   GET /patient/ai-summary/:id
===================================================== */
router.get("/patient/ai-summary/:id", async (req, res) => {

    const pool = req.app.locals.pool;
    const patientId = req.params.id;

    try {

        /* 1. Profile */
        const profileResult = await pool.query(`
            SELECT
                u.name,
                u.email,
                u.mobile,
                COALESCE(p.age, u.age)          AS age,
                COALESCE(p.gender, u.gender)    AS gender,
                COALESCE(p.blood_group, 'Unknown') AS blood_group,
                p.weight,
                p.allergies
            FROM users u
            LEFT JOIN patients p ON p.user_id = u.id
            WHERE u.id = $1
        `, [patientId]);

        if (!profileResult.rows.length) {
            return res.status(404).json({ error: "Patient not found" });
        }

        const profile = profileResult.rows[0];

        /* 2. Latest vitals (most recent patient_visits row) */
        let latest_vitals = null;
        const hasVitalsTbl = await pool.query(`SELECT to_regclass('patient_visits') AS t`)
            .then(r => !!r.rows[0].t)
            .catch(() => false);
        if (hasVitalsTbl) {
            const vitalsResult = await pool.query(`
                SELECT
                    pv.height_cm,
                    pv.weight_kg,
                    pv.bmi,
                    pv.bp_systolic,
                    pv.bp_diastolic,
                    pv.heart_rate,
                    pv.temperature_f,
                    pv.created_at AS recorded_at
                FROM patient_visits pv
                JOIN appointments a ON a.id = pv.appointment_id
                WHERE a.patient_id = $1
                ORDER BY pv.created_at DESC
                LIMIT 1
            `, [patientId]);
            latest_vitals = vitalsResult.rows[0] || null;
        }

        /* 3. Prescription history */
        const rxResult = await pool.query(`
            SELECT
                a.appointment_date,
                a.symptoms,
                u.name          AS doctor_name,
                d.specialisation AS doctor_specialisation,
                json_agg(
                    json_build_object(
                        'medicine', m.medicine_name,
                        'dosage',   pm.dosage,
                        'quantity', pm.quantity,
                        'duration', pm.duration
                    ) ORDER BY pm.id
                ) AS medicines
            FROM prescriptions p
            JOIN users u         ON u.id = p.doctor_id
            LEFT JOIN doctors d  ON d.user_id = p.doctor_id
            LEFT JOIN appointments a ON a.id = p.appointment_id
            JOIN prescription_medicines pm ON pm.prescription_id = p.id
            JOIN medicines m    ON m.id = pm.medicine_id
            WHERE p.patient_id = $1
            GROUP BY p.id, a.appointment_date, a.symptoms, u.name, d.specialisation
            ORDER BY p.created_at DESC
        `, [patientId]);

        /* 4. Lab reports */
        const labResult = await pool.query(`
            SELECT
                lr.tests,
                lr.status,
                lr.completed_at,
                u.name AS doctor_name
            FROM lab_requests lr
            LEFT JOIN users u ON u.id = lr.doctor_id
            WHERE lr.patient_id = $1
            AND UPPER(lr.status) IN ('COMPLETED', 'REVIEWED')
            ORDER BY lr.completed_at DESC
        `, [patientId]);

        const lab_reports = labResult.rows.map(r => ({
            ...r,
            tests: Array.isArray(r.tests) ? r.tests
                 : (typeof r.tests === "string" ? JSON.parse(r.tests) : [])
        }));

        /* 5. Appointment history (completed only) */
        const apptResult = await pool.query(`
            SELECT
                a.appointment_date,
                a.appointment_time,
                a.symptoms,
                a.status,
                u.name AS doctor_name
            FROM appointments a
            JOIN users u ON u.id = a.doctor_id
            WHERE a.patient_id = $1
            AND UPPER(a.status) IN ('COMPLETED', 'REVIEWED')
            ORDER BY a.appointment_date DESC
        `, [patientId]);

        /* Assemble final payload */
        const summary = {
            patient_id:   parseInt(patientId),
            profile,
            latest_vitals,
            prescriptions:   rxResult.rows,
            lab_reports,
            appointments:    apptResult.rows,
            generated_at:    new Date().toISOString()
        };

        res.json(summary);

    } catch (err) {
        console.error("AI SUMMARY ERROR:", err.message);
        res.status(500).json({ error: err.message });
    }
});

/* =====================================================
   CONSULTATION TIMELINE (Patient Medical History)
   GET /patient/medical-history/:id

   Groups every consultation by appointment in chronological
   order and exposes, with timestamps on every event:
     - Appointment
     - Vitals
     - Clinical Notes
     - Prescription
     - Laboratory Request
     - Laboratory Report (append-only — every upload is kept,
       never replaced)
     - Pharmacy Dispensing
     - AI Prediction
===================================================== */

async function tableExists(pool, name) {
    const r = await pool.query(`SELECT to_regclass($1) AS t`, [name]);
    return !!(r.rows[0] && r.rows[0].t);
}

router.get("/patient/medical-history/:id", async (req, res) => {

    const pool      = req.app.locals.pool;
    const patientId = req.params.id;

    try {

        const patientRes = await pool.query(`
            SELECT u.id, u.name, phi.health_id, u.email, u.mobile
            FROM users u
            LEFT JOIN patient_health_ids phi ON phi.user_id = u.id
            WHERE u.id = $1
        `, [patientId]);

        if (!patientRes.rows.length) {
            return res.status(404).json({ error: "Patient not found" });
        }

        /* ---- 1. Appointments (chronological) ---- */
        const apptRes = await pool.query(`
            SELECT
                a.id,
                a.appointment_date,
                a.appointment_time,
                a.token_no,
                a.status,
                a.symptoms,
                a.created_at          AS booked_at,
                u.name                AS doctor_name,
                d.specialisation      AS doctor_specialisation
            FROM appointments a
            JOIN users u       ON u.id = a.doctor_id
            LEFT JOIN doctors d ON d.user_id = a.doctor_id
            WHERE a.patient_id = $1
              AND UPPER(a.status) NOT IN ('CANCELLED','CANCELED')
            ORDER BY a.appointment_date ASC, a.appointment_time ASC, a.id ASC
        `, [patientId]);

        /* ---- 2. Vitals (one per consultation/visit) ---- */
        let vitalsByAppt = {};
        const hasVitals = await tableExists(pool, 'patient_visits');
        if (hasVitals) {
            const vitalsRes = await pool.query(`
                SELECT
                    pv.appointment_id,
                    pv.consultation_started_at,
                    pv.consultation_completed_at,
                    pv.created_at,
                    pv.height_cm, pv.weight_kg, pv.bmi,
                    pv.temperature_f, pv.heart_rate, pv.respiratory_rate,
                    pv.spo2, pv.bp_systolic, pv.bp_diastolic,
                    pv.blood_sugar_random, pv.pain_scale
                FROM patient_visits pv
                JOIN appointments a ON a.id = pv.appointment_id
                WHERE a.patient_id = $1
                ORDER BY pv.created_at ASC
            `, [patientId]);
            vitalsByAppt = vitalsRes.rows.reduce((acc, r) => {
                (acc[r.appointment_id] = acc[r.appointment_id] || []).push(r);
                return acc;
            }, {});
        }

        /* ---- 3. Clinical Notes (append-only) ---- */
        let notesByAppt = {};
        const hasNotes = await tableExists(pool, 'clinical_notes');
        if (hasNotes) {
            const notesRes = await pool.query(`
                SELECT
                    cn.id, cn.appointment_id,
                    cn.chief_complaint, cn.present_illness,
                    cn.physical_examination, cn.diagnosis,
                    cn.clinical_impression, cn.advice,
                    cn.follow_up_date, cn.created_at
                FROM clinical_notes cn
                JOIN appointments a ON a.id = cn.appointment_id
                WHERE a.patient_id = $1
                ORDER BY cn.created_at ASC
            `, [patientId]);
            notesByAppt = notesRes.rows.reduce((acc, r) => {
                (acc[r.appointment_id] = acc[r.appointment_id] || []).push(r);
                return acc;
            }, {});
        }

        /* ---- 4. Prescriptions + medicines + dispensing ---- */
        const hasDispensing = await tableExists(pool, 'dispensing_records');
        let rxByAppt = {};
        const hasPrescriptions = await tableExists(pool, 'prescriptions');
        if (hasPrescriptions) {

            const medicinesAgg = hasDispensing
                ? `
                    (
                        SELECT COALESCE(json_agg(sub ORDER BY sub.id), '[]'::json)
                        FROM (
                            SELECT
                                pm.id, m.medicine_name,
                                pm.dosage, pm.frequency, pm.quantity, pm.duration,
                                pm.food_timing, pm.morning, pm.afternoon, pm.night,
                                pm.special_instructions,
                                COALESCE(dr.quantity_dispensed, 0) AS dispensed_qty,
                                COALESCE(dr.medicine_availability, '') AS availability
                            FROM prescription_medicines pm
                            JOIN medicines m ON m.id = pm.medicine_id
                            LEFT JOIN dispensing_records dr ON dr.prescription_medicine_id = pm.id
                            WHERE pm.prescription_id = p.id
                        ) sub
                    ) AS medicines
                `
                : `
                    (
                        SELECT COALESCE(json_agg(sub ORDER BY sub.id), '[]'::json)
                        FROM (
                            SELECT
                                pm.id, m.medicine_name,
                                pm.dosage, pm.frequency, pm.quantity, pm.duration,
                                pm.food_timing, pm.morning, pm.afternoon, pm.night,
                                pm.special_instructions,
                                0 AS dispensed_qty,
                                '' AS availability
                            FROM prescription_medicines pm
                            JOIN medicines m ON m.id = pm.medicine_id
                            WHERE pm.prescription_id = p.id
                        ) sub
                    ) AS medicines
                `;

            const dispensingAgg = hasDispensing
                ? `
                    (
                        SELECT COALESCE(json_agg(sub2 ORDER BY sub2.dispensing_date, sub2.id), '[]'::json)
                        FROM (
                            SELECT
                                dr.id, m2.medicine_name,
                                dr.quantity_prescribed, dr.quantity_dispensed,
                                dr.medicine_availability, dr.remarks, dr.dispensing_date,
                                ph.name AS pharmacist_name
                            FROM dispensing_records dr
                            JOIN medicines m2 ON m2.id = dr.medicine_id
                            JOIN users ph     ON ph.id = dr.pharmacist_id
                            WHERE dr.prescription_id = p.id
                        ) sub2
                    ) AS dispensing
                `
                : `'[]'::json AS dispensing`;

            const rxRes = await pool.query(`
                SELECT
                    p.id, p.appointment_id, p.visit_id,
                    p.created_at, p.status,
                    ${medicinesAgg},
                    ${dispensingAgg}
                FROM prescriptions p
                JOIN appointments a ON a.id = p.appointment_id
                WHERE a.patient_id = $1
                ORDER BY p.created_at ASC
            `, [patientId]);

            rxByAppt = rxRes.rows.reduce((acc, r) => {
                (acc[r.appointment_id] = acc[r.appointment_id] || []).push(r);
                return acc;
            }, {});
        }

        /* ---- 5. Lab requests + reports (append-only) ---- */
        let labByAppt = {};
        const hasLabRequests = await tableExists(pool, 'lab_requests');
        if (hasLabRequests) {

            const reportsAgg = await tableExists(pool, 'lab_request_reports')
                ? `
                    (
                        SELECT COALESCE(json_agg(sub ORDER BY sub.id), '[]'::json)
                        FROM (
                            SELECT
                                rr.id, rr.test_name, rr.report_file,
                                rr.upload_date,
                                tu.name AS technician_name
                            FROM lab_request_reports rr
                            LEFT JOIN users tu ON tu.id = rr.lab_technician_id
                            WHERE rr.lab_request_id = lr.id
                        ) sub
                    ) AS reports
                `
                : `'[]'::json AS reports`;

            const labRes = await pool.query(`
                SELECT
                    lr.id, lr.appointment_id, lr.visit_id,
                    lr.tests, lr.priority, lr.clinical_notes,
                    lr.status, lr.created_at, lr.completed_at,
                    lr.report_file,
                    du.name AS doctor_name,
                    ${reportsAgg}
                FROM lab_requests lr
                JOIN appointments a ON a.id = lr.appointment_id
                LEFT JOIN users du  ON du.id = lr.doctor_id
                WHERE a.patient_id = $1
                ORDER BY lr.created_at ASC
            `, [patientId]);

            labByAppt = labRes.rows.reduce((acc, r) => {
                const row = { ...r, tests: Array.isArray(r.tests) ? r.tests : (typeof r.tests === 'string' ? JSON.parse(r.tests) : []) };
                (acc[row.appointment_id] = acc[row.appointment_id] || []).push(row);
                return acc;
            }, {});
        }

        /* ---- 6. AI Predictions ---- */
        let aiPredictions = [];
        const hasAi = await tableExists(pool, 'ai_predictions');
        if (hasAi) {
            await pool.query(`
                ALTER TABLE ai_predictions
                    ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
                    ADD COLUMN IF NOT EXISTS visit_id       INTEGER REFERENCES patient_visits(id) ON DELETE SET NULL,
                    ADD COLUMN IF NOT EXISTS doctor_id      INTEGER REFERENCES users(id),
                    ADD COLUMN IF NOT EXISTS disease        VARCHAR(100),
                    ADD COLUMN IF NOT EXISTS confidence     NUMERIC(5,2),
                    ADD COLUMN IF NOT EXISTS explanation    JSONB
            `).catch(() => {});
            const aiRes = await pool.query(`
                SELECT * FROM (
                    SELECT DISTINCT ON (COALESCE(ap.appointment_id, 0), COALESCE(ap.disease, ap.model_type, ''))
                        ap.id,
                        ap.appointment_id,
                        ap.visit_id,
                        ap.doctor_id,
                        ap.model_type,
                        ap.disease,
                        ap.prediction,
                        ap.probability,
                        ap.confidence,
                        ap.explanation,
                        ap.predicted_at,
                        u.name AS doctor_name
                    FROM ai_predictions ap
                    LEFT JOIN users u ON u.id = ap.doctor_id
                    WHERE ap.patient_id = $1
                    ORDER BY COALESCE(ap.appointment_id, 0), COALESCE(ap.disease, ap.model_type, ''), ap.predicted_at DESC
                ) dedup
                ORDER BY dedup.predicted_at DESC
            `, [patientId]);
            aiPredictions = aiRes.rows;
        }

        /* ---- Assemble visits ---- */
        const visits = apptRes.rows.map(a => ({
            appointment: {
                id: a.id,
                date: a.appointment_date,
                time: a.appointment_time,
                token_no: a.token_no,
                status: a.status,
                symptoms: a.symptoms,
                booked_at: a.booked_at,
                doctor_name: a.doctor_name,
                doctor_specialisation: a.doctor_specialisation
            },
            vitals:        (vitalsByAppt[a.id] || [])[0] || null,
            notes:         notesByAppt[a.id] || [],
            prescription:  (rxByAppt[a.id] || [])[0] || null,
            lab_requests:  labByAppt[a.id] || []
        }));

        res.json({
            patient: {
                id: patientRes.rows[0].id,
                name: patientRes.rows[0].name,
                health_id: patientRes.rows[0].health_id,
                email: patientRes.rows[0].email,
                mobile: patientRes.rows[0].mobile
            },
            visits,
            ai_predictions: aiPredictions
        });

    }

    catch (err) {
        console.error("MEDICAL HISTORY ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }

});

/* =====================================================
   PATIENT TIMELINE
   GET /patient/timeline/:id
   Returns every visit (newest first) with all events:
   appointment, vitals, clinical notes, prescription,
   lab requests + reports, medicine dispensing, AI prediction.
   Supports query filters: doctor_id, department, date, visit_id
===================================================== */
router.get("/patient/timeline/:id", async (req, res) => {

    const pool      = req.app.locals.pool;
    const patientId = req.params.id;
    const { doctor_id, department, date, visit_id } = req.query;

    try {

        /* ---- Appointments ---- */
        let apptWhere = `a.patient_id = $1 AND UPPER(a.status) NOT IN ('CANCELLED','CANCELED')`;
        const apptParams = [patientId];
        let pi = 2;
        if (doctor_id)   { apptWhere += ` AND a.doctor_id = $${pi++}`;         apptParams.push(doctor_id); }
        if (department)  { apptWhere += ` AND LOWER(a.department) = LOWER($${pi++})`; apptParams.push(department); }
        if (date)        { apptWhere += ` AND a.appointment_date = $${pi++}`;  apptParams.push(date); }
        if (visit_id)    { apptWhere += ` AND a.id = $${pi++}`;                apptParams.push(visit_id); }

        const apptRes = await pool.query(`
            SELECT
                a.id, a.appointment_date, a.appointment_time, a.token_no,
                a.status, a.symptoms, a.created_at AS booked_at, a.department,
                u.id AS doctor_id, u.name AS doctor_name,
                d.specialisation AS doctor_specialisation
            FROM appointments a
            JOIN users u       ON u.id = a.doctor_id
            LEFT JOIN doctors d ON d.user_id = a.doctor_id
            WHERE ${apptWhere}
            ORDER BY a.appointment_date DESC, a.appointment_time DESC, a.id DESC
        `, apptParams);

        if (!apptRes.rows.length) return res.json({ visits: [] });

        const apptIds = apptRes.rows.map(r => r.id);
        const inList  = apptIds.map((_, i) => `$${i + 1}`).join(',');

        /* ---- Vitals ---- */
        let vitalsByAppt = {};
        const hasVitals = await tableExists(pool, 'patient_visits');
        if (hasVitals) {
            const r = await pool.query(
                `SELECT * FROM patient_visits WHERE appointment_id IN (${inList}) ORDER BY created_at ASC`,
                apptIds
            );
            r.rows.forEach(row => { vitalsByAppt[row.appointment_id] = row; });
        }

        /* ---- Clinical Notes ---- */
        let notesByAppt = {};
        const hasNotes = await tableExists(pool, 'clinical_notes');
        if (hasNotes) {
            const r = await pool.query(
                `SELECT * FROM clinical_notes WHERE appointment_id IN (${inList}) ORDER BY created_at ASC`,
                apptIds
            );
            r.rows.forEach(row => {
                (notesByAppt[row.appointment_id] = notesByAppt[row.appointment_id] || []).push(row);
            });
        }

        /* ---- Prescriptions + medicines + dispensing ---- */
        let rxByAppt = {};
        const hasDispensing    = await tableExists(pool, 'dispensing_records');
        const hasPrescriptions = await tableExists(pool, 'prescriptions');
        if (hasPrescriptions) {
            const medicinesAgg = hasDispensing
                ? `(SELECT COALESCE(json_agg(sub ORDER BY sub.id),'[]'::json) FROM (
                       SELECT pm.id, m.medicine_name, pm.dosage, pm.frequency, pm.quantity, pm.duration,
                              pm.food_timing, pm.morning, pm.afternoon, pm.night, pm.special_instructions,
                              COALESCE(dr.quantity_dispensed,0) AS dispensed_qty,
                              COALESCE(dr.medicine_availability,'') AS availability
                       FROM prescription_medicines pm
                       JOIN medicines m ON m.id = pm.medicine_id
                       LEFT JOIN dispensing_records dr ON dr.prescription_medicine_id = pm.id
                       WHERE pm.prescription_id = p.id) sub) AS medicines`
                : `(SELECT COALESCE(json_agg(sub ORDER BY sub.id),'[]'::json) FROM (
                       SELECT pm.id, m.medicine_name, pm.dosage, pm.frequency, pm.quantity, pm.duration,
                              pm.food_timing, pm.morning, pm.afternoon, pm.night, pm.special_instructions,
                              0 AS dispensed_qty, '' AS availability
                       FROM prescription_medicines pm
                       JOIN medicines m ON m.id = pm.medicine_id
                       WHERE pm.prescription_id = p.id) sub) AS medicines`;

            const dispensingAgg = hasDispensing
                ? `(SELECT COALESCE(json_agg(sub2 ORDER BY sub2.dispensing_date,sub2.id),'[]'::json) FROM (
                       SELECT dr.id, m2.medicine_name, dr.quantity_prescribed, dr.quantity_dispensed,
                              dr.medicine_availability, dr.remarks, dr.dispensing_date, ph.name AS pharmacist_name
                       FROM dispensing_records dr
                       JOIN medicines m2 ON m2.id = dr.medicine_id
                       JOIN users ph     ON ph.id = dr.pharmacist_id
                       WHERE dr.prescription_id = p.id) sub2) AS dispensing`
                : `'[]'::json AS dispensing`;

            const r = await pool.query(
                `SELECT p.id, p.appointment_id, p.visit_id, p.created_at, p.status,
                        ${medicinesAgg}, ${dispensingAgg}
                 FROM prescriptions p
                 WHERE p.appointment_id IN (${inList})
                 ORDER BY p.created_at ASC`,
                apptIds
            );
            r.rows.forEach(row => { rxByAppt[row.appointment_id] = row; });
        }

        /* ---- Lab requests + reports ---- */
        let labByAppt = {};
        const hasLab = await tableExists(pool, 'lab_requests');
        if (hasLab) {
            const reportsAgg = await tableExists(pool, 'lab_request_reports')
                ? `(SELECT COALESCE(json_agg(sub ORDER BY sub.id),'[]'::json) FROM (
                       SELECT rr.id, rr.test_name, rr.report_file, rr.upload_date, tu.name AS technician_name
                       FROM lab_request_reports rr
                       LEFT JOIN users tu ON tu.id = rr.lab_technician_id
                       WHERE rr.lab_request_id = lr.id) sub) AS reports`
                : `'[]'::json AS reports`;

            const r = await pool.query(
                `SELECT lr.id, lr.appointment_id, lr.visit_id, lr.tests, lr.priority,
                        lr.clinical_notes, lr.status, lr.created_at, lr.completed_at,
                        lr.report_file, du.name AS doctor_name, ${reportsAgg}
                 FROM lab_requests lr
                 LEFT JOIN users du ON du.id = lr.doctor_id
                 WHERE lr.appointment_id IN (${inList})
                 ORDER BY lr.created_at ASC`,
                apptIds
            );
            r.rows.forEach(row => {
                const parsed = { ...row, tests: Array.isArray(row.tests) ? row.tests : (typeof row.tests === 'string' ? JSON.parse(row.tests) : []) };
                (labByAppt[row.appointment_id] = labByAppt[row.appointment_id] || []).push(parsed);
            });
        }

        /* ---- AI Predictions (keyed by appointment_id) ---- */
        let aiByAppt = {};
        const hasAi = await tableExists(pool, 'ai_predictions');
        if (hasAi) {
            await pool.query(`
                ALTER TABLE ai_predictions
                    ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
                    ADD COLUMN IF NOT EXISTS visit_id       INTEGER REFERENCES patient_visits(id) ON DELETE SET NULL,
                    ADD COLUMN IF NOT EXISTS doctor_id      INTEGER REFERENCES users(id),
                    ADD COLUMN IF NOT EXISTS disease        VARCHAR(100),
                    ADD COLUMN IF NOT EXISTS confidence     NUMERIC(5,2),
                    ADD COLUMN IF NOT EXISTS explanation    JSONB
            `).catch(() => {});
            const r = await pool.query(
                `SELECT * FROM (
                    SELECT DISTINCT ON (ap.appointment_id, COALESCE(ap.disease, ap.model_type, ''))
                        ap.id, ap.appointment_id, ap.visit_id, ap.doctor_id, ap.model_type,
                        ap.disease, ap.prediction, ap.probability, ap.confidence, ap.explanation, ap.predicted_at,
                        u.name AS doctor_name
                    FROM ai_predictions ap
                    LEFT JOIN users u ON u.id = ap.doctor_id
                    WHERE ap.appointment_id IN (${inList})
                    ORDER BY ap.appointment_id, COALESCE(ap.disease, ap.model_type, ''), ap.predicted_at DESC
                ) dedup
                ORDER BY dedup.predicted_at DESC`,
                apptIds
            );
            r.rows.forEach(row => {
                (aiByAppt[row.appointment_id] = aiByAppt[row.appointment_id] || []).push(row);
            });
        }

        /* ---- Assemble visits (newest first — already sorted by query) ---- */
        const visits = apptRes.rows.map(a => ({
            appointment: {
                id:                   a.id,
                date:                 a.appointment_date,
                time:                 a.appointment_time,
                token_no:             a.token_no,
                status:               a.status,
                symptoms:             a.symptoms,
                booked_at:            a.booked_at,
                department:           a.department,
                doctor_id:            a.doctor_id,
                doctor_name:          a.doctor_name,
                doctor_specialisation: a.doctor_specialisation
            },
            vitals:       vitalsByAppt[a.id] || null,
            notes:        notesByAppt[a.id]  || [],
            prescription: rxByAppt[a.id]     || null,
            lab_requests: labByAppt[a.id]    || [],
            ai_predictions: aiByAppt[a.id]   || []
        }));

        res.json({ visits });

    } catch (err) {
        console.error("TIMELINE ERROR:", err.message);
        res.status(500).json({ error: "Server Error" });
    }
});

module.exports = router;