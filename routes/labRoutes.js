const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

/* ensure uploads directory exists */
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* =====================================================
   SCHEMA
   - lab_requests gains visit_id / priority / clinical_notes
   - lab_request_reports : append-only, one row per uploaded file.
     Previous reports are NEVER overwritten.
   - notifications: in-app notifications (no email)
===================================================== */
async function initLabSchema(pool) {
    await pool.query(`
        ALTER TABLE lab_requests
            ADD COLUMN IF NOT EXISTS visit_id       INTEGER,
            ADD COLUMN IF NOT EXISTS priority       VARCHAR(20) DEFAULT 'Normal',
            ADD COLUMN IF NOT EXISTS clinical_notes TEXT
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS lab_request_reports (
            id                SERIAL PRIMARY KEY,
            lab_request_id    INTEGER REFERENCES lab_requests(id) ON DELETE CASCADE,
            visit_id          INTEGER,
            patient_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
            doctor_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
            lab_technician_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            test_name         TEXT,
            report_file       TEXT NOT NULL,
            upload_date       TIMESTAMP DEFAULT NOW(),
            created_at        TIMESTAMP DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
            title      TEXT,
            message    TEXT,
            link       TEXT,
            is_read    BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
}

/* =====================================================
   MULTER CONFIGURATION
   Accepts PDF / JPEG / PNG report files (multi-file).
===================================================== */

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },

    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_"));
    }
});

const upload = multer({

    storage,

    limits: { fileSize: 25 * 1024 * 1024 },

    fileFilter: (req, file, cb) => {

        const allowed = [
            "application/pdf",
            "image/jpeg",
            "image/png"
        ];

        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only PDF, JPEG and PNG files are allowed"), false);
        }

    }

});

/* =====================================================
   CREATE LAB REQUEST
===================================================== */

/* Resolve (or create) the Visit ID for an appointment */
async function resolveVisitId(pool, appointmentId) {
    if (!appointmentId) return null;
    const found = await pool.query(`
        SELECT id FROM patient_visits WHERE appointment_id=$1
    `, [appointmentId]);
    if (found.rows.length) return found.rows[0].id;
    const created = await pool.query(`
        INSERT INTO patient_visits (appointment_id, patient_id, doctor_id, status, consultation_started_at)
        SELECT a.id, a.patient_id, a.doctor_id, 'CONSULTING', NOW()
        FROM appointments a WHERE a.id=$1
        ON CONFLICT (appointment_id) DO NOTHING
        RETURNING id
    `, [appointmentId]);
    if (created.rows.length) return created.rows[0].id;
    const again = await pool.query(`SELECT id FROM patient_visits WHERE appointment_id=$1`, [appointmentId]);
    return again.rows[0].id;
}

router.post("/request", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        await initLabSchema(pool);

        const {
            doctorId,
            patientId,
            appointmentId,
            tests,
            priority,
            clinicalNotes
        } = req.body;

        if (
            !doctorId ||
            !patientId ||
            !appointmentId ||
            !tests ||
            !Array.isArray(tests) ||
            tests.length === 0
        ) {

            return res.status(400).json({
                success: false,
                message: "Missing required fields"
            });

        }

        const visitId = await resolveVisitId(pool, appointmentId);

        await pool.query(

            `
            INSERT INTO lab_requests
            (
                appointment_id,
                visit_id,
                patient_id,
                doctor_id,
                tests,
                priority,
                clinical_notes,
                status
            )
            VALUES
            ($1,$2,$3,$4,$5,$6,$7,'PENDING')
            `,

            [
                appointmentId,
                visitId,
                patientId,
                doctorId,
                JSON.stringify(tests),
                (priority || "Normal").trim() || "Normal",
                clinicalNotes || ""
            ]

        );

        await pool.query(

            `
            UPDATE appointments
            SET status='WAITING_LAB'
            WHERE id=$1
            `,

            [appointmentId]

        );

        res.json({

            success: true,
            message: "Lab request created"

        });

    }

    catch (err) {

        console.error(err);

        res.status(500).json({

            success: false,
            message: err.message

        });

    }

});

/* =====================================================
   LAB DASHBOARD
   Returns ALL lab requests enriched with patient/doctor
   names, patient id, visit id, priority, clinical notes,
   request date and the full (append-only) report history.
   The dashboard buckets them into
   Pending / In Progress / Completed client-side.
===================================================== */

router.get("/requests", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        await initLabSchema(pool);

        const result = await pool.query(

            `
            SELECT

                lr.id,
                lr.appointment_id,
                lr.visit_id,
                lr.patient_id,
                lr.doctor_id,
                lr.tests,
                lr.priority,
                lr.clinical_notes,
                lr.status,
                lr.created_at,
                lr.completed_at,

                pu.name AS patient_name,
                phi.health_id AS patient_display_id,
                du.name AS doctor_name,

                (
                    SELECT COALESCE(
                        json_agg(
                            json_build_object(
                                'id',            rr.id,
                                'test_name',     rr.test_name,
                                'report_file',   rr.report_file,
                                'upload_date',   rr.upload_date,
                                'technician_id', rr.lab_technician_id
                            )
                            ORDER BY rr.id
                        ),
                        '[]'
                    )
                    FROM lab_request_reports rr
                    WHERE rr.lab_request_id = lr.id
                ) AS reports

            FROM lab_requests lr

            LEFT JOIN users pu
                ON pu.id = lr.patient_id

            LEFT JOIN patient_health_ids phi
                ON phi.user_id = lr.patient_id

            LEFT JOIN users du
                ON du.id = lr.doctor_id

            ORDER BY lr.created_at DESC
            `

        );

        const rows = result.rows.map(row => ({

            ...row,

            tests:
                typeof row.tests === "string"
                    ? JSON.parse(row.tests)
                    : (row.tests || [])

        }));

        res.json(rows);

    }

    catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

/* =====================================================
   UPDATE LAB REQUEST STATUS
   POST /lab/status/:id   body: { status }
   Used by the dashboard to move Pending -> In Progress
===================================================== */

router.post("/status/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        await initLabSchema(pool);

        const { status } = req.body || {};

        const allowed = ["PENDING", "IN_PROGRESS"];

        if (!allowed.includes(String(status || "").toUpperCase())) {

            return res.status(400).json({
                success: false,
                message: "Invalid status"
            });

        }

        await pool.query(
            `UPDATE lab_requests SET status=$2 WHERE id=$1`,
            [req.params.id, String(status).toUpperCase()]
        );

        res.json({
            success: true,
            message: "Status updated"
        });

    }

    catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

/* =====================================================
   UPLOAD LAB REPORTS
   POST /lab/upload/:id
   - multi-file upload (PDF / JPEG / PNG)
   - one lab_request_reports row per file (append-only history;
     previous reports are NEVER overwritten)
   - request status -> COMPLETED, consultation -> LAB_READY
   - in-app notification sent to the requesting doctor
===================================================== */

router.post(

    "/upload/:id",

    upload.array("reports", 10),

    async (req, res) => {

        const pool = req.app.locals.pool;

        try {

            await initLabSchema(pool);

            if (!req.files || req.files.length === 0) {

                return res.status(400).json({

                    success: false,
                    message: "Please upload at least one file (PDF, JPEG or PNG)"

                });

            }

            const labRequestId = req.params.id;
            const technicianId = req.body.technicianId || null;
            const testName     = req.body.testName || "General";

            const reqRes = await pool.query(
                `SELECT id, appointment_id, visit_id, patient_id, doctor_id, tests, status
                 FROM lab_requests WHERE id=$1`,
                [labRequestId]
            );

            if (!reqRes.rows.length) {

                for (const f of req.files) {
                    fs.unlink(f.path, () => {});
                }

                return res.status(404).json({
                    success: false,
                    message: "Lab request not found"
                });

            }

            const lab = reqRes.rows[0];

            const visitId = lab.visit_id || await resolveVisitId(pool, lab.appointment_id);

            /* Append one permanent report row per uploaded file */
            for (const f of req.files) {

                await pool.query(
                    `
                    INSERT INTO lab_request_reports
                    (
                        lab_request_id,
                        visit_id,
                        patient_id,
                        doctor_id,
                        lab_technician_id,
                        test_name,
                        report_file,
                        upload_date
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
                    `,
                    [
                        labRequestId,
                        visitId,
                        lab.patient_id,
                        lab.doctor_id,
                        technicianId,
                        testName || "General",
                        f.filename
                    ]
                );

            }

            /* Update the request status + keep last file for legacy views */
            await pool.query(
                `
                UPDATE lab_requests
                SET
                    report_file=$2,
                    status='COMPLETED',
                    completed_at=NOW()
                WHERE id=$1
                `,
                [labRequestId, req.files[req.files.length - 1].filename]
            );

            await pool.query(
                `
                UPDATE appointments
                SET status='LAB_READY'
                WHERE id=$1
                `,
                [lab.appointment_id]
            );

            /* In-app notification for the requesting doctor */
            const pat = await pool.query(
                `SELECT name FROM users WHERE id=$1`,
                [lab.patient_id]
            );

            await pool.query(
                `
                INSERT INTO notifications (user_id, title, message, link)
                VALUES ($1,$2,$3,$4)
                `,
                [
                    lab.doctor_id,
                    "Lab Report Uploaded",
                    "Lab report uploaded for patient " + (pat.rows[0] ? pat.rows[0].name : "Unknown") +
                    " (" + (req.files.length === 1 ? "1 file" : req.files.length + " files") + ").",
                    "/doctor?id=" + lab.doctor_id + "&openReport=" + lab.appointment_id
                ]
            );

            res.json({

                success: true,
                message: "Reports uploaded successfully"

            });

        }

        catch (err) {

            console.error(err);

            res.status(500).json({
                success: false,
                message: err.message
            });

        }

    }

);

/* =====================================================
   PATIENT REPORTS
===================================================== */

router.get("/patient-reports/:patientId", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        await initLabSchema(pool);

        const result = await pool.query(

            `
            SELECT

                lr.id,
                lr.tests,
                lr.report_file,
                lr.status,
                lr.created_at,
                lr.completed_at,

                u.name AS doctor_name,

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
                ) AS reports

            FROM lab_requests lr

            LEFT JOIN users u
                ON u.id=lr.doctor_id

            WHERE
                lr.patient_id=$1
                AND UPPER(lr.status) = 'REVIEWED'

            ORDER BY lr.created_at DESC
            `,

            [req.params.patientId]

        );

        res.json(result.rows);

    }

    catch (err) {

        console.error(err);

        res.status(500).json([]);

    }

});

/* =====================================================
   COMPLETED REPORTS
   FOR DOCTOR
===================================================== */

router.get("/completed/:doctorId", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        await initLabSchema(pool);

        const result = await pool.query(

            `
            SELECT

                lr.*,

                u.name AS patient_name,

                phi.health_id AS patient_display_id,

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
                ) AS reports

            FROM lab_requests lr

            LEFT JOIN users u
                ON u.id=lr.patient_id

            LEFT JOIN patient_health_ids phi
                ON phi.user_id=lr.patient_id

            WHERE
                lr.doctor_id=$1
                AND UPPER(lr.status) IN ('COMPLETED','REVIEWED')

            ORDER BY lr.created_at DESC
            `,

            [req.params.doctorId]

        );

        const rows = result.rows.map(row => ({

            ...row,

            tests:
                typeof row.tests === "string"
                    ? JSON.parse(row.tests)
                    : row.tests

        }));

        res.json(rows);

    }

    catch (err) {

        console.error(err);

        res.status(500).json([]);

    }

});

/* =====================================================
   ALL COMPLETED REPORTS — for lab dashboard
===================================================== */

router.get("/completed-all", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT
                lr.id,
                lr.tests,
                lr.report_file,
                lr.status,
                lr.created_at,
                lr.completed_at,
                pu.name AS patient_name,
                du.name AS doctor_name
            FROM lab_requests lr
            LEFT JOIN users pu ON pu.id = lr.patient_id
            LEFT JOIN users du ON du.id = lr.doctor_id
            WHERE UPPER(lr.status) IN ('COMPLETED','REVIEWED')
            ORDER BY lr.completed_at DESC
        `);

        const rows = result.rows.map(r => ({
            ...r,
            tests: typeof r.tests === "string" ? JSON.parse(r.tests) : (r.tests || [])
        }));

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }

});

/* =====================================================
   IN-APP NOTIFICATIONS
   No email is ever sent — notifications live in the
   notifications table and are shown in the dashboard.
===================================================== */

/* List a user's notifications (most recent first) + unread count */
router.get("/notifications/:userId", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        await initLabSchema(pool);

        const result = await pool.query(
            `
            SELECT id, title, message, link, is_read, created_at
            FROM notifications
            WHERE user_id=$1
            ORDER BY created_at DESC, id DESC
            LIMIT 30
            `,
            [req.params.userId]
        );

        const count = await pool.query(
            `
            SELECT COUNT(*)::int AS unread
            FROM notifications
            WHERE user_id=$1 AND is_read=FALSE
            `,
            [req.params.userId]
        );

        res.json({
            success: true,
            unread: count.rows[0].unread,
            notifications: result.rows
        });

    }

    catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

/* Mark a single notification as read */
router.post("/notifications/:id/read", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        await initLabSchema(pool);

        await pool.query(
            `UPDATE notifications SET is_read=TRUE WHERE id=$1`,
            [req.params.id]
        );

        res.json({ success: true });

    }

    catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

/* Mark all notifications of a user as read */
router.post("/notifications/read-all/:userId", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        await initLabSchema(pool);

        await pool.query(
            `UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE`,
            [req.params.userId]
        );

        res.json({ success: true });

    }

    catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

module.exports = router;