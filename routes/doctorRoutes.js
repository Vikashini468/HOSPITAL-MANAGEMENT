const express = require("express");
const router = express.Router();

/* =====================================================
   SAVE / UPDATE DOCTOR SCHEDULE (UPSERT)
===================================================== */
router.post("/doctor/save-schedule", async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const {
            doctorId,
            availableDays,
            startTime,
            endTime,
            maxTokens,
            consultationFee,
            languages,
            bio
        } = req.body;

        if (!doctorId) {
            return res.status(400).json({
                success: false,
                message: "Doctor ID required"
            });
        }

        // Check existing schedule
        const check = await pool.query(
            "SELECT id FROM doctor_schedule WHERE doctor_id=$1",
            [doctorId]
        );

        if (check.rows.length > 0) {
            // UPDATE
            await pool.query(
                `
                UPDATE doctor_schedule
                SET available_days=$1,
                    start_time=$2,
                    end_time=$3,
                    max_tokens=$4,
                    consultation_fee=$5,
                    languages=$6,
                    bio=$7
                WHERE doctor_id=$8
                `,
                [
                    availableDays,
                    startTime,
                    endTime,
                    maxTokens,
                    consultationFee,
                    languages,
                    bio,
                    doctorId
                ]
            );
        } else {
            // INSERT
            await pool.query(
                `
                INSERT INTO doctor_schedule
                (
                    doctor_id,
                    available_days,
                    start_time,
                    end_time,
                    max_tokens,
                    consultation_fee,
                    languages,
                    bio
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                `,
                [
                    doctorId,
                    availableDays,
                    startTime,
                    endTime,
                    maxTokens,
                    consultationFee,
                    languages,
                    bio
                ]
            );
        }

        res.json({ success: true });

    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false });
    }
});


/* =====================================================
   GET DOCTOR SCHEDULE
===================================================== */
router.get("/doctor/schedule/:id", async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const result = await pool.query(
            `
            SELECT
                u.id,
                u.name,
                d.specialisation,
                ds.available_days,
                ds.start_time,
                ds.end_time,
                ds.max_tokens,
                ds.consultation_fee,
                ds.languages,
                ds.bio
            FROM users u
            JOIN doctors d ON u.id = d.user_id
            LEFT JOIN doctor_schedule ds ON ds.doctor_id = u.id
            WHERE u.id = $1
            `,
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Doctor not found"
            });
        }

        res.json(result.rows[0]);

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Server Error" });
    }
});


/* =====================================================
   GENERATE AVAILABLE SLOTS
===================================================== */
router.get("/doctor/slots/:doctorId/:day", async (req, res) => {
    const pool = req.app.locals.pool;

    const { doctorId, day } = req.params;

    try {
        const scheduleResult = await pool.query(
            `SELECT * FROM doctor_schedule WHERE doctor_id=$1`,
            [doctorId]
        );

        if (scheduleResult.rows.length === 0) {
            return res.json([]);
        }

        const schedule = scheduleResult.rows[0];

        const availableDays = (schedule.available_days || "").split(",").map(d => d.trim());

        if (!availableDays.includes(day)) {
            return res.json([]);
        }

        const startMinutes = toMinutes(schedule.start_time);
        const endMinutes = toMinutes(schedule.end_time);

        const maxTokens = schedule.max_tokens;

        const interval = Math.floor((endMinutes - startMinutes) / maxTokens);

        let slots = [];

        for (let i = 0; i < maxTokens; i++) {
            let total = startMinutes + (interval * i);

            let hour = Math.floor(total / 60);
            let minute = total % 60;

            slots.push(
                `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
            );
        }

        // booked slots
        const booked = await pool.query(
            `
            SELECT appointment_time
            FROM appointments
            WHERE doctor_id=$1
            AND appointment_day=$2
            AND status!='Cancelled'
            `,
            [doctorId, day]
        );

        const bookedTimes = booked.rows.map(r =>
            r.appointment_time.substring(0, 5)
        );

        const freeSlots = slots.filter(slot => !bookedTimes.includes(slot));

        res.json(freeSlots);

    } catch (err) {
        console.log(err);
        res.status(500).json([]);
    }
});


/* =====================================================
   GET DOCTOR APPOINTMENTS
===================================================== */
/* =====================================================
   GET DOCTOR APPOINTMENTS
===================================================== */
router.get("/doctor/appointments/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const doctorId = parseInt(req.params.id);

        const result = await pool.query(

`
SELECT
    a.id,
    a.patient_id,
    a.doctor_id,
    a.appointment_date,
    a.appointment_time,
    a.token_no,
    a.status,
    a.symptoms,

    u.name AS patient_name,

    p.age,
    p.gender,
    p.blood_group,

    lr.id AS lab_request_id,
    lr.report_file,

    CASE
        WHEN lr.status='COMPLETED' THEN true
        ELSE false
    END AS lab_ready

FROM appointments a

JOIN users u
ON u.id=a.patient_id

LEFT JOIN patients p
ON p.user_id=a.patient_id

LEFT JOIN lab_requests lr
ON lr.appointment_id=a.id

WHERE
    a.doctor_id=$1
AND
    a.appointment_date=CURRENT_DATE
AND
(
    UPPER(a.status)='WAITING'
    OR
    UPPER(a.status)='INPROGRESS'
    OR
    UPPER(a.status)='LAB_READY'
)

ORDER BY a.token_no
`,
        [doctorId]

        );

        res.json(result.rows);

    }

    catch(err){

        console.log(err);

        res.status(500).json([]);

    }

});

/* =====================================================
   DOCTORS LIST
===================================================== */
router.get("/doctors", async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const result = await pool.query(
            `
            SELECT
                users.id,
                users.name,
                users.gender,
                doctors.specialisation AS specialization,
                doctors.photo,
                COALESCE(ds.consultation_fee, 0) AS consultation_fee
            FROM users
            JOIN doctors ON users.id = doctors.user_id
            LEFT JOIN doctor_schedule ds ON ds.doctor_id = users.id
            WHERE users.approved = true
            `
        );

        res.json(result.rows);

    } catch (err) {
        console.log(err);
        res.status(500).json([]);
    }
});

router.get("/doctor/profile/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(
            `
            SELECT
                u.id,
                u.name,
                d.specialisation
            FROM users u
            JOIN doctors d
                ON u.id = d.user_id
            WHERE u.id = $1
            `,
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Doctor not found"
            });
        }

        res.json(result.rows[0]);

    } catch (err) {
        console.log(err);
        res.status(500).json({
            message: "Server Error"
        });
    }

});
router.get("/doctor/labwaiting/:doctorId", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT
                lr.id,
                lr.appointment_id,
                lr.tests,
                lr.status,
                u.name
            FROM lab_requests lr
            JOIN appointments a
                ON a.id = lr.appointment_id
            JOIN users u
                ON u.id = a.patient_id
            WHERE a.doctor_id = $1
            AND UPPER(lr.status) = 'PENDING'
            ORDER BY lr.id DESC
        `,[req.params.doctorId]);

        const rows = result.rows.map(r=>({

            ...r,

            tests:
                typeof r.tests==="string"
                    ? JSON.parse(r.tests)
                    : r.tests

        }));

        res.json(rows);

    }
    catch(err){

        console.log(err);
        res.status(500).json([]);

    }

});
router.get("/doctor/labcompleted/:doctorId", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await pool.query(`
            SELECT
                a.id,
                a.patient_id,
                u.name,
                lr.report_file,
                json_agg(lr.tests) AS all_tests
            FROM appointments a
            JOIN users u ON a.patient_id = u.id
            JOIN lab_requests lr ON lr.appointment_id = a.id
            WHERE a.doctor_id = $1
            AND lr.status = 'COMPLETED'
            GROUP BY a.id, a.patient_id, u.name, lr.report_file
        `, [req.params.doctorId]);

        const rows = result.rows.map(r => {
            let tests = [];
            try {
                (r.all_tests || []).forEach(t => {
                    const parsed = typeof t === "string" ? JSON.parse(t) : t;
                    if (Array.isArray(parsed)) tests = tests.concat(parsed);
                    else tests.push(parsed);
                });
            } catch(e) {}
            return { ...r, tests };
        });

        res.json(rows);
    } catch(err) {
        console.log(err);
        res.status(500).json([]);
    }
});
/* =====================================================
   HELPERS
===================================================== */
function toMinutes(time) {
    const parts = time.split(":");
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}
router.get("/doctor/lab-report/:labRequestId", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(
        `
        SELECT
            lr.*,
            u.name
        FROM lab_requests lr
        JOIN users u
            ON u.id=lr.patient_id
        WHERE lr.id=$1
        `,
        [req.params.labRequestId]
        );

        res.json(result.rows[0]);

    } catch(err){

        console.log(err);
        res.status(500).json({});

    }

});
module.exports = router;