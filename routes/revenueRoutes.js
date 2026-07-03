const express = require("express");
const router  = express.Router();

/* =====================================================
   SUMMARY — Total Revenue, Expenses, Net Profit
===================================================== */

router.get("/summary", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const revenueResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM hospital_revenue
        `);

        const expenseResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM hospital_expenses
        `);

        const totalRevenue  = Number(revenueResult.rows[0].total);
        const totalExpenses = Number(expenseResult.rows[0].total);
        const netProfit     = totalRevenue - totalExpenses;

        res.json({ totalRevenue, totalExpenses, netProfit });

    } catch (err) {

        console.error(err);
        res.status(500).json({ totalRevenue: 0, totalExpenses: 0, netProfit: 0 });

    }

});

/* =====================================================
   MONTHLY — Revenue per month for current year
===================================================== */

router.get("/monthly", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT
                TO_CHAR(revenue_date, 'Mon') AS month,
                EXTRACT(MONTH FROM revenue_date)  AS month_num,
                COALESCE(SUM(amount), 0)          AS total
            FROM hospital_revenue
            WHERE EXTRACT(YEAR FROM revenue_date) = EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY
                TO_CHAR(revenue_date, 'Mon'),
                EXTRACT(MONTH FROM revenue_date)
            ORDER BY
                EXTRACT(MONTH FROM revenue_date)
        `);

        const months  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const revenue = new Array(12).fill(0);

        result.rows.forEach(r => {
            const idx = months.indexOf(r.month.trim());
            if (idx >= 0) revenue[idx] = Number(r.total);
        });

        res.json({ labels: months, revenue });

    } catch (err) {

        console.error(err);
        res.status(500).json({ labels: [], revenue: [] });

    }

});

/* =====================================================
   SOURCE-WISE — Revenue grouped by source
===================================================== */

router.get("/source-wise", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT
                source,
                COALESCE(SUM(amount), 0) AS total
            FROM hospital_revenue
            GROUP BY source
            ORDER BY total DESC
        `);

        if (!result.rows.length) {
            return res.json({ labels: [], data: [] });
        }

        res.json({
            labels: result.rows.map(r => r.source),
            data:   result.rows.map(r => Number(r.total))
        });

    } catch (err) {

        console.error(err);
        res.status(500).json({ labels: [], data: [] });

    }

});

/* =====================================================
   EXPENSE-WISE — Expenses grouped by category
===================================================== */

router.get("/expense-wise", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT
                category,
                COALESCE(SUM(amount), 0) AS total
            FROM hospital_expenses
            GROUP BY category
            ORDER BY total DESC
        `);

        if (!result.rows.length) {
            return res.json({ labels: [], data: [] });
        }

        res.json({
            labels: result.rows.map(r => r.category),
            data:   result.rows.map(r => Number(r.total))
        });

    } catch (err) {

        console.error(err);
        res.status(500).json({ labels: [], data: [] });

    }

});

/* =====================================================
   RECENT REVENUE TRANSACTIONS
===================================================== */

router.get("/recent-revenue", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT id, source, amount, revenue_date
            FROM hospital_revenue
            ORDER BY revenue_date DESC
            LIMIT 10
        `);

        res.json(result.rows);

    } catch (err) {

        console.error(err);
        res.status(500).json([]);

    }

});

/* =====================================================
   RECENT EXPENSE TRANSACTIONS
===================================================== */

router.get("/recent-expenses", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT id, category, amount, expense_date
            FROM hospital_expenses
            ORDER BY expense_date DESC
            LIMIT 10
        `);

        res.json(result.rows);

    } catch (err) {

        console.error(err);
        res.status(500).json([]);

    }

});

/* =====================================================
   BREAKDOWN — Expenses split by category including Salary
===================================================== */

router.get("/breakdown", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const revenueResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) AS total FROM hospital_revenue
        `);

        const expenseBreakdown = await pool.query(`
            SELECT category, COALESCE(SUM(amount), 0) AS total
            FROM hospital_expenses
            GROUP BY category
            ORDER BY total DESC
        `);

        const totalRevenue  = Number(revenueResult.rows[0].total);
        const totalExpenses = expenseBreakdown.rows.reduce((sum, r) => sum + Number(r.total), 0);
        const netProfit     = totalRevenue - totalExpenses;

        const salaryRow  = expenseBreakdown.rows.find(r => r.category === 'Salary');
        const salaryTotal = salaryRow ? Number(salaryRow.total) : 0;

        res.json({
            totalRevenue,
            totalExpenses,
            netProfit,
            salaryExpenses: salaryTotal,
            breakdown: expenseBreakdown.rows.map(r => ({
                category: r.category,
                total: Number(r.total)
            }))
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ totalRevenue: 0, totalExpenses: 0, netProfit: 0, salaryExpenses: 0, breakdown: [] });
    }

});

/* =====================================================
   EXPORT
===================================================== */

module.exports = router;
