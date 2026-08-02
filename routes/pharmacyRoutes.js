const express = require("express");
const router = express.Router();

/* =====================================================
   PRESCRIPTION SCHEMA (idempotent, run at startup)
   - prescriptions:   visit_id + prescription_date
   - prescription_medicines: clinical fields + the
     connecting ids (Patient ID, Doctor ID, Visit ID,
     Prescription Date) so every medicine row is fully
     traceable on its own.
===================================================== */
async function initPrescriptionSchema(pool) {
    await pool.query(`
        ALTER TABLE prescriptions
            ADD COLUMN IF NOT EXISTS visit_id          INTEGER,
            ADD COLUMN IF NOT EXISTS prescription_date DATE DEFAULT CURRENT_DATE
    `);
    await pool.query(`
        ALTER TABLE prescription_medicines
            ADD COLUMN IF NOT EXISTS dosage               VARCHAR(100),
            ADD COLUMN IF NOT EXISTS frequency            VARCHAR(100),
            ADD COLUMN IF NOT EXISTS duration             VARCHAR(100),
            ADD COLUMN IF NOT EXISTS quantity             INTEGER,
            ADD COLUMN IF NOT EXISTS food_timing          VARCHAR(20),
            ADD COLUMN IF NOT EXISTS morning              BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS afternoon            BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS night                BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS special_instructions TEXT,
            ADD COLUMN IF NOT EXISTS patient_id           INTEGER,
            ADD COLUMN IF NOT EXISTS doctor_id            INTEGER,
            ADD COLUMN IF NOT EXISTS visit_id             INTEGER,
            ADD COLUMN IF NOT EXISTS prescription_date    DATE
    `);
}

/* =====================================================
   DISPENSING SCHEMA (idempotent, run lazily on demand)
   - dispensing_records: permanent, append-only history of
     every dispense action. Captures Pharmacist ID,
     Dispensing Date, Medicine Availability, Remarks and
     the quantity actually dispensed (partial allowed).
   - prescriptions gains dispensed_at / dispensed_by /
     completed_at so the pharmacy state is fully auditable.
===================================================== */
async function initDispensingSchema(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS dispensing_records (
            id                       SERIAL PRIMARY KEY,
            prescription_id          INTEGER REFERENCES prescriptions(id) ON DELETE CASCADE,
            prescription_medicine_id INTEGER,
            patient_id               INTEGER,
            doctor_id                INTEGER,
            visit_id                 INTEGER,
            pharmacist_id            INTEGER,
            medicine_id              INTEGER,
            quantity_prescribed      INTEGER,
            quantity_dispensed       INTEGER,
            medicine_availability    VARCHAR(20),
            remarks                  TEXT,
            dispensing_date          TIMESTAMP DEFAULT NOW(),
            created_at               TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE prescriptions
            ADD COLUMN IF NOT EXISTS dispensed_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS dispensed_by  INTEGER,
            ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMP
    `);
}

/* Ensure the visit table exists (same shape as appointmentRoutes) */
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

/* Resolve (or create) the Visit ID for an appointment */
async function resolveVisitId(pool, appointmentId, patientId, doctorId) {
    if (!appointmentId) return null;
    await ensureVisitTable(pool);
    const found = await pool.query(`
        SELECT id FROM patient_visits WHERE appointment_id=$1
    `, [appointmentId]);
    if (found.rows.length) return found.rows[0].id;
    const created = await pool.query(`
        INSERT INTO patient_visits (appointment_id, patient_id, doctor_id, status, consultation_started_at)
        VALUES ($1,$2,$3,'CONSULTING',NOW())
        ON CONFLICT (appointment_id) DO NOTHING
        RETURNING id
    `, [appointmentId, patientId, doctorId]);
    if (created.rows.length) return created.rows[0].id;
    const again = await pool.query(`SELECT id FROM patient_visits WHERE appointment_id=$1`, [appointmentId]);
    return again.rows[0].id;
}

/* GET MEDICINES (LIVE STOCK) */
router.get("/medicines", async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const result = await pool.query(`
            SELECT
    id,
    medicine_name AS name,
    type,
    price,
    quantity AS stock_quantity
FROM medicines
ORDER BY medicine_name
LIMIT 100;
        `);

        res.json(result.rows);
    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});

/* DEDUCT STOCK */
router.post("/medicine/deduct-stock", async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const { name, quantity } = req.body;

        const result = await pool.query(`
            SELECT quantity
            FROM medicines
            WHERE medicine_name = $1
        `, [name]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Medicine not found" });
        }

        const currentStock = result.rows[0].quantity;

        if (currentStock < quantity) {
            return res.status(400).json({ message: "Insufficient stock" });
        }

        await pool.query(`
            UPDATE medicines
            SET quantity = quantity - $1
            WHERE medicine_name = $2
        `, [quantity, name]);

        res.json({ success: true });

    } catch (err) {
        console.log(err);
        res.status(500).json({ message: "Server error" });
    }
});
router.get("/pharmacy/prescriptions", async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        await initDispensingSchema(pool);
        const result = await pool.query(`
            SELECT
                p.id            AS prescription_id,
                p.status,
                p.created_at,
                p.prescription_date,
                p.visit_id,
                p.patient_id,
                p.dispensed_at,
                p.dispensed_by,
                p.completed_at,
                phi.health_id   AS patient_id_display,
                pu.name         AS patient_name,
                du.name         AS doctor_name,
                a.appointment_date,
                a.symptoms,
                (SELECT COALESCE(json_agg(sub ORDER BY sub.id), '[]'::json) FROM (
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
                ) sub) AS dispensing,
                json_agg(
                    json_build_object(
                        'id',                pm.id,
                        'medicine_name',     m.medicine_name,
                        'quantity',          pm.quantity,
                        'dosage',            pm.dosage,
                        'frequency',         pm.frequency,
                        'duration',          pm.duration,
                        'food_timing',       pm.food_timing,
                        'morning',           pm.morning,
                        'afternoon',         pm.afternoon,
                        'night',             pm.night,
                        'special_instructions', pm.special_instructions,
                        'price',             m.price,
                        'total',             pm.quantity * m.price,
                        'stock',             m.quantity,
                        'dispensed_qty',     COALESCE(dr.quantity_dispensed, 0),
                        'availability',      COALESCE(dr.medicine_availability,
                            CASE
                                WHEN m.quantity >= pm.quantity THEN 'Available'
                                WHEN m.quantity > 0 THEN 'Low Stock'
                                ELSE 'Out of Stock'
                            END)
                    ) ORDER BY pm.id
                ) AS medicines,
                SUM(pm.quantity * m.price) AS grand_total
            FROM prescriptions p
            JOIN prescription_medicines pm ON pm.prescription_id = p.id
            JOIN medicines m               ON m.id = pm.medicine_id
            JOIN users pu                  ON pu.id = p.patient_id
            JOIN users du                  ON du.id = p.doctor_id
            LEFT JOIN appointments a        ON a.id = p.appointment_id
            LEFT JOIN patient_health_ids phi ON phi.user_id = p.patient_id
            LEFT JOIN dispensing_records dr ON dr.prescription_medicine_id = pm.id
            GROUP BY p.id, pu.name, du.name, phi.health_id, a.appointment_date, a.symptoms
            ORDER BY p.created_at DESC
        `);

        res.json(result.rows);

    } catch (err) {
        console.log(err);
        res.status(500).json([]);
    }
});

/* =====================================================
   DISPENSE PRESCRIPTION
   POST /pharmacy/dispense
   Body: {
       prescriptionId, pharmacistId, remarks,
       items: [ { prescriptionMedicineId, quantityDispensed } ]
   }
   - Verifies stock availability for every medicine BEFORE
     dispensing (records Available / Low Stock / Out of Stock)
   - Allows partial dispensing — records the quantity actually
     dispensed for each medicine (0 = not dispensed)
   - Deducts stock only for what is actually dispensed
   - Stores every record permanently (dispensing history)
   - Sets prescription status: Pending → Dispensed
===================================================== */
router.post("/pharmacy/dispense", async (req, res) => {

    const pool = req.app.locals.pool;
    const { prescriptionId, pharmacistId, remarks, items } = req.body || {};

    if (!prescriptionId || !pharmacistId || !Array.isArray(items) || !items.length) {
        return res.status(400).json({ success: false, message: "Prescription ID, Pharmacist ID and at least one item are required." });
    }

    const client = await pool.connect();

    try {

        await initDispensingSchema(pool);
        await client.query("BEGIN");

        const prx = await client.query(
            `SELECT id, patient_id, doctor_id, visit_id, status FROM prescriptions WHERE id=$1`,
            [prescriptionId]
        );

        if (!prx.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Prescription not found" });
        }

        const p = prx.rows[0];
        if (String(p.status).toLowerCase() === 'completed') {
            await client.query("ROLLBACK");
            return res.status(409).json({ success: false, message: "This prescription is already completed." });
        }

        const records = [];

        for (const item of items) {

            const pmed = await client.query(`
                SELECT pm.id, pm.medicine_id, pm.quantity AS prescribed, m.medicine_name, m.quantity AS stock
                FROM prescription_medicines pm
                JOIN medicines m ON m.id = pm.medicine_id
                WHERE pm.id = $1 AND pm.prescription_id = $2
            `, [item.prescriptionMedicineId, prescriptionId]);

            if (!pmed.rows.length) {
                await client.query("ROLLBACK");
                return res.status(400).json({ success: false, message: "Invalid medicine item in prescription." });
            }

            const med = pmed.rows[0];
            const qty = Math.max(0, parseInt(item.quantityDispensed) || 0);

            /* Verify stock availability BEFORE dispensing */
            if (qty > 0 && med.stock < qty) {
                await client.query("ROLLBACK");
                return res.status(400).json({
                    success: false,
                    message: "Insufficient stock for " + med.medicine_name + " (available: " + med.stock + ", requested: " + qty + ")"
                });
            }

            /* Availability label at verification time */
            const availability = (med.stock >= med.prescribed) ? "Available"
                : (med.stock > 0 ? "Low Stock" : "Out of Stock");

            /* Deduct stock only for what is actually dispensed */
            if (qty > 0) {
                await client.query(
                    `UPDATE medicines SET quantity = quantity - $1 WHERE id = $2`,
                    [qty, med.medicine_id]
                );
            }

            /* Store the dispensing record permanently */
            const rec = await client.query(`
                INSERT INTO dispensing_records (
                    prescription_id, prescription_medicine_id, patient_id, doctor_id, visit_id,
                    pharmacist_id, medicine_id, quantity_prescribed, quantity_dispensed,
                    medicine_availability, remarks, dispensing_date
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
                RETURNING id
            `, [
                prescriptionId, med.id, p.patient_id, p.doctor_id, p.visit_id,
                pharmacistId, med.medicine_id, med.prescribed, qty,
                availability, remarks || null
            ]);

            records.push({
                record_id: rec.rows[0].id,
                medicine_name: med.medicine_name,
                quantity_prescribed: med.prescribed,
                quantity_dispensed: qty,
                availability
            });

        }

        /* Update status: Pending → Dispensed */
        await client.query(`
            UPDATE prescriptions
            SET status = 'Dispensed', dispensed_at = NOW(), dispensed_by = $2
            WHERE id = $1
        `, [prescriptionId, pharmacistId]);

        await client.query("COMMIT");

        res.json({ success: true, records });

    } catch (err) {

        await client.query("ROLLBACK").catch(() => {});
        console.log(err);
        res.status(500).json({ success: false, message: err.message });

    } finally {

        client.release();

    }

});
router.post("/pharmacy/prescriptions", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const {
            patientId,
            doctorId,
            appointmentId,
            medicines
        } = req.body;

        if (!patientId || !doctorId || !Array.isArray(medicines) || !medicines.length) {
            return res.status(400).json({ success: false, message: "Patient, doctor and at least one medicine are required." });
        }

        /* Ensure the extended columns exist */
        await initPrescriptionSchema(pool);

        /* Visit ID — one per consultation/appointment, reused across saves */
        const visitId = await resolveVisitId(pool, appointmentId, patientId, doctorId);

        /* Do not duplicate prescriptions: one prescription row per
           consultation (appointment). Reuse the existing row if the
           doctor saves again for the same consultation; medicines are
           appended below so nothing entered is ever lost. */
        let prescriptionId = null;
        if (appointmentId) {
            const existing = await pool.query(
                `SELECT id FROM prescriptions WHERE appointment_id=$1 ORDER BY id LIMIT 1`,
                [appointmentId]
            );
            if (existing.rows.length) prescriptionId = existing.rows[0].id;
        }

        if (!prescriptionId) {
            const prescriptionResult = await pool.query(
                `INSERT INTO prescriptions (patient_id, doctor_id, appointment_id, notes, visit_id, prescription_date)
                 VALUES ($1,$2,$3,'', $4, CURRENT_DATE) RETURNING id`,
                [patientId, doctorId, appointmentId, visitId]
            );
            prescriptionId = prescriptionResult.rows[0].id;
        }

        // Save all medicines (each stored separately, never overwritten)
        for (const med of medicines) {

            // Find medicine id
            const medicineResult = await pool.query(
                `
                SELECT id
                FROM medicines
                WHERE medicine_name=$1
                `,
                [med.name]
            );

            if (medicineResult.rows.length === 0) {
                continue;
            }

            const medicineId = medicineResult.rows[0].id;

            const morning   = !!(med.morning === true || med.morning === "true" || med.morning === 1 || med.morning === "1");
            const afternoon = !!(med.afternoon === true || med.afternoon === "true" || med.afternoon === 1 || med.afternoon === "1");
            const night     = !!(med.night === true || med.night === "true" || med.night === 1 || med.night === "1");

            await pool.query(
                `
                INSERT INTO prescription_medicines
                (
                    prescription_id,
                    medicine_id,
                    dosage,
                    duration,
                    quantity,
                    frequency,
                    food_timing,
                    morning,
                    afternoon,
                    night,
                    special_instructions,
                    patient_id,
                    doctor_id,
                    visit_id,
                    prescription_date
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_DATE)
                `,
                [
                    prescriptionId,
                    medicineId,
                    med.dosage   || med.type || "",
                    (med.days ? med.days + " Days" : (med.duration || "")),
                    med.quantity ? parseInt(med.quantity) : null,
                    med.frequency   || "",
                    med.food_timing || "",
                    morning,
                    afternoon,
                    night,
                    med.special_instructions || "",
                    patientId,
                    doctorId,
                    visitId
                ]
            );
        }

        res.json({
            success: true,
            prescription_id: prescriptionId,
            visit_id: visitId
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});
/* =====================================================
   COMPLETE PRESCRIPTION
   POST /pharmacy/complete-prescription/:id
   Status: Dispensed → Completed.
   Stock is already deducted at dispensing time, so this
   step only finalises the prescription permanently.
===================================================== */
router.post("/pharmacy/complete-prescription/:id", async (req, res) => {
    const pool = req.app.locals.pool;

    const prescriptionId = req.params.id;

    try {

        await initDispensingSchema(pool);

        await pool.query(`
            UPDATE prescriptions
            SET status = 'Completed', completed_at = NOW()
            WHERE id = $1
        `, [prescriptionId]);

        res.json({ success: true });

    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false });
    }
});

module.exports = router;
module.exports.initPrescriptionSchema = initPrescriptionSchema;