const fs = require("fs");
const csv = require("csv-parser");
const { Pool } = require("pg");

const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "nalamaihospital",
    password: "vikashini",
    port: 5432
});

async function insertMedicine(row) {
    try {
        await pool.query(`
            INSERT INTO medicines
            (medicine_name, type, price, quantity, composition)
            VALUES ($1,$2,$3,$4,$5)
        `, [
            row.medicine,
            row.type,
            parseFloat(row.price),
            parseInt(row.quantity),
            row.composition
        ]);

        console.log("Inserted:", row.medicine);

    } catch (err) {
        console.log("Insert error:", err.message);
    }
}

fs.createReadStream("medicine.csv")
    .pipe(csv())
    .on("data", async (row) => {
        await insertMedicine(row);
    })
    .on("end", () => {
        console.log("CSV import completed");
    });