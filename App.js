const express = require("express");
const http = require("http");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const path = require("path");

dotenv.config();
const { Server } = require("socket.io"); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

/* ===========================
   BODY PARSER
=========================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ===========================
   DATABASE
=========================== */
const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "nalamaihospital",
    password: "vikashini",
    port: 5432
});

app.locals.pool = pool;

/* ===========================
   STATIC FILES (PUT FIRST)
=========================== */
app.use(express.static(path.join(__dirname, "views")));
app.use(express.static(__dirname));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ===========================
   ROUTES
=========================== */
const appointmentRoutes = require("./routes/appointmentRoutes");
const authRoutes = require("./routes/authRoutes");
const patientRoutes = require("./routes/patientRoutes");
const doctorRoutes = require("./routes/doctorRoutes");
const pharmacyRoutes = require("./routes/pharmacyRoutes");
const labRoutes = require("./routes/labRoutes");
const emergencyRoutes = require("./routes/emergencyRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes")(pool, io);
const maintenanceRoutes = require("./routes/maintenanceRoutes")(pool, io);
const adminRoutes = require("./routes/adminRoutes");
const salaryRoutes = require("./routes/salaryRoutes");
const revenueRoutes = require("./routes/revenueRoutes");
const receptionistRoutes = require("./routes/receptionistRoutes");
app.use("/receptionist", receptionistRoutes);
app.use("/revenue", revenueRoutes);
app.use("/salary", salaryRoutes);
app.use("/admin", adminRoutes);
app.use("/purchase", purchaseRoutes);
app.use("/maintenance", maintenanceRoutes);
app.use("/emergency", emergencyRoutes);

app.use("/appointment", appointmentRoutes);
app.use("/", pharmacyRoutes);
app.use("/", authRoutes);
app.use("/", patientRoutes);
app.use("/", doctorRoutes);

/* IMPORTANT */
app.use("/lab", labRoutes);

/* ===========================
   DEFAULT ROUTE (IMPORTANT)
=========================== */
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

/* OTP */
app.get("/otp.html", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "auth", "otp.html"));
});

/* ===========================
   SERVER
=========================== */
server.listen(5000, () => {
    console.log("Server Running on Port 5000");
});