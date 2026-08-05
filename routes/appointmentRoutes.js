const express = require("express");
const router = express.Router();
const aiService = require("../utils/aiService");

/* =====================================================
   PATIENT VISITS TABLE (lazily created)
   One visit entry per consultation (per appointment).
   Previous visit records are never overwritten — a new
   consultation always creates a new visit row.
===================================================== */
async function ensureVisitTable(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS patient_visits (
            id                        SERIAL PRIMARY KEY,
            appointment_id            INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
            patient_id                INTEGER REFERENCES users(id) ON DELETE CASCADE,
            doctor_id                 INTEGER REFERENCES users(id) ON DELETE CASCADE,
            status                    VARCHAR(20) DEFAULT 'CONSULTING',
            consultation_started_at   TIMESTAMP,
            consultation_completed_at TIMESTAMP,
            height_cm                 NUMERIC(5,1),
            weight_kg                 NUMERIC(5,1),
            bmi                       NUMERIC(4,1),
            temperature_f             NUMERIC(4,1),
            heart_rate                INTEGER,
            respiratory_rate          INTEGER,
            spo2                      INTEGER,
            bp_systolic               INTEGER,
            bp_diastolic              INTEGER,
            blood_sugar_random        NUMERIC(6,1),
            pain_scale                INTEGER,
            created_at                TIMESTAMP DEFAULT NOW()
        )
    `);
}

/* =====================================================
   CLINICAL NOTES TABLE (lazily created)
   Append-only: every save creates a new note row for the
   consultation. Older notes are never overwritten.
   Fields: Chief Complaint, Present Illness, Physical Exam,
   Diagnosis, Clinical Impression, Advice, Follow-up Date.
===================================================== */
async function ensureClinicalNotesTable(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS clinical_notes (
            id                   SERIAL PRIMARY KEY,
            appointment_id       INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
            patient_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
            doctor_id            INTEGER REFERENCES users(id) ON DELETE CASCADE,
            chief_complaint      TEXT,
            present_illness      TEXT,
            physical_examination TEXT,
            diagnosis            TEXT,
            clinical_impression  TEXT,
            advice               TEXT,
            follow_up_date       DATE,
            created_at           TIMESTAMP DEFAULT NOW()
        )
    `);
}

/* =====================================================
   SAVE VITALS (shared by the vitals route and the
   Complete Consultation flow)
   Vitals are stored on the visit entry (one per
   consultation). Values entered but not yet saved are
   persisted so no entered information is lost.
===================================================== */
async function saveVitalsForAppointment(pool, appointmentId, v) {
    await ensureVisitTable(pool);

    const h = parseFloat(v.height);
    const w = parseFloat(v.weight);
    const bmi = (h > 0 && w > 0)
        ? parseFloat((w / ((h / 100) * (h / 100))).toFixed(1))
        : null;

    await pool.query(`
        INSERT INTO patient_visits (appointment_id, patient_id, doctor_id, status, consultation_started_at)
        SELECT a.id, a.patient_id, a.doctor_id, 'CONSULTING', NOW()
        FROM appointments a WHERE a.id=$1
        ON CONFLICT (appointment_id) DO NOTHING
    `, [appointmentId]);

    await pool.query(`
        UPDATE patient_visits
        SET height_cm = $2,
            weight_kg = $3,
            bmi = $4,
            temperature_f = $5,
            heart_rate = $6,
            respiratory_rate = $7,
            spo2 = $8,
            bp_systolic = $9,
            bp_diastolic = $10,
            blood_sugar_random = $11,
            pain_scale = $12,
            status = 'CONSULTING'
        WHERE appointment_id = $1
    `, [
        appointmentId,
        h   || null,
        w   || null,
        bmi,
        v.temperature ? parseFloat(v.temperature) : null,
        v.heart_rate ? parseInt(v.heart_rate) : null,
        v.respiratory_rate ? parseInt(v.respiratory_rate) : null,
        v.spo2 ? parseInt(v.spo2) : null,
        v.bp_systolic ? parseInt(v.bp_systolic) : null,
        v.bp_diastolic ? parseInt(v.bp_diastolic) : null,
        v.blood_sugar ? parseFloat(v.blood_sugar) : null,
        v.pain_scale !== "" && v.pain_scale != null ? parseInt(v.pain_scale) : null
    ]);

    return bmi;
}

/* True when an object has at least one non-empty value */
function hasAnyValue(obj) {
    return !!obj && Object.values(obj).some(val => val !== undefined && val !== null && String(val).trim() !== "");
}

/* =====================================================
   SAVE CLINICAL NOTES (shared by the notes route and the
   Complete Consultation flow)
   Append-only: each save creates a NEW note row. The
   note includes Diagnosis and Follow-up Date.
===================================================== */
async function saveClinicalNotesForAppointment(pool, appointmentId, appt, n) {
    await ensureClinicalNotesTable(pool);
    await pool.query(`
        INSERT INTO clinical_notes (
            appointment_id, patient_id, doctor_id,
            chief_complaint, present_illness, physical_examination,
            diagnosis, clinical_impression, advice, follow_up_date
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
        appointmentId,
        appt.patient_id,
        appt.doctor_id,
        n.chief_complaint         || null,
        n.present_illness         || null,
        n.physical_examination    || null,
        n.diagnosis               || null,
        n.clinical_impression     || null,
        n.advice                  || null,
        n.follow_up_date          || null
    ]);
}

/* =====================================================
   MARK CONSULTATION COMPLETED (shared)
   - Appointment status → COMPLETED  (unlocks the patient
     from the CONSULTING hold)
   - Records consultation end time on the visit entry
   - The patient automatically moves to the Completed
     queue (the dashboard buckets by appointment status)
===================================================== */
async function markConsultationCompleted(pool, appointmentId) {
    await ensureVisitTable(pool);

    await pool.query(`
        INSERT INTO patient_visits (appointment_id, patient_id, doctor_id, status, consultation_started_at)
        SELECT a.id, a.patient_id, a.doctor_id, 'CONSULTING', NOW()
        FROM appointments a WHERE a.id=$1
        ON CONFLICT (appointment_id) DO NOTHING
    `, [appointmentId]);

    await pool.query(
        `UPDATE appointments SET status='COMPLETED' WHERE id=$1`,
        [appointmentId]
    );

    await pool.query(`
        UPDATE patient_visits
        SET status='COMPLETED', consultation_completed_at=NOW()
        WHERE appointment_id=$1
    `, [appointmentId]);
}

/* =====================================================
   CONSULTATION DATASET TABLE (lazily created)
   One prepared JSON dataset per completed consultation.
   The dataset is assembled automatically after the
   consultation from stored patient data — it is NOT a
   prediction. Prediction runs later from this payload.
===================================================== */
async function ensureConsultationDatasetTable(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS consultation_datasets (
            id             SERIAL PRIMARY KEY,
            appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
            patient_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
            doctor_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
            dataset        JSONB NOT NULL,
            created_at     TIMESTAMP DEFAULT NOW()
        )
    `);
}

/* True when a cell has a non-empty value */
function hasValue(v) {
    return v !== undefined && v !== null && String(v).trim() !== "";
}

/* Split free text (comma / newline separated) into a clean array */
function toList(value) {
    if (Array.isArray(value)) return value.map(x => String(x).trim()).filter(Boolean);
    if (!hasValue(value)) return [];
    return String(value)
        .split(/[\n,;]+/)
        .map(x => x.trim())
        .filter(Boolean);
}

/* Family-history flag — true when the source text/array mentions the condition */
function familyFlag(source, keyword) {
    const haystack = Array.isArray(source)
        ? source.join(" ")
        : String(source || "");
    return new RegExp(keyword, "i").test(haystack);
}

/* =====================================================
   BUILD CONSULTATION DATASET  (automatic, NO prediction)
   Assembles a JSON object for the given appointment from
   the patient's stored data:
     Patient Information — age, gender, lifestyle
       (smoking, alcohol, physical activity, diet quality,
        sleep hours, stress level, occupation)
     Vitals — height, weight, BMI, temperature,
       blood pressure, heart rate, blood sugar
     Medical History — existing diseases, current
       medications, family history (diabetes, hypertension,
       heart disease, stroke, kidney disease)
   Falls back from the legacy tables (users/patients,
   patient_lifestyle, patient_medical_history) to the new
   system tables (pat_*) matched by mobile when the legacy
   lifestyle/history is empty.
   Stores the payload in consultation_datasets and returns it.
===================================================== */
async function buildConsultationDataset(pool, appointmentId) {
    await ensureConsultationDatasetTable(pool);

    /* Appointment + patient profile (legacy keyed by user_id) */
    const apptRes = await pool.query(`
        SELECT a.id, a.patient_id, a.doctor_id, a.symptoms,
               u.name AS patient_name, u.mobile,
               COALESCE(p.age, u.age)       AS age,
               COALESCE(p.gender, u.gender) AS gender,
               phi.health_id AS patient_health_id
        FROM appointments a
        JOIN users u ON u.id = a.patient_id
        LEFT JOIN patients p ON p.user_id = a.patient_id
        LEFT JOIN patient_health_ids phi ON phi.user_id = a.patient_id
        WHERE a.id = $1
    `, [appointmentId]);

    if (!apptRes.rows.length)
        throw new Error("Appointment not found");

    const a = apptRes.rows[0];

    /* Vitals — stored on the visit row for this consultation */
    const visitRes = await pool.query(
        `SELECT * FROM patient_visits WHERE appointment_id = $1`,
        [appointmentId]
    );
    const v = visitRes.rows[0] || {};

    /* Lifestyle + medical history — legacy first */
    const [lsRes, mhRes] = await Promise.all([
        pool.query(`SELECT * FROM patient_lifestyle WHERE user_id = $1`, [a.patient_id]),
        pool.query(`SELECT * FROM patient_medical_history WHERE user_id = $1`, [a.patient_id])
    ]);
    let ls = lsRes.rows[0] || {};
    let mh = mhRes.rows[0] || {};

    /* Fall back to the new system tables (pat_*) matched by mobile
       when legacy lifestyle / medical history are empty */
    let newFh = [];
    if ((!Object.keys(ls).some(k => hasValue(ls[k])) || !Object.keys(mh).some(k => hasValue(mh[k]))) && hasValue(a.mobile)) {
        const patRes = await pool.query(
            `SELECT patient_id FROM pat_patients WHERE mobile = $1 LIMIT 1`, [a.mobile]
        );
        if (patRes.rows.length) {
            const pid = patRes.rows[0].patient_id;
            const [pls, pmh, pfh] = await Promise.all([
                pool.query(`SELECT * FROM pat_lifestyle WHERE patient_id = $1`, [pid]),
                pool.query(`SELECT * FROM pat_medical_history WHERE patient_id = $1`, [pid]),
                pool.query(`SELECT conditions FROM pat_family_history WHERE patient_id = $1`, [pid])
            ]);
            if (!Object.keys(ls).some(k => hasValue(ls[k])))
                ls = pls.rows[0] || {};
            if (!Object.keys(mh).some(k => hasValue(mh[k])))
                mh = pmh.rows[0] || {};
            newFh = (pfh.rows[0] || {}).conditions || [];
        }
    }

    /* Diet quality lives under `diet` in the legacy table */
    const dietQuality = hasValue(ls.diet_quality) ? ls.diet_quality : ls.diet;

    /* Family history — merge legacy text with new-system array */
    const fhSources = [mh.family_history, newFh];

    const dataset = {
        appointment_id:      Number(appointmentId),
        patient_id:          a.patient_id,
        patient_name:        a.patient_name,
        patient_health_id:   a.patient_health_id || null,
        doctor_id:           a.doctor_id,
        symptoms:            a.symptoms || null,
        prepared_at:         new Date().toISOString(),
        patient_information: {
            age:      a.age != null ? Number(a.age) : null,
            gender:   a.gender || null,
            lifestyle: {
                smoking:           ls.smoking           || null,
                alcohol:           ls.alcohol           || null,
                physical_activity: ls.physical_activity || null,
                diet_quality:      dietQuality          || null,
                sleep_hours:       ls.sleep_hours       || null,
                stress_level:      ls.stress_level      || null,
                occupation:        ls.occupation        || null
            }
        },
        vitals: {
            height_cm:      v.height_cm       != null ? Number(v.height_cm)      : null,
            weight_kg:      v.weight_kg       != null ? Number(v.weight_kg)      : null,
            bmi:            v.bmi             != null ? Number(v.bmi)            : null,
            temperature_f:  v.temperature_f   != null ? Number(v.temperature_f)  : null,
            blood_pressure: {
                systolic:  v.bp_systolic  != null ? Number(v.bp_systolic)  : null,
                diastolic: v.bp_diastolic != null ? Number(v.bp_diastolic) : null
            },
            heart_rate:       v.heart_rate       != null ? Number(v.heart_rate)       : null,
            blood_sugar_random: v.blood_sugar_random != null ? Number(v.blood_sugar_random) : null
        },
        medical_history: {
            existing_diseases:   toList(mh.existing_conditions || mh.existing_diseases),
            current_medications: toList(mh.current_medications || mh.medication_details || mh.medications),
            family_history: {
                diabetes:      familyFlag(fhSources, "diabetes"),
                hypertension:  familyFlag(fhSources, "hypertension|high blood pressure"),
                heart_disease: familyFlag(fhSources, "heart"),
                stroke:        familyFlag(fhSources, "stroke"),
                kidney_disease:familyFlag(fhSources, "kidney|renal")
            }
        }
    };

    await pool.query(`
        INSERT INTO consultation_datasets (appointment_id, patient_id, doctor_id, dataset)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (appointment_id)
        DO UPDATE SET patient_id=$2, doctor_id=$3, dataset=$4, created_at=NOW()
    `, [appointmentId, a.patient_id, a.doctor_id, JSON.stringify(dataset)]);

    return dataset;
}

/* =====================================================
   MAP CONSULTATION DATASET → MODEL FEATURES
   Translates the prepared patient JSON into the feature
   payload expected by the Python Diabetes model
   (diabetes_api.py /predict). Missing lab fields default
   to null; lifestyle fields default to safe values so the
   model always receives a complete feature vector.
===================================================== */
function datasetToFeatures(dataset) {
    const pi = dataset.patient_information || {};
    const ls = pi.lifestyle || {};
    const vt = dataset.vitals || {};
    const bp = vt.blood_pressure || {};
    const mh = dataset.medical_history || {};
    const fh = mh.family_history || {};

    return {
        age:                     pi.age != null ? Number(pi.age) : null,
        gender:                  pi.gender || "Unknown",
        bmi:                     vt.bmi != null ? Number(vt.bmi) : null,
        systolic_bp:             bp.systolic != null ? Number(bp.systolic) : null,
        diastolic_bp:            bp.diastolic != null ? Number(bp.diastolic) : null,
        heart_rate:              vt.heart_rate != null ? Number(vt.heart_rate) : null,
        glucose_mg_dl:           vt.blood_sugar_random != null ? Number(vt.blood_sugar_random) : null,
        hba1c_percent:           null,
        total_cholesterol_mg_dl: null,
        hdl_mg_dl:               null,
        ldl_mg_dl:               null,
        triglycerides_mg_dl:     null,
        family_history_diabetes: fh.diabetes ? "Yes" : "No",
        smoking:                 ls.smoking || "No",
        alcohol:                 ls.alcohol || "No",
        physical_activity:       ls.physical_activity || "Moderate",
        diet_quality:            ls.diet_quality || "Average",
        sleep_hours:             ls.sleep_hours || null,
        fatigue:                 0,
        excessive_thirst:        0,
        frequent_urination:      0
    };
}

/* =====================================================
   MAP CONSULTATION DATASET → HYPERTENSION MODEL FEATURES
   Translates the prepared patient JSON into the feature
   payload expected by the Python Hypertension model
   (diabetes_api.py /predict/hypertension). Lab fields not
   captured during consultation default to null.
   ===================================================== */
function datasetToHypertensionFeatures(dataset) {
    const pi = dataset.patient_information || {};
    const ls = pi.lifestyle || {};
    const vt = dataset.vitals || {};
    const bp = vt.blood_pressure || {};
    const mh = dataset.medical_history || {};
    const fh = mh.family_history || {};

    return {
        age:                     pi.age != null ? Number(pi.age) : null,
        gender:                  pi.gender || "Male",
        bmi:                     vt.bmi != null ? Number(vt.bmi) : null,
        systolic_bp:             bp.systolic != null ? Number(bp.systolic) : null,
        diastolic_bp:            bp.diastolic != null ? Number(bp.diastolic) : null,
        heart_rate:              vt.heart_rate != null ? Number(vt.heart_rate) : null,
        total_cholesterol_mg_dl: null,
        hdl_mg_dl:               null,
        ldl_mg_dl:               null,
        triglycerides_mg_dl:     null,
        creatinine_mg_dl:        null,
        family_history_hypertension: fh.hypertension ? "Yes" : "No",
        smoking:                 ls.smoking || "No",
        alcohol:                 ls.alcohol || "No",
        physical_activity:       ls.physical_activity || "Moderate",
        diet_quality:            ls.diet_quality || "Average",
        sleep_hours:             ls.sleep_hours != null ? Number(ls.sleep_hours) : null,
        headache:                0,
        dizziness:               0,
        chest_pain:              0,
        breathlessness:          0
    };
}

/* =====================================================
   MAP CONSULTATION DATASET → CARDIOVASCULAR MODEL FEATURES
   Translates the prepared patient JSON into the feature
   payload expected by the Python Cardiovascular model
   (diabetes_api.py /predict/cardiovascular). The model uses
   Kaggle CVD-format values (gender 1=male / 2=female,
   binary 0/1 flags). Fields not captured during consultation
   default to the neutral model defaults.
   ===================================================== */
function datasetToCardiovascularFeatures(dataset) {
    const pi = dataset.patient_information || {};
    const ls = pi.lifestyle || {};
    const vt = dataset.vitals || {};
    const bp = vt.blood_pressure || {};

    const flagged = (v) => /^(yes|current|regular)$/i.test(String(v || ""));

    return {
        age:         pi.age != null ? Number(pi.age) : null,
        gender:      /^f/i.test(String(pi.gender || "")) ? 2 : 1,
        height:      vt.height_cm != null ? Number(vt.height_cm) : null,
        weight:      vt.weight_kg != null ? Number(vt.weight_kg) : null,
        ap_hi:       bp.systolic != null ? Number(bp.systolic) : null,
        ap_lo:       bp.diastolic != null ? Number(bp.diastolic) : null,
        cholesterol: 1,
        gluc:        1,
        smoke:       flagged(ls.smoking) ? 1 : 0,
        alco:        flagged(ls.alcohol) ? 1 : 0,
        active:      /^(moderate|high|active|regular)$/i.test(String(ls.physical_activity || "")) ? 1 : 0
    };
}

/* =====================================================
   RUN DIABETES PREDICTION FOR A CONSULTATION
   POST /appointment/predict/:appointmentId
   Uses the prepared consultation dataset (no retraining,
   no direct .pkl access). Node sends the feature JSON to
   the Python prediction API and returns:
     prediction, risk probability, confidence score.
   The result is also stored in ai_predictions.
===================================================== */
async function runConsultationPrediction(pool, appointmentId) {
    /* Prepare the patient-data JSON (same builder as completion) */
    const dataset = await buildConsultationDataset(pool, appointmentId);

    const payload = datasetToFeatures(dataset);

    /* Send to the Python AI service — Node never loads the .pkl */
    const result = await aiService.predictDiabetes(payload);

    /* Confidence = how sure the model is of the returned class */
    const probPct    = Number(result.probability) || 0;
    const confidence = Math.round(Math.max(probPct, 100 - probPct) * 100) / 100;
    const doctorId   = dataset.doctor_id || null;

    /* Ensure table exists with all required columns — never overwrites rows */
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_predictions (
            id             SERIAL PRIMARY KEY,
            patient_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
            visit_id       INTEGER REFERENCES patient_visits(id) ON DELETE SET NULL,
            doctor_id      INTEGER REFERENCES users(id),
            model_type     VARCHAR(50) NOT NULL DEFAULT 'diabetes',
            disease        VARCHAR(100),
            prediction     VARCHAR(20) NOT NULL,
            probability    NUMERIC(5,2),
            confidence     NUMERIC(5,2),
            input_data     JSONB,
            explanation    JSONB,
            predicted_at   TIMESTAMP DEFAULT NOW()
        )
    `);
    /* Add any columns that may be missing from older table versions */
    await pool.query(`
        ALTER TABLE ai_predictions
            ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS visit_id       INTEGER REFERENCES patient_visits(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS doctor_id      INTEGER REFERENCES users(id),
            ADD COLUMN IF NOT EXISTS disease        VARCHAR(100),
            ADD COLUMN IF NOT EXISTS confidence     NUMERIC(5,2),
            ADD COLUMN IF NOT EXISTS explanation    JSONB
    `).catch(() => {});

    /* Resolve the visit_id for this appointment */
    const visitRes = await pool.query(
        `SELECT id FROM patient_visits WHERE appointment_id = $1 LIMIT 1`,
        [appointmentId]
    ).catch(() => ({ rows: [] }));
    const visitId = visitRes.rows[0]?.id || null;

    /* INSERT — never UPDATE, so every prediction run is kept permanently */
    await pool.query(`
        INSERT INTO ai_predictions
            (patient_id, appointment_id, visit_id, doctor_id,
             model_type, disease, prediction, probability, confidence, input_data, explanation)
        VALUES ($1, $2, $3, $4, 'diabetes', 'Diabetes', $5, $6, $7, $8, $9)
    `, [
        dataset.patient_id,
        Number(appointmentId),
        visitId,
        doctorId,
        result.prediction,
        result.probability,
        confidence,
        JSON.stringify(payload),
        JSON.stringify({
            top_features:       result.top_features || [],
            feature_importance: result.feature_importance || [],
            explanation:        result.explanation || ""
        })
    ]);

    return {
        success:        true,
        appointment_id: Number(appointmentId),
        visit_id:       visitId,
        patient_id:     dataset.patient_id,
        patient_name:   dataset.patient_name,
        doctor_id:      doctorId,
        disease:        'Diabetes',
        prediction:     result.prediction,
        probability:    result.probability,
        confidence:     confidence,
        threshold:      result.threshold,
        input_used:     payload
    };
}

/* =====================================================
   RUN UNIFIED DISEASE RISK PREDICTION FOR A CONSULTATION
   POST /appointment/predict-disease-risk/:appointmentId
   Builds ONE patient JSON and sends it (mapped to each
   model's feature format) to all three Python AI endpoints
   — Diabetes, Hypertension, Cardiovascular — in parallel
   via Promise.all. Waits for every result, saves all three
   predictions into ai_predictions and returns a single
   Disease Risk Summary.
   ===================================================== */
async function runDiseaseRiskPrediction(pool, appointmentId) {
    /* Prepare the single patient JSON (same builder as completion) */
    const dataset = await buildConsultationDataset(pool, appointmentId);

    const models = [
        { model_type: 'diabetes',       disease: 'Diabetes',               payload: datasetToFeatures(dataset) },
        { model_type: 'hypertension',   disease: 'Hypertension',           payload: datasetToHypertensionFeatures(dataset) },
        { model_type: 'cardiovascular', disease: 'Cardiovascular Disease', payload: datasetToCardiovascularFeatures(dataset) }
    ];

    /* Fire all three Python calls in parallel and wait for every one */
    const results = await Promise.all(models.map(m => {
        const fn = {
            diabetes:       aiService.predictDiabetes,
            hypertension:   aiService.predictHypertension,
            cardiovascular: aiService.predictCardiovascular
        }[m.model_type];
        return fn(m.payload);
    }));

    results.forEach((r, i) => { models[i].result = r; });

    const doctorId = dataset.doctor_id || null;

    /* Ensure table exists with all required columns — never overwrites rows */
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_predictions (
            id             SERIAL PRIMARY KEY,
            patient_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
            visit_id       INTEGER REFERENCES patient_visits(id) ON DELETE SET NULL,
            doctor_id      INTEGER REFERENCES users(id),
            model_type     VARCHAR(50) NOT NULL DEFAULT 'diabetes',
            disease        VARCHAR(100),
            prediction     VARCHAR(20) NOT NULL,
            probability    NUMERIC(5,2),
            confidence     NUMERIC(5,2),
            input_data     JSONB,
            explanation    JSONB,
            predicted_at   TIMESTAMP DEFAULT NOW()
        )
    `);
    /* Add any columns that may be missing from older table versions */
    await pool.query(`
        ALTER TABLE ai_predictions
            ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS visit_id       INTEGER REFERENCES patient_visits(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS doctor_id      INTEGER REFERENCES users(id),
            ADD COLUMN IF NOT EXISTS disease        VARCHAR(100),
            ADD COLUMN IF NOT EXISTS confidence     NUMERIC(5,2),
            ADD COLUMN IF NOT EXISTS explanation    JSONB
    `).catch(() => {});

    /* Resolve the visit_id for this appointment */
    const visitRes = await pool.query(
        `SELECT id FROM patient_visits WHERE appointment_id = $1 LIMIT 1`,
        [appointmentId]
    ).catch(() => ({ rows: [] }));
    const visitId = visitRes.rows[0]?.id || null;

    /* Store every prediction run permanently (never UPDATE) */
    for (const m of models) {
        const rawProb = Number(m.result.probability);
        const probability = isNaN(rawProb) ? null
            : Math.round((rawProb <= 1 ? rawProb * 100 : rawProb) * 100) / 100;
        const confidence = m.result.confidence != null ? Number(m.result.confidence) : null;

        await pool.query(`
            INSERT INTO ai_predictions
                (patient_id, appointment_id, visit_id, doctor_id,
                 model_type, disease, prediction, probability, confidence, input_data, explanation)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
            dataset.patient_id,
            Number(appointmentId),
            visitId,
            doctorId,
            m.model_type,
            m.disease,
            m.result.prediction,
            probability,
            confidence,
            JSON.stringify(m.payload),
            JSON.stringify({
                top_features:       m.result.top_features || [],
                feature_importance: m.result.feature_importance || [],
                explanation:        m.result.explanation || ""
            })
        ]);
    }

    return {
        success:        true,
        appointment_id: Number(appointmentId),
        visit_id:       visitId,
        patient_id:     dataset.patient_id,
        patient_name:   dataset.patient_name,
        doctor_id:      doctorId,
        predicted_at:   new Date().toISOString(),
        results:        models.map(m => ({
            model_type:  m.model_type,
            disease:     m.disease,
            prediction:  m.result.prediction,
            probability: (() => {
                const p = Number(m.result.probability);
                return isNaN(p) ? null : Math.round((p <= 1 ? p * 100 : p) * 100) / 100;
            })(),
            confidence:  m.result.confidence != null ? Number(m.result.confidence) : null,
            top_features:       m.result.top_features || [],
            feature_importance: m.result.feature_importance || [],
            explanation:        m.result.explanation || ""
        }))
    };
}

/* =====================================================
   START CONSULTATION
   - Sets appointment status to CONSULTING
   - Records consultation start time (in the visit entry)
   - Locks the appointment so it cannot be started twice
   Body: { doctor_id } (optional, enforces the lock)
===================================================== */

router.post("/start/:id", async (req, res) => {

    const pool = req.app.locals.pool;
    const appointmentId = req.params.id;
    const doctorId = Number((req.body || {}).doctor_id);

    try{

        const cur = await pool.query(
            `SELECT id, patient_id, doctor_id, status FROM appointments WHERE id=$1`,
            [appointmentId]
        );
        if (!cur.rows.length)
            return res.status(404).json({ success: false, message: "Appointment not found" });

        const a = cur.rows[0];
        const st = String(a.status || "").toUpperCase();

        /* Lock: only a Waiting (or Lab-Ready) appointment can be opened for consultation */
        if (st === "CONSULTING" || st === "INPROGRESS") {
            /* Same doctor resuming is allowed; a different doctor is blocked */
            if (doctorId && a.doctor_id && doctorId !== Number(a.doctor_id))
                return res.status(403).json({ success: false, locked: true, message: "This consultation is already open by another doctor." });
            await ensureVisitTable(pool);
            await pool.query(`
                INSERT INTO patient_visits (appointment_id, patient_id, doctor_id, status, consultation_started_at)
                VALUES ($1,$2,$3,'CONSULTING',NOW())
                ON CONFLICT (appointment_id) DO NOTHING
            `, [appointmentId, a.patient_id, a.doctor_id]);
            return res.json({ success: true, alreadyActive: true });
        }

        if (st !== "WAITING" && st !== "LAB_READY")
            return res.status(409).json({ success: false, locked: true, message: "This appointment cannot be started (current status: " + (a.status || "?") + ")." });

        await ensureVisitTable(pool);

        await pool.query(
            `UPDATE appointments SET status='CONSULTING' WHERE id=$1`,
            [appointmentId]
        );

        /* Each consultation creates a new visit entry with its start time */
        await pool.query(`
            INSERT INTO patient_visits (appointment_id, patient_id, doctor_id, status, consultation_started_at)
            VALUES ($1,$2,$3,'CONSULTING',NOW())
            ON CONFLICT (appointment_id) DO NOTHING
        `, [appointmentId, a.patient_id, a.doctor_id]);

        res.json({
            success:true
        });

    }

    catch(err){

        console.log(err);

        res.status(500).json({
            success:false
        });

    }

});

/* =====================================================
   GET APPOINTMENT DETAILS
===================================================== */

router.get("/details/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try{

        const result = await pool.query(

            `
            SELECT

                a.id,

                a.patient_id,

                a.doctor_id,

                a.symptoms,

                a.status,

                lr.report_file,

                lr.tests,

                (
                    SELECT COALESCE(
                        json_agg(
                            json_build_object(
                                'id',          rr.id,
                                'test_name',   rr.test_name,
                                'report_file', rr.report_file,
                                'upload_date', rr.upload_date
                            )
                            ORDER BY rr.id
                        ),
                        '[]'
                    )
                    FROM lab_request_reports rr
                    WHERE rr.lab_request_id = lr.id
                ) AS lab_reports,

                u.name AS patient_name,

                p.age,

                p.gender,

                p.blood_group

            FROM appointments a

            JOIN users u
                ON u.id=a.patient_id

            LEFT JOIN patients p
                ON p.user_id=a.patient_id

            LEFT JOIN lab_requests lr
                ON lr.appointment_id=a.id
                AND UPPER(lr.status) IN ('COMPLETED','REVIEWED')

            WHERE a.id=$1

            ORDER BY lr.id DESC

            LIMIT 1

            `,

            [req.params.id]

        );

        res.json(result.rows[0]);

    }

    catch(err){

        console.log(err);

        res.status(500).json({});

    }

});

/* =====================================================
   COMPLETE NORMAL CONSULTATION
   POST /appointment/complete/:id
   Body (optional): {
       vitals: { height, weight, temperature, heart_rate,
                 respiratory_rate, spo2, bp_systolic,
                 bp_diastolic, blood_sugar, pain_scale },
       notes:  { chief_complaint, present_illness,
                 physical_examination, diagnosis,
                 clinical_impression, advice, follow_up_date }
   }
   Flow:
   1. Saves any entered (but not yet saved) vitals
   2. Saves any entered clinical notes (append-only;
      includes Diagnosis and Follow-up Date)
   3. Appointment status → COMPLETED
   4. Records consultation end time (visit entry)
   5. Unlocks the patient (CONSULTING hold released) —
      the patient automatically moves to Completed queue
   The prescription is created automatically by the
   Prescription window (status = Pending in Pharmacy), so
   it is never duplicated here.
===================================================== */

router.post("/complete/:id", async (req, res) => {

    const pool = req.app.locals.pool;
    const appointmentId = req.params.id;
    const { vitals, notes } = req.body || {};

    try{

        const cur = await pool.query(
            `SELECT id, patient_id, doctor_id FROM appointments WHERE id=$1`,
            [appointmentId]
        );
        if (!cur.rows.length)
            return res.status(404).json({ success: false, message: "Appointment not found" });

        if (hasAnyValue(vitals))
            await saveVitalsForAppointment(pool, appointmentId, vitals);

        if (hasAnyValue(notes))
            await saveClinicalNotesForAppointment(pool, appointmentId, cur.rows[0], notes);

        await markConsultationCompleted(pool, appointmentId);

        /* Automatically prepare the patient-data JSON (no prediction) */
        let dataset = null;
        try {
            dataset = await buildConsultationDataset(pool, appointmentId);
        } catch (e) {
            console.error("DATASET BUILD ERROR:", e.message);
        }

        res.json({
            success: true,
            dataset
        });

    }

    catch(err){

        console.log(err);

        res.status(500).json({

            success:false

        });

    }

});

/* =====================================================
   CONFIRM CONSULTATION AFTER LAB REPORT
===================================================== */

router.post("/confirm-lab/:appointmentId", async (req,res)=>{

    const pool = req.app.locals.pool;
    const appointmentId = req.params.appointmentId;
    const { vitals, notes } = req.body || {};

    try{

        const cur = await pool.query(
            `SELECT id, patient_id, doctor_id FROM appointments WHERE id=$1`,
            [appointmentId]
        );
        if (!cur.rows.length)
            return res.status(404).json({ success: false, message: "Appointment not found" });

        // Mark lab request reviewed

        await pool.query(

            `
            UPDATE lab_requests
            SET status='REVIEWED'
            WHERE appointment_id=$1
            `,

            [appointmentId]

        );

        // Save any entered vitals / clinical notes (never lose data)

        if (hasAnyValue(vitals))
            await saveVitalsForAppointment(pool, appointmentId, vitals);

        if (hasAnyValue(notes))
            await saveClinicalNotesForAppointment(pool, appointmentId, cur.rows[0], notes);

        // Complete the appointment, record end time and unlock the patient

        await markConsultationCompleted(pool, appointmentId);

        /* Automatically prepare the patient-data JSON (no prediction) */
        let dataset = null;
        try {
            dataset = await buildConsultationDataset(pool, appointmentId);
        } catch (e) {
            console.error("DATASET BUILD ERROR:", e.message);
        }

        res.json({
            success: true,
            dataset
        });

    }

    catch(err){

        console.log(err);

        res.status(500).json({

            success:false

        });

    }

});

/* =====================================================
   SAVE VITALS (per consultation -> Visit entry)
   POST /appointment/vitals/:appointmentId
   Body: { height, weight, temperature, heart_rate,
           respiratory_rate, spo2, bp_systolic, bp_diastolic,
           blood_sugar, pain_scale }
   Each consultation owns one visit row (keyed by
   appointment_id). Previous consultations keep their own
   visit entries and are never overwritten.
===================================================== */
router.post("/vitals/:appointmentId", async (req, res) => {

    const pool = req.app.locals.pool;
    const appointmentId = req.params.appointmentId;
    const {
        height, weight, temperature, heart_rate,
        respiratory_rate, spo2, bp_systolic, bp_diastolic,
        blood_sugar, pain_scale
    } = req.body;

    try {

        const bmi = await saveVitalsForAppointment(pool, appointmentId, {
            height, weight, temperature, heart_rate,
            respiratory_rate, spo2, bp_systolic, bp_diastolic,
            blood_sugar, pain_scale
        });

        res.json({ success: true, bmi });

    } catch (err) {
        console.error("VITALS ERROR:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   GET VITALS
   GET /appointment/vitals/:appointmentId
   Returns the current visit's vitals for this consultation.
===================================================== */
router.get("/vitals/:appointmentId", async (req, res) => {

    const pool = req.app.locals.pool;

    try {
        await ensureVisitTable(pool);
        const result = await pool.query(`
            SELECT * FROM patient_visits WHERE appointment_id = $1
        `, [req.params.appointmentId]);

        res.json(result.rows[0] || {});
    } catch (err) {
        res.json({});
    }
});

/* =====================================================
   SAVE CLINICAL NOTES (append-only per consultation)
   POST /appointment/notes/:appointmentId
   Body: { chief_complaint, present_illness,
           physical_examination, diagnosis,
           clinical_impression, advice, follow_up_date }
   Every save creates a NEW note row — older notes are
   never overwritten.
===================================================== */
router.post("/notes/:appointmentId", async (req, res) => {

    const pool = req.app.locals.pool;
    const appointmentId = req.params.appointmentId;
    const {
        chief_complaint, present_illness, physical_examination,
        diagnosis, clinical_impression, advice, follow_up_date
    } = req.body;

    try {

        const cur = await pool.query(
            `SELECT id, patient_id, doctor_id FROM appointments WHERE id=$1`,
            [appointmentId]
        );
        if (!cur.rows.length)
            return res.status(404).json({ success: false, message: "Appointment not found" });

        const a = cur.rows[0];

        await saveClinicalNotesForAppointment(pool, appointmentId, a, {
            chief_complaint, present_illness, physical_examination,
            diagnosis, clinical_impression, advice, follow_up_date
        });

        res.json({ success: true });

    } catch (err) {
        console.error("CLINICAL NOTES ERROR:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   GET PREPARED CONSULTATION DATASET
   GET /appointment/dataset/:appointmentId
   Returns the prepared patient-data JSON for this
   consultation (built on demand — no prediction).
===================================================== */
router.get("/dataset/:appointmentId", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const dataset = await buildConsultationDataset(pool, req.params.appointmentId);
        res.json({ success: true, dataset });
    } catch (err) {
        console.error("DATASET FETCH ERROR:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   RUN DIABETES PREDICTION
   POST /appointment/predict/:appointmentId
   Sends the prepared patient JSON to the Python API and
   returns Prediction / Risk Probability / Confidence.
===================================================== */
router.post("/predict/:appointmentId", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await runConsultationPrediction(pool, req.params.appointmentId);
        res.json(result);
    } catch (err) {
        console.error("PREDICT ERROR:", err.message);
        res.status(502).json({ success: false, message: err.message });
    }
});

/* =====================================================
   RUN UNIFIED DISEASE RISK PREDICTION
   POST /appointment/predict-disease-risk/:appointmentId
   Predicts Diabetes + Hypertension + Cardiovascular in
   parallel and returns a single Disease Risk Summary.
   ===================================================== */
router.post("/predict-disease-risk/:appointmentId", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await runDiseaseRiskPrediction(pool, req.params.appointmentId);
        res.json(result);
    } catch (err) {
        console.error("DISEASE RISK PREDICTION ERROR:", err.message);
        res.status(502).json({ success: false, message: err.message });
    }
});

/* =====================================================
   GET CLINICAL NOTES for an appointment (all, oldest first)
===================================================== */
router.get("/notes/:appointmentId", async (req, res) => {    const pool = req.app.locals.pool;

    try {
        await ensureClinicalNotesTable(pool);
        const result = await pool.query(`
            SELECT id, appointment_id, patient_id, doctor_id,
                   chief_complaint, present_illness, physical_examination,
                   diagnosis, clinical_impression, advice,
                   to_char(follow_up_date, 'YYYY-MM-DD') AS follow_up_date,
                   created_at
            FROM clinical_notes
            WHERE appointment_id = $1
            ORDER BY id ASC
        `, [req.params.appointmentId]);

        res.json(result.rows);
    } catch (err) {
        console.error("CLINICAL NOTES FETCH ERROR:", err.message);
        res.json([]);
    }
});

module.exports = router;