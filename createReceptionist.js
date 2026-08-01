/**
 * Aarudhra Multispeciality Hospital
 * Create Dummy Receptionist Account
 *
 * Run once:  node createReceptionist.js
 */

require("dotenv").config();
const { Pool } = require("pg");
const bcrypt   = require("bcrypt");

const pool = new Pool({
    user:     "postgres",
    host:     "localhost",
    database: "nalamaihospital",
    password: "vikashini",
    port:     5432
});

/* ── Receptionist credentials ── */
const RECEPTIONIST = {
    name:       "Priya Receptionist",
    email:      "receptionist@aarudhra.com",
    mobile:     "9876543210",
    password:   "Recept@2025",          /* plain – will be hashed */
    role:       "receptionist",
    gender:     "Female",
    department: "Front Desk",
    employee_id:"REC-001"
};

async function run() {
    const client = await pool.connect();
    try {
        /* 1. Check if already exists */
        const exists = await client.query(
            `SELECT id FROM users WHERE email = $1`,
            [RECEPTIONIST.email]
        );

        if (exists.rows.length > 0) {
            console.log("⚠️  Receptionist account already exists.");
            console.log("   Email   :", RECEPTIONIST.email);
            console.log("   Password: (already set — check DB or re-run after deleting the row)");
            return;
        }

        /* 2. Hash password */
        const hashed = await bcrypt.hash(RECEPTIONIST.password, 10);

        /* 3. Build username */
        const username = `receptionist@priyareceptionist`;

        /* 4. Insert into users — pre-approved so they can log in immediately */
        const result = await client.query(
            `INSERT INTO users
             (name, username, email, mobile, password, role, gender, approved, verified, profile_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7, true, true, 'APPROVED')
             RETURNING id, name, email, role`,
            [
                RECEPTIONIST.name,
                username,
                RECEPTIONIST.email,
                RECEPTIONIST.mobile,
                hashed,
                RECEPTIONIST.role,
                RECEPTIONIST.gender
            ]
        );

        const userId = result.rows[0].id;

        console.log("✅  Receptionist account created successfully.");
        console.log("─────────────────────────────────────────────");
        console.log("   Name     :", RECEPTIONIST.name);
        console.log("   Email    :", RECEPTIONIST.email);
        console.log("   Password :", RECEPTIONIST.password);
        console.log("   Role     :", RECEPTIONIST.role);
        console.log("   User ID  :", userId);
        console.log("─────────────────────────────────────────────");
        console.log("⚠️  Delete this file or remove the plain-text");
        console.log("   password after first login.");

    } catch (err) {
        console.error("❌  Error:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

run();
