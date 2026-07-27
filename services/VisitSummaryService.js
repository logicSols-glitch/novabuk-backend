/**
 * services/visitSummaryService.js
 * ──────────────────────────────────
 * Downloadable "Visit Summary" PDF — a patient's own clinical record
 * for one completed visit (diagnosis, advice, tests ordered, doctor,
 * clinic), for exactly the situation this doesn't otherwise cover:
 * proof of consultation for insurance, travel, a new doctor, work/
 * school clearance, etc. Mirrors the same Buffer-return pattern as
 * billingService.js / prescriptionService.js so it can be streamed
 * straight to the browser from a patient-facing route.
 *
 * REQUIRED PACKAGE: pdfkit (already a dependency)
 */

const PDFDocument = require("pdfkit");
const path = require("path");

function generateVisitSummaryPDFBuffer(visit, clinic, patient, doctorName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Watermark — same 15% opacity logo pattern used across every
    // NovaBuk-generated document (receipt, prescription).
    const logoPath = path.join(__dirname, "../public/images/logo.png");
    try {
      doc.opacity(0.12);
      doc.image(logoPath, doc.page.width / 2 - 120, doc.page.height / 2 - 120, { width: 240 });
      doc.opacity(1);
    } catch (err) {
      console.warn("[visitSummaryService] Could not load logo for watermark:", err.message);
    }

    // Header
    doc.fontSize(18).font("Helvetica-Bold").text(clinic.name, { align: "center" });
    if (clinic.location?.address) {
      doc.fontSize(9).font("Helvetica").fillColor("#555").text(
        `${clinic.location.address}${clinic.location.city ? ", " + clinic.location.city : ""}`,
        { align: "center" }
      );
    }
    doc.fillColor("#000").moveDown(0.6);
    doc.fontSize(14).font("Helvetica-Bold").text("VISIT SUMMARY", { align: "center" });
    doc.moveDown(1.2);

    // Meta block
    const row = (label, value) => {
      doc.font("Helvetica-Bold").fontSize(10).text(`${label}: `, { continued: true }).font("Helvetica").text(value || "—");
    };
    row("Patient", patient.fullName);
    row("NovaBuk ID", patient.novaBukId || "—");
    row("Visit type", visit.visitType || "General");
    row(
      "Date seen",
      new Date(visit.completedAt || visit.createdAt).toLocaleDateString("en-NG", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    );
    row("Attending doctor", doctorName);
    doc.moveDown(0.8);

    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(0.8);

    // Clinical sections — only rendered when there's actually content,
    // so a visit with a light record doesn't produce a page full of
    // empty headers.
    const section = (title, content) => {
      if (!content || !content.trim()) return;
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f2027").text(title);
      doc.moveDown(0.25);
      doc.font("Helvetica").fontSize(10).fillColor("#222").text(content.trim(), { align: "left" });
      doc.moveDown(0.9);
    };

    section("Diagnosis", visit.diagnosis);
    section("Doctor's Advice", visit.advice);
    section("Tests Ordered", visit.testsOrdered);
    section("Prescription Notes", visit.prescription);
    section("Clinical Notes", visit.clinicNotes);

    if (
      !visit.diagnosis?.trim() &&
      !visit.advice?.trim() &&
      !visit.testsOrdered?.trim() &&
      !visit.prescription?.trim() &&
      !visit.clinicNotes?.trim()
    ) {
      doc.font("Helvetica-Oblique").fontSize(10).fillColor("#888").text("No additional clinical notes were recorded for this visit.");
      doc.moveDown(0.9);
    }

    doc.moveDown(1.5);
    doc.fontSize(8).fillColor("#999").text(
      `Generated ${new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })} — Powered by NovaBuk. This document reflects the clinic's own records at the time of the visit.`,
      { align: "center" }
    );

    doc.end();
  });
}

module.exports = { generateVisitSummaryPDFBuffer };