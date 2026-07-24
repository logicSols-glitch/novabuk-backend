/**
 * services/prescriptionService.js
 * ──────────────────────────────────
 * Prescription PDF export — Feature 4 (Prescription Pad).
 *
 * Mirrors the receipt PDF pattern already used in billingService.js:
 * returns a Buffer (not a stream), so the same generated PDF can be
 * sent straight to the browser from either the clinic portal (staff
 * print/download) or the patient app (their own download route),
 * without duplicating the PDF layout in two places.
 *
 * REQUIRED PACKAGE: pdfkit (already a dependency — see billingService.js)
 */

const PDFDocument = require("pdfkit");
const path = require("path");
const User = require("../models/User");
const ClinicStaff = require("../models/ClinicStaff");

// ── RESOLVE DOCTOR NAME ────────────────────────────────────────
/**
 * doctorId + doctorType → display name. Same owner-vs-ClinicStaff
 * pattern used throughout this codebase (Appointment.js, PrivateNote.js,
 * clinic-lab.js, etc) — "doctor" here can be either the clinic owner
 * (a User) or an added ClinicStaff doctor.
 */
async function resolveDoctorName(doctorId, doctorType) {
  if (!doctorId) return "Doctor";
  try {
    if (doctorType === "User") {
      const user = await User.findById(doctorId).select("fullName");
      return user?.fullName || "Doctor";
    }
    const staff = await ClinicStaff.findById(doctorId).select("fullName");
    return staff?.fullName || "Doctor";
  } catch (err) {
    return "Doctor";
  }
}

// ── PDF GENERATION ──────────────────────────────────────────────
function generatePrescriptionPDFBuffer(prescription, clinic, patient, doctorName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 40 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Watermark — same 15% opacity logo pattern as the billing receipt,
    // so every NovaBuk-generated document has a consistent look.
    const logoPath = path.join(__dirname, "../public/images/logo.png");
    try {
      doc.opacity(0.15);
      doc.image(logoPath, doc.page.width / 2 - 100, doc.page.height / 2 - 100, { width: 200 });
      doc.opacity(1);
    } catch (err) {
      console.warn("[prescriptionService] Could not load logo for watermark:", err.message);
    }

    // Clinic header
    doc.fontSize(16).font("Helvetica-Bold").text(clinic.name, { align: "center" });
    if (clinic.location?.address) {
      doc.fontSize(9).font("Helvetica").text(clinic.location.address, { align: "center" });
    }
    doc.moveDown(0.8);
    doc.fontSize(13).font("Helvetica-Bold").text("PRESCRIPTION", { align: "center" });
    doc.moveDown(1);

    // Meta block
    doc.fontSize(10);
    doc.font("Helvetica-Bold").text("Patient: ", { continued: true }).font("Helvetica").text(patient.fullName);
    doc.font("Helvetica-Bold").text("Prescribed by: ", { continued: true }).font("Helvetica").text(doctorName);
    doc
      .font("Helvetica-Bold")
      .text("Date: ", { continued: true })
      .font("Helvetica")
      .text(new Date(prescription.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }));
    doc.moveDown(0.8);

    doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
    doc.moveDown(0.6);

    // Drug list
    doc.font("Helvetica-Bold").fontSize(11).text("Medications", { underline: true });
    doc.moveDown(0.4);

    prescription.items.forEach((item, idx) => {
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(`${idx + 1}. ${item.drugName} — ${item.dosage}`);
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#444")
        .text(`   ${item.route} · ${item.frequency} · ${item.durationDays} day(s)`);
      if (item.specialNotes) {
        doc.fontSize(9).fillColor("#666").text(`   Note: ${item.specialNotes}`);
      }
      if (item.dispensed) {
        doc.fontSize(8).fillColor("#198754").text(`   ✓ Dispensed ${new Date(item.dispensedAt).toLocaleDateString("en-NG")}`);
      }
      doc.fillColor("#000").moveDown(0.6);
    });

    doc.moveDown(1);
    doc.fontSize(8).fillColor("#999").text("Powered by NovaBuk — Healthcare, Simplified.", { align: "center" });

    doc.end();
  });
}

module.exports = { generatePrescriptionPDFBuffer, resolveDoctorName };