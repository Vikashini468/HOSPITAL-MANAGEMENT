const express = require("express");
const router = express.Router();

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
                p.photo

            FROM users u

            LEFT JOIN patients p
            ON u.id = p.user_id

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
                age:row.age,
                gender:row.gender,
                blood_group:row.blood_group,
                weight:row.weight,
                allergies:row.allergies,
                previous_hospital:row.previous_hospital,
                address:row.address,
                photo:row.photo
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

    try{

        const{

            doctorId,
            patientId,
            appointmentDate,
            appointmentTime,
            symptoms

        }=req.body;


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


        /* Generate next token */

        /* Check whether this time slot is already booked */

const slotCheck = await pool.query(

    `
    SELECT id
    FROM appointments
    WHERE doctor_id = $1
    AND appointment_date = $2
    AND appointment_time = $3
    `,

    [
        doctorId,
        appointmentDate,
        appointmentTime
    ]

);

if (slotCheck.rows.length > 0) {

    return res.status(400).json({

        success: false,
        message: "This time slot is already booked."

    });

}


/* Generate next token */

const tokenResult = await pool.query(`
    SELECT COALESCE(MAX(token_no), 0) + 1 AS token
    FROM appointments
    WHERE doctor_id = $1
    AND appointment_date = CURRENT_DATE
`, [doctorId]);
const tokenNo = tokenResult.rows[0].token;

await pool.query(`
    INSERT INTO appointments
    (
        doctor_id,
        patient_id,
        appointment_date,
        appointment_time,
        token_no,
        status,
        symptoms
    )
    VALUES ($1,$2,CURRENT_DATE,$3,$4,'Waiting',$5)
`, [
    doctorId,
    patientId,
    appointmentTime,
    tokenNo,
    symptoms
]);
        

        res.json({

            success:true,
            token:tokenNo

        });

    }

    catch(err){

        console.log(err);

        res.status(500).json({

            success:false,
            message:"Unable to book appointment"

        });

    }

});


/* =====================================================
   MY APPOINTMENTS
===================================================== */

router.get("/patient/appointments/:id", async (req, res) => {
    const pool = req.app.locals.pool;

    try {
        const result = await pool.query(`
            SELECT
    a.id,
    a.doctor_id,
    a.patient_id,
    a.appointment_date,
    a.appointment_time,
    a.token_no,
    a.status,
    a.symptoms,
    u.name AS doctor_name
FROM appointments a
JOIN users u
ON u.id = a.doctor_id
WHERE a.patient_id = $1
AND UPPER(a.status) NOT IN ('COMPLETED', 'REVIEWED', 'LAB_COMPLETED', 'INPROGRESS')
ORDER BY a.appointment_date DESC,
         a.appointment_time DESC;
        `, [req.params.id]);

        res.json(result.rows);

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Server Error" });
    }
});
router.get("/patient/prescriptions/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(
            `
            SELECT
                p.id,
                m.medicine_name,
                pm.quantity,
                pm.duration,
                u.name AS doctor_name,
                p.created_at

            FROM prescriptions p

            JOIN prescription_medicines pm
                ON pm.prescription_id = p.id

            JOIN medicines m
                ON m.id = pm.medicine_id

            JOIN users u
                ON u.id = p.doctor_id

            WHERE p.patient_id = $1

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
module.exports = router;