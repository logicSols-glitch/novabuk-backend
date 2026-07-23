/**
 * services/billingService.js
 * ─────────────────────────────
 * Point of Care Billing — bill generation, receipt numbering, PDF
 * generation, and WhatsApp document delivery.
 *
 * REQUIRED PACKAGE: npm install pdfkit
 * (cloudinary is already a dependency — see routes/uploads.js)
 */

const cloudinary = require("cloudinary").v2;
const PDFDocument = require("pdfkit");
const path = require("path");

const ClinicFeeSchedule = require("../models/ClinicFeeSchedule");
const PatientBill = require("../models/PatientBill");
const { getNextSequence } = require("../models/Counter");

// ── BILL GENERATION ────────────────────────────────────────────
/**
 * Called from clinic-visits.js /visits/:id/complete. Looks up the
 * clinic's configured fee for this visit's type and creates a
 * PatientBill. Returns null (does NOT throw) if the clinic hasn't
 * configured a fee for this visit type — visit completion should
 * never fail just because billing isn't configured yet.
 *
 * IDEMPOTENT: if a bill already exists for this visit (e.g. the
 * complete route gets called twice due to a network retry), returns
 * the existing bill instead of creating a duplicate.
 *
 * PLAN GATING NOTE: only ever adds a CONSULTATION line item — lab/
 * pharmacy charges require Feature 4 (lab requests/prescriptions),
 * which doesn't exist yet. This is the single place to extend when
 * that's built.
 */
async function generateBillForVisit(visit, clinic) {
  const existing = await PatientBill.findOne({ visit: visit._id });
  if (existing) {
    console.log(`[billingService] Bill already exists for visit ${visit._id} — skipping duplicate creation.`);
    return existing;
  }

  const feeEntry = await ClinicFeeSchedule.findOne({
    clinic: clinic._id,
    visitType: visit.visitType || "General",
    isActive: true,
  });

  if (!feeEntry) {
    console.warn(
      `[billingService] No active fee configured for clinic ${clinic._id}, visit type "${visit.visitType}". Skipping bill generation — clinic needs to set up Billing in Settings.`
    );
    return null;
  }

  const lineItems = [
    {
      itemType: "CONSULTATION",
      description: `${visit.visitType || "General"} Consultation`,
      unitPrice: feeEntry.feeAmount,
      quantity: 1,
      lineTotal: feeEntry.feeAmount,
    },
  ];

  const subtotal = lineItems.reduce((sum, item) => sum + item.lineTotal, 0);

  const bill = await PatientBill.create({
    visit: visit._id,
    patient: visit.user._id || visit.user,
    clinic: clinic._id,
    lineItems,
    subtotal,
    discount: 0,
    totalAmount: subtotal,
    paymentStatus: "UNPAID",
  });

  return bill;
}

// ── RECEIPT NUMBERING (atomic — no race condition) ────────────
/**
 * Format: NVB-[YEAR][MONTH]-[SEQUENCE], e.g. NVB-202606-00142.
 * Uses Counter's atomic $inc — guaranteed unique even under
 * concurrent requests, unlike counting existing documents.
 */
async function generateReceiptNumber() {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const counterName = `receipt-${yearMonth}`;

  const sequence = await getNextSequence(counterName);
  return `NVB-${yearMonth}-${String(sequence).padStart(5, "0")}`;
}

// ── PDF GENERATION (returns a Buffer, not a stream) ────────────
/**
 * Returns a Buffer rather than piping directly to an HTTP response,
 * so the SAME generated PDF can be:
 *   1. Streamed to the receptionist's browser (view/download), AND
 *   2. Uploaded to Cloudinary for WhatsApp document sharing
 * without generating the PDF twice.
 */
function generateReceiptPDFBuffer(bill, clinic, patient) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 40 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Watermark — logo at 15% opacity, centered, behind the content.
    const logoPath = path.join(__dirname, "../public/images/logo.png");
    try {
      doc.opacity(0.15);
      doc.image(logoPath, doc.page.width / 2 - 100, doc.page.height / 2 - 100, { width: 200 });
      doc.opacity(1);
    } catch (err) {
      console.warn("[billingService] Could not load logo for watermark:", err.message);
    }

    // Clinic header
    doc.fontSize(16).font("Helvetica-Bold").text(clinic.name, { align: "center" });
    if (clinic.location?.address) {
      doc.fontSize(9).font("Helvetica").text(clinic.location.address, { align: "center" });
    }
    doc.moveDown(1);

    // Receipt meta
    doc.fontSize(10).font("Helvetica-Bold").text(`Receipt No: ${bill.receiptNumber || "PENDING"}`);
    doc.font("Helvetica").text(`Date: ${new Date(bill.paidAt || bill.createdAt).toLocaleDateString("en-NG")}`);
    doc.text(`Patient: ${patient.fullName}`);
    doc.moveDown(1);

    // Line items
    doc.font("Helvetica-Bold");
    doc.text("Description", 40, doc.y, { continued: true, width: 220 });
    doc.text("Qty", 260, doc.y, { continued: true, width: 40 });
    doc.text("Amount", 300, doc.y);
    doc.moveDown(0.3);
    doc.font("Helvetica");

    bill.lineItems.forEach((item) => {
      const y = doc.y;
      doc.text(item.description, 40, y, { continued: true, width: 220 });
      doc.text(String(item.quantity), 260, y, { continued: true, width: 40 });
      doc.text(`\u20a6${item.lineTotal.toLocaleString()}`, 300, y);
    });

    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
    doc.moveDown(0.3);

    if (bill.discount > 0) {
      doc.text(`Subtotal: \u20a6${bill.subtotal.toLocaleString()}`, { align: "right" });
      doc.text(`Discount: -\u20a6${bill.discount.toLocaleString()}`, { align: "right" });
    }
    doc.font("Helvetica-Bold").fontSize(12).text(`TOTAL: \u20a6${bill.totalAmount.toLocaleString()}`, { align: "right" });
    doc.font("Helvetica").fontSize(10).text(`Payment Method: ${bill.paymentMethod || "—"}`, { align: "right" });

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#999").text("Powered by NovaBuk — Healthcare, Simplified.", { align: "center" });

    doc.end();
  });
}

// ── UPLOAD RECEIPT PDF TO CLOUDINARY ──────────────────────────
/**
 * Needed because Termii's WhatsApp media parameter requires a
 * publicly accessible URL — it fetches the file itself, no direct
 * upload support. Reuses the same Cloudinary config already set up
 * in routes/uploads.js.
 */
function uploadReceiptToCloudinary(pdfBuffer, receiptNumber) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw", // PDFs are "raw" files in Cloudinary, not "image"
        public_id: `receipts/${receiptNumber}`,
        format: "pdf",
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    uploadStream.end(pdfBuffer);
  });
}

// ── WHATSAPP DELIVERY ──────────────────────────────────────────
/**
 * Sends the actual PDF as a WhatsApp document via Termii — uploads
 * to Cloudinary first (Termii needs a public URL, not a direct file
 * upload), then sends via sendWhatsAppDocument. Falls back to a
 * text-only wa.me-style summary if Termii isn't configured, so
 * the flow doesn't break in environments without Termii set up yet.
 */
async function shareReceiptViaWhatsApp(bill, clinic, patient) {
  const pdfBuffer = await generateReceiptPDFBuffer(bill, clinic, patient);
  const receiptUrl = await uploadReceiptToCloudinary(pdfBuffer, bill.receiptNumber);

  const { sendWhatsAppDocument } = require("./reminderService"); // lazy require — same reasoning as elsewhere in this codebase

  const caption =
    `Receipt from ${clinic.name}\n` +
    `Receipt No: ${bill.receiptNumber}\n` +
    `Total: \u20a6${bill.totalAmount.toLocaleString()}\n` +
    `Payment: ${bill.paymentMethod}`;

  const result = await sendWhatsAppDocument({
    userId: patient._id,
    whatsappNumber: patient.phone,
    caption,
    mediaUrl: receiptUrl,
  });

  return { ...result, receiptUrl };
}

module.exports = {
  generateBillForVisit,
  generateReceiptNumber,
  generateReceiptPDFBuffer,
  uploadReceiptToCloudinary,
  shareReceiptViaWhatsApp,
};