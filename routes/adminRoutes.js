const express = require("express");
const router = express.Router();

/* ========================
   PENDING USERS
======================== */
router.get("/pending-users", async (req, res) => {
    const pool = req.app.locals.pool;
    const result = await pool.query(`
        SELECT id, name, email, role, mobile, address, approved
        FROM users
        WHERE approved = false
        ORDER BY created_at DESC
    `);
    res.json(result.rows);
});

router.get("/user/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    const result = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
    if(result.rows.length === 0)
        return res.status(404).json({ message: "User not found" });
    res.json(result.rows[0]);
});

router.post("/approve-user/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    await pool.query(`UPDATE users SET approved=true WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
});

router.post("/reject-user/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    await pool.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
});

/* ========================
   DASHBOARD STATS
======================== */
router.get("/stats/purchase", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const uploads = await pool.query(`SELECT COUNT(*) AS total_uploads, COALESCE(SUM(total_items),0) AS total_items FROM purchase_uploads`);
        res.json(uploads.rows[0]);
    } catch(e) {
        res.json({ total_uploads: 0, total_items: 0 });
    }
});

router.get("/stats/maintenance", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE status='pending') AS pending,
                COUNT(*) FILTER (WHERE status='approved') AS approved,
                COUNT(*) FILTER (WHERE status='completed') AS completed,
                COUNT(*) FILTER (WHERE status='rejected') AS rejected
            FROM maintenance_requests
        `);
        res.json(result.rows[0]);
    } catch(e) {
        res.json({ pending: 0, approved: 0, completed: 0, rejected: 0 });
    }
});

module.exports = router;
