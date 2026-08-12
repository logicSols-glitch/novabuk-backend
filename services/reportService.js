/**
 * services/reportService.js
 * ────────────────────────────
 * Downloadable/printable billing report — patients seen, revenue
 * collected, payment method breakdown, and category breakdown
 * (consultation/pharmacy/lab) for any date range a clinic picks.
 * Mirrors the same Buffer-return pattern as billingService.js /
 * prescriptionService.js / VisitSummaryService.js, so it streams
 * straight to the browser the same way every other document in this
 * codebase does.
 *
 * The single-day case (startDate === endDate) and any wider range
 * both flow through the same renderer — a "Daily Summary" a clinic
 * prints every evening and a "Q1 Report" they generate once a
 * quarter are the same document shape, just a different date range.
 *
 * REQUIRED PACKAGE: pdfkit (already a dependency — see billingService.js)
 */

const PDFDocument = require("pdfkit");
const path = require("path");

function formatMoney(n) {
  return `\u20a6${(n || 0).toLocaleString()}`;
}

function formatDateLabel(dateStr) {
  return new Date(dateStr).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function generateBillingReportPDFBuffer(summary, clinic, startDate, endDate) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Watermark — same 15% opacity logo pattern used across every
    // NovaBuk-generated document.
    const logoPath = path.join(__dirname, "../public/images/logo.png");
    try {
      doc.opacity(0.12);
      doc.image(logoPath, doc.page.width / 2 - 120, doc.page.height / 2 - 120, { width: 240 });
      doc.opacity(1);
    } catch (err) {
      console.warn("[reportService] Could not load logo for watermark:", err.message);
    }

    // Header
    doc.fontSize(18).font("Helvetica-Bold").text(clinic?.name || "Clinic", { align: "center" });
    if (clinic?.location?.address) {
      doc.fontSize(9).font("Helvetica").fillColor("#555").text(
        `${clinic.location.address}${clinic.location.city ? ", " + clinic.location.city : ""}`,
        { align: "center" }
      );
    }
    doc.fillColor("#000").moveDown(0.6);

    const isSingleDay = startDate === endDate;
    doc.fontSize(14).font("Helvetica-Bold").text("BILLING REPORT", { align: "center" });
    doc.fontSize(10).font("Helvetica").fillColor("#555").text(
      isSingleDay ? formatDateLabel(startDate) : `${formatDateLabel(startDate)}  —  ${formatDateLabel(endDate)}`,
      { align: "center" }
    );
    doc.fillColor("#000").moveDown(1.2);

    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
    doc.moveDown(1);

    // ── HEADLINE NUMBERS ──────────────────────────────────────
    const headline = (label, value) => {
      doc.font("Helvetica").fontSize(11).fillColor("#444").text(label, { continued: true });
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(`  ${value}`, { align: "right" });
    };
    headline("Patients Seen", String(summary.patientsSeen));
    doc.moveDown(0.3);
    headline("Total Revenue Collected", formatMoney(summary.totalRevenue));
    doc.moveDown(0.3);
    headline("Outstanding Balance", formatMoney(summary.outstandingBalance));
    doc.moveDown(1.2);

    // ── TABLE HELPER ──────────────────────────────────────────
    const table = (title, rows) => {
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f2027").text(title);
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#eee").stroke().strokeColor("#000");
      doc.moveDown(0.3);

      rows.forEach(([label, value]) => {
        const y = doc.y;
        doc.font("Helvetica").fontSize(10).fillColor("#333").text(label, 50, y, { continued: true, width: 300 });
        doc.font("Helvetica").fontSize(10).fillColor("#333").text(value, { align: "right" });
      });
      doc.moveDown(1);
    };

    // ── PAYMENT METHOD BREAKDOWN ──────────────────────────────
    table("Revenue by Payment Method", [
      ["Cash", formatMoney(summary.byPaymentMethod.CASH)],
      ["Transfer", formatMoney(summary.byPaymentMethod.TRANSFER)],
      ["POS", formatMoney(summary.byPaymentMethod.POS)],
      ["Waived", formatMoney(summary.byPaymentMethod.WAIVED)],
    ]);

    // ── CATEGORY BREAKDOWN ─────────────────────────────────────
    table("Revenue by Category", [
      ["Consultation (front desk)", formatMoney(summary.byCategory.GENERAL)],
      ["Pharmacy", formatMoney(summary.byCategory.PHARMACY)],
      ["Lab", formatMoney(summary.byCategory.LAB)],
    ]);

    doc.moveDown(1);
    doc.fontSize(8).fillColor("#999").text(
      `Generated ${new Date().toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })} — Powered by NovaBuk.`,
      { align: "center" }
    );

    doc.end();
  });
}

module.exports = { generateBillingReportPDFBuffer };