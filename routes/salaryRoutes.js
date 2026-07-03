const express = require("express");
const router = express.Router();

/* =====================================================
   GET ALL EMPLOYEE ROLES
===================================================== */

router.get("/roles", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`
            SELECT DISTINCT role
            FROM users
            WHERE LOWER(role) <> 'patient'
            ORDER BY role
        `);

        res.json(result.rows);

    }

    catch (err) {

        console.log(err);

        res.status(500).json([]);

    }

});

/* =====================================================
   GET EMPLOYEES
===================================================== */

router.get("/employees", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const { role } = req.query;

        let query = `
            SELECT
                u.id,
                u.name,
                u.role,
                COALESCE(s.department,'-') AS department,
                COALESCE(s.basic_salary,0) AS basic_salary,
                COALESCE(s.allowance,0) AS allowance,
                COALESCE(s.deduction,0) AS deduction,
                (
                    COALESCE(s.basic_salary,0)
                    + COALESCE(s.allowance,0)
                    - COALESCE(s.deduction,0)
                ) AS total_salary,
                COALESCE(p.status, 'Pending') AS payment_status
            FROM users u
            LEFT JOIN employee_salary s ON s.employee_id = u.id
            LEFT JOIN LATERAL (
                SELECT status FROM salary_payments
                WHERE user_id = u.id
                ORDER BY year DESC,
                    CASE TRIM(month)
                        WHEN 'January'   THEN 1
                        WHEN 'February'  THEN 2
                        WHEN 'March'     THEN 3
                        WHEN 'April'     THEN 4
                        WHEN 'May'       THEN 5
                        WHEN 'June'      THEN 6
                        WHEN 'July'      THEN 7
                        WHEN 'August'    THEN 8
                        WHEN 'September' THEN 9
                        WHEN 'October'   THEN 10
                        WHEN 'November'  THEN 11
                        WHEN 'December'  THEN 12
                        ELSE 0
                    END DESC
                LIMIT 1
            ) p ON true
            WHERE LOWER(u.role) <> 'patient'
        `;

        let values = [];

        if (role) {

            query += " AND u.role = $1";

            values.push(role);

        }

        query += " ORDER BY u.name";

        const result = await pool.query(query, values);

        res.json(result.rows);

    }

    catch (err) {

        console.log(err);

        res.status(500).json([]);

    }

});
/* =====================================================
   STATS — counts from users table
===================================================== */

router.get("/stats", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const totalResult = await pool.query(`
            SELECT COUNT(*) AS total
            FROM users
            WHERE LOWER(role) <> 'patient'
        `);

        const payrollResult = await pool.query(`
            SELECT COALESCE(SUM(total_salary), 0) AS payroll
            FROM employee_salary
        `);

        const paidResult = await pool.query(`
            SELECT COUNT(DISTINCT user_id) AS paid
            FROM salary_payments
            WHERE LOWER(status) = 'paid'
        `);

        const total = parseInt(totalResult.rows[0].total);
        const paid  = parseInt(paidResult.rows[0].paid);

        res.json({
            totalEmployees:  total,
            monthlyPayroll:  parseFloat(payrollResult.rows[0].payroll),
            paidEmployees:   paid,
            pendingEmployees: total - paid
        });

    } catch (err) {
        console.log(err);
        res.status(500).json({ totalEmployees: 0, monthlyPayroll: 0, paidEmployees: 0, pendingEmployees: 0 });
    }

});

/* =====================================================
   CREATE / UPDATE EMPLOYEE SALARY
===================================================== */

router.post("/update", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const {

            employeeId,
            basicSalary,
            hra,
            allowance,
            bonus,
            deduction

        } = req.body;

        if (!employeeId) {

            return res.status(400).json({

                success: false,
                message: "Employee ID is required"

            });

        }

        const totalSalary =
            Number(basicSalary || 0)
            + Number(hra || 0)
            + Number(allowance || 0)
            + Number(bonus || 0)
            - Number(deduction || 0);

        /* ---------------------------------------
           CHECK WHETHER RECORD EXISTS
        --------------------------------------- */

        const check = await pool.query(

            `
            SELECT id
            FROM employee_salary
            WHERE employee_id = $1
            `,

            [employeeId]

        );

        if (check.rows.length > 0) {

            /* UPDATE */

            await pool.query(

                `
                UPDATE employee_salary
                SET
                    basic_salary = $1,
                    hra          = $2,
                    allowance    = $3,
                    bonus        = $4,
                    deduction    = $5,
                    total_salary = $6,
                    updated_at   = NOW()
                WHERE employee_id = $7
                `,

                [basicSalary, hra, allowance, bonus, deduction, totalSalary, employeeId]

            );

        }

        else {

            /* GET EMPLOYEE ROLE */

            const emp = await pool.query(

                `
                SELECT role
                FROM users
                WHERE id = $1
                `,

                [employeeId]

            );

            const department =
                emp.rows.length
                    ? emp.rows[0].role
                    : "General";

            /* INSERT */

            await pool.query(

                `
                INSERT INTO employee_salary
                (employee_id, department, basic_salary, hra, allowance, bonus, deduction, total_salary)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                `,

                [employeeId, department, basicSalary, hra, allowance, bonus, deduction, totalSalary]

            );

        }

        res.json({

            success: true,
            message: "Salary updated successfully"

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
   RECORD SALARY PAYMENT
===================================================== */

router.post("/pay", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const { employeeId, month, year, status } = req.body;

        if (!employeeId || !month || !year) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        console.log("PAY payload:", { employeeId, month, year, status });

        /* Get net salary from employee_salary */
        const salaryResult = await pool.query(
            `SELECT total_salary FROM employee_salary WHERE employee_id = $1`,
            [employeeId]
        );

        const totalSalary = salaryResult.rows.length ? salaryResult.rows[0].total_salary : 0;

        /* Check if a payment record already exists for this employee/month/year */
        const existing = await pool.query(
            `SELECT id FROM salary_payments WHERE user_id = $1 AND month = $2 AND year = $3`,
            [employeeId, month.trim(), parseInt(year)]
        );

        if (existing.rows.length > 0) {

            /* UPDATE existing record */
            await pool.query(
                `UPDATE salary_payments
                 SET status = $1, total_salary = $2, payment_date = NOW()
                 WHERE user_id = $3 AND month = $4 AND year = $5`,
                [status, totalSalary, employeeId, month.trim(), parseInt(year)]
            );

        } else {

            /* INSERT new record */
            await pool.query(
                `INSERT INTO salary_payments (user_id, month, year, total_salary, status, payment_date)
                 VALUES ($1, $2, $3, $4, $5, NOW())`,
                [employeeId, month.trim(), parseInt(year), totalSalary, status]
            );

        }

        /* -----------------------------------------------
           Sync to hospital_expenses when status = Paid
           Always insert a new expense row per payment
        ----------------------------------------------- */
        if (status === 'Paid') {

            await pool.query(
                `INSERT INTO hospital_expenses (category, amount, expense_date)
                 VALUES ('Salary', $1, NOW())`,
                [totalSalary]
            );

        }

        res.json({ success: true });

    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Server Error" });
    }

});

/* =====================================================
   SALARY HISTORY
===================================================== */

router.get("/history/:employeeId", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(
            `
            SELECT month, year, total_salary AS salary, payment_date, status
            FROM salary_payments
            WHERE user_id = $1
            ORDER BY year DESC, month DESC
            `,
            [req.params.employeeId]
        );

        res.json(result.rows);

    } catch (err) {
        console.log(err);
        res.status(500).json([]);
    }

});

/* =====================================================
   EXPORT ROUTER
===================================================== */

module.exports = router;