const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");

module.exports = (db, io) => {

    const router = express.Router();

    const upload = multer({
        dest: "uploads/"
    });

    /* ===========================
       PURCHASE EXCEL UPLOAD
    =========================== */

    router.post("/upload", upload.single("file"), async (req, res) => {

        try {

            const workbook = XLSX.readFile(req.file.path);

            const sheet = workbook.Sheets[
                workbook.SheetNames[0]
            ];

            const items = XLSX.utils.sheet_to_json(sheet);

            let inserted = 0;

            for (const item of items) {

                if (!item.item_name || !item.quantity)
                    continue;

                await db.query(`
                    INSERT INTO purchase_stock
                    (
                        item_name,
                        item_type,
                        supplier,
                        quantity,
                        rate,
                        expiry_date,
                        batch_no
                    )
                    VALUES($1,$2,$3,$4,$5,$6,$7)
                `,
                [
                    item.item_name,
                    item.item_type,
                    item.supplier,
                    item.quantity,
                    item.rate,
                    item.expiry_date,
                    item.batch_no
                ]);

                inserted++;

                if (item.item_type === "Medicine") {

                    await db.query(`
                        INSERT INTO medicine_stock
                        (
                            medicine_name,
                            batch_no,
                            quantity,
                            expiry_date,
                            status
                        )
                        VALUES($1,$2,$3,$4,'Available')
                        ON CONFLICT DO NOTHING
                    `,
                    [
                        item.item_name,
                        item.batch_no,
                        item.quantity,
                        item.expiry_date
                    ]);

                }

                if (item.item_type === "Equipment") {

                    await db.query(`
                        INSERT INTO equipment_stock
                        (
                            equipment_name,
                            quantity,
                            supplier,
                            status
                        )
                        VALUES($1,$2,$3,'Active')
                    `,
                    [
                        item.item_name,
                        item.quantity,
                        item.supplier
                    ]);

                }

            }

            await db.query(`
                INSERT INTO purchase_uploads
                (
                    uploaded_by,
                    staff_id,
                    file_name,
                    file_path,
                    total_items
                )
                VALUES($1,$2,$3,$4,$5)
            `,
            [
                "Purchase Staff",
                "PUR001",
                req.file.originalname,
                req.file.path,
                inserted
            ]);

            io.emit("stockUpdated");

            res.json({
                success: true,
                records: inserted
            });

        }
        catch (err) {

            console.log(err);

            res.status(500).json(err);

        }

    });

    /* ===========================
       PURCHASE UPLOADS
    =========================== */

    router.get("/uploads", async (req, res) => {

        const result = await db.query(`
            SELECT *
            FROM purchase_uploads
            ORDER BY id DESC
        `);

        res.json(result.rows);

    });

    /* ===========================
       PURCHASE REPORT
    =========================== */

    router.get("/report", async (req, res) => {

        const result = await db.query(`
            SELECT *
            FROM purchase_stock
            ORDER BY id DESC
        `);

        res.json(result.rows);

    });

    /* ===========================
       MEDICINE STOCK
    =========================== */

    router.get("/medicine-stock", async (req, res) => {

        const result = await db.query(`
            SELECT *
            FROM medicine_stock
            ORDER BY id DESC
        `);

        res.json(result.rows);

    });

    /* ===========================
       VIEW EXCEL FILE
    =========================== */

    router.get("/view-file/:id", async (req, res) => {

        const result = await db.query(`
            SELECT file_path
            FROM purchase_uploads
            WHERE id=$1
        `,
        [req.params.id]);

        if (result.rows.length === 0)
            return res.send("File not found");

        const workbook = XLSX.readFile(result.rows[0].file_path);

        const sheet = workbook.Sheets[
            workbook.SheetNames[0]
        ];

        res.send(
            XLSX.utils.sheet_to_html(sheet)
        );

    });

    /* ===========================
       ADMIN REPORT POST
    =========================== */

    router.post("/admin-report", async (req, res) => {

        const { purchase_id, message } = req.body;

        await db.query(`
            INSERT INTO purchase_reports
            (
                purchase_id,
                message
            )
            VALUES($1,$2)
        `,
        [
            purchase_id,
            message
        ]);

        res.json({
            success: true
        });

    });

    /* ===========================
       PURCHASE REPORTS GET
    =========================== */

    router.get("/reports", async (req, res) => {
        try {
            const result = await db.query(`SELECT * FROM purchase_reports ORDER BY id DESC`);
            res.json(result.rows);
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    /* ===========================
       EDIT PURCHASE UPLOAD
    =========================== */

    router.put("/edit/:id", async (req, res) => {
        try {
            const { supplier, quantity, rate } = req.body;
            await db.query(`
                UPDATE purchase_stock SET supplier=$1, quantity=$2, rate=$3 WHERE id=$4
            `, [supplier, quantity, rate, req.params.id]);
            res.json({ success: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;

};