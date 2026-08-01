/* =====================================================
   NALAM AI — NEW TABLES MIGRATION
   Run once:  node migrate.js
   Safe to re-run (IF NOT EXISTS everywhere).
===================================================== */
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    user:     "postgres",
    host:     "localhost",
    database: "nalamaihospital",
    password: "vikashini",
    port:     5432
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log("Running migration…");

        /* ── 1. staff_profiles ─────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS staff_profiles (
                id                  SERIAL PRIMARY KEY,
                user_id             INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                employee_id         VARCHAR(50) UNIQUE,
                department          VARCHAR(100),
                date_of_joining     DATE,
                profile_photo       VARCHAR(255),
                address             TEXT,
                city                VARCHAR(100),
                state               VARCHAR(100),
                pincode             VARCHAR(10),
                dob                 DATE,
                gender              VARCHAR(20),
                /* doctor-specific */
                medical_reg_no      VARCHAR(100),
                reg_authority       VARCHAR(200),
                specialization      VARCHAR(150),
                years_experience    INTEGER,
                languages_known     TEXT,
                /* nurse */
                nursing_reg_no      VARCHAR(100),
                nursing_reg_auth    VARCHAR(200),
                /* lab */
                lab_certification   VARCHAR(200),
                /* pharmacist */
                pharmacy_reg_no     VARCHAR(100),
                pharmacy_reg_auth   VARCHAR(200),
                /* status */
                profile_status      VARCHAR(50)  DEFAULT 'INCOMPLETE',
                verification_status VARCHAR(50)  DEFAULT 'PENDING_VERIFICATION',
                rejection_reason    TEXT,
                qr_token            VARCHAR(100) UNIQUE,
                created_at          TIMESTAMP    DEFAULT NOW(),
                updated_at          TIMESTAMP    DEFAULT NOW()
            )
        `);

        /* ── 2. staff_qualifications ───────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS staff_qualifications (
                id                  SERIAL PRIMARY KEY,
                user_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,
                degree_name         VARCHAR(150) NOT NULL,
                institution         VARCHAR(255),
                year_of_completion  INTEGER,
                certificate_file    VARCHAR(255),
                verification_status VARCHAR(50)  DEFAULT 'PENDING',
                verified_by         INTEGER REFERENCES users(id),
                verified_at         TIMESTAMP,
                rejection_reason    TEXT,
                created_at          TIMESTAMP    DEFAULT NOW()
            )
        `);

        /* ── 3. staff_approvals (audit trail) ──────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS staff_approvals (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
                action      VARCHAR(50)  NOT NULL,
                performed_by INTEGER REFERENCES users(id),
                notes       TEXT,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        `);

        /* ── 4. patient_health_ids ─────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS patient_health_ids (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                health_id   VARCHAR(30) UNIQUE NOT NULL,
                qr_token    VARCHAR(100) UNIQUE NOT NULL,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        `);

        /* ── 5. patient_lifestyle ──────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS patient_lifestyle (
                id                  SERIAL PRIMARY KEY,
                user_id             INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                smoking             VARCHAR(30),
                alcohol             VARCHAR(30),
                physical_activity   VARCHAR(30),
                sleep_hours         VARCHAR(30),
                diet                VARCHAR(30),
                food_habits         TEXT,
                water_intake        VARCHAR(20),
                stress_level        VARCHAR(20),
                occupation          VARCHAR(50),
                created_at          TIMESTAMP DEFAULT NOW(),
                updated_at          TIMESTAMP DEFAULT NOW()
            )
        `);

        /* ── 6. patient_medical_history ────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS patient_medical_history (
                id                  SERIAL PRIMARY KEY,
                user_id             INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                family_history      TEXT,
                existing_conditions TEXT,
                current_medication  BOOLEAN DEFAULT false,
                medication_details  TEXT,
                allergies           BOOLEAN DEFAULT false,
                allergy_details     TEXT,
                created_at          TIMESTAMP DEFAULT NOW(),
                updated_at          TIMESTAMP DEFAULT NOW()
            )
        `);

        /* ── 7. patient_consents ───────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS patient_consents (
                id              SERIAL PRIMARY KEY,
                user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
                consent_given   BOOLEAN NOT NULL DEFAULT false,
                consent_version VARCHAR(20) DEFAULT '1.0',
                registered_by   INTEGER REFERENCES users(id),
                consented_at    TIMESTAMP DEFAULT NOW()
            )
        `);

        /* ── 8. qr_tokens ──────────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS qr_tokens (
                id          SERIAL PRIMARY KEY,
                token       VARCHAR(100) UNIQUE NOT NULL,
                token_type  VARCHAR(30)  NOT NULL,
                reference_id INTEGER     NOT NULL,
                is_active   BOOLEAN      DEFAULT true,
                created_at  TIMESTAMP    DEFAULT NOW()
            )
        `);

        /* ── 9. qr_scan_logs ───────────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS qr_scan_logs (
                id              SERIAL PRIMARY KEY,
                token           VARCHAR(100),
                token_type      VARCHAR(30),
                scanned_by      INTEGER REFERENCES users(id),
                scanned_role    VARCHAR(50),
                reference_id    INTEGER,
                access_granted  BOOLEAN DEFAULT true,
                scanned_at      TIMESTAMP DEFAULT NOW()
            )
        `);

        /* ── 10. otp_verifications ─────────────────────── */
        await client.query(`
            CREATE TABLE IF NOT EXISTS otp_verifications (
                id          SERIAL PRIMARY KEY,
                mobile      VARCHAR(20),
                email       VARCHAR(150),
                otp_hash    VARCHAR(255) NOT NULL,
                purpose     VARCHAR(50)  DEFAULT 'PATIENT_REG',
                attempts    INTEGER      DEFAULT 0,
                verified    BOOLEAN      DEFAULT false,
                expires_at  TIMESTAMP    NOT NULL,
                created_at  TIMESTAMP    DEFAULT NOW()
            )
        `);

        /* ── Add profile_status column to users if missing ── */
        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS profile_status VARCHAR(50) DEFAULT 'COMPLETE'
        `);

        /* ── Add health_id column to patients if missing ── */
        await client.query(`
            ALTER TABLE patients
            ADD COLUMN IF NOT EXISTS health_id VARCHAR(30)
        `);

        console.log("✅ Migration complete — all tables created.");
    } catch (err) {
        console.error("Migration error:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
