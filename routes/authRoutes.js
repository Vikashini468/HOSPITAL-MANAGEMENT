const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const sendOTP = require("../utils/mail");

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// -------------------- PAGES --------------------
router.get("/register.html", (req, res) => res.sendFile(path.join(__dirname, "../views/auth/register.html")));
router.get("/login.html", (req, res) => res.sendFile(path.join(__dirname, "../views/auth/login.html")));
router.get("/otp.html", (req, res) => res.sendFile(path.join(__dirname, "../views/auth/otp.html")));

router.get("/prescription.html", (req, res) => res.sendFile(path.join(__dirname, "../prescription.html")));
router.get("/lab_selection.html", (req, res) => res.sendFile(path.join(__dirname, "../lab_selection.html")));
router.get("/patient", (req, res) => res.sendFile(path.join(__dirname, "../views/patient/patient.html")));
router.get("/doctor", (req, res) => res.sendFile(path.join(__dirname, "../views/doctor/doctor.html")));
router.get("/lab", (req, res) => res.sendFile(path.join(__dirname, "../views/lab/lab.html")));
router.get("/pharmacy", (req, res) => res.sendFile(path.join(__dirname, "../views/pharmacy/pharmacy.html")));
router.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "../views/admin/admin.html")));

// -------------------- REGISTER --------------------
router.post("/register", upload.any(), async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const { name, email, mobile, password, role, age, gender, dob, bloodGroup, weight, allergies, previousHospital, address } = req.body;

        if (!name || !email || !mobile || !password || !role) return res.status(400).send("Missing required fields");

        const existingUser = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
        if (existingUser.rows.length > 0) return res.status(400).send("User already exists");

        const username = `${role}@${name.replace(/\s/g, "").toLowerCase()}`;
        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

        await sendOTP(email, otp);

        const userResult = await pool.query(
            `INSERT INTO users (name, username, email, mobile, password, role, gender, otp, otp_expires, verified, approved)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,false) RETURNING id`,
            [name, username, email, mobile, hashedPassword, role, gender, otp, otpExpires]
        );
        const userId = userResult.rows[0].id;
        const photo = req.files && req.files.length > 0 ? req.files[0].filename : null;

        if (role === "patient") {
            await pool.query(
                `INSERT INTO patients (user_id, name, age, gender, dob, blood_group, weight, allergies, previous_hospital, address, photo)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [userId, name, age, gender, dob, bloodGroup, weight, allergies, previousHospital, address, photo]
            );
        }
        if (role === "doctor") {
            await pool.query(
                `INSERT INTO doctors (user_id, degree, college, specialisation, medical_number, current_hospital) VALUES ($1,$2,$3,$4,$5,$6)`,
                [userId, req.body.degree, req.body.college, req.body.specialisation, req.body.medicalNumber, req.body.currentHospitalDoctor]
            );
        }
        if (role === "nurse") {
            await pool.query(
                `INSERT INTO nurses (user_id, qualification, college, current_hospital) VALUES ($1,$2,$3,$4)`,
                [userId, req.body.nurseQualification, req.body.nurseCollege, req.body.currentHospitalNurse]
            );
        }
        if (role === "lab") {
            await pool.query(
                `INSERT INTO labs (user_id, qualification, registration_number, current_hospital) VALUES ($1,$2,$3,$4)`,
                [userId, req.body.labQualification, req.body.labRegistration, req.body.currentHospitalLab]
            );
        }
        if (role === "pharmacist") {
            await pool.query(
                `INSERT INTO pharmacists (user_id, qualification, license_number, current_hospital) VALUES ($1,$2,$3,$4)`,
                [userId, req.body.pharmacistQualification, req.body.licenseNumber, req.body.currentHospitalPharmacist]
            );
        }

        return res.redirect(`/otp.html?email=${email}`);
    } catch (err) {
        console.error(err);
        return res.status(500).send("Registration Failed");
    }
});

// -------------------- VERIFY OTP --------------------
router.post("/verify-otp", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const { email, otp } = req.body;
        const result = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);
        if (result.rows.length === 0) return res.json({ success: false, message: "User not found" });
        const user = result.rows[0];
        if (new Date() > user.otp_expires) return res.json({ success: false, message: "OTP expired" });
        if (user.otp !== otp) return res.json({ success: false, message: "Invalid OTP" });
        await pool.query(`UPDATE users SET verified=true, otp=NULL, otp_expires=NULL WHERE email=$1`, [email]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// -------------------- LOGIN --------------------
router.post("/login", async (req, res) => {
    const pool = req.app.locals.pool;
    try {
        const { email, password } = req.body;
        const result = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);
        if (result.rows.length === 0) return res.send("User Not Found");
        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.send("Wrong Password");
        if (user.role !== "patient" && user.role !== "admin" && !user.approved) return res.send("Please wait for approval");
        if (!user.verified) return res.send("Please Verify OTP First");

        if (user.role === "admin") {
            if (user.email !== "admin@nalam.com") return res.send("Access Denied: Not authorized admin");
            return res.redirect(`/admin?username=${encodeURIComponent(user.username)}`);
        }

        const routes = { patient: "/patient", doctor: "/doctor", nurse: "/nurse", lab: "/lab", pharmacist: "/pharmacy" };
        return res.redirect(`${routes[user.role]}?id=${user.id}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Login Failed");
    }
});

// -------------------- API --------------------
router.get("/api/user/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    const result = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.params.id]);
    res.json(result.rows[0]);
});

router.get("/admin/pending-users", async (req, res) => {
    const pool = req.app.locals.pool;
    const result = await pool.query(`SELECT * FROM users WHERE role IN ('doctor','nurse','lab','pharmacist') AND approved=false`);
    res.json(result.rows);
});

router.post("/admin/approve-user/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    await pool.query(`UPDATE users SET approved=true WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
});

router.delete("/admin/reject-user/:id", async (req, res) => {
    const pool = req.app.locals.pool;
    await pool.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
});

module.exports = router;
