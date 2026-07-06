const express = require("express");

module.exports = (io) => {
    const router = express.Router();

    /* =====================================================
       HELPER — get pool from request
    ===================================================== */
    const db = (req) => req.app.locals.pool;

    /* =====================================================
       CREATE TABLES (run once on startup)
    ===================================================== */
    async function initTables(pool) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inpatients (
                id               SERIAL PRIMARY KEY,
                patient_name     VARCHAR(200) NOT NULL,
                age              INTEGER,
                gender           VARCHAR(20),
                blood_group      VARCHAR(10),
                phone            VARCHAR(20),
                address          TEXT,
                disease          TEXT,
                emergency_contact VARCHAR(20),
                doctor_id        INTEGER REFERENCES users(id),
                ward             VARCHAR(100),
                room_no          VARCHAR(50),
                bed_no           VARCHAR(50),
                admission_date   DATE DEFAULT CURRENT_DATE,
                admission_type   VARCHAR(50) DEFAULT 'Normal',
                status           VARCHAR(50) DEFAULT 'Admitted',
                created_at       TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`
CREATE TABLE IF NOT EXISTS lab_reports (

    id SERIAL PRIMARY KEY,

    patient_id INTEGER REFERENCES inpatients(id) ON DELETE CASCADE,

    report_type VARCHAR(100),

    report_name VARCHAR(255),

    report_file TEXT,

    uploaded_by INTEGER,

    uploaded_at TIMESTAMP DEFAULT NOW()

)
`);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS treatment_history (
                id          SERIAL PRIMARY KEY,
                patient_id  INTEGER REFERENCES inpatients(id) ON DELETE CASCADE,
                doctor_id   INTEGER,
                description TEXT,
                activity_date DATE DEFAULT CURRENT_DATE,
                activity_time TIME DEFAULT CURRENT_TIME,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS patient_vitals (
                id          SERIAL PRIMARY KEY,
                patient_id  INTEGER REFERENCES inpatients(id) ON DELETE CASCADE,
                temperature NUMERIC(5,2),
                bp          VARCHAR(20),
                pulse       INTEGER,
                respiration INTEGER,
                oxygen      NUMERIC(5,2),
                sugar       NUMERIC(6,2),
                weight      NUMERIC(6,2),
                height      NUMERIC(6,2),
                recorded_at TIMESTAMP DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS medicine_schedule (
                id          SERIAL PRIMARY KEY,
                patient_id  INTEGER REFERENCES inpatients(id) ON DELETE CASCADE,
                medicine    VARCHAR(200) NOT NULL,
                morning     BOOLEAN DEFAULT false,
                afternoon   BOOLEAN DEFAULT false,
                night       BOOLEAN DEFAULT false,
                status      VARCHAR(50) DEFAULT 'Pending',
                created_at  TIMESTAMP DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS inpatient_billing (
                id              SERIAL PRIMARY KEY,
                patient_id      INTEGER REFERENCES inpatients(id) ON DELETE CASCADE,
                room_charge     NUMERIC(12,2) DEFAULT 0,
                doctor_fee      NUMERIC(12,2) DEFAULT 0,
                medicine_fee    NUMERIC(12,2) DEFAULT 0,
                lab_fee         NUMERIC(12,2) DEFAULT 0,
                maintenance_fee NUMERIC(12,2) DEFAULT 0,
                other_fee       NUMERIC(12,2) DEFAULT 0,
                discount        NUMERIC(12,2) DEFAULT 0,
                gst             NUMERIC(5,2)  DEFAULT 0,
                total           NUMERIC(12,2) DEFAULT 0,
                updated_at      TIMESTAMP DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS inpatient_discharge (
                id            SERIAL PRIMARY KEY,
                patient_id    INTEGER REFERENCES inpatients(id) ON DELETE CASCADE,
                doctor_id     INTEGER,
                summary       TEXT,
                instructions  TEXT,
                follow_up     DATE,
                total_bill    NUMERIC(12,2) DEFAULT 0,
                paid_amount   NUMERIC(12,2) DEFAULT 0,
                discharge_date TIMESTAMP DEFAULT NOW()
            )
        `);

        console.log("✅ Inpatient tables ready");
    }

    /* =====================================================
       DASHBOARD STATS
    ===================================================== */
    router.get("/dashboard", async (req, res) => {
        try {
            const pool = db(req);
            const [total, available, occupied, todayAdmit, todayDischarge, critical] = await Promise.all([
                pool.query(`SELECT COUNT(*) FROM inpatients WHERE status='Admitted'`),
                pool.query(`SELECT COUNT(*) FROM inpatients WHERE status='Discharged' OR status IS NULL`),
                pool.query(`SELECT COUNT(*) FROM inpatients WHERE status='Admitted'`),
                pool.query(`SELECT COUNT(*) FROM inpatients WHERE DATE(admission_date)=CURRENT_DATE`),
                pool.query(`SELECT COUNT(*) FROM inpatient_discharge WHERE DATE(discharge_date)=CURRENT_DATE`),
                pool.query(`SELECT COUNT(*) FROM inpatients WHERE UPPER(admission_type)='ICU' AND status='Admitted'`)
            ]);
            res.json({
                total_patients:    parseInt(total.rows[0].count),
                available_beds:    100 - parseInt(occupied.rows[0].count),
                occupied_beds:     parseInt(occupied.rows[0].count),
                today_admissions:  parseInt(todayAdmit.rows[0].count),
                today_discharges:  parseInt(todayDischarge.rows[0].count),
                critical_patients: parseInt(critical.rows[0].count)
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({});
        }
    });

    /* =====================================================
       ADMIT PATIENT
    ===================================================== */
    router.post("/admit", async (req, res) => {
        try {
            const pool = db(req);
            const {
                patient_name, age, gender, blood_group, phone, address,
                disease, emergency_contact, doctor_id, ward, room_no,
                bed_no, admission_date, admission_type
            } = req.body;

            if (!patient_name || !doctor_id || !ward || !room_no || !bed_no) {
                return res.status(400).json({ success: false, message: "Required fields missing" });
            }

            const result = await pool.query(`
                INSERT INTO inpatients
                (patient_name, age, gender, blood_group, phone, address, disease,
                 emergency_contact, doctor_id, ward, room_no, bed_no,
                 admission_date, admission_type, status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Admitted')
                RETURNING *
            `, [patient_name, age, gender, blood_group, phone, address, disease,
                emergency_contact, doctor_id, ward, room_no, bed_no,
                admission_date || new Date().toISOString().split("T")[0], admission_type || "Normal"]);

            const patient = result.rows[0];

            /* Create blank billing record */
            await pool.query(`
                INSERT INTO inpatient_billing (patient_id) VALUES ($1)
                ON CONFLICT DO NOTHING
            `, [patient.id]);

            io.emit("patientAdmitted", patient);
            res.json({ success: true, patient });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    /* =====================================================
       GET ALL PATIENTS
    ===================================================== */
    router.get("/patients", async (req, res) => {
        try {
            const pool = db(req);
            const result = await pool.query(`
                SELECT
                    i.*,
                    u.name AS doctor_name,
                    d.specialisation AS doctor_dept
                FROM inpatients i
                LEFT JOIN users u ON u.id = i.doctor_id
                LEFT JOIN doctors d ON d.user_id = i.doctor_id
                ORDER BY i.id DESC
            `);
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json([]);
        }
    });

    /* =====================================================
       GET SINGLE PATIENT
    ===================================================== */
    router.get("/patient/:id", async (req, res) => {
        try {
            const pool = db(req);
            const result = await pool.query(`
                SELECT
                    i.*,
                    u.name AS doctor_name,
                    d.specialisation AS doctor_dept,
                    ds.consultation_fee
                FROM inpatients i
                LEFT JOIN users u ON u.id = i.doctor_id
                LEFT JOIN doctors d ON d.user_id = i.doctor_id
                LEFT JOIN doctor_schedule ds ON ds.doctor_id = i.doctor_id
                WHERE i.id = $1
            `, [req.params.id]);
            if (!result.rows.length) return res.status(404).json({ message: "Not found" });
            res.json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({});
        }
    });

    /* =====================================================
       ASSIGN / CHANGE ROOM
    ===================================================== */
    router.put("/assign-room", async (req, res) => {
        try {
            const pool = db(req);
            const { patient_id, ward, room_no, bed_no } = req.body;
            await pool.query(`
                UPDATE inpatients SET ward=$1, room_no=$2, bed_no=$3 WHERE id=$4
            `, [ward, room_no, bed_no, patient_id]);
            io.emit("roomChanged", { patient_id, ward, room_no, bed_no });
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    /* =====================================================
       ASSIGN DOCTOR
    ===================================================== */
    router.put("/assign-doctor", async (req, res) => {
        try {
            const pool = db(req);
            const { patient_id, doctor_id } = req.body;
            await pool.query(`UPDATE inpatients SET doctor_id=$1 WHERE id=$2`, [doctor_id, patient_id]);
            io.emit("doctorAssigned", { patient_id, doctor_id });
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    /* =====================================================
       ADD TREATMENT ENTRY
    ===================================================== */
    router.post("/treatment", async (req, res) => {
        try {
            const pool = db(req);
            const { patient_id, doctor_id, description, activity_date, activity_time } = req.body;
            const result = await pool.query(`
                INSERT INTO treatment_history
                (patient_id, doctor_id, description, activity_date, activity_time)
                VALUES ($1,$2,$3,$4,$5) RETURNING *
            `, [patient_id, doctor_id, description,
                activity_date || new Date().toISOString().split("T")[0],
                activity_time || new Date().toTimeString().slice(0, 5)]);
            io.emit("treatmentUpdated", result.rows[0]);
            res.json({ success: true, entry: result.rows[0] });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    /* =====================================================
       GET TREATMENT HISTORY
    ===================================================== */
    router.get("/treatments/:id", async (req, res) => {
        try {
            const pool = db(req);
            const result = await pool.query(`
                SELECT t.*, u.name AS doctor_name
                FROM treatment_history t
                LEFT JOIN users u ON u.id = t.doctor_id
                WHERE t.patient_id = $1
                ORDER BY t.activity_date DESC, t.activity_time DESC
            `, [req.params.id]);
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json([]);
        }
    });

    /* =====================================================
       ADD VITALS
    ===================================================== */
    router.post("/vitals", async (req, res) => {
        try {
            const pool = db(req);
            const { patient_id, temperature, bp, pulse, respiration, oxygen, sugar, weight, height } = req.body;
            const result = await pool.query(`
                INSERT INTO patient_vitals
                (patient_id, temperature, bp, pulse, respiration, oxygen, sugar, weight, height)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
            `, [patient_id, temperature, bp, pulse, respiration, oxygen, sugar, weight, height]);
            io.emit("vitalsUpdated", result.rows[0]);
            res.json({ success: true, vitals: result.rows[0] });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    /* =====================================================
       GET VITALS HISTORY
    ===================================================== */
    router.get("/vitals/:id", async (req, res) => {
        try {
            const pool = db(req);
            const result = await pool.query(`
                SELECT * FROM patient_vitals
                WHERE patient_id = $1
                ORDER BY recorded_at DESC
            `, [req.params.id]);
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json([]);
        }
    });

    /* =====================================================
       ADD MEDICINE
    ===================================================== */
    router.post("/medicine", async (req, res) => {
        try {
            const pool = db(req);
            const { patient_id, medicine, morning, afternoon, night } = req.body;
            const result = await pool.query(`
                INSERT INTO medicine_schedule (patient_id, medicine, morning, afternoon, night)
                VALUES ($1,$2,$3,$4,$5) RETURNING *
            `, [patient_id, medicine, !!morning, !!afternoon, !!night]);
            io.emit("medicineUpdated", result.rows[0]);
            res.json({ success: true, medicine: result.rows[0] });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    /* =====================================================
       GET MEDICINE SCHEDULE
    ===================================================== */
    router.get("/medicine/:id", async (req, res) => {
        try {
            const pool = db(req);
            const result = await pool.query(`
                SELECT * FROM medicine_schedule
                WHERE patient_id = $1
                ORDER BY created_at DESC
            `, [req.params.id]);
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json([]);
        }
    });

    /* =====================================================
       UPDATE MEDICINE STATUS
    ===================================================== */
    router.put("/medicine/update", async (req, res) => {
        try {
            const pool = db(req);
            const { id, status, morning, afternoon, night } = req.body;
            await pool.query(`
                UPDATE medicine_schedule
                SET status=$1, morning=$2, afternoon=$3, night=$4
                WHERE id=$5
            `, [status, !!morning, !!afternoon, !!night, id]);
            io.emit("medicineUpdated", { id, status });
            res.json({ success: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    /* =====================================================
       GET BILLING
    ===================================================== */
    router.get("/billing/:id", async (req, res) => {
        try {
            const pool = db(req);
            const result = await pool.query(`
                SELECT * FROM inpatient_billing WHERE patient_id = $1
            `, [req.params.id]);
            res.json(result.rows[0] || {});
        } catch (err) {
            console.error(err);
            res.status(500).json({});
        }
    });

    /* =====================================================
       GENERATE / UPDATE BILL
    ===================================================== */
    router.post("/generate-bill", async (req, res) => {
        try {
            const pool = db(req);
            const {
                patient_id, room_charge, doctor_fee, medicine_fee,
                lab_fee, maintenance_fee, other_fee, discount, gst
            } = req.body;

            const subtotal = [room_charge, doctor_fee, medicine_fee, lab_fee, maintenance_fee, other_fee]
                .reduce((s, v) => s + Number(v || 0), 0);
            const afterDiscount = subtotal - Number(discount || 0);
            const total = afterDiscount + (afterDiscount * Number(gst || 0) / 100);

            const existing = await pool.query(
                `SELECT id FROM inpatient_billing WHERE patient_id=$1`, [patient_id]
            );

            if (existing.rows.length) {
                await pool.query(`
                    UPDATE inpatient_billing
                    SET room_charge=$1, doctor_fee=$2, medicine_fee=$3, lab_fee=$4,
                        maintenance_fee=$5, other_fee=$6, discount=$7, gst=$8,
                        total=$9, updated_at=NOW()
                    WHERE patient_id=$10
                `, [room_charge, doctor_fee, medicine_fee, lab_fee,
                    maintenance_fee, other_fee, discount, gst, total, patient_id]);
            } else {
                await pool.query(`
                    INSERT INTO inpatient_billing
                    (patient_id, room_charge, doctor_fee, medicine_fee, lab_fee,
                     maintenance_fee, other_fee, discount, gst, total)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                `, [patient_id, room_charge, doctor_fee, medicine_fee, lab_fee,
                    maintenance_fee, other_fee, discount, gst, total]);
            }

            io.emit("billGenerated", { patient_id, total });
            res.json({ success: true, total });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    /* =====================================================
       DISCHARGE PATIENT
    ===================================================== */
    router.post("/discharge", async (req, res) => {
        try {
            const pool = db(req);
            const {
                patient_id, doctor_id, summary, instructions,
                follow_up, total_bill, paid_amount
            } = req.body;

            const result = await pool.query(`
                INSERT INTO inpatient_discharge
                (patient_id, doctor_id, summary, instructions, follow_up, total_bill, paid_amount)
                VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
            `, [patient_id, doctor_id, summary, instructions, follow_up || null, total_bill, paid_amount]);

            /* Mark patient as discharged and release bed */
            await pool.query(`
                UPDATE inpatients SET status='Discharged' WHERE id=$1
            `, [patient_id]);

            /* Add to hospital_expenses */
            if (Number(total_bill) > 0) {
                await pool.query(`
                    INSERT INTO hospital_expenses (category, amount, expense_date)
                    VALUES ('Inpatient', $1, NOW())
                `, [total_bill]);
            }

            io.emit("patientDischarged", { patient_id });
            res.json({ success: true, discharge: result.rows[0] });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    /* =====================================================
       GET DISCHARGE SUMMARY
    ===================================================== */
    router.get("/discharge/:id", async (req, res) => {
        try {
            const pool = db(req);
            const result = await pool.query(`
                SELECT
                    d.*,
                    i.patient_name, i.age, i.gender, i.blood_group,
                    i.ward, i.room_no, i.bed_no, i.admission_date,
                    i.disease, i.admission_type,
                    u.name AS doctor_name,
                    doc.specialisation AS doctor_dept
                FROM inpatient_discharge d
                JOIN inpatients i ON i.id = d.patient_id
                LEFT JOIN users u ON u.id = d.doctor_id
                LEFT JOIN doctors doc ON doc.user_id = d.doctor_id
                WHERE d.patient_id = $1
                ORDER BY d.id DESC LIMIT 1
            `, [req.params.id]);
            res.json(result.rows[0] || {});
        } catch (err) {
            console.error(err);
            res.status(500).json({});
        }
    });
/* =====================================================
   UPLOAD LAB REPORT
===================================================== */

router.post("/lab/upload", async (req, res) => {

    try {

        const pool = db(req);

        const {

            patient_id,
            report_type,
            report_name,
            report_file,
            uploaded_by

        } = req.body;

        const result = await pool.query(

            `INSERT INTO lab_reports

            (patient_id,report_type,report_name,report_file,uploaded_by)

            VALUES($1,$2,$3,$4,$5)

            RETURNING *`,

            [

                patient_id,

                report_type,

                report_name,

                report_file,

                uploaded_by

            ]

        );

        io.emit("labReportUploaded", result.rows[0]);

        res.json({

            success:true,

            report:result.rows[0]

        });

    }

    catch(err){

        console.error(err);

        res.status(500).json({

            success:false,

            message:err.message

        });

    }

});
/* =====================================================
   GET LAB REPORTS
===================================================== */

router.get("/lab/:id", async (req,res)=>{

    try{

        const pool=db(req);

        const result=await pool.query(

            `SELECT *

             FROM lab_reports

             WHERE patient_id=$1

             ORDER BY uploaded_at DESC`,

             [req.params.id]

        );

        res.json(result.rows);

    }

    catch(err){

        console.error(err);

        res.status(500).json([]);

    }

});
/* =====================================================
   DELETE LAB REPORT
===================================================== */

router.delete("/lab/:id",async(req,res)=>{

    try{

        const pool=db(req);

        await pool.query(

            `DELETE FROM lab_reports WHERE id=$1`,

            [req.params.id]

        );

        res.json({

            success:true

        });

    }

    catch(err){

        console.error(err);

        res.status(500).json({

            success:false

        });

    }

});
/* =====================================================
   DOWNLOAD LAB REPORT
===================================================== */

router.get("/lab/download/:id",async(req,res)=>{

    try{

        const pool=db(req);

        const result=await pool.query(

            `SELECT report_file

             FROM lab_reports

             WHERE id=$1`,

             [req.params.id]

        );

        if(!result.rows.length){

            return res.status(404).json({

                message:"Report not found"

            });

        }

        res.json({

            file:result.rows[0].report_file

        });

    }

    catch(err){

        console.error(err);

        res.status(500).json({});

    }

});
/* =====================================================
   LAB COUNT
===================================================== */

router.get("/lab-count/:id",async(req,res)=>{

    try{

        const pool=db(req);

        const result=await pool.query(

            `SELECT COUNT(*) FROM lab_reports

             WHERE patient_id=$1`,

             [req.params.id]

        );

        res.json({

            count:Number(result.rows[0].count)

        });

    }

    catch(err){

        console.error(err);

        res.status(500).json({

            count:0

        });

    }

});

    /* =====================================================
       GET DOCTORS LIST (for admission form)
    ===================================================== */
    router.get("/doctors", async (req, res) => {
        try {
            const pool = db(req);
            const result = await pool.query(`
                SELECT u.id, u.name, d.specialisation
                FROM users u
                JOIN doctors d ON d.user_id = u.id
                WHERE u.approved = true
                ORDER BY u.name
            `);
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json([]);
        }
    });

    /* =====================================================
       MAINTENANCE REQUEST FROM INPATIENT
    ===================================================== */
    router.post("/maintenance-request", async (req, res) => {
        try {
            const pool = db(req);
            const { patient_id, category, asset_name, problem, priority } = req.body;

            /* Get patient room info for department field */
            const pat = await pool.query(`SELECT ward, room_no FROM inpatients WHERE id=$1`, [patient_id]);
            const ward = pat.rows.length ? `Ward ${pat.rows[0].ward} Room ${pat.rows[0].room_no}` : "Inpatient";

            const result = await pool.query(`
                INSERT INTO maintenance_requests
                (department, category, asset_name, problem, priority, requested_by, status, created_at)
                VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())
                RETURNING id
            `, [ward, category, asset_name, problem, priority, `Inpatient #${patient_id}`]);

            io.emit("maintenanceUpdated");
            res.json({ success: true, request_id: result.rows[0].id });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: err.message });
        }
    });

    /* =====================================================
       INIT TABLES ON MODULE LOAD
    ===================================================== */
    router.initTables = initTables;

    return router;
};
