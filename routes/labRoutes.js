const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

/* =====================================================
   MULTER CONFIGURATION
===================================================== */

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },

    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({

    storage,

    fileFilter: (req, file, cb) => {

        if (file.mimetype === "application/pdf") {
            cb(null, true);
        } else {
            cb(new Error("Only PDF files are allowed"), false);
        }

    }

});

/* =====================================================
   CREATE LAB REQUEST
===================================================== */

router.post("/request", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const {
            doctorId,
            patientId,
            appointmentId,
            tests
        } = req.body;

        if (
            !doctorId ||
            !patientId ||
            !appointmentId ||
            !tests
        ) {

            return res.status(400).json({
                success: false,
                message: "Missing required fields"
            });

        }

        await pool.query(

            `
            INSERT INTO lab_requests
            (
                appointment_id,
                patient_id,
                doctor_id,
                tests,
                status
            )
            VALUES
            ($1,$2,$3,$4,'PENDING')
            `,

            [
                appointmentId,
                patientId,
                doctorId,
                JSON.stringify(tests)
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
   SHOW ONLY PENDING REQUESTS
===================================================== */

router.get("/requests", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(

            `
            SELECT

                lr.id,
                lr.appointment_id,
                lr.patient_id,
                lr.doctor_id,
                lr.tests,
                lr.status,
                lr.created_at,

                pu.name AS patient_name,
                du.name AS doctor_name

            FROM lab_requests lr

            LEFT JOIN users pu
                ON pu.id = lr.patient_id

            LEFT JOIN users du
                ON du.id = lr.doctor_id

            WHERE UPPER(lr.status)='PENDING'

            ORDER BY lr.created_at DESC
            `

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

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

/* =====================================================
   UPLOAD LAB REPORT
===================================================== */

router.post(

    "/upload/:id",

    upload.single("report"),

    async (req, res) => {

        const pool = req.app.locals.pool;

        try {

            if (!req.file) {

                return res.status(400).json({

                    success: false,
                    message: "Please upload a PDF"

                });

            }

            const fileName = req.file.filename;

            await pool.query(

                `
                UPDATE lab_requests
                SET
                    report_file=$1,
                    status='COMPLETED',
                    completed_at=NOW()
                WHERE id=$2
                `,

                [
                    fileName,
                    req.params.id
                ]

            );

            await pool.query(

                `
                UPDATE appointments
SET status='LAB_READY'
WHERE id=
(
    SELECT appointment_id
    FROM lab_requests
    WHERE id=$1
)
                `,

                [req.params.id]

            );

            res.json({

                success: true,
                message: "Report uploaded successfully"

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

        const result = await pool.query(

            `
            SELECT

                lr.id,
                lr.tests,
                lr.report_file,
                lr.status,
                lr.created_at,

                u.name AS doctor_name

            FROM lab_requests lr

            LEFT JOIN users u
                ON u.id=lr.doctor_id

            WHERE
                lr.patient_id=$1
                AND UPPER(lr.status)='REVIEWED'

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

        const result = await pool.query(

            `
            SELECT

                lr.*,

                u.name AS patient_name

            FROM lab_requests lr

            LEFT JOIN users u
                ON u.id=lr.patient_id

            WHERE
                lr.doctor_id=$1
                AND UPPER(lr.status)='COMPLETED'

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

module.exports = router;