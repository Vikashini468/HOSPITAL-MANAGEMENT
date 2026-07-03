const express = require("express");
const router = express.Router();

/* =====================================================
   CREATE EMERGENCY CASE
===================================================== */

router.post("/create", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const {

            patientId,
            doctorId,
            category,
            priority,
            department,
            symptoms,
            emergencyNotes,
            ambulanceRequired,
            arrivalType

        } = req.body;

        /* Validation */

        if (
            !patientId ||
            !category ||
            !priority ||
            !department ||
            !symptoms
        ) {

            return res.status(400).json({

                success: false,
                message: "Please fill all required fields."

            });

        }

        /* Check patient */

        const patient = await pool.query(

            `
            SELECT id
            FROM patients
            WHERE id=$1
            `,

            [patientId]

        );

        if (patient.rows.length === 0) {

            return res.status(404).json({

                success: false,
                message: "Patient not found."

            });

        }

        /* Insert emergency */

        const result = await pool.query(

            `
            INSERT INTO emergency_cases
            (
                patient_id,
                doctor_id,
                category,
                priority,
                department,
                symptoms,
                emergency_notes,
                ambulance_required,
                arrival_type
            )

            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,$8,$9
            )

            RETURNING id
            `,

            [

                patientId,
                doctorId || null,
                category,
                priority,
                department,
                symptoms,
                emergencyNotes || "",
                ambulanceRequired || false,
                arrivalType || "Walk-in"

            ]

        );

        /* Insert first status */

        await pool.query(

            `
            INSERT INTO emergency_status_history
            (
                emergency_id,
                status
            )

            VALUES
            (
                $1,
                'Booked'
            )
            `,

            [

                result.rows[0].id

            ]

        );

        res.json({

            success: true,
            emergencyId: result.rows[0].id,
            message: "Emergency case created successfully."

        });

    }

    catch (err) {

        console.log(err);

        res.status(500).json({

            success: false,
            message: "Server Error"

        });

    }

});


/* =====================================================
   GET ALL EMERGENCY CASES
===================================================== */

router.get("/list", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(

            `
           SELECT

e.id,

p.id AS patient_id,

u.name,

p.age,

p.gender,

e.category,

e.priority,

e.department,

e.status,

e.created_at

FROM emergency_cases e

JOIN patients p
ON e.patient_id=p.id

JOIN users u
ON p.user_id=u.id

ORDER BY

CASE

WHEN e.priority='Critical' THEN 1
WHEN e.priority='Very Urgent' THEN 2
WHEN e.priority='Urgent' THEN 3
ELSE 4

END,

e.created_at;
            `

        );

        res.json(result.rows);

    }

    catch (err) {

        console.log(err);

        res.status(500).json([]);

    }

});


/* =====================================================
   GET EMERGENCY DETAILS
===================================================== */

router.get("/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(

            `
           SELECT

e.*,

u.name,

p.age,

p.gender,

p.blood_group,

p.allergies

FROM emergency_cases e

JOIN patients p
ON e.patient_id=p.id

JOIN users u
ON p.user_id=u.id

WHERE e.id=$1;
            `,

            [

                req.params.id

            ]

        );

        if (result.rows.length === 0) {

            return res.status(404).json({

                success: false,
                message: "Emergency case not found."

            });

        }

        res.json(result.rows[0]);

    }

    catch (err) {

        console.log(err);

        res.status(500).json({

            success: false

        });

    }

});


/* =====================================================
   UPDATE STATUS
===================================================== */

router.put("/status/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const { status } = req.body;

        await pool.query(

            `
            UPDATE emergency_cases

            SET

                status=$1,

                updated_at=CURRENT_TIMESTAMP

            WHERE id=$2
            `,

            [

                status,

                req.params.id

            ]

        );

        await pool.query(

            `
            INSERT INTO emergency_status_history
            (
                emergency_id,
                status
            )

            VALUES
            (
                $1,
                $2
            )
            `,

            [

                req.params.id,
                status

            ]

        );

        res.json({

            success: true

        });

    }

    catch (err) {

        console.log(err);

        res.status(500).json({

            success: false

        });

    }

});

/* =====================================================
   GET DOCTORS BY SPECIALISATION
===================================================== */

router.get("/doctors/:specialisation", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(

            `
            SELECT

                d.id,
                u.name

            FROM doctors d

            JOIN users u
            ON d.user_id = u.id

            WHERE d.specialisation = $1

            ORDER BY u.name
            `,

            [req.params.specialisation]

        );

        res.json(result.rows);

    }

    catch(err){

        console.log(err);

        res.status(500).json([]);

    }

});
/* =====================================================
   SEARCH PATIENT
===================================================== */

router.get("/search-patient/:text", async (req,res)=>{

    const pool=req.app.locals.pool;

    try{

        const text="%"+req.params.text+"%";

        const result=await pool.query(

            `
            SELECT

                p.id,

                u.name,

                u.mobile,

                p.age,

                p.gender

            FROM patients p

            JOIN users u
            ON p.user_id=u.id

            WHERE

            LOWER(u.name) LIKE LOWER($1)

            OR

            u.mobile LIKE $1

            LIMIT 10
            `,

            [text]

        );

        res.json(result.rows);

    }

    catch(err){

        console.log(err);

        res.status(500).json([]);

    }

});

module.exports = router;