const express = require("express");
const router = express.Router();

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
        const result = await pool.query(`
            SELECT
                p.id AS prescription_id,
                pu.name AS patient_name,
                du.name AS doctor_name,
                m.medicine_name,
                m.price,
                pm.quantity,
                pm.duration,
                (pm.quantity * m.price) AS total_amount,
                p.status,
                p.created_at
            FROM prescriptions p
            JOIN prescription_medicines pm ON pm.prescription_id = p.id
            JOIN medicines m ON m.id = pm.medicine_id
            JOIN users pu ON pu.id = p.patient_id
            JOIN users du ON du.id = p.doctor_id
            WHERE p.status != 'Completed'
            ORDER BY p.created_at DESC
        `);

        res.json(result.rows);

    } catch (err) {
        console.log(err);
        res.status(500).json([]);
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

        const prescriptionResult = await pool.query(
            `INSERT INTO prescriptions (patient_id, doctor_id, appointment_id, notes)
             VALUES ($1,$2,$3,'') RETURNING id`,
            [patientId, doctorId, appointmentId]
        );

        const prescriptionId = prescriptionResult.rows[0].id;

        // Save all medicines
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

            await pool.query(
                `
                INSERT INTO prescription_medicines
                (
                    prescription_id,
                    medicine_id,
                    dosage,
                    duration,
                    quantity
                )
                VALUES ($1,$2,$3,$4,$5)
                `,
                [
                    prescriptionId,
                    medicineId,
                    med.type,
                    med.days + " Days",
                    med.quantity
                ]
            );
        }

        res.json({
            success: true
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});
router.post("/pharmacy/complete-prescription/:id", async (req, res) => {
    const pool = req.app.locals.pool;

    const prescriptionId = req.params.id;

    try {
        // 1. Get all medicines in this prescription
        const meds = await pool.query(`
            SELECT pm.medicine_id, pm.quantity, m.medicine_name
            FROM prescription_medicines pm
            JOIN medicines m ON m.id = pm.medicine_id
            WHERE pm.prescription_id = $1
        `, [prescriptionId]);

        // 2. Deduct stock for each medicine
        for (const row of meds.rows) {
            await pool.query(`
                UPDATE medicines
                SET quantity = quantity - $1
                WHERE id = $2
            `, [row.quantity, row.medicine_id]);
        }

        // 3. Mark prescription as completed
        await pool.query(`
            UPDATE prescriptions
            SET status = 'Completed'
            WHERE id = $1
        `, [prescriptionId]);

        res.json({ success: true });

    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false });
    }
});

module.exports = router;