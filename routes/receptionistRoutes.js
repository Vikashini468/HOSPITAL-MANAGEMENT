const express = require("express");
const router  = express.Router();

/* =====================================================
   STATS
===================================================== */

router.get("/stats", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const [appt, labWaiting, labDone] = await Promise.all([

            pool.query(`SELECT COUNT(*) FROM appointments
                        WHERE DATE(appointment_date) = CURRENT_DATE`),

            pool.query(`SELECT COUNT(*) FROM appointments
                        WHERE UPPER(status) = 'WAITING_LAB'`),

            pool.query(`SELECT COUNT(*) FROM appointments
                        WHERE UPPER(status) = 'LAB_READY'`)
        ]);

        res.json({
            today_appointments: parseInt(appt.rows[0].count),
            lab_waiting:        parseInt(labWaiting.rows[0].count),
            lab_completed:      parseInt(labDone.rows[0].count)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ today_appointments: 0, lab_waiting: 0, lab_completed: 0 });
    }

});

/* =====================================================
   ALL APPOINTMENTS WITH TOKEN NUMBER
   Token = appointment id (sequential, unique per day)
===================================================== */

router.get("/appointments", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT
                a.id                                    AS token,
                a.id,
                a.appointment_date,
                a.symptoms,
                a.status,
                u1.name                                 AS patient_name,
                u1.mobile                               AS patient_mobile,
                u2.name                                 AS doctor_name,
                COALESCE(p.age::TEXT, '-')              AS age,
                COALESCE(p.gender, '-')                 AS gender
            FROM appointments a
            JOIN users u1   ON u1.id = a.patient_id
            JOIN users u2   ON u2.id = a.doctor_id
            LEFT JOIN patients p ON p.user_id = a.patient_id
            ORDER BY a.appointment_date DESC
        `);

        res.json(result.rows);

    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }

});

/* =====================================================
   PATIENTS WAITING FOR LAB REPORT
   status = WAITING_LAB
===================================================== */

router.get("/lab/waiting", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT
                a.id                                AS token,
                a.id                                AS appointment_id,
                a.appointment_date,
                a.status                            AS appointment_status,
                u1.name                             AS patient_name,
                u1.mobile                           AS patient_mobile,
                u2.name                             AS doctor_name,
                lr.id                               AS lab_request_id,
                lr.tests,
                lr.status                           AS lab_status,
                lr.created_at                       AS requested_at
            FROM appointments a
            JOIN users u1   ON u1.id = a.patient_id
            JOIN users u2   ON u2.id = a.doctor_id
            JOIN lab_requests lr ON lr.appointment_id = a.id
            WHERE UPPER(a.status) = 'WAITING_LAB'
            AND   UPPER(lr.status) = 'PENDING'
            ORDER BY lr.created_at ASC
        `);

        const rows = result.rows.map(r => ({
            ...r,
            tests: typeof r.tests === "string" ? JSON.parse(r.tests) : r.tests
        }));

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }

});

/* =====================================================
   PATIENTS WITH COMPLETED LAB REPORT
   status = LAB_READY
===================================================== */

router.get("/lab/completed", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT
                a.id                                AS token,
                a.id                                AS appointment_id,
                a.appointment_date,
                u1.name                             AS patient_name,
                u1.mobile                           AS patient_mobile,
                u2.name                             AS doctor_name,
                lr.id                               AS lab_request_id,
                lr.tests,
                lr.report_file,
                lr.completed_at,
                lr.status                           AS lab_status
            FROM appointments a
            JOIN users u1   ON u1.id = a.patient_id
            JOIN users u2   ON u2.id = a.doctor_id
            JOIN lab_requests lr ON lr.appointment_id = a.id
            WHERE UPPER(a.status) = 'LAB_READY'
            AND   UPPER(lr.status) = 'COMPLETED'
            ORDER BY lr.completed_at DESC
        `);

        const rows = result.rows.map(r => ({
            ...r,
            tests: typeof r.tests === "string" ? JSON.parse(r.tests) : r.tests
        }));

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }

});

/* =====================================================
   PATIENTS LIST
===================================================== */

router.get("/patients", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT
                u.id,
                u.name,
                u.email,
                u.mobile,
                COALESCE(p.age::TEXT, '-')  AS age,
                COALESCE(p.gender, '-')     AS gender,
                COALESCE(p.blood_group, '-') AS blood_group,
                COUNT(a.id)                 AS total_appointments
            FROM users u
            LEFT JOIN patients p    ON p.user_id = u.id
            LEFT JOIN appointments a ON a.patient_id = u.id
            WHERE LOWER(u.role) = 'patient'
            GROUP BY u.id, u.name, u.email, u.mobile, p.age, p.gender, p.blood_group
            ORDER BY u.name
        `);

        res.json(result.rows);

    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }

});

module.exports = router;
