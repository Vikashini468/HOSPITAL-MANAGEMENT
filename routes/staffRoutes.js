const express  = require("express");
const router   = express.Router();
const bcrypt   = require("bcrypt");
const multer   = require("multer");
const path     = require("path");
const crypto   = require("crypto");
const QRCode   = require("qrcode");

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
        cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
    }
});


/* =========================================================
   CREATE STAFF BY ADMIN
   POST /api/staff/create
========================================================= */

router.post("/create", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const {
            name,
            mobile,
            email,
            gender,
            dob,
            role,
            department,
            employee_id,
            joining_date
        } = req.body;


        /* -----------------------------
           VALIDATION
        ----------------------------- */

        if (!name || !mobile || !email || !gender || !dob || !role) {

            return res.status(400).json({
                success: false,
                message: "Please fill all required fields."
            });

        }


        /* -----------------------------
           VALID STAFF ROLES
        ----------------------------- */

        const allowedRoles = [
            "doctor",
            "nurse",
            "lab",
            "lab_staff",
            "pharmacist",
            "receptionist"
        ];

        /* Normalise lab_staff → lab for DB consistency */
        if (role === "lab_staff") req.body.role = "lab";

        if (!allowedRoles.includes(role)) {

            return res.status(400).json({
                success: false,
                message: "Invalid staff role."
            });

        }


        /* -----------------------------
           CHECK EXISTING USER
        ----------------------------- */

        const existing = await pool.query(
            `SELECT id FROM users WHERE email=$1`,
            [email]
        );

        if (existing.rows.length > 0) {

            return res.status(409).json({
                success: false,
                message: "User with this email already exists."
            });

        }


        /* -----------------------------
           USERNAME
        ----------------------------- */

        const username =
            `${role}@${name.replace(/\s/g, "").toLowerCase()}${Date.now().toString().slice(-4)}`;


        /* -----------------------------
           DEFAULT PASSWORD = name (lowercase, no spaces)
        ----------------------------- */

        const temporaryPassword =
            name.replace(/\s+/g, "").toLowerCase();

        const hashedPassword =
            await bcrypt.hash(temporaryPassword, 10);


        /* -----------------------------
           CREATE USER
        ----------------------------- */

        const userResult = await pool.query(

            `INSERT INTO users
            (
                name,
                username,
                email,
                mobile,
                password,
                role,
                gender,
                approved,
                verified,
                profile_status
            )
            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,false,true,'INCOMPLETE'
            )
            RETURNING id, name, username, email, role`,

            [
                name,
                username,
                email,
                mobile,
                hashedPassword,
                role,
                gender
            ]

        );


        const userId   = userResult.rows[0].id;
        const dbRole   = role === "lab_staff" ? "lab" : role;

        /* Store extra fields in staff_profiles */
        await pool.query(
            `INSERT INTO staff_profiles
             (user_id, employee_id, department, date_of_joining, profile_status)
             VALUES ($1,$2,$3,$4,'INCOMPLETE')
             ON CONFLICT (user_id) DO NOTHING`,
            [userId, employee_id || null, department || null, joining_date || null]
        );


        /* =================================================
           CREATE ROLE-SPECIFIC RECORD
        ================================================= */

        if (dbRole === "doctor") {
            await pool.query(
                `INSERT INTO doctors (user_id, current_hospital)
                 SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM doctors WHERE user_id=$1)`,
                [userId, department || null]
            );
        } else if (dbRole === "nurse") {
            await pool.query(
                `INSERT INTO nurses (user_id, current_hospital)
                 SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM nurses WHERE user_id=$1)`,
                [userId, department || null]
            );
        } else if (dbRole === "lab") {
            await pool.query(
                `INSERT INTO labs (user_id, current_hospital)
                 SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM labs WHERE user_id=$1)`,
                [userId, department || null]
            );
        } else if (dbRole === "pharmacist") {
            await pool.query(
                `INSERT INTO pharmacists (user_id, current_hospital)
                 SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM pharmacists WHERE user_id=$1)`,
                [userId, department || null]
            );
        }


        /* =================================================
           RESPONSE
        ================================================= */

        res.status(201).json({

            success: true,

            message:
                "Staff account created successfully.",

            staff: userResult.rows[0],

            /*
                Development only.
                Later send this by email.
            */

            temporaryPassword

        });

    }

    catch (error) {

        console.error(
            "CREATE STAFF ERROR:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Failed to create staff account.",

            error:
                error.message

        });

    }

});


/* =========================================================
   ALL STAFF
   GET /api/staff/list
========================================================= */

router.get("/list", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`

            SELECT
                u.id,
                u.name,
                u.username,
                u.email,
                u.mobile,
                u.gender,
                u.dob,
                u.role,
                u.approved,
                u.verified,
                u.profile_status

            FROM users u

            WHERE u.role IN
            (
                'doctor',
                'nurse',
                'lab',
                'pharmacist',
                'receptionist'
            )

            ORDER BY u.id DESC

        `);


        res.json(

            result.rows.map(user => ({

                ...user,

                status:
                    user.profile_status ||
                    (
                        user.approved
                            ? "APPROVED"
                            : "PENDING"
                    )

            }))

        );

    }

    catch (error) {

        console.error(
            "GET STAFF ERROR:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Failed to load staff.",

            error:
                error.message

        });

    }

});


/* =========================================================
   PENDING STAFF
   GET /api/staff/pending-approvals
========================================================= */

router.get("/pending-approvals", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const result = await pool.query(`

            SELECT
                u.id,
                u.name,
                u.username,
                u.email,
                u.mobile,
                u.gender,
                u.dob,
                u.role,
                u.approved,
                u.verified,
                u.profile_status

            FROM users u

            WHERE
                u.role IN
                (
                    'doctor',
                    'nurse',
                    'lab',
                    'pharmacist',
                    'receptionist'
                )

                AND u.profile_status = 'PENDING_APPROVAL'

            ORDER BY u.id DESC

        `);


        res.json(result.rows);

    }

    catch (error) {

        console.error(
            "PENDING STAFF ERROR:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Failed to load pending staff.",

            error:
                error.message

        });

    }

});


/* =========================================================
   APPROVE STAFF
   PUT /api/staff/approve/:id
========================================================= */

router.put("/approve/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const userId = req.params.id;


        const result = await pool.query(

            `UPDATE users

             SET
                approved = true,
                profile_status = 'APPROVED'

             WHERE
                id = $1

             AND role IN
             (
                'doctor',
                'nurse',
                'lab',
                'pharmacist',
                'receptionist'
             )

             RETURNING id, name, email, role`,

            [userId]

        );


        if (result.rows.length === 0) {

            return res.status(404).json({

                success: false,

                message:
                    "Staff member not found."

            });

        }


        res.json({

            success: true,

            message:
                "Staff approved successfully.",

            staff:
                result.rows[0]

        });

    }

    catch (error) {

        console.error(
            "APPROVE STAFF ERROR:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Failed to approve staff.",

            error:
                error.message

        });

    }

});


/* =========================================================
   REJECT STAFF
   PUT /api/staff/reject/:id
========================================================= */

router.put("/reject/:id", async (req, res) => {

    const pool = req.app.locals.pool;

    try {

        const userId = req.params.id;

        const reason =
            req.body.reason ||
            "Rejected by administrator";


        const result = await pool.query(

            `UPDATE users

             SET
                approved = false,
                profile_status = 'CORRECTION_REQUIRED'

             WHERE
                id = $1

             AND role IN
             (
                'doctor',
                'nurse',
                'lab',
                'pharmacist',
                'receptionist'
             )

             RETURNING id, name, email, role`,

            [userId]

        );


        if (result.rows.length === 0) {

            return res.status(404).json({

                success: false,

                message:
                    "Staff member not found."

            });

        }


        res.json({

            success: true,

            message:
                "Staff sent back for correction.",

            reason,

            staff:
                result.rows[0]

        });

    }

    catch (error) {

        console.error(
            "REJECT STAFF ERROR:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Failed to reject staff.",

            error:
                error.message

        });

    }

});


/* =========================================================
   GET STAFF PROFILE
   GET /api/staff/profile/:id
========================================================= */
router.get("/profile/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await pool.query(`
            SELECT u.id, u.name, u.email, u.mobile, u.role, u.gender, u.dob,
                   u.profile_status,
                   sp.employee_id, sp.department, sp.date_of_joining,
                   sp.profile_photo, sp.address, sp.city, sp.state, sp.pincode,
                   sp.medical_reg_no, sp.reg_authority, sp.specialization,
                   sp.years_experience, sp.languages_known,
                   sp.nursing_reg_no, sp.nursing_reg_auth,
                   sp.lab_certification,
                   sp.pharmacy_reg_no, sp.pharmacy_reg_auth,
                   sp.verification_status, sp.rejection_reason
            FROM users u
            LEFT JOIN staff_profiles sp ON sp.user_id = u.id
            WHERE u.id = $1
        `, [req.params.id]);

        if (!result.rows.length)
            return res.status(404).json({ success: false, message: "Staff not found" });

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =========================================================
   COMPLETE PROFILE (personal + professional fields)
   POST /api/staff/complete-profile   (multipart)
========================================================= */
router.post("/complete-profile", upload.single("profile_photo"), async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const {
            user_id, address, city, state, pincode,
            medical_reg_no, reg_authority, specialization, years_experience, languages_known,
            nursing_reg_no, nursing_reg_auth, lab_certification,
            pharmacy_reg_no, pharmacy_reg_auth
        } = req.body;

        if (!user_id)
            return res.status(400).json({ success: false, message: "user_id required" });

        const photo = req.file ? req.file.filename : null;

        /* Upsert staff_profiles */
        await pool.query(`
            INSERT INTO staff_profiles
            (user_id, address, city, state, pincode,
             medical_reg_no, reg_authority, specialization, years_experience, languages_known,
             nursing_reg_no, nursing_reg_auth, lab_certification,
             pharmacy_reg_no, pharmacy_reg_auth
             ${photo ? ", profile_photo" : ""})
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15${photo ? ",$16" : ""})
            ON CONFLICT (user_id) DO UPDATE SET
                address           = EXCLUDED.address,
                city              = EXCLUDED.city,
                state             = EXCLUDED.state,
                pincode           = EXCLUDED.pincode,
                medical_reg_no    = EXCLUDED.medical_reg_no,
                reg_authority     = EXCLUDED.reg_authority,
                specialization    = EXCLUDED.specialization,
                years_experience  = EXCLUDED.years_experience,
                languages_known   = EXCLUDED.languages_known,
                nursing_reg_no    = EXCLUDED.nursing_reg_no,
                nursing_reg_auth  = EXCLUDED.nursing_reg_auth,
                lab_certification = EXCLUDED.lab_certification,
                pharmacy_reg_no   = EXCLUDED.pharmacy_reg_no,
                pharmacy_reg_auth = EXCLUDED.pharmacy_reg_auth,
                updated_at        = NOW()
                ${photo ? ", profile_photo = EXCLUDED.profile_photo" : ""}
        `, photo
            ? [user_id, address||null, city||null, state||null, pincode||null,
               medical_reg_no||null, reg_authority||null, specialization||null,
               years_experience||null, languages_known||null,
               nursing_reg_no||null, nursing_reg_auth||null, lab_certification||null,
               pharmacy_reg_no||null, pharmacy_reg_auth||null, photo]
            : [user_id, address||null, city||null, state||null, pincode||null,
               medical_reg_no||null, reg_authority||null, specialization||null,
               years_experience||null, languages_known||null,
               nursing_reg_no||null, nursing_reg_auth||null, lab_certification||null,
               pharmacy_reg_no||null, pharmacy_reg_auth||null]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =========================================================
   ADD QUALIFICATION
   POST /api/staff/qualification/add   (multipart)
========================================================= */
router.post("/qualification/add", upload.single("certificate"), async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const { user_id, degree_name, institution, year_of_completion } = req.body;

        if (!user_id || !degree_name || !institution || !year_of_completion)
            return res.status(400).json({ success: false, message: "All fields required" });

        if (!req.file)
            return res.status(400).json({ success: false, message: "Certificate file required" });

        await pool.query(`
            INSERT INTO staff_qualifications
            (user_id, degree_name, institution, year_of_completion, certificate_file, verification_status)
            VALUES ($1,$2,$3,$4,$5,'PENDING')
        `, [user_id, degree_name, institution, year_of_completion, req.file.filename]);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =========================================================
   GET QUALIFICATIONS
   GET /api/staff/qualifications/:id
========================================================= */
router.get("/qualifications/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await pool.query(
            `SELECT * FROM staff_qualifications WHERE user_id=$1 ORDER BY id`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json([]);
    }
});


/* =========================================================
   DELETE QUALIFICATION
   DELETE /api/staff/qualification/:id
========================================================= */
router.delete("/qualification/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        await pool.query(`DELETE FROM staff_qualifications WHERE id=$1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =========================================================
   SUBMIT FOR APPROVAL
   POST /api/staff/submit-approval/:id
========================================================= */
router.post("/submit-approval/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const userId = req.params.id;

        await pool.query(
            `UPDATE users SET profile_status='PENDING_APPROVAL' WHERE id=$1`,
            [userId]
        );
        await pool.query(
            `UPDATE staff_profiles SET profile_status='PENDING_APPROVAL', updated_at=NOW() WHERE user_id=$1`,
            [userId]
        );
        await pool.query(
            `INSERT INTO staff_approvals (user_id, action, notes) VALUES ($1,'SUBMITTED','Staff submitted profile for approval')`,
            [userId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =========================================================
   REVIEW STAFF (admin detail view)
   GET /api/staff/review/:id
========================================================= */
router.get("/review/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const profResult = await pool.query(`
            SELECT u.id, u.name, u.email, u.mobile, u.role, u.gender, u.dob,
                   u.profile_status,
                   sp.employee_id, sp.department, sp.date_of_joining,
                   sp.profile_photo, sp.address, sp.city, sp.state, sp.pincode,
                   sp.medical_reg_no, sp.reg_authority, sp.specialization,
                   sp.years_experience, sp.languages_known,
                   sp.nursing_reg_no, sp.nursing_reg_auth,
                   sp.lab_certification,
                   sp.pharmacy_reg_no, sp.pharmacy_reg_auth,
                   sp.verification_status, sp.rejection_reason, sp.qr_token
            FROM users u
            LEFT JOIN staff_profiles sp ON sp.user_id = u.id
            WHERE u.id = $1
        `, [req.params.id]);

        const qualResult = await pool.query(
            `SELECT * FROM staff_qualifications WHERE user_id=$1 ORDER BY id`,
            [req.params.id]
        );

        const approvalLog = await pool.query(
            `SELECT sa.*, u.name AS performed_by_name
             FROM staff_approvals sa
             LEFT JOIN users u ON u.id = sa.performed_by
             WHERE sa.user_id=$1 ORDER BY sa.created_at DESC`,
            [req.params.id]
        );

        res.json({
            profile:        profResult.rows[0] || {},
            qualifications: qualResult.rows,
            approval_log:   approvalLog.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =========================================================
   APPROVE STAFF (POST — used by approval.html)
   POST /api/staff/approve/:id
   Body: { reviewed_by, card_pin }  (pin is 4-6 digits)
========================================================= */
router.post("/approve/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const userId     = req.params.id;
        const reviewedBy = req.body.reviewed_by || null;
        const cardPin    = (req.body.card_pin || "").toString().trim();

        if (!cardPin || !/^\d{4,6}$/.test(cardPin))
            return res.status(400).json({ success: false, message: "card_pin must be 4–6 digits." });

        /* Generate QR token */
        const qrToken = crypto.randomBytes(32).toString("hex");

        await pool.query(
            `UPDATE users SET approved=true, profile_status='APPROVED' WHERE id=$1`,
            [userId]
        );
        await pool.query(
            `UPDATE staff_profiles
             SET verification_status='VERIFIED', profile_status='APPROVED',
                 qr_token=$1, card_pin=$2, updated_at=NOW()
             WHERE user_id=$3`,
            [qrToken, cardPin, userId]
        );
        await pool.query(
            `UPDATE staff_qualifications SET verification_status='APPROVED' WHERE user_id=$1`,
            [userId]
        );

        /* Upsert QR token record */
        await pool.query(`
            INSERT INTO qr_tokens (token, token_type, reference_id, is_active)
            VALUES ($1,'STAFF_CARD',$2,true)
            ON CONFLICT (token) DO NOTHING
        `, [qrToken, userId]);

        await pool.query(
            `INSERT INTO staff_approvals (user_id, action, performed_by, notes)
             VALUES ($1,'APPROVED',$2,'Staff approved by admin')`,
            [userId, reviewedBy]
        );

        res.json({ success: true, message: "Staff approved.", qr_token: qrToken });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =========================================================
   REQUEST CORRECTION
   POST /api/staff/request-correction/:id
========================================================= */
router.post("/request-correction/:id", async (req, res) => {
    const pool   = req.app.locals.pool;
    const reason = req.body.reason || "Please correct your profile.";
    try {
        const userId = req.params.id;

        await pool.query(
            `UPDATE users SET profile_status='CORRECTION_REQUIRED' WHERE id=$1`,
            [userId]
        );
        await pool.query(
            `UPDATE staff_profiles
             SET verification_status='CORRECTION_REQUIRED',
                 profile_status='CORRECTION_REQUIRED',
                 rejection_reason=$1, updated_at=NOW()
             WHERE user_id=$2`,
            [reason, userId]
        );
        await pool.query(
            `INSERT INTO staff_approvals (user_id, action, notes) VALUES ($1,'CORRECTION_REQUIRED',$2)`,
            [userId, reason]
        );

        res.json({ success: true, message: "Correction requested." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =========================================================
   STAFF QR CARD DATA
   GET /api/staff/qr-card/:id
========================================================= */
router.get("/qr-card/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const result = await pool.query(`
            SELECT u.id, u.name, u.role, u.email, u.mobile,
                   sp.employee_id, sp.department, sp.specialization,
                   sp.profile_photo, sp.verification_status, sp.qr_token,
                   sp.date_of_joining, sp.address, sp.city, sp.state
            FROM users u
            JOIN staff_profiles sp ON sp.user_id = u.id
            WHERE u.id = $1
        `, [req.params.id]);

        if (!result.rows.length)
            return res.status(404).json({ success: false, message: "Staff not found" });

        const staff = result.rows[0];

        if (!staff.qr_token)
            return res.status(400).json({ success: false, message: "QR not generated yet — staff not approved" });

        /* QR encodes a URL so scanning opens the verify page directly */
        const verifyUrl = `http://localhost:5000/staff/verify.html?token=${staff.qr_token}`;
        const qrImage   = await QRCode.toDataURL(verifyUrl, { width: 220, margin: 1 });

        res.json({ success: true, staff, qr_image: qrImage });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


/* =========================================================
   VERIFY STAFF CARD (QR scan → PIN → details)
   POST /api/staff/verify-card
   Body: { token, pin }
========================================================= */
router.post("/verify-card", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const { token, pin } = req.body;
        if (!token || !pin)
            return res.status(400).json({ success: false, message: "token and pin required" });

        const result = await pool.query(`
            SELECT u.id, u.name, u.role, u.email, u.mobile, u.gender, u.dob,
                   sp.employee_id, sp.department, sp.specialization,
                   sp.medical_reg_no, sp.reg_authority,
                   sp.nursing_reg_no, sp.nursing_reg_auth,
                   sp.pharmacy_reg_no, sp.pharmacy_reg_auth,
                   sp.lab_certification,
                   sp.years_experience, sp.languages_known,
                   sp.profile_photo, sp.verification_status,
                   sp.date_of_joining, sp.address, sp.city, sp.state, sp.pincode,
                   sp.card_pin, sp.qr_token
            FROM users u
            JOIN staff_profiles sp ON sp.user_id = u.id
            WHERE sp.qr_token = $1
        `, [token]);

        if (!result.rows.length)
            return res.status(404).json({ success: false, message: "Invalid QR code" });

        const staff = result.rows[0];

        if (staff.card_pin !== pin.toString().trim())
            return res.status(401).json({ success: false, message: "Incorrect PIN" });

        /* Remove pin from response */
        delete staff.card_pin;
        delete staff.qr_token;

        /* Fetch qualifications */
        const quals = await pool.query(
            `SELECT degree_name, institution, year_of_completion, verification_status
             FROM staff_qualifications WHERE user_id=$1 ORDER BY id`,
            [staff.id]
        );

        res.json({ success: true, staff, qualifications: quals.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});


module.exports = router;