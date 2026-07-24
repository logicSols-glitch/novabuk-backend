const express = require("express");
const router = express.Router();

const ClinicFeeSchedule = require("../models/ClinicFeeSchedule");
const PatientBill = require("../models/PatientBill");
const Clinic = require("../models/Clinic");
const { protectClinicPortal } = require("../middleware/protectClinicPortal");
const { requireRole } = require("../middleware/requireRole");
const {
  generateReceiptNumber,
  generateReceiptPDFBuffer,
  shareReceiptViaWhatsApp,
} = require("../services/billingService");

router.use(protectClinicPortal);

// Nigeria doesn't observe daylight saving — WAT is a fixed UTC+1
// offset year-round, so this is safe to hardcode rather than using a
// timezone library for a single-country product.
const LAGOS_UTC_OFFSET_HOURS = 1;

function getLagosDayBoundaries(dateStr) {
  const base = dateStr ? new Date(dateStr) : new Date();
  // Get the date components as they'd appear in Lagos time
  const lagosNow = new Date(base.getTime() + LAGOS_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const y = lagosNow.getUTCFullYear();
  const m = lagosNow.getUTCMonth();
  const d = lagosNow.getUTCDate();

  // Midnight Lagos time, expressed back in UTC for the DB query
  const startUtc = new Date(Date.UTC(y, m, d, -LAGOS_UTC_OFFSET_HOURS, 0, 0));
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}

// ─────────────────────────────────────────────────────────────
// FEE SCHEDULE
// ─────────────────────────────────────────────────────────────

// GET /api/clinic/fee-schedule — any clinic actor can view current fees
router.get("/fee-schedule", async (req, res) => {
  try {
    const fees = await ClinicFeeSchedule.find({ clinic: req.actor.clinicId, isActive: true });
    res.json({ success: true, data: fees });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PUT /api/clinic/fee-schedule — owner/admin only, sets/updates fees
// Body: { fees: [{ visitType, feeAmount }, ...] }
router.put("/fee-schedule", requireRole(), async (req, res) => {
  try {
    const { fees } = req.body;
    if (!Array.isArray(fees) || fees.length === 0) {
      return res.status(400).json({ success: false, message: "fees array is required." });
    }

    const validTypes = ["General", "Specialist", "Follow-up", "Emergency"];
    const updated = [];

    for (const entry of fees) {
      if (!validTypes.includes(entry.visitType)) {
        return res.status(400).json({
          success: false,
          message: `"${entry.visitType}" is not a valid visit type.`,
        });
      }
      if (typeof entry.feeAmount !== "number" || entry.feeAmount < 0) {
        return res.status(400).json({
          success: false,
          message: `feeAmount for ${entry.visitType} must be a non-negative number.`,
        });
      }

      const fee = await ClinicFeeSchedule.findOneAndUpdate(
        { clinic: req.actor.clinicId, visitType: entry.visitType },
        { feeAmount: entry.feeAmount, isActive: true },
        { new: true, upsert: true }
      );
      updated.push(fee);
    }

    res.json({ success: true, message: "Fee schedule updated.", data: updated });
  } catch (error) {
    console.error("Update fee schedule error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// CHECKOUT / BILLS
// ─────────────────────────────────────────────────────────────

// GET /api/clinic/bills/pending — receptionist checkout dashboard
router.get("/bills/pending", requireRole("doctor", "nurse", "receptionist"), async (req, res) => {
  try {
    const bills = await PatientBill.find({
      clinic: req.actor.clinicId,
      paymentStatus: { $in: ["UNPAID", "PART_PAID"] },
    })
      .populate("patient", "fullName phone novaBukId")
      .populate("visit", "visitType")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: bills });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/clinic/bills/daily-summary?date=2026-07-18
// Defaults to today (Lagos time) if no date given.
// Same role list as /bills/pending above — both render on the same
// checkout page, so a doctor or nurse viewing pending bills should see
// the day's totals too, not just the receptionist.
//
// MUST come before /bills/:id below — Express matches routes in
// registration order, and /bills/:id matches ANY single path segment,
// so a request to /bills/daily-summary was being caught by /bills/:id
// first (with req.params.id === "daily-summary"), which then tried to
// findOne({ _id: "daily-summary", ... }) — an invalid ObjectId, so
// Mongoose throws a CastError there and the route 500s. The dedicated
// handler below was correct but was 100% unreachable until this move.
router.get("/bills/daily-summary", requireRole("doctor", "nurse", "receptionist"), async (req, res) => {
  try {
    const { startUtc, endUtc } = getLagosDayBoundaries(req.query.date);

    const bills = await PatientBill.find({
      clinic: req.actor.clinicId,
      paidAt: { $gte: startUtc, $lt: endUtc },
      paymentStatus: { $in: ["PAID", "WAIVED"] },
    });

    const allTodaysBills = await PatientBill.find({
      clinic: req.actor.clinicId,
      createdAt: { $gte: startUtc, $lt: endUtc },
    });

    const summary = {
      date: startUtc.toISOString().split("T")[0],
      patientsSeen: allTodaysBills.length,
      totalRevenue: 0,
      byPaymentMethod: { CASH: 0, TRANSFER: 0, POS: 0, WAIVED: 0 },
      outstandingBalance: 0,
    };

    bills.forEach((bill) => {
      summary.totalRevenue += bill.amountPaid;
      if (bill.paymentMethod) {
        summary.byPaymentMethod[bill.paymentMethod] =
          (summary.byPaymentMethod[bill.paymentMethod] || 0) + bill.amountPaid;
      }
    });

    allTodaysBills.forEach((bill) => {
      if (["UNPAID", "PART_PAID"].includes(bill.paymentStatus)) {
        summary.outstandingBalance += bill.totalAmount - bill.amountPaid;
      }
    });

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error("Daily summary error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/clinic/bills/:id
router.get("/bills/:id", requireRole("doctor", "nurse", "receptionist"), async (req, res) => {
  try {
    const bill = await PatientBill.findOne({ _id: req.params.id, clinic: req.actor.clinicId })
      .populate("patient", "fullName phone novaBukId")
      .populate("visit", "visitType status");

    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found." });
    }
    res.json({ success: true, data: bill });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PATCH /api/clinic/bills/:id/pay
// Body: { paymentStatus: "PAID"|"PART_PAID"|"WAIVED", paymentMethod, amountPaid, waivedReason }
// PATCH /api/clinic/bills/:id/correct — owner/admin only
// Adjusts discount and/or line items BEFORE payment settles. Once a
// bill is PAID or WAIVED, it's a closed financial record — correcting
// a settled bill is a refund/adjustment scenario, out of scope here,
// not something silently editable after the fact.
// Body: { lineItems?: [...], discount?: number, reason: string }
router.patch("/bills/:id/correct", requireRole(), async (req, res) => {
  try {
    const bill = await PatientBill.findOne({ _id: req.params.id, clinic: req.actor.clinicId });
    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found." });
    }

    if (["PAID", "WAIVED"].includes(bill.paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "This bill has already been settled and can't be corrected. Settled-bill adjustments need a refund process, not an edit.",
      });
    }

    const { lineItems, discount, reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "A reason is required for every bill correction — this is an audited financial record.",
      });
    }

    const previousTotal = bill.totalAmount;

    if (Array.isArray(lineItems) && lineItems.length > 0) {
      for (const item of lineItems) {
        if (!item.description || typeof item.unitPrice !== "number" || item.unitPrice < 0) {
          return res.status(400).json({
            success: false,
            message: "Each line item needs a description and a non-negative unitPrice.",
          });
        }
      }
      bill.lineItems = lineItems.map((item) => ({
        itemType: item.itemType || "OTHER",
        description: item.description,
        unitPrice: item.unitPrice,
        quantity: item.quantity || 1,
        lineTotal: item.unitPrice * (item.quantity || 1),
      }));
      bill.subtotal = bill.lineItems.reduce((sum, i) => sum + i.lineTotal, 0);
    }

    if (typeof discount === "number") {
      if (discount < 0 || discount > bill.subtotal) {
        return res.status(400).json({
          success: false,
          message: "Discount must be between 0 and the bill's subtotal.",
        });
      }
      bill.discount = discount;
    }

    bill.totalAmount = bill.subtotal - bill.discount;

    // If amountPaid already covers more than the new (corrected)
    // total, cap it back — prevents a corrected-down bill from
    // appearing "overpaid" due to a partial payment made before the
    // correction.
    if (bill.amountPaid > bill.totalAmount) {
      bill.amountPaid = bill.totalAmount;
    }
    bill.paymentStatus = bill.amountPaid >= bill.totalAmount && bill.amountPaid > 0 ? "PAID" : bill.amountPaid > 0 ? "PART_PAID" : "UNPAID";

    bill.editHistory.push({
      editedById: req.actor.id,
      editedByType: req.actor.isOwner ? "User" : "ClinicStaff",
      editedByName: req.actor.fullName,
      previousTotal,
      newTotal: bill.totalAmount,
      reason: reason.trim(),
    });

    await bill.save();

    res.json({ success: true, message: "Bill corrected.", data: bill });
  } catch (error) {
    console.error("Correct bill error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

router.patch("/bills/:id/pay", requireRole("doctor", "nurse", "receptionist"), async (req, res) => {
  try {
    const bill = await PatientBill.findOne({ _id: req.params.id, clinic: req.actor.clinicId });
    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found." });
    }

    if (bill.paymentStatus === "PAID") {
      return res.status(400).json({ success: false, message: "This bill has already been paid in full." });
    }

    const { paymentStatus, paymentMethod, amountPaid, waivedReason } = req.body;

    if (!["PAID", "PART_PAID", "WAIVED"].includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "paymentStatus must be PAID, PART_PAID, or WAIVED.",
      });
    }

    if (paymentStatus === "WAIVED") {
      if (!waivedReason || !waivedReason.trim()) {
        return res.status(400).json({
          success: false,
          message: "A reason is required to waive a bill.",
        });
      }
      bill.waivedReason = waivedReason.trim();
      bill.paymentMethod = "WAIVED";
      bill.amountPaid = bill.totalAmount; // treated as fully settled
    } else {
      if (!["CASH", "TRANSFER", "POS"].includes(paymentMethod)) {
        return res.status(400).json({
          success: false,
          message: "paymentMethod must be CASH, TRANSFER, or POS.",
        });
      }
      if (typeof amountPaid !== "number" || amountPaid <= 0) {
        return res.status(400).json({
          success: false,
          message: "amountPaid must be a positive number.",
        });
      }

      const newTotalPaid = bill.amountPaid + amountPaid;
      if (newTotalPaid > bill.totalAmount) {
        return res.status(400).json({
          success: false,
          message: `Amount exceeds the outstanding balance of \u20a6${(bill.totalAmount - bill.amountPaid).toLocaleString()}.`,
        });
      }

      bill.amountPaid = newTotalPaid;
      bill.paymentMethod = paymentMethod;

      // Only actually PAID if the full amount is now covered — a
      // receptionist can't mark PART_PAID as PAID if there's still a
      // balance outstanding, regardless of what they pass in paymentStatus.
      if (newTotalPaid >= bill.totalAmount) {
        bill.paymentStatus = "PAID";
      } else {
        bill.paymentStatus = "PART_PAID";
      }
    }

    if (paymentStatus === "WAIVED") {
      bill.paymentStatus = "WAIVED";
    }

    // Receipt number only ever assigned once, the first time a bill
    // reaches a settled state (PAID or WAIVED) — not on every partial payment.
    if (["PAID", "WAIVED"].includes(bill.paymentStatus) && !bill.receiptNumber) {
      bill.receiptNumber = await generateReceiptNumber();
      bill.paidAt = new Date();
    }

    bill.handledById = req.actor.id;
    bill.handledByType = req.actor.isOwner ? "User" : "ClinicStaff";

    await bill.save();

    res.json({ success: true, message: "Payment recorded.", data: bill });
  } catch (error) {
    console.error("Record payment error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/clinic/bills/:id/receipt — stream the PDF receipt
router.get("/bills/:id/receipt", requireRole("doctor", "nurse", "receptionist"), async (req, res) => {
  try {
    const bill = await PatientBill.findOne({ _id: req.params.id, clinic: req.actor.clinicId })
      .populate("patient", "fullName")
      .populate("clinic", "name location");

    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found." });
    }
    if (!bill.receiptNumber) {
      return res.status(400).json({
        success: false,
        message: "This bill hasn't been paid yet — no receipt to generate.",
      });
    }

    const clinic = await Clinic.findById(req.actor.clinicId);
    const pdfBuffer = await generateReceiptPDFBuffer(bill, clinic, bill.patient);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${bill.receiptNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Generate receipt error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// POST /api/clinic/bills/:id/share-whatsapp — sends the PDF via WhatsApp
router.post("/bills/:id/share-whatsapp", requireRole("doctor", "nurse", "receptionist"), async (req, res) => {
  try {
    const bill = await PatientBill.findOne({ _id: req.params.id, clinic: req.actor.clinicId }).populate(
      "patient",
      "fullName phone"
    );
    if (!bill) {
      return res.status(404).json({ success: false, message: "Bill not found." });
    }
    if (!bill.receiptNumber) {
      return res.status(400).json({ success: false, message: "This bill hasn't been paid yet." });
    }
    if (!bill.patient.phone) {
      return res.status(400).json({
        success: false,
        message: "This patient has no phone number on file — can't send via WhatsApp.",
      });
    }

    const clinic = await Clinic.findById(req.actor.clinicId);
    const result = await shareReceiptViaWhatsApp(bill, clinic, bill.patient);

    if (!result.success) {
      return res.status(502).json({
        success: false,
        message: result.reason || result.error || "Failed to send via WhatsApp.",
      });
    }

    res.json({ success: true, message: "Receipt sent via WhatsApp.", receiptUrl: result.receiptUrl });
  } catch (error) {
    console.error("Share receipt via WhatsApp error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// DAILY CASHIER SUMMARY
// ─────────────────────────────────────────────────────────────

module.exports = router;