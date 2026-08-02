const express  = require("express");
const router   = express.Router();
const QRCode   = require("qrcode");

/* =====================================================
   SCAN QR — universal entry point
   Body: { token, scanned_by, scanned_role }
===================================================== */
router.post("/scan", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const { token, scanned_by, scanned_role } = req.body;
        if (!token) return res.status(400).json({ success: false, message: "Token required" });

        /* Look up token */
        const tokenRow = await pool.query(
            `SELECT * FROM qr_tokens WHERE token=$1 AND is_active=true`, [token]
        );
        if (!tokenRow.rows.length)
            return res.status(404).json({ success: false, message: "Invalid or expired QR code" });

        const qt = tokenRow.rows[0];

        /* Log the scan */
        await pool.query(`
            INSERT INTO qr_scan_logs (token, token_type, scanned_by, scanned_role, reference_id)
            VALUES ($1,$2,$3,$4,$5)
        `, [token, qt.token_type, scanned_by || null, scanned_role || "unknown", qt.reference_id]);

        /* Route by type */
        if (qt.token_type === "PATIENT_HEALTH_CARD") {
            const data = await getPatientRecord(pool, qt.reference_id, scanned_role);
            return res.json({ success: true, type: "PATIENT_HEALTH_CARD", data });
        }

        if (qt.token_type === "STAFF_CARD") {
            const data = await getStaffRecord(pool, qt.reference_id, scanned_role);
            return res.json({ success: true, type: "STAFF_CARD", data });
        }

        return res.json({ success: false, message: "Unknown QR type" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   PATIENT SELF-ACCESS — step 1: validate QR, send OTP
===================================================== */
router.post("/patient-self/init", async (req, res) => {
    const pool = req.app.locals.pool;
    const bcrypt = require("bcrypt");
    const sendOTP = require("../utils/mail");
    try {
        const { token } = req.body;
        const tokenRow = await pool.query(
            `SELECT * FROM qr_tokens WHERE token=$1 AND token_type='PATIENT_HEALTH_CARD' AND is_active=true`,
            [token]
        );
        if (!tokenRow.rows.length)
            return res.status(404).json({ success: false, message: "Invalid QR code" });

        const userId = tokenRow.rows[0].reference_id;
        const user   = await pool.query(`SELECT email, mobile, name FROM users WHERE id=$1`, [userId]);
        if (!user.rows.length) return res.status(404).json({ success: false, message: "Patient not found" });

        const otp     = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await bcrypt.hash(otp, 10);
        const expires = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(`
            INSERT INTO otp_verifications (email, mobile, otp_hash, purpose, expires_at)
            VALUES ($1,$2,$3,'PATIENT_SELF_ACCESS',$4)
        `, [user.rows[0].email, user.rows[0].mobile, otpHash, expires]);

        await sendOTP(user.rows[0].email, otp);

        res.json({ success: true, message: "OTP sent", user_id: userId,
                   masked_email: user.rows[0].email.replace(/(.{2}).+(@.+)/, "$1***$2") });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   PATIENT SELF-ACCESS — step 2: verify OTP, return record
===================================================== */
router.post("/patient-self/verify", async (req, res) => {
    const pool   = req.app.locals.pool;
    const bcrypt = require("bcrypt");
    try {
        const { user_id, otp } = req.body;
        const user = await pool.query(`SELECT email FROM users WHERE id=$1`, [user_id]);
        if (!user.rows.length) return res.status(404).json({ success: false, message: "Not found" });

        const otpRow = await pool.query(`
            SELECT * FROM otp_verifications
            WHERE email=$1 AND purpose='PATIENT_SELF_ACCESS' AND verified=false
            ORDER BY created_at DESC LIMIT 1
        `, [user.rows[0].email]);

        if (!otpRow.rows.length) return res.json({ success: false, message: "No OTP found" });
        const rec = otpRow.rows[0];

        if (new Date() > rec.expires_at) return res.json({ success: false, message: "OTP expired" });
        if (rec.attempts >= 5) return res.json({ success: false, message: "Too many attempts" });

        await pool.query(`UPDATE otp_verifications SET attempts=attempts+1 WHERE id=$1`, [rec.id]);

        const match = await bcrypt.compare(otp, rec.otp_hash);
        if (!match) return res.json({ success: false, message: "Invalid OTP" });

        await pool.query(`UPDATE otp_verifications SET verified=true WHERE id=$1`, [rec.id]);

        const data = await getPatientRecord(pool, user_id, "PATIENT_SELF");
        res.json({ success: true, data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/* =====================================================
   QR SCAN AUDIT LOG  (admin)
===================================================== */
router.get("/scan-logs", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await pool.query(`
            SELECT l.*, u.name AS scanner_name
            FROM qr_scan_logs l
            LEFT JOIN users u ON u.id = l.scanned_by
            ORDER BY l.scanned_at DESC
            LIMIT 200
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json([]);
    }
});

/* =====================================================
   QR IMAGE UTILITY — shared with other modules
   Reuses the `qrcode` package; encodes ONLY the given text
===================================================== */
function generateQRImage(text) {
    return QRCode.toDataURL(text, { width: 250, margin: 1 });
}

/* =====================================================
   GENERATE QR IMAGE for a token string (utility)
===================================================== */
router.get("/generate-image/:token", async (req, res) => {
    try {
        const img = await generateQRImage(req.params.token);
        res.json({ qr_image: img });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* =====================================================
   HELPERS
===================================================== */
async function getPatientRecord(pool, userId, role) {
    const base = await pool.query(`
        SELECT u.id, u.name, u.email, u.mobile,
               p.age, p.gender, p.blood_group, p.address, p.photo,
               phi.health_id
        FROM users u
        LEFT JOIN patients p ON p.user_id = u.id
        LEFT JOIN patient_health_ids phi ON phi.user_id = u.id
        WHERE u.id = $1
    `, [userId]);

    const patient = base.rows[0] || {};

    /* Receptionist — basic info only */
    if (role === "receptionist") return { basic: patient };

    /* Doctor / Patient self — full record */
    const [consults, prescriptions, labs, lifestyle, history] = await Promise.all([
        pool.query(`
            SELECT a.id, a.appointment_date, a.symptoms, a.status,
                   u.name AS doctor_name
            FROM appointments a JOIN users u ON u.id=a.doctor_id
            WHERE a.patient_id=$1 ORDER BY a.appointment_date DESC LIMIT 20
        `, [userId]),
        pool.query(`
            SELECT p.id, p.created_at, u.name AS doctor_name,
                   m.medicine_name, pm.quantity, pm.duration, pm.dosage
            FROM prescriptions p
            JOIN users u ON u.id=p.doctor_id
            JOIN prescription_medicines pm ON pm.prescription_id=p.id
            JOIN medicines m ON m.id=pm.medicine_id
            WHERE p.patient_id=$1 ORDER BY p.created_at DESC LIMIT 30
        `, [userId]),
        pool.query(`
            SELECT lr.id, lr.tests, lr.status, lr.report_file, lr.created_at,
                   u.name AS doctor_name
            FROM lab_requests lr JOIN users u ON u.id=lr.doctor_id
            WHERE lr.patient_id=$1 ORDER BY lr.created_at DESC LIMIT 20
        `, [userId]),
        pool.query(`SELECT * FROM patient_lifestyle WHERE user_id=$1`, [userId]),
        pool.query(`SELECT * FROM patient_medical_history WHERE user_id=$1`, [userId])
    ]);

    return {
        basic:         patient,
        consultations: consults.rows,
        prescriptions: prescriptions.rows,
        lab_reports:   labs.rows,
        lifestyle:     lifestyle.rows[0] || {},
        medical_history: history.rows[0] || {}
    };
}

async function getStaffRecord(pool, userId, role) {
    const result = await pool.query(`
        SELECT u.id, u.name, u.role, u.email, u.mobile,
               sp.employee_id, sp.department, sp.specialization,
               sp.medical_reg_no, sp.verification_status, sp.profile_photo,
               sp.years_experience, sp.languages_known
        FROM users u
        JOIN staff_profiles sp ON sp.user_id = u.id
        WHERE u.id = $1
    `, [userId]);

    const staff = result.rows[0] || {};

    /* Only admin can see qualifications */
    if (role === "admin") {
        const quals = await pool.query(
            `SELECT * FROM staff_qualifications WHERE user_id=$1`, [userId]
        );
        return { ...staff, qualifications: quals.rows };
    }
    return staff;
}

module.exports = router;
module.exports.generateQRImage = generateQRImage;
