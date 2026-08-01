const express  = require("express");
const router   = express.Router();
const bcrypt   = require("bcrypt");
const multer   = require("multer");
const path     = require("path");
const crypto   = require("crypto");
const QRCode   = require("qrcode");
const hospital = require("../config/hospital");

/* ── multer ── */
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

/* =====================================================
   REGISTER PATIENT  (receptionist only)
   POST /api/patient-reg/register
   multipart: face_image (file)
===================================================== */
router.post("/register", upload.single("face_image"), async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const {
            name, dob, age, gender, mobile, address, city, state, pincode,
            blood_group, registered_by,
            /* lifestyle */
            smoking, alcohol, physical_activity, diet_quality,
            sleep_hours, sleep_quality, stress_level, occupation,
            /* family history */
            family_history,
            /* medical history */
            existing_diseases, previous_surgeries, allergies, current_medications,
            /* face embedding (JSON string from browser face-api) */
            face_embedding,
            /* consent */
            consent_given, consent_version,
            /* PIN */
            card_pin
        } = req.body;

        if (!name || !mobile || !gender || !dob)
            return res.status(400).json({ success: false, message: "name, mobile, gender, dob required" });

        if (!req.file)
            return res.status(400).json({ success: false, message: "Face image is required" });

        if (!face_embedding)
            return res.status(400).json({ success: false, message: "Face embedding is required" });

        if (!card_pin || !/^\d{4,6}$/.test(card_pin))
            return res.status(400).json({ success: false, message: "card_pin must be 4–6 digits" });

        if (consent_given !== "true" && consent_given !== true)
            return res.status(400).json({ success: false, message: "Patient consent is required" });

        /* Check duplicate mobile */
        const dup = await pool.query(
            `SELECT u.id FROM users u JOIN patients p ON p.user_id=u.id WHERE u.mobile=$1`,
            [mobile]
        );
        if (dup.rows.length)
            return res.status(409).json({ success: false, message: "Patient with this mobile already registered" });

        const tempPass = await bcrypt.hash(mobile, 10);
        const pinHash  = await bcrypt.hash(card_pin, 10);

        /* Create user */
        const userRes = await pool.query(`
            INSERT INTO users (name, username, email, mobile, password, role, gender, verified, approved, profile_status)
            VALUES ($1,$2,$3,$4,$5,'patient',$6,true,true,'COMPLETE')
            RETURNING id
        `, [
            name,
            `patient@${name.replace(/\s/g,"").toLowerCase()}${Date.now()}`,
            `${mobile}@patient.nalam`,
            mobile,
            tempPass,
            gender
        ]);

        const userId = userRes.rows[0].id;

        /* Generate Patient ID: PAT000001 */
        const patientId = "PAT" + String(userId).padStart(6, "0");

        /* Create patient record */
        await pool.query(`
            INSERT INTO patients (user_id, name, age, gender, dob, blood_group, address, mobile, city, state, pincode)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [userId, name, age || null, gender, dob, blood_group || null,
            address || null, mobile, city || null, state || null, pincode || null]);

        /* Generate QR token — encodes only Patient ID */
        const qrToken = patientId;

        await pool.query(`
            INSERT INTO patient_health_ids (user_id, health_id, qr_token)
            VALUES ($1,$2,$3)
        `, [userId, patientId, qrToken]);

        await pool.query(`
            INSERT INTO qr_tokens (token, token_type, reference_id)
            VALUES ($1,'PATIENT_HEALTH_CARD',$2)
            ON CONFLICT (token) DO NOTHING
        `, [qrToken, userId]);

        await pool.query(`UPDATE patients SET health_id=$1 WHERE user_id=$2`, [patientId, userId]);

        /* Face data */
        await pool.query(`
            INSERT INTO patient_face (patient_id, face_image_path, face_embedding, status)
            VALUES ($1,$2,$3,'ACTIVE')
            ON CONFLICT (patient_id) DO UPDATE
            SET face_image_path=$2, face_embedding=$3, captured_at=NOW()
        `, [userId, req.file.filename, face_embedding]);

        /* PIN */
        await pool.query(`
            INSERT INTO patient_pin (patient_id, pin_hash)
            VALUES ($1,$2)
            ON CONFLICT (patient_id) DO UPDATE SET pin_hash=$2, created_at=NOW()
        `, [userId, pinHash]);

        /* Lifestyle */
        await pool.query(`
            INSERT INTO patient_lifestyle
            (user_id, smoking, alcohol, physical_activity, sleep_hours, sleep_quality,
             diet, stress_level, occupation)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (user_id) DO UPDATE SET
                smoking=$2, alcohol=$3, physical_activity=$4, sleep_hours=$5,
                sleep_quality=$6, diet=$7, stress_level=$8, occupation=$9
        `, [userId, smoking||null, alcohol||null, physical_activity||null,
            sleep_hours||null, sleep_quality||null, diet_quality||null,
            stress_level||null, occupation||null]);

        /* Medical history */
        await pool.query(`
            INSERT INTO patient_medical_history
            (user_id, family_history, existing_conditions, previous_surgeries,
             allergies, current_medications)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (user_id) DO UPDATE SET
                family_history=$2, existing_conditions=$3, previous_surgeries=$4,
                allergies=$5, current_medications=$6
        `, [userId,
            family_history || null,
            existing_diseases || null,
            previous_surgeries || null,
            allergies || null,
            current_medications || null]);

        /* Consent */
        await pool.query(`
            INSERT INTO patient_consents (user_id, consent_given, consent_version, registered_by)
            VALUES ($1,true,$2,$3)
        `, [userId, consent_version || "1.0", registered_by || null]);

        /* Generate QR image — encode full URL so phone camera opens the verify page */
        const serverHost = process.env.SERVER_HOST || "192.168.1.6";
        const serverPort = process.env.PORT || 5000;
        const verifyUrl  = `http://${serverHost}:${serverPort}/patient/verify?id=${patientId}`;
        const qrImage = await QRCode.toDataURL(verifyUrl, { width: 250, margin: 1 });

        res.json({
            success:    true,
            user_id:    userId,
            patient_id: patientId,
            qr_image:   qrImage
        });

    } catch (err) {
        console.error("REGISTER PATIENT ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =====================================================
   HEALTH CARD DATA
   GET /api/patient-reg/health-card/:userId
===================================================== */
router.get("/health-card/:userId", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await pool.query(`
            SELECT u.name, u.mobile,
                   p.age, p.gender, p.blood_group,
                   phi.health_id, phi.qr_token,
                   pc.consented_at AS issue_date
            FROM users u
            JOIN patients p ON p.user_id = u.id
            JOIN patient_health_ids phi ON phi.user_id = u.id
            LEFT JOIN patient_consents pc ON pc.user_id = u.id
            WHERE u.id = $1
        `, [req.params.userId]);

        if (!result.rows.length) return res.status(404).json({ message: "Not found" });
        const pat = result.rows[0];

        const serverHost = process.env.SERVER_HOST || "192.168.1.6";
        const serverPort = process.env.PORT || 5000;
        const verifyUrl  = `http://${serverHost}:${serverPort}/patient/verify?id=${pat.qr_token}`;
        const qrImage = await QRCode.toDataURL(verifyUrl, { width: 250, margin: 1 });

        res.json({
            hospital_name: hospital.name,
            hospital_logo: hospital.logo,
            ...pat,
            qr_image: qrImage
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});


/* =====================================================
   SEARCH PATIENT
   GET /api/patient-reg/search?q=...
===================================================== */
router.get("/search", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const q = `%${req.query.q || ""}%`;
        const result = await pool.query(`
            SELECT u.id, u.name, u.mobile,
                   p.age, p.gender, p.blood_group, p.photo,
                   phi.health_id
            FROM users u
            JOIN patients p ON p.user_id = u.id
            LEFT JOIN patient_health_ids phi ON phi.user_id = u.id
            WHERE u.role='patient'
            AND (u.name ILIKE $1 OR u.mobile ILIKE $1 OR phi.health_id ILIKE $1)
            ORDER BY u.name
            LIMIT 30
        `, [q]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
});


/* =====================================================
   LIST ALL PATIENTS
   GET /api/patient-reg/list
===================================================== */
router.get("/list", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await pool.query(`
            SELECT u.id, u.name, u.mobile,
                   p.age, p.gender, p.blood_group, p.dob,
                   phi.health_id,
                   pc.consented_at AS registered_at
            FROM users u
            JOIN patients p ON p.user_id = u.id
            LEFT JOIN patient_health_ids phi ON phi.user_id = u.id
            LEFT JOIN patient_consents pc ON pc.user_id = u.id
            WHERE u.role='patient'
            ORDER BY u.id DESC
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
});


/* =====================================================
   VERIFY PIN  (step 1 of QR scan access)
   POST /api/patient-reg/verify-pin
   Body: { patient_id, pin }
===================================================== */
router.post("/verify-pin", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const { patient_id, pin } = req.body;
        if (!patient_id || !pin)
            return res.status(400).json({ success: false, message: "patient_id and pin required" });

        /* Resolve user_id from health_id */
        const phi = await pool.query(
            `SELECT user_id FROM patient_health_ids WHERE health_id=$1`, [patient_id]
        );
        if (!phi.rows.length)
            return res.status(404).json({ success: false, message: "Patient ID not found" });

        const userId = phi.rows[0].user_id;

        const pinRow = await pool.query(
            `SELECT pin_hash FROM patient_pin WHERE patient_id=$1`, [userId]
        );
        if (!pinRow.rows.length)
            return res.status(404).json({ success: false, message: "No PIN set for this patient" });

        const match = await bcrypt.compare(pin.toString(), pinRow.rows[0].pin_hash);
        if (!match)
            return res.status(401).json({ success: false, message: "Incorrect PIN" });

        /* Return face embedding for client-side comparison */
        const faceRow = await pool.query(
            `SELECT face_embedding, face_image_path FROM patient_face WHERE patient_id=$1 AND status='ACTIVE'`,
            [userId]
        );

        res.json({
            success:         true,
            user_id:         userId,
            face_embedding:  faceRow.rows[0]?.face_embedding || null,
            face_image_path: faceRow.rows[0]?.face_image_path || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =====================================================
   GET FULL PATIENT RECORD  (after auth)
   GET /api/patient-reg/record/:userId
===================================================== */
router.get("/record/:userId", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const [basic, lifestyle, history, consults, prescriptions, labs] = await Promise.all([
            pool.query(`
                SELECT u.id, u.name, u.mobile,
                       p.age, p.gender, p.blood_group, p.dob, p.address,
                       p.city, p.state, p.pincode, p.photo,
                       phi.health_id
                FROM users u
                LEFT JOIN patients p ON p.user_id = u.id
                LEFT JOIN patient_health_ids phi ON phi.user_id = u.id
                WHERE u.id = $1
            `, [req.params.userId]),
            pool.query(`SELECT * FROM patient_lifestyle WHERE user_id=$1`, [req.params.userId]),
            pool.query(`SELECT * FROM patient_medical_history WHERE user_id=$1`, [req.params.userId]),
            pool.query(`
                SELECT a.id, a.appointment_date, a.symptoms, a.status,
                       u.name AS doctor_name
                FROM appointments a JOIN users u ON u.id=a.doctor_id
                WHERE a.patient_id=$1 ORDER BY a.appointment_date DESC LIMIT 20
            `, [req.params.userId]),
            pool.query(`
                SELECT p.id, p.created_at, u.name AS doctor_name,
                       m.medicine_name, pm.dosage, pm.duration
                FROM prescriptions p
                JOIN users u ON u.id=p.doctor_id
                JOIN prescription_medicines pm ON pm.prescription_id=p.id
                JOIN medicines m ON m.id=pm.medicine_id
                WHERE p.patient_id=$1 ORDER BY p.created_at DESC LIMIT 30
            `, [req.params.userId]),
            pool.query(`
                SELECT lr.id, lr.tests, lr.status, lr.report_file, lr.created_at,
                       u.name AS doctor_name
                FROM lab_requests lr JOIN users u ON u.id=lr.doctor_id
                WHERE lr.patient_id=$1 ORDER BY lr.created_at DESC LIMIT 20
            `, [req.params.userId])
        ]);

        if (!basic.rows.length)
            return res.status(404).json({ success: false, message: "Patient not found" });

        res.json({
            success:         true,
            basic:           basic.rows[0],
            lifestyle:       lifestyle.rows[0] || {},
            medical_history: history.rows[0] || {},
            consultations:   consults.rows,
            prescriptions:   prescriptions.rows,
            lab_reports:     labs.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =====================================================
   LOG FAILED AUTH ATTEMPT
   POST /api/patient-reg/log-failed-auth
===================================================== */
router.post("/log-failed-auth", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const { patient_id, reason } = req.body;
        await pool.query(`
            INSERT INTO qr_scan_logs (token, token_type, scanned_role, reference_id)
            VALUES ($1,'PATIENT_HEALTH_CARD','FAILED_AUTH',$2)
        `, [patient_id || "UNKNOWN", null]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false });
    }
});


/* =====================================================
   GENERATE PDF  (server-side HTML → print)
   GET /api/patient-reg/pdf/:userId
===================================================== */
router.get("/pdf/:userId", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const [basic, lifestyle, history] = await Promise.all([
            pool.query(`
                SELECT u.name, u.mobile, p.age, p.gender, p.blood_group,
                       p.dob, p.address, p.city, p.state, phi.health_id
                FROM users u
                LEFT JOIN patients p ON p.user_id=u.id
                LEFT JOIN patient_health_ids phi ON phi.user_id=u.id
                WHERE u.id=$1
            `, [req.params.userId]),
            pool.query(`SELECT * FROM patient_lifestyle WHERE user_id=$1`, [req.params.userId]),
            pool.query(`SELECT * FROM patient_medical_history WHERE user_id=$1`, [req.params.userId])
        ]);

        if (!basic.rows.length) return res.status(404).send("Not found");

        const p  = basic.rows[0];
        const ls = lifestyle.rows[0] || {};
        const mh = history.rows[0] || {};

        const html = buildPdfHtml(p, ls, mh, hospital);
        res.setHeader("Content-Type", "text/html");
        res.send(html);
    } catch (err) {
        res.status(500).send(err.message);
    }
});


/* =====================================================
   GENERATE WORD DOC
   GET /api/patient-reg/docx/:userId
===================================================== */
router.get("/docx/:userId", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = require("docx");

        const [basic, lifestyle, history] = await Promise.all([
            pool.query(`
                SELECT u.name, u.mobile, p.age, p.gender, p.blood_group,
                       p.dob, p.address, p.city, p.state, phi.health_id
                FROM users u
                LEFT JOIN patients p ON p.user_id=u.id
                LEFT JOIN patient_health_ids phi ON phi.user_id=u.id
                WHERE u.id=$1
            `, [req.params.userId]),
            pool.query(`SELECT * FROM patient_lifestyle WHERE user_id=$1`, [req.params.userId]),
            pool.query(`SELECT * FROM patient_medical_history WHERE user_id=$1`, [req.params.userId])
        ]);

        if (!basic.rows.length) return res.status(404).send("Not found");

        const p  = basic.rows[0];
        const ls = lifestyle.rows[0] || {};
        const mh = history.rows[0] || {};

        const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
        const cellBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

        function row(label, value) {
            return new TableRow({ children: [
                new TableCell({ borders: cellBorders, width: { size: 30, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, color: "1565C0" })] })] }),
                new TableCell({ borders: cellBorders, width: { size: 70, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: String(value || "—") })] })] })
            ]});
        }

        function section(title) {
            return new Paragraph({ text: title, heading: HeadingLevel.HEADING_2,
                spacing: { before: 300, after: 100 } });
        }

        const doc = new Document({ sections: [{ children: [
            new Paragraph({ text: hospital.name, heading: HeadingLevel.HEADING_1,
                alignment: "center", spacing: { after: 100 } }),
            new Paragraph({ text: "Patient Medical Record", alignment: "center",
                spacing: { after: 400 },
                children: [new TextRun({ text: "Patient Medical Record", color: "555555", size: 24 })] }),

            section("Personal Information"),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
                row("Patient ID",   p.health_id),
                row("Full Name",    p.name),
                row("Age",          p.age),
                row("Gender",       p.gender),
                row("Date of Birth",p.dob ? new Date(p.dob).toLocaleDateString() : "—"),
                row("Blood Group",  p.blood_group),
                row("Mobile",       p.mobile),
                row("Address",      [p.address, p.city, p.state].filter(Boolean).join(", "))
            ]}),

            section("Lifestyle Information"),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
                row("Smoking",           ls.smoking),
                row("Alcohol",           ls.alcohol),
                row("Physical Activity", ls.physical_activity),
                row("Diet Quality",      ls.diet),
                row("Sleep Hours",       ls.sleep_hours),
                row("Sleep Quality",     ls.sleep_quality),
                row("Stress Level",      ls.stress_level),
                row("Occupation",        ls.occupation)
            ]}),

            section("Medical History"),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
                row("Family History",      mh.family_history),
                row("Existing Diseases",   mh.existing_conditions),
                row("Previous Surgeries",  mh.previous_surgeries),
                row("Allergies",           mh.allergies),
                row("Current Medications", mh.current_medications)
            ]}),

            new Paragraph({ text: `Generated on ${new Date().toLocaleString()} — ${hospital.name}`,
                alignment: "center", spacing: { before: 600 },
                children: [new TextRun({ text: `Generated on ${new Date().toLocaleString()} — ${hospital.name}`,
                    color: "AAAAAA", size: 18 })] })
        ]}]});

        const buffer = await Packer.toBuffer(doc);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="patient-${p.health_id}.docx"`);
        res.send(buffer);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});


/* =====================================================
   HELPER — build printable HTML for PDF
===================================================== */
function buildPdfHtml(p, ls, mh, hosp) {
    const row = (label, value) => value
        ? `<tr><td style="font-weight:600;color:#1565c0;padding:8px 12px;width:200px;border-bottom:1px solid #eee">${label}</td>
               <td style="padding:8px 12px;border-bottom:1px solid #eee">${value}</td></tr>`
        : "";

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Patient Record — ${p.name}</title>
    <style>
        body{font-family:"Segoe UI",sans-serif;margin:0;padding:30px;color:#333;background:white;}
        .header{background:linear-gradient(135deg,#134f8f,#1a6fc4);color:white;padding:24px 30px;border-radius:12px;margin-bottom:28px;text-align:center;}
        .header h1{font-size:22px;margin-bottom:4px;}
        .header p{font-size:13px;opacity:.85;}
        h2{color:#1565c0;font-size:15px;margin:24px 0 10px;padding-bottom:6px;border-bottom:2px solid #e3f2fd;}
        table{width:100%;border-collapse:collapse;font-size:13px;}
        .footer{text-align:center;color:#aaa;font-size:11px;margin-top:40px;padding-top:16px;border-top:1px solid #eee;}
        @media print{body{padding:0;}}
    </style></head><body>
    <div class="header">
        <h1>${hosp.name}</h1>
        <p>Patient Medical Record &nbsp;|&nbsp; Confidential</p>
    </div>

    <h2>Personal Information</h2>
    <table>${row("Patient ID", p.health_id)}${row("Full Name", p.name)}${row("Age", p.age)}
    ${row("Gender", p.gender)}${row("Date of Birth", p.dob ? new Date(p.dob).toLocaleDateString() : null)}
    ${row("Blood Group", p.blood_group)}${row("Mobile", p.mobile)}
    ${row("Address", [p.address, p.city, p.state].filter(Boolean).join(", "))}</table>

    <h2>Lifestyle Information</h2>
    <table>${row("Smoking", ls.smoking)}${row("Alcohol", ls.alcohol)}
    ${row("Physical Activity", ls.physical_activity)}${row("Diet Quality", ls.diet)}
    ${row("Sleep Hours", ls.sleep_hours)}${row("Sleep Quality", ls.sleep_quality)}
    ${row("Stress Level", ls.stress_level)}${row("Occupation", ls.occupation)}</table>

    <h2>Medical History</h2>
    <table>${row("Family History", ls.family_history)}${row("Existing Diseases", mh.existing_conditions)}
    ${row("Previous Surgeries", mh.previous_surgeries)}${row("Allergies", mh.allergies)}
    ${row("Current Medications", mh.current_medications)}</table>

    <div class="footer">Generated on ${new Date().toLocaleString()} &nbsp;|&nbsp; ${hosp.name} &nbsp;|&nbsp; Confidential</div>
    <script>window.onload=()=>window.print();</script>
    </body></html>`;
}

module.exports = router;
