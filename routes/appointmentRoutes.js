const express = require("express");
const router = express.Router();

/* =====================================================
   START CONSULTATION
===================================================== */

router.post("/start/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try{

        await pool.query(

            `
            UPDATE appointments
            SET status='INPROGRESS'
            WHERE id=$1
            `,

            [req.params.id]

        );

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
                AND lr.status='COMPLETED'

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
===================================================== */

router.post("/complete/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try{

        await pool.query(

            `
            UPDATE appointments
            SET status='COMPLETED'
            WHERE id=$1
            `,

            [req.params.id]

        );

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
   CONFIRM CONSULTATION AFTER LAB REPORT
===================================================== */

router.post("/confirm-lab/:appointmentId", async (req,res)=>{

    const pool = req.app.locals.pool;

    try{

        const appointmentId = req.params.appointmentId;

        // Mark lab request reviewed

        await pool.query(

            `
            UPDATE lab_requests
            SET status='REVIEWED'
            WHERE appointment_id=$1
            `,

            [appointmentId]

        );

        // Complete appointment

        await pool.query(

            `
            UPDATE appointments
            SET status='COMPLETED'
            WHERE id=$1
            `,

            [appointmentId]

        );
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

module.exports = router;