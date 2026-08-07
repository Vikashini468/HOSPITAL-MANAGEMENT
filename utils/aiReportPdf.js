/* =====================================================
   AI DISEASE RISK PREDICTION REPORT — PDF GENERATOR
   -----------------------------------------------------
   Builds the professional "AI Prediction Report" PDF for
   a doctor consultation using pdfkit. It is generated for
   a PENDING report (temporary, doctor review) and again
   for a VERIFIED report (permanent medical history copy
   which includes the doctor notes + verification stamp).
   ===================================================== */

const PDFDocument = require("pdfkit");
const fs          = require("fs");
const path        = require("path");
const hospital    = require("../config/hospital");

/* Friendly model name per model_type (used on the report only) */
const MODEL_NAMES = {
    diabetes:       "Diabetes Risk Model",
    hypertension:   "Hypertension Risk Model",
    cardiovascular: "Cardiovascular Risk Model"
};

function modelName(modelType) {
    return MODEL_NAMES[String(modelType || "").toLowerCase()] || String(modelType || "AI Model");
}

/* Risk level derived from the model output — display only */
function riskLevel(prediction) {
    const p = String(prediction || "").toUpperCase();
    if (p.includes("HIGH") || p === "POSITIVE") return "High";
    if (p.includes("MODERATE") || p.includes("MEDIUM")) return "Medium";
    return "Low";
}

function statusStyle(status) {
    const s = String(status || "PENDING").toUpperCase();
    if (s === "VERIFIED")      return { label: "Verified",    fill: "#2e7d32", bg: "#e8f5e9" };
    if (s === "NOT_VERIFIED")  return { label: "Not Verified", fill: "#c62828", bg: "#ffebee" };
    return { label: "Pending", fill: "#e65100", bg: "#fff3e0" };
}

function fmtNum(v, suffix) {
    if (v == null || isNaN(Number(v))) return "—";
    return Number(v) + (suffix || "");
}

/* Ensure the target directory exists */
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

/* =====================================================
   generateAiPredictionReport(report)
   report = {
     report_no, patient_id, patient_health_id, patient_name,
     visit_id, doctor_name, predicted_at,
     results: [{ disease, prediction, probability, confidence, model_type }],
     verification_status, doctor_notes, verified_at,
     outputPath
   }
   Returns a Promise that resolves with outputPath.
   ===================================================== */
function generateAiPredictionReport(report) {
    return new Promise((resolve, reject) => {
        try {
            ensureDir(path.dirname(report.outputPath));

            const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
            const stream = fs.createWriteStream(report.outputPath);
            stream.on("error", reject);
            doc.pipe(stream);

            const PENDING     = String(report.verification_status || "PENDING").toUpperCase() !== "VERIFIED";
            const status      = statusStyle(report.verification_status);
            const predDate    = report.predicted_at ? new Date(report.predicted_at) : new Date();
            const verifiedAt  = report.verified_at ? new Date(report.verified_at) : null;

            /* ── Header band ── */
            doc.rect(0, 0, doc.page.width, 92).fill(PENDING ? "#134f8f" : "#2e7d32");

            /* Drawn hospital logo placeholder */
            const logoX = 44, logoY = 20, logoSize = 52;
            doc.roundedRect(logoX, logoY, logoSize, logoSize, 10).fill("#ffffff");
            doc.roundedRect(logoX, logoY, logoSize, logoSize, 10).stroke("#e3eaf5");
            doc.font("Helvetica-Bold").fontSize(24).fillColor("#134f8f")
               .text(hospital.name.charAt(0).toUpperCase(), logoX, logoY + 8, {
                   width: logoSize, align: "center"
               });
            doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff")
               .text(hospital.name, logoX + logoSize + 12, 20, { width: 420 });
            doc.font("Helvetica").fontSize(10).fillColor("#dbeafe")
               .text(hospital.tagline, logoX + logoSize + 12, 46, { width: 420 });
            doc.fontSize(8).fillColor("#cfe3ff")
               .text(hospital.address, logoX + logoSize + 12, 62, { width: 420 });
            doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff")
               .text(`${hospital.phone}   |   ${hospital.email}   |   ${hospital.website}`, logoX + logoSize + 12, 74, { width: 420 });

            /* ── Report title block ── */
            doc.y = 116;
            doc.font("Helvetica-Bold").fontSize(16).fillColor("#0d47a1").text("AI Disease Risk Prediction Report");
            doc.font("Helvetica").fontSize(9).fillColor("#666")
               .text(`Report No: ${report.report_no || "—"}`, doc.x, doc.y + 6);
            doc.fontSize(9).text(`Generated on: ${predDate.toLocaleString("en-IN")}`, { continued: true });

            /* Verification status box */
            const sWidth = 130, sHeight = 26;
            doc.save()
               .roundedRect(doc.page.width - 40 - sWidth, 118, sWidth, sHeight, 6)
               .fill(status.bg);
            doc.font("Helvetica-Bold").fontSize(10).fillColor(status.fill)
               .text(`Verification: ${status.label}`, doc.page.width - 40 - sWidth + 10, 125, { width: sWidth - 20, align: "center" });
            doc.restore();

            /* ── Patient / visit / doctor info ── */
            doc.y = 172;
            const infoRows = [
                ["Patient ID", report.patient_health_id || report.patient_id || "—"],
                ["Patient Name", report.patient_name || "—"],
                ["Visit ID", report.visit_id || "—"],
                ["Doctor", report.doctor_name ? "Dr. " + report.doctor_name : "—"],
                ["Prediction Date / Time", predDate.toLocaleString("en-IN")]
            ];
            if (verifiedAt) infoRows.push(["Verified At", verifiedAt.toLocaleString("en-IN")]);

            doc.roundedRect(40, doc.y, doc.page.width - 80, infoRows.length * 22 + 14, 8)
               .fill("#f4f8ff").stroke("#d0e4ff");
            let infoY = doc.y + 10;
            infoRows.forEach(([label, value], i) => {
                doc.font("Helvetica-Bold").fontSize(9).fillColor("#0d47a1")
                   .text(label, 52, infoY);
                doc.font("Helvetica").fontSize(9).fillColor("#333")
                   .text(String(value), 190, infoY, { width: doc.page.width - 250 });
                infoY += 22;
            });

            /* ── Results table ── */
            doc.y = infoY + 14;
            doc.font("Helvetica-Bold").fontSize(12).fillColor("#0d47a1").text("Prediction Results");

            const results = Array.isArray(report.results) ? report.results : [];
            const cols = [
                { label: "Disease",       w: 110 },
                { label: "Prediction",    w: 85  },
                { label: "Risk Probability", w: 78 },
                { label: "Confidence",    w: 70  },
                { label: "Risk Level",    w: 62  },
                { label: "Model",         w: 125 }
            ];
            const tableX = 40;
            const tableW = doc.page.width - 80;
            const rowH = 30;

            const drawRow = (y, isHeader, r) => {
                let x = tableX;
                const colsDef = isHeader
                    ? cols.map(c => ({ label: c.label, w: c.w, bold: true }))
                    : cols.map(c => ({ label: c.label, w: c.w }));
                colsDef.forEach((c, i) => {
                    const isLast = i === colsDef.length - 1;
                    const w = isLast ? tableW - (x - tableX) : c.w;
                    doc.rect(x, y, w, rowH).fill(isHeader ? "#134f8f" : (i % 2 ? "#f8faff" : "#ffffff")).stroke("#dde7f5");
                    doc.font(c.bold ? "Helvetica-Bold" : "Helvetica")
                       .fontSize(c.bold ? 8.5 : 8)
                       .fillColor(isHeader ? "#ffffff" : "#333")
                       .text(String(c.label), x + 4, y + 10, { width: w - 8 });
                    x += w;
                });
            };

            const startY = doc.y + 8;
            drawRow(startY, true);
            let ry = startY + rowH;
            results.forEach((r, i) => {
                const rowVals = [
                    r.disease || "—",
                    r.prediction || "—",
                    fmtNum(r.probability, "%"),
                    fmtNum(r.confidence, "%"),
                    riskLevel(r.prediction),
                    modelName(r.model_type)
                ];
                let x = tableX;
                rowVals.forEach((val, j) => {
                    const isLast = j === rowVals.length - 1;
                    const w = isLast ? tableW - (x - tableX) : cols[j].w;
                    doc.rect(x, ry, w, rowH).fill(j % 2 ? "#f8faff" : "#ffffff").stroke("#dde7f5");
                    const bold = j === 1;
                    doc.font(bold ? "Helvetica-Bold" : "Helvetica")
                       .fontSize(8)
                       .fillColor(bold ? "#0d47a1" : "#333")
                       .text(String(val), x + 4, ry + 10, { width: w - 8 });
                    x += w;
                });
                ry += rowH;
            });

            /* ── Doctor notes ── */
            doc.y = ry + 16;
            doc.font("Helvetica-Bold").fontSize(12).fillColor("#0d47a1").text("Doctor Notes");
            const notes = String(report.doctor_notes || "").trim();
            doc.roundedRect(40, doc.y + 4, doc.page.width - 80, 80, 8)
               .fill("#ffffff").stroke("#d0e4ff");
            doc.font("Helvetica").fontSize(10).fillColor("#333")
               .text(notes || (PENDING ? "Awaiting doctor verification…" : "No notes recorded."), 52, doc.y + 16, {
                   width: doc.page.width - 104
               });

            /* ── Footer on every page ── */
            const totalPages = doc.bufferedPageRange().count;
            const footer = () => {
                const range = doc.bufferedPageRange();
                for (let i = range.start; i < range.start + range.count; i++) {
                    doc.switchToPage(i);
                    doc.font("Helvetica").fontSize(8).fillColor("#999")
                       .text(
                           `${hospital.name} — AI Disease Risk Prediction Report  •  Page ${i + 1} of ${totalPages}`,
                           40, doc.page.height - 30, { width: doc.page.width - 80, align: "center" }
                       );
                    if (PENDING) {
                        doc.font("Helvetica-Bold").fontSize(8).fillColor("#e65100")
                           .text("UNVERIFIED — TEMPORARY REPORT. Pending doctor verification.",
                                 40, doc.page.height - 44, { width: doc.page.width - 80, align: "center" });
                    }
                }
            };

            doc.on("pageAdded", footer);
            doc.on("end", () => footer());

            doc.end();
            stream.on("finish", () => resolve(report.outputPath));
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = { generateAiPredictionReport, modelName, riskLevel };
