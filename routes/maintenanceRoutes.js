const express = require("express");

module.exports = (db, io) => {

    const router = express.Router();

    // CREATE REQUEST
    router.post("/create", async (req, res) => {
        try {
            const { department, category, asset_name, problem, priority, requested_by } = req.body;

            const result = await db.query(`
                INSERT INTO maintenance_requests
                (department, category, asset_name, problem, priority, requested_by, status, created_at)
                VALUES($1,$2,$3,$4,$5,$6,'pending',NOW())
                RETURNING *
            `, [department, category, asset_name, problem, priority, requested_by]);

            io.emit("maintenanceUpdated");

            res.json({ success: true, data: result.rows[0] });
        }
        catch (e) {
            console.log(e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // ALL REQUESTS (staff view)
    router.get("/my", async (req, res) => {
        const data = await db.query(`SELECT * FROM maintenance_requests ORDER BY id DESC`);
        res.json(data.rows);
    });

    // MANAGER - PENDING REQUESTS
    router.get("/manager/pending", async (req, res) => {
        const data = await db.query(`
            SELECT * FROM maintenance_requests WHERE status='pending' ORDER BY id DESC
        `);
        res.json(data.rows);
    });

    // APPROVE REQUEST
    router.put("/approve/:id", async (req, res) => {
        try {
            const { approved_by, technician } = req.body;

            const token = Math.random().toString(36).substring(2, 6).toUpperCase();

            const data = await db.query(`
                UPDATE maintenance_requests
                SET status='approved', approved_by=$1, technician=$2, token_no=$3, approved_date=NOW()
                WHERE id=$4
                RETURNING *
            `, [approved_by, technician, token, req.params.id]);

            io.emit("maintenanceUpdated");

            res.json({ success: true, token: token, data: data.rows[0] });
        }
        catch (e) {
            console.log(e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // REJECT REQUEST
    router.put("/reject/:id", async (req, res) => {
        await db.query(`UPDATE maintenance_requests SET status='rejected' WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
    });

    // APPROVED LIST
    router.get("/approved", async (req, res) => {
        const data = await db.query(`
            SELECT * FROM maintenance_requests WHERE status='approved' ORDER BY approved_date DESC
        `);
        res.json(data.rows);
    });

    // COMPLETE WORK
    router.put("/complete/:id", async (req, res) => {
        const { work_done } = req.body;
        await db.query(`
            UPDATE maintenance_requests
            SET status='completed', work_done=$1, completed_at=NOW()
            WHERE id=$2
        `, [work_done, req.params.id]);
        res.json({ success: true });
    });

    // COMPLETED TOKENS LIST
    router.get("/tokens", async (req, res) => {
        const data = await db.query(`
            SELECT * FROM maintenance_requests WHERE status='completed' ORDER BY completed_at DESC
        `);
        res.json(data.rows);
    });

    // SINGLE TOKEN DETAIL
    router.get("/token/:id", async (req, res) => {
        const data = await db.query(`SELECT * FROM maintenance_requests WHERE id=$1`, [req.params.id]);
        res.json(data.rows[0]);
    });

    // ALL REQUESTS (admin view)
    router.get("/all", async (req, res) => {
        const data = await db.query(`SELECT * FROM maintenance_requests ORDER BY id DESC`);
        res.json(data.rows);
    });

    return router;
};
