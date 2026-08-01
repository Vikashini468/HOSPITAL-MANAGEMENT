const express = require("express");
const multer  = require("multer");
const path    = require("path");
const bcrypt  = require("bcrypt");
const router  = express.Router();

const SALT_ROUNDS = 10;

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename:    (req, file, cb) => cb(null, `face_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

/* =====================================================
   TABLE INITIALISATION
   Call once on server startup: initTables(pool)
===================================================== */
async function initTables(pool) {
    /* ── Core patients table ── */
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pat_patients (
            id            SERIAL PRIMARY KEY,
            patient_id    VARCHAR(20)  UNIQUE NOT NULL,
            name          VARCHAR(255) NOT NULL,
            dob           DATE,
            age           INTEGER,
            gender        VARCHAR(20),
            mobile        VARCHAR(15)  UNIQUE NOT NULL,
            blood_group   VARCHAR(5),
            address       TEXT,
            city          VARCHAR(100),
            state         VARCHAR(100),
            pincode       VARCHAR(10),
            registered_at TIMESTAMP DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS pat_lifestyle (
            id                SERIAL PRIMARY KEY,
            patient_id        VARCHAR(20) NOT NULL UNIQUE,
            smoking           VARCHAR(20),
            alcohol           VARCHAR(30),
            physical_activity VARCHAR(30),
            diet_quality      VARCHAR(20),
            sleep_hours       VARCHAR(20),
            sleep_quality     VARCHAR(20),
            stress_level      VARCHAR(20),
            occupation        VARCHAR(150),
            FOREIGN KEY (patient_id) REFERENCES pat_patients(patient_id) ON DELETE CASCADE
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS pat_family_history (
            id         SERIAL PRIMARY KEY,
            patient_id VARCHAR(20) NOT NULL UNIQUE,
            conditions TEXT[],
            FOREIGN KEY (patient_id) REFERENCES pat_patients(patient_id) ON DELETE CASCADE
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS pat_medical_history (
            id                      SERIAL PRIMARY KEY,
            patient_id              VARCHAR(20) NOT NULL UNIQUE,
            existing_diseases       TEXT[],
            existing_diseases_other TEXT,
            surgeries               TEXT[],
            surgeries_other         TEXT,
            allergies               TEXT[],
            allergies_other         TEXT,
            medications             TEXT[],
            medications_other       TEXT,
            FOREIGN KEY (patient_id) REFERENCES pat_patients(patient_id) ON DELETE CASCADE
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS pat_face (
            id          SERIAL PRIMARY KEY,
            patient_id  VARCHAR(20) NOT NULL UNIQUE,
            image_path  VARCHAR(500) NOT NULL,
            captured_at TIMESTAMP DEFAULT NOW(),
            FOREIGN KEY (patient_id) REFERENCES pat_patients(patient_id) ON DELETE CASCADE
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS pat_consent (
            id            SERIAL PRIMARY KEY,
            patient_id    VARCHAR(20) NOT NULL UNIQUE,
            consent_given BOOLEAN NOT NULL DEFAULT TRUE,
            consent_date  TIMESTAMP DEFAULT NOW(),
            FOREIGN KEY (patient_id) REFERENCES pat_patients(patient_id) ON DELETE CASCADE
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS pat_pin (
            id           SERIAL PRIMARY KEY,
            patient_id   VARCHAR(20) NOT NULL UNIQUE,
            pin_hash     VARCHAR(255) NOT NULL,
            created_at   TIMESTAMP DEFAULT NOW(),
            FOREIGN KEY (patient_id) REFERENCES pat_patients(patient_id) ON DELETE CASCADE
        );
    `);
}

/* =====================================================
   HELPERS
===================================================== */

/* Generate PAT000001 style ID from serial */
function buildPatientId(serial) {
    return "PAT" + String(serial).padStart(6, "0");
}

/* Generate a random 6-digit PIN string */
function generatePin() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

/* Parse a JSON-encoded array sent from the browser, or return [] */
function parseArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try { return JSON.parse(value); } catch { return []; }
}

/* =====================================================
   POST /api/patient/register
   Body (JSON):
     Step 1 — name, dob, age, gender, mobile, blood_group,
               address, city, state, pincode
     Step 2 — smoking, alcohol, activity, diet, sleepHours,
               sleepQuality, stress, occupation
     Step 3 — familyHistory  (array)
     Step 4 — existingDiseases (array), existingDiseasesOther,
               surgeries (array), surgeriesOther,
               allergies (array), allergiesOther,
               medications (array), medicationsOther
===================================================== */
router.post("/register", async (req, res) => {
    const pool = req.app.locals.pool;

    const {
        /* Step 1 */
        name, dob, age, gender, mobile,
        blood_group, address, city, state, pincode,
        /* Step 2 */
        smoking, alcohol, activity, diet,
        sleepHours, sleepQuality, stress, occupation,
        /* Step 3 */
        familyHistory,
        /* Step 4 */
        existingDiseases, existingDiseasesOther,
        surgeries, surgeriesOther,
        allergies, allergiesOther,
        medications, medicationsOther
    } = req.body;

    /* ── Required field check ── */
    if (!name || !mobile || !gender || !dob) {
        return res.status(400).json({
            success: false,
            message: "name, dob, gender and mobile are required"
        });
    }

    if (!/^\d{10}$/.test(mobile)) {
        return res.status(400).json({
            success: false,
            message: "mobile must be a 10-digit number"
        });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        /* ── Duplicate mobile check ── */
        const dup = await client.query(
            `SELECT id FROM pat_patients WHERE mobile = $1`, [mobile]
        );
        if (dup.rows.length) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                message: "A patient with this mobile number is already registered"
            });
        }

        /* ── Insert core patient row ── */
        const patRow = await client.query(`
            INSERT INTO pat_patients
                (patient_id, name, dob, age, gender, mobile,
                 blood_group, address, city, state, pincode)
            VALUES
                ('TEMP', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
        `, [
            name,
            dob         || null,
            age         ? parseInt(age) : null,
            gender,
            mobile,
            blood_group || null,
            address     || null,
            city        || null,
            state       || null,
            pincode     || null
        ]);

        const serial    = patRow.rows[0].id;
        const patientId = buildPatientId(serial);

        /* Back-fill the generated patient_id */
        await client.query(
            `UPDATE pat_patients SET patient_id = $1 WHERE id = $2`,
            [patientId, serial]
        );

        /* ── Lifestyle (Step 2) ── */
        await client.query(`
            INSERT INTO pat_lifestyle
                (patient_id, smoking, alcohol, physical_activity,
                 diet_quality, sleep_hours, sleep_quality, stress_level, occupation)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
            patientId,
            smoking      || null,
            alcohol      || null,
            activity     || null,
            diet         || null,
            sleepHours   || null,
            sleepQuality || null,
            stress       || null,
            occupation   || null
        ]);

        /* ── Family History (Step 3) ── */
        const familyArr = parseArray(familyHistory);
        await client.query(`
            INSERT INTO pat_family_history (patient_id, conditions)
            VALUES ($1, $2)
        `, [patientId, familyArr]);

        /* ── Medical History (Step 4) ── */
        await client.query(`
            INSERT INTO pat_medical_history
                (patient_id,
                 existing_diseases,   existing_diseases_other,
                 surgeries,           surgeries_other,
                 allergies,           allergies_other,
                 medications,         medications_other)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
            patientId,
            parseArray(existingDiseases),
            existingDiseasesOther || null,
            parseArray(surgeries),
            surgeriesOther        || null,
            parseArray(allergies),
            allergiesOther        || null,
            parseArray(medications),
            medicationsOther      || null
        ]);

        /* ── Generate & store PIN (Step 5 trigger) ── */
        const plainPin = generatePin();
        const pinHash  = await bcrypt.hash(plainPin, SALT_ROUNDS);
        await client.query(`
            INSERT INTO pat_pin (patient_id, pin_hash)
            VALUES ($1, $2)
            ON CONFLICT (patient_id) DO UPDATE SET pin_hash = $2, created_at = NOW()
        `, [patientId, pinHash]);

        await client.query("COMMIT");

        return res.status(201).json({
            success:    true,
            message:    "Patient registered successfully",
            patient_id: patientId,
            pin:        plainPin,   /* shown once on health card, never stored plain */
            name,
            mobile
        });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("PATIENT REGISTER ERROR:", err.message);
        return res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
});

/* =====================================================
   POST /api/patient/save-face
   multipart: face_image (file), patient_id (body)
===================================================== */
router.post("/save-face", upload.single("face_image"), async (req, res) => {
    const pool = req.app.locals.pool;
    const { patient_id } = req.body;

    if (!patient_id)
        return res.status(400).json({ success: false, message: "patient_id is required" });

    if (!req.file)
        return res.status(400).json({ success: false, message: "face_image is required" });

    try {
        /* Verify patient exists */
        const check = await pool.query(
            `SELECT patient_id FROM pat_patients WHERE patient_id = $1`, [patient_id]
        );
        if (!check.rows.length)
            return res.status(404).json({ success: false, message: "Patient not found" });

        await pool.query(`
            INSERT INTO pat_face (patient_id, image_path)
            VALUES ($1, $2)
            ON CONFLICT (patient_id)
            DO UPDATE SET image_path = $2, captured_at = NOW()
        `, [patient_id, req.file.filename]);

        return res.json({
            success:    true,
            message:    "Face image saved",
            patient_id,
            image_path: req.file.filename
        });
    } catch (err) {
        console.error("SAVE FACE ERROR:", err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   POST /api/patient/save-consent
   Body: { patient_id }
===================================================== */
router.post("/save-consent", async (req, res) => {
    const pool = req.app.locals.pool;
    const { patient_id } = req.body;

    if (!patient_id)
        return res.status(400).json({ success: false, message: "patient_id is required" });

    try {
        const check = await pool.query(
            `SELECT patient_id FROM pat_patients WHERE patient_id = $1`, [patient_id]
        );
        if (!check.rows.length)
            return res.status(404).json({ success: false, message: "Patient not found" });

        await pool.query(`
            INSERT INTO pat_consent (patient_id, consent_given, consent_date)
            VALUES ($1, TRUE, NOW())
            ON CONFLICT (patient_id)
            DO UPDATE SET consent_given = TRUE, consent_date = NOW()
        `, [patient_id]);

        return res.json({ success: true, message: "Consent recorded", patient_id });
    } catch (err) {
        console.error("SAVE CONSENT ERROR:", err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   GET /api/patient/full-record/:patient_id
   Returns complete medical record (all 8 sections)
   Called after PIN verification succeeds on the frontend
===================================================== */
router.get("/full-record/:patient_id", async (req, res) => {
    const pool = req.app.locals.pool;
    const { patient_id } = req.params;

    try {
        /* 1. Basic info */
        const basic = await pool.query(
            `SELECT * FROM pat_patients WHERE patient_id = $1`, [patient_id]
        );
        if (!basic.rows.length)
            return res.status(404).json({ success: false, message: "Patient not found" });

        /* 2. Lifestyle */
        const lifestyle = await pool.query(
            `SELECT * FROM pat_lifestyle WHERE patient_id = $1`, [patient_id]
        );

        /* 3. Family history */
        const family = await pool.query(
            `SELECT conditions FROM pat_family_history WHERE patient_id = $1`, [patient_id]
        );

        /* 4. Medical history */
        const medical = await pool.query(
            `SELECT * FROM pat_medical_history WHERE patient_id = $1`, [patient_id]
        );

        /* 5. Face / photo */
        const face = await pool.query(
            `SELECT image_path, captured_at FROM pat_face WHERE patient_id = $1`, [patient_id]
        );

        /* 6. Doctor visits — join via mobile number to legacy appointments table */
        const pat = basic.rows[0];
        let visits = [], prescriptions = [], labReports = [];

        /* Try to find legacy user_id by mobile */
        const legacyUser = await pool.query(
            `SELECT id FROM users WHERE mobile = $1 LIMIT 1`, [pat.mobile]
        );

        if (legacyUser.rows.length) {
            const uid = legacyUser.rows[0].id;

            /* Doctor visits */
            const visitsRes = await pool.query(`
                SELECT a.id, a.appointment_date, a.appointment_time, a.status,
                       a.symptoms, a.token_no, u.name AS doctor_name
                FROM appointments a
                JOIN users u ON u.id = a.doctor_id
                WHERE a.patient_id = $1
                ORDER BY a.appointment_date DESC, a.appointment_time DESC
            `, [uid]);
            visits = visitsRes.rows;

            /* Prescriptions */
            const rxRes = await pool.query(`
                SELECT p.id, p.created_at, u.name AS doctor_name,
                       json_agg(json_build_object(
                           'medicine', m.medicine_name,
                           'dosage', pm.dosage,
                           'quantity', pm.quantity,
                           'duration', pm.duration
                       )) AS medicines
                FROM prescriptions p
                JOIN users u ON u.id = p.doctor_id
                JOIN prescription_medicines pm ON pm.prescription_id = p.id
                JOIN medicines m ON m.id = pm.medicine_id
                WHERE p.patient_id = $1
                GROUP BY p.id, u.name
                ORDER BY p.created_at DESC
            `, [uid]);
            prescriptions = rxRes.rows;

            /* Lab reports */
            const labRes = await pool.query(`
                SELECT lr.id, lr.tests, lr.report_file, lr.status,
                       lr.created_at, lr.completed_at, u.name AS doctor_name
                FROM lab_requests lr
                LEFT JOIN users u ON u.id = lr.doctor_id
                WHERE lr.patient_id = $1
                ORDER BY lr.created_at DESC
            `, [uid]);
            labReports = labRes.rows.map(r => ({
                ...r,
                tests: typeof r.tests === "string" ? JSON.parse(r.tests) : (r.tests || [])
            }));
        }

        /* 7. Vitals — placeholder (no vitals table yet, return empty) */
        const vitals = [];

        /* 8. AI Dataset — computed summary from all collected data */
        const ls = lifestyle.rows[0] || {};
        const mh = medical.rows[0] || {};
        const aiDataset = {
            patient_id,
            age:              pat.age,
            gender:           pat.gender,
            blood_group:      pat.blood_group,
            smoking:          ls.smoking,
            alcohol:          ls.alcohol,
            physical_activity: ls.physical_activity,
            diet_quality:     ls.diet_quality,
            sleep_hours:      ls.sleep_hours,
            sleep_quality:    ls.sleep_quality,
            stress_level:     ls.stress_level,
            family_history:   (family.rows[0] || {}).conditions || [],
            existing_diseases: mh.existing_diseases || [],
            allergies:        mh.allergies || [],
            medications:      mh.medications || [],
            total_visits:     visits.length,
            total_prescriptions: prescriptions.length,
            total_lab_reports:   labReports.length
        };

        return res.json({
            success: true,
            basic:        pat,
            lifestyle:    ls,
            family_history: (family.rows[0] || {}).conditions || [],
            medical_history: mh,
            face:         face.rows[0] || null,
            vitals,
            visits,
            prescriptions,
            lab_reports:  labReports,
            ai_dataset:   aiDataset
        });

    } catch (err) {
        console.error("FULL RECORD ERROR:", err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   POST /api/patient/verify-pin
   Body: { patient_id, pin }
   Handles both registration systems:
     - pat_patients / pat_pin  (new system)
     - patients / patient_pin  (receptionist system, keyed by user_id)
===================================================== */
router.post("/verify-pin", async (req, res) => {
    const pool = req.app.locals.pool;
    const { patient_id, pin } = req.body;

    if (!patient_id || !pin)
        return res.status(400).json({ success: false, message: "patient_id and pin are required" });

    try {
        /* ── Try new system (pat_patients + pat_pin) ── */
        const newSys = await pool.query(`
            SELECT p.patient_id, p.name, p.gender, p.blood_group,
                   p.age, p.registered_at, pp.pin_hash
            FROM   pat_patients p
            JOIN   pat_pin      pp ON pp.patient_id = p.patient_id
            WHERE  p.patient_id = $1
        `, [patient_id]);

        if (newSys.rows.length) {
            const row   = newSys.rows[0];
            const match = await bcrypt.compare(String(pin), row.pin_hash);
            if (!match)
                return res.status(401).json({ success: false, message: "Incorrect PIN" });
            return res.json({
                success: true, source: "new",
                patient_id: row.patient_id, name: row.name,
                gender: row.gender, blood_group: row.blood_group,
                age: row.age, registered_at: row.registered_at
            });
        }

        /* ── Try receptionist system (patient_health_ids + patient_pin) ── */
        const legSys = await pool.query(`
            SELECT u.id AS user_id, u.name, u.mobile,
                   p.age, p.gender, p.blood_group, p.dob,
                   phi.health_id AS patient_id,
                   pp.pin_hash
            FROM   patient_health_ids phi
            JOIN   users    u  ON u.id  = phi.user_id
            JOIN   patients p  ON p.user_id = u.id
            JOIN   patient_pin pp ON pp.patient_id = u.id
            WHERE  phi.health_id = $1
        `, [patient_id]);

        if (legSys.rows.length) {
            const row   = legSys.rows[0];
            const match = await bcrypt.compare(String(pin), row.pin_hash);
            if (!match)
                return res.status(401).json({ success: false, message: "Incorrect PIN" });
            return res.json({
                success: true, source: "legacy",
                patient_id: row.patient_id, user_id: row.user_id,
                name: row.name, gender: row.gender,
                blood_group: row.blood_group, age: row.age,
                registered_at: row.dob
            });
        }

        return res.status(404).json({ success: false, message: "Patient ID not found" });

    } catch (err) {
        console.error("VERIFY PIN ERROR:", err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   GET /api/patient/record-docx/:patient_id
   Downloads full medical record as .docx
===================================================== */
router.get("/record-docx/:patient_id", async (req, res) => {
    const pool = req.app.locals.pool;
    const { patient_id } = req.params;

    try {
        const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
                WidthType, BorderStyle, HeadingLevel, AlignmentType } = require("docx");

        const basic = await pool.query(`SELECT * FROM pat_patients WHERE patient_id=$1`, [patient_id]);
        if (!basic.rows.length) return res.status(404).send("Patient not found");
        const b = basic.rows[0];

        const [ls, mh, fam, visits, rxs, labs] = await Promise.all([
            pool.query(`SELECT * FROM pat_lifestyle WHERE patient_id=$1`, [patient_id]),
            pool.query(`SELECT * FROM pat_medical_history WHERE patient_id=$1`, [patient_id]),
            pool.query(`SELECT conditions FROM pat_family_history WHERE patient_id=$1`, [patient_id]),
            pool.query(`SELECT a.appointment_date,a.appointment_time,a.symptoms,a.status,u.name AS doctor_name FROM appointments a JOIN users u ON u.id=a.doctor_id WHERE a.patient_id=(SELECT id FROM users WHERE mobile=$1 LIMIT 1) ORDER BY a.appointment_date DESC LIMIT 20`, [b.mobile]),
            pool.query(`SELECT p.created_at,u.name AS doctor_name,json_agg(json_build_object('medicine',m.medicine_name,'dosage',pm.dosage,'quantity',pm.quantity,'duration',pm.duration)) AS medicines FROM prescriptions p JOIN users u ON u.id=p.doctor_id JOIN prescription_medicines pm ON pm.prescription_id=p.id JOIN medicines m ON m.id=pm.medicine_id WHERE p.patient_id=(SELECT id FROM users WHERE mobile=$1 LIMIT 1) GROUP BY p.id,u.name ORDER BY p.created_at DESC LIMIT 20`, [b.mobile]),
            pool.query(`SELECT lr.created_at,lr.tests,lr.status,u.name AS doctor_name FROM lab_requests lr LEFT JOIN users u ON u.id=lr.doctor_id WHERE lr.patient_id=(SELECT id FROM users WHERE mobile=$1 LIMIT 1) ORDER BY lr.created_at DESC LIMIT 20`, [b.mobile])
        ]);

        const l  = ls.rows[0]  || {};
        const mhd = mh.rows[0] || {};
        const familyArr = (fam.rows[0] || {}).conditions || [];

        const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
        const borders  = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

        const fmt = d => d ? new Date(d).toLocaleDateString("en-IN") : "—";
        const val = v => String(v || "—");
        const arrVal = a => Array.isArray(a) && a.length ? a.join(", ") : "—";

        function row(label, value) {
            return new TableRow({ children: [
                new TableCell({ borders, width: { size: 35, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, color: "1565C0", size: 20 })] })] }),
                new TableCell({ borders, width: { size: 65, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: value, size: 20 })] })] })
            ]});
        }

        function section(title) {
            return new Paragraph({
                text: title, heading: HeadingLevel.HEADING_2,
                spacing: { before: 320, after: 120 },
                children: [new TextRun({ text: title, bold: true, color: "0D3B7A", size: 26 })]
            });
        }

        function table(rows) {
            return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
        }

        const children = [
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 60 },
                children: [new TextRun({ text: "NALAM AI Hospital", bold: true, size: 36, color: "0D3B7A" })]
            }),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
                children: [new TextRun({ text: "Patient Medical Record — Confidential", size: 22, color: "888888" })]
            }),

            section("1. Basic Information"),
            table([
                row("Patient ID",   val(b.patient_id)),
                row("Full Name",    val(b.name)),
                row("Date of Birth",fmt(b.dob)),
                row("Age",          b.age ? b.age + " yrs" : "—"),
                row("Gender",       val(b.gender)),
                row("Blood Group",  val(b.blood_group)),
                row("Mobile",       val(b.mobile)),
                row("Address",      [b.address, b.city, b.state, b.pincode].filter(Boolean).join(", ") || "—"),
                row("Registered",   fmt(b.registered_at))
            ]),

            section("2. Medical History"),
            table([
                row("Existing Diseases",   arrVal(mhd.existing_diseases)),
                row("Surgeries",           arrVal(mhd.surgeries)),
                row("Allergies",           arrVal(mhd.allergies)),
                row("Current Medications", arrVal(mhd.medications)),
                row("Family History",      arrVal(familyArr))
            ]),

            section("3. Lifestyle"),
            table([
                row("Smoking",           val(l.smoking)),
                row("Alcohol",           val(l.alcohol)),
                row("Physical Activity", val(l.physical_activity)),
                row("Diet Quality",      val(l.diet_quality)),
                row("Sleep Hours",       val(l.sleep_hours)),
                row("Sleep Quality",     val(l.sleep_quality)),
                row("Stress Level",      val(l.stress_level)),
                row("Occupation",        val(l.occupation))
            ]),

            section("4. Doctor Visits"),
            ...( visits.rows.length
                ? visits.rows.map(v => new Paragraph({
                    spacing: { after: 80 },
                    children: [new TextRun({ text: `${fmt(v.appointment_date)} ${v.appointment_time||""} — Dr. ${v.doctor_name||"—"} | ${v.symptoms||"—"} | ${v.status||"—"}`, size: 20 })]
                  }))
                : [new Paragraph({ children: [new TextRun({ text: "No visits recorded.", color: "AAAAAA", italics: true, size: 20 })] })]
            ),

            section("5. Prescriptions"),
            ...( rxs.rows.length
                ? rxs.rows.map(p => {
                    const meds = Array.isArray(p.medicines) ? p.medicines : [];
                    const medStr = meds.map(m => `${m.medicine} (${m.dosage||"—"}, qty:${m.quantity||"—"}, ${m.duration||"—"})`).join(" | ") || "—";
                    return new Paragraph({
                        spacing: { after: 80 },
                        children: [new TextRun({ text: `${fmt(p.created_at)} — Dr. ${p.doctor_name||"—"}: ${medStr}`, size: 20 })]
                    });
                  })
                : [new Paragraph({ children: [new TextRun({ text: "No prescriptions found.", color: "AAAAAA", italics: true, size: 20 })] })]
            ),

            section("6. Lab Reports"),
            ...( labs.rows.length
                ? labs.rows.map(r => {
                    const tests = typeof r.tests === "string" ? JSON.parse(r.tests) : (r.tests || []);
                    return new Paragraph({
                        spacing: { after: 80 },
                        children: [new TextRun({ text: `${fmt(r.created_at)} — Dr. ${r.doctor_name||"—"} | Tests: ${tests.join(", ")||"—"} | ${r.status||"—"}`, size: 20 })]
                    });
                  })
                : [new Paragraph({ children: [new TextRun({ text: "No lab reports found.", color: "AAAAAA", italics: true, size: 20 })] })]
            ),

            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 600 },
                children: [new TextRun({ text: `Generated on ${new Date().toLocaleString("en-IN")} — NALAM AI Hospital — Confidential`, color: "AAAAAA", size: 18 })]
            })
        ];

        const doc = new Document({ sections: [{ children }] });
        const buffer = await Packer.toBuffer(doc);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="Patient_Record_${patient_id}.docx"`);
        res.send(buffer);

    } catch (err) {
        console.error("RECORD DOCX ERROR:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = { router, initTables };
