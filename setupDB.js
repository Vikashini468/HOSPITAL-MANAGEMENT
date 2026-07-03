// Run this once: node setupDB.js
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "nalamaihospital",
    password: "vikashini",
    port: 5432
});

async function setup() {
    const client = await pool.connect();
    try {
        console.log("Creating tables...");

        await client.query(`
            CREATE TABLE IF NOT EXISTS purchase_stock (
                id SERIAL PRIMARY KEY,
                item_name VARCHAR(255) NOT NULL,
                item_type VARCHAR(100),
                supplier VARCHAR(255),
                quantity INTEGER,
                rate NUMERIC(10,2),
                expiry_date VARCHAR(50),
                batch_no VARCHAR(100),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS purchase_uploads (
                id SERIAL PRIMARY KEY,
                uploaded_by VARCHAR(255),
                staff_id VARCHAR(100),
                file_name VARCHAR(255),
                file_path VARCHAR(500),
                total_items INTEGER DEFAULT 0,
                uploaded_time TIMESTAMP DEFAULT NOW()
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS purchase_reports (
                id SERIAL PRIMARY KEY,
                purchase_id INTEGER REFERENCES purchase_uploads(id) ON DELETE SET NULL,
                admin_name VARCHAR(255),
                message TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS medicine_stock (
                id SERIAL PRIMARY KEY,
                medicine_name VARCHAR(255),
                batch_no VARCHAR(100),
                quantity INTEGER,
                expiry_date VARCHAR(50),
                status VARCHAR(50) DEFAULT 'Available',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS equipment_stock (
                id SERIAL PRIMARY KEY,
                equipment_name VARCHAR(255),
                quantity INTEGER,
                supplier VARCHAR(255),
                status VARCHAR(50) DEFAULT 'Active',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS maintenance_requests (
                id SERIAL PRIMARY KEY,
                department VARCHAR(100),
                category VARCHAR(100),
                asset_name VARCHAR(255),
                problem TEXT,
                priority VARCHAR(50),
                requested_by VARCHAR(255),
                status VARCHAR(50) DEFAULT 'pending',
                approved_by VARCHAR(255),
                technician VARCHAR(255),
                token_no VARCHAR(20),
                work_done TEXT,
                approved_date TIMESTAMP,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);

        console.log("All tables created successfully.");
    } catch(e) {
        console.error("Error creating tables:", e.message);
    } finally {
        client.release();
        await pool.end();
    }
}

setup();
