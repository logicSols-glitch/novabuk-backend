const express = require("express");
const router = express.Router();

const Prescription = require("../models/Prescription");
const Visit = require("../models/Visit");
const PatientBill = require("../models/PatientBill");
const Notification = require("../models/notification");
const Clinic = require("../models/Clinic");
const DrugStock = require("../models/DrugStock");
const { protectClinicPortal } = require("../middleware/protectClinicPortal");
const { requireRole, requireClinicalRole } = require("../middleware/requireRole");
const { generatePrescriptionPDFBuffer, resolveDoctorName } = require("../services/prescriptionService");

router.use(protectClinicPortal);

// Free-text drug names go straight into a regex for case-insensitive
// matching (see the stock check below) — escaping this is what stops
// a drug name containing regex special characters from either
// breaking the query or matching more broadly than intended.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Computes the pharmacy-scoped payment picture for one bill — how much
// of it is PHARMACY line items, how much of that has been collected
// specifically through the pharmacist's own checkout (pay-pharmacy),
// and how much is still outstanding. Shared by both the pending list
// and the single-prescription detail route below, and mirrors the
// same capping logic used server-side in clinic-billing.js's
// /bills/:id/pay-pharmacy route, so what the pharmacist SEES here
// always matches what they'll actually be allowed to collect.
function buildBillInfo(bill) {
  if (!bill) {
    return { id: null, exists: false, settled: false, pharmacySubtotal: 0, amountPaidPharmacy: 0, pharmacyRemaining: 0 };
  }
  const pharmacySubtotal = bill.lineItems
    .filter((item) => item.itemType === "PHARMACY")
    .reduce((sum, item) => sum + item.lineTotal, 0);
  const overallRemaining = bill.totalAmount - bill.amountPaid;
  const pharmacyRemaining = Math.max(0, Math.min(pharmacySubtotal - bill.amountPaidPharmacy, overallRemaining));

  return {
    id: bill._id,
    exists: true,
    settled: ["PAID", "WAIVED"].includes(bill.paymentStatus),
    pharmacySubtotal,
    amountPaidPharmacy: bill.amountPaidPharmacy,
    pharmacyRemaining,
  };
}

// Feature 4 gate — Pro/Premium tier only, matching the doc's exact
// wording (adapted to Growth/Pro naming instead of Basic/Premium).
async function requireProPlan(req, res, next) {
  const Clinic = require("../models/Clinic");
  const clinic = await Clinic.findById(req.actor.clinicId);
  if (!clinic || !["Pro", "Enterprise"].includes(clinic.subscriptionPlan)) {
    return res.status(403).json({
      success: false,
      message: "This feature is available on the Pro plan. Upgrade to unlock lab and pharmacy workflow.",
    });
  }
  req.clinic = clinic;
  next();
}

// ─────────────────────────────────────────────────────────────
// POST /api/clinic/visits/:visitId/prescriptions
// Doctor issues a prescription. NOT billed here — see the dispense
// route below for why (dispensing, not prescribing, is the real charge).
// ─────────────────────────────────────────────────────────────
router.post("/visits/:visitId/prescriptions", requireProPlan, requireClinicalRole(), async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one prescription item is required." });
    }

    const validRoutes = ["oral", "topical", "IV", "IM"];
    for (const item of items) {
      if (!item.drugName || !item.dosage || !validRoutes.includes(item.route) || !item.frequency || !item.durationDays) {
        return res.status(400).json({
          success: false,
          message: "Each item needs drugName, dosage, a valid route, frequency, and durationDays.",
        });
      }
    }

    const visit = await Visit.findById(req.params.visitId);
    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    const prescription = await Prescription.create({
      visit: visit._id,
      patient: visit.user,
      clinic: req.actor.clinicId,
      doctorId: req.actor.id,
      doctorType: req.actor.isOwner ? "User" : "ClinicStaff",
      items: items.map((i) => ({
        drugName: i.drugName,
        dosage: i.dosage,
        route: i.route,
        frequency: i.frequency,
        durationDays: i.durationDays,
        specialNotes: i.specialNotes || "",
      })),
    });

    res.status(201).json({ success: true, data: prescription });
  } catch (error) {
    console.error("Create prescription error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/prescriptions/pending
// Pharmacist dashboard — all ISSUED/PARTIALLY_DISPENSED, oldest first.
// ─────────────────────────────────────────────────────────────
router.get("/prescriptions/pending", requireProPlan, requireRole("pharmacist"), async (req, res) => {
  try {
    const prescriptions = await Prescription.find({
      clinic: req.actor.clinicId,
      status: { $in: ["ISSUED", "PARTIALLY_DISPENSED"] },
    })
      .populate("patient", "fullName novaBukId")
      .sort({ createdAt: 1 });

    // Batch-fetch every relevant bill in one query rather than one
    // lookup per prescription. A pharmacist needs to know BEFORE
    // dispensing whether this patient's bill is already settled
    // (PAID/WAIVED) — dispensing after that point won't add a charge
    // automatically (see the dispense route below) — and, separately,
    // exactly how much of the pharmacy portion is still outstanding so
    // they can collect it themselves via pay-pharmacy.
    const visitIds = prescriptions.map((p) => p.visit);
    const bills = await PatientBill.find({ visit: { $in: visitIds } }).select(
      "visit paymentStatus lineItems amountPaid amountPaidPharmacy totalAmount"
    );
    const billByVisit = {};
    bills.forEach((b) => {
      billByVisit[b.visit.toString()] = b;
    });

    // doctorId/doctorType is either a User (owner) or ClinicStaff — resolve
    // to a display name here so the pharmacist dashboard doesn't need to
    // know about that split at all.
    const withDoctorNames = await Promise.all(
      prescriptions.map(async (p) => {
        const plain = p.toObject();
        plain.doctorName = await resolveDoctorName(p.doctorId, p.doctorType);
        plain.bill = buildBillInfo(billByVisit[p.visit.toString()]);
        return plain;
      })
    );

    res.json({ success: true, data: withDoctorNames });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/clinic/prescriptions/:id
router.get("/prescriptions/:id", requireProPlan, async (req, res) => {
  try {
    const prescription = await Prescription.findOne({ _id: req.params.id, clinic: req.actor.clinicId }).populate(
      "patient",
      "fullName novaBukId"
    );
    if (!prescription) {
      return res.status(404).json({ success: false, message: "Prescription not found." });
    }
    const plain = prescription.toObject();
    plain.doctorName = await resolveDoctorName(prescription.doctorId, prescription.doctorType);
    const bill = await PatientBill.findOne({ visit: prescription.visit }).select(
      "paymentStatus lineItems amountPaid amountPaidPharmacy totalAmount"
    );
    plain.bill = buildBillInfo(bill);
    res.json({ success: true, data: plain });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/clinic/prescriptions/:id/items/:itemId/dispense
// Pharmacist marks one drug dispensed, enters the actual price/qty
// charged (not a fixed catalog price — pharmacy costs fluctuate with
// stock/supplier, so the pharmacist enters the real number here).
// THIS is where the pharmacy line item gets appended to the bill —
// at dispense time, not at prescribe time.
// ─────────────────────────────────────────────────────────────
router.patch(
  "/prescriptions/:id/items/:itemId/dispense",
  requireProPlan,
  requireRole("pharmacist"),
  async (req, res) => {
    try {
      const { unitPrice, quantity } = req.body;
      if (typeof unitPrice !== "number" || unitPrice < 0) {
        return res.status(400).json({ success: false, message: "unitPrice must be a non-negative number." });
      }
      if (typeof quantity !== "number" || quantity < 1) {
        return res.status(400).json({ success: false, message: "quantity must be at least 1." });
      }

      const prescription = await Prescription.findOne({ _id: req.params.id, clinic: req.actor.clinicId });
      if (!prescription) {
        return res.status(404).json({ success: false, message: "Prescription not found." });
      }

      const item = prescription.items.id(req.params.itemId);
      if (!item) {
        return res.status(404).json({ success: false, message: "Prescription item not found." });
      }
      if (item.dispensed) {
        return res.status(400).json({ success: false, message: "This item has already been dispensed." });
      }

      // ── STOCK CHECK (opt-in — see models/DrugStock.js) ──────
      // No record for this drug at all → nothing to check against,
      // dispense proceeds exactly as it always has. A record DOES
      // exist → this is now a real physical constraint, not a config
      // gap, so it blocks (unlike the billing gaps below, which never
      // block clinical action — you genuinely cannot hand over a
      // pill that isn't there, the way you CAN still see a patient
      // without a configured consultation fee).
      const stockEntry = await DrugStock.findOne({
        clinic: req.actor.clinicId,
        drugName: new RegExp(`^${escapeRegex(item.drugName.trim())}$`, "i"),
      });
      if (stockEntry && stockEntry.quantityOnHand < quantity) {
        return res.status(400).json({
          success: false,
          message: `Only ${stockEntry.quantityOnHand} ${stockEntry.unit} of ${item.drugName} left in stock — can't dispense ${quantity}. Restock or dispense a smaller amount.`,
        });
      }

      item.dispensed = true;
      item.dispensedAt = new Date();
      item.dispensedById = req.actor.id;
      item.dispensedByType = req.actor.isOwner ? "User" : "ClinicStaff";
      item.unitPrice = unitPrice;
      item.quantity = quantity;

      // Roll up header status from item states
      const allDispensed = prescription.items.every((i) => i.dispensed);
      const anyDispensed = prescription.items.some((i) => i.dispensed);
      prescription.status = allDispensed ? "COMPLETED" : anyDispensed ? "PARTIALLY_DISPENSED" : "ISSUED";

      await prescription.save();

      // Decrement AFTER the prescription save succeeds — if something
      // above failed, stock shouldn't move for a dispense that didn't
      // actually happen.
      let stockWarning = null;
      if (stockEntry) {
        stockEntry.quantityOnHand -= quantity;
        await stockEntry.save();
        if (stockEntry.quantityOnHand <= stockEntry.reorderThreshold) {
          stockWarning = `Low stock: only ${stockEntry.quantityOnHand} ${stockEntry.unit} of ${item.drugName} left.`;
        }
      }

      // ── APPEND PHARMACY LINE ITEM TO THE BILL ──────────────
      const bill = await PatientBill.findOne({ visit: prescription.visit });
      let billWarning = null;
      if (bill && !["PAID", "WAIVED"].includes(bill.paymentStatus)) {
        const lineTotal = unitPrice * quantity;
        bill.lineItems.push({
          itemType: "PHARMACY",
          description: `${item.drugName} (${item.dosage}) x${quantity}`,
          unitPrice,
          quantity,
          lineTotal,
        });
        bill.subtotal += lineTotal;
        bill.totalAmount = bill.subtotal - bill.discount;
        await bill.save();
      } else if (bill) {
        billWarning = "This patient's bill is already settled, so this charge was not added automatically. It needs a manual correction.";
        console.warn(
          `[clinic-pharmacy] Bill ${bill._id} already settled — dispensed drug NOT added to bill. Needs manual follow-up/correction.`
        );
      } else {
        // No PatientBill exists for this visit at all — usually means
        // the clinic hasn't configured a consultation fee for this
        // visit type in Settings → Billing, so generateBillForVisit()
        // never created one when the visit was completed. Dispensing
        // still succeeds (never block clinical care over a billing
        // config gap), but the charge has nowhere to attach to, so say
        // so plainly instead of the pharmacist believing it landed
        // somewhere it didn't.
        billWarning =
          "No bill exists yet for this visit, so this charge could not be added anywhere. This usually means a consultation fee hasn't been configured for this visit type in Settings → Billing.";
        console.warn(
          `[clinic-pharmacy] No PatientBill found for visit ${prescription.visit} — dispensed drug charge was not recorded anywhere.`
        );
      }

      res.json({ success: true, message: "Item dispensed.", data: prescription, billWarning, stockWarning });
    } catch (error) {
      console.error("Dispense item error:", error);
      res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/drug-stock
// List every tracked drug for this clinic — powers the Inventory
// panel. A clinic that's never used this at all just gets an empty
// list; nothing here is required for the pharmacy workflow to work.
// ─────────────────────────────────────────────────────────────
router.get("/drug-stock", requireProPlan, async (req, res) => {
  try {
    const stock = await DrugStock.find({ clinic: req.actor.clinicId }).sort({ drugName: 1 });
    res.json({ success: true, data: stock });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/clinic/drug-stock
// Bulk SET (not additive) — mirrors clinic-lab.js's PUT
// /lab-price-list exactly. Use this for initial setup or correcting
// a miscount; use POST /drug-stock/:id/restock (below) for the
// day-to-day "50 more just arrived" action, which adds rather than
// overwrites.
// Body: { drugs: [{ drugName, quantityOnHand, reorderThreshold?, unit? }] }
// ─────────────────────────────────────────────────────────────
router.put("/drug-stock", requireProPlan, requireRole(), async (req, res) => {
  try {
    const { drugs } = req.body;
    if (!Array.isArray(drugs) || !drugs.length) {
      return res.status(400).json({ success: false, message: "At least one drug is required." });
    }

    const updated = [];
    for (const d of drugs) {
      if (!d.drugName || typeof d.quantityOnHand !== "number" || d.quantityOnHand < 0) {
        return res.status(400).json({
          success: false,
          message: "Each drug needs a drugName and a non-negative quantityOnHand.",
        });
      }

      // Case-insensitive match — previously this compared drugName
      // exactly, while the dispense route (and the frontend's own
      // stock-line lookup) both match case-insensitively. That
      // mismatch meant "Paracetamol" and "paracetamol" silently
      // became two different rows instead of one being an edit of
      // the other — confusing, and a real risk if dispensing only
      // ever finds one of the two.
      const existing = await DrugStock.findOne({
        clinic: req.actor.clinicId,
        drugName: new RegExp(`^${escapeRegex(d.drugName.trim())}$`, "i"),
      });

      if (existing) {
        existing.quantityOnHand = d.quantityOnHand;
        if (d.reorderThreshold !== undefined) existing.reorderThreshold = d.reorderThreshold;
        if (d.unit) existing.unit = d.unit;
        await existing.save();
        updated.push(existing);
      } else {
        const created = await DrugStock.create({
          clinic: req.actor.clinicId,
          drugName: d.drugName.trim(),
          quantityOnHand: d.quantityOnHand,
          ...(d.reorderThreshold !== undefined && { reorderThreshold: d.reorderThreshold }),
          ...(d.unit && { unit: d.unit }),
        });
        updated.push(created);
      }
    }

    res.json({ success: true, message: "Stock updated.", data: updated });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Duplicate drug name in this request." });
    }
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/clinic/drug-stock/:id
// Removes a tracked drug entirely — e.g. a mistaken entry, or a drug
// the clinic no longer wants to track stock for. Doesn't affect any
// past dispense records; it only stops future dispenses of that drug
// from being checked/decremented against anything.
// ─────────────────────────────────────────────────────────────
router.delete("/drug-stock/:id", requireProPlan, requireRole(), async (req, res) => {
  try {
    const entry = await DrugStock.findOneAndDelete({ _id: req.params.id, clinic: req.actor.clinicId });
    if (!entry) {
      return res.status(404).json({ success: false, message: "Stock entry not found." });
    }
    res.json({ success: true, message: "Removed from inventory." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/clinic/drug-stock/:id/restock
// Additive — adds `quantity` to whatever's already on hand, and
// stamps lastRestockedAt. This is the routine "delivery just came in"
// action; PUT above is for setup/corrections.
// ─────────────────────────────────────────────────────────────
router.post("/drug-stock/:id/restock", requireProPlan, requireRole(), async (req, res) => {
  try {
    const { quantity } = req.body;
    if (typeof quantity !== "number" || quantity <= 0) {
      return res.status(400).json({ success: false, message: "quantity must be a positive number." });
    }

    const entry = await DrugStock.findOne({ _id: req.params.id, clinic: req.actor.clinicId });
    if (!entry) {
      return res.status(404).json({ success: false, message: "Stock entry not found." });
    }

    entry.quantityOnHand += quantity;
    entry.lastRestockedAt = new Date();
    await entry.save();

    res.json({ success: true, message: "Restocked.", data: entry });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});


// Existing prescription(s) tied to one visit — used by the
// consultation page to show issued/dispensed status after the fact.
// A visit can only be completed (and therefore a prescription
// created) once, so this is how the doctor sees the outcome on a
// visit they've already closed, without needing the pharmacy
// dashboard.
// ─────────────────────────────────────────────────────────────
router.get("/visits/:visitId/prescriptions", requireProPlan, async (req, res) => {
  try {
    const prescriptions = await Prescription.find({
      visit: req.params.visitId,
      clinic: req.actor.clinicId,
    }).sort({ createdAt: -1 });

    res.json({ success: true, data: prescriptions });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/prescriptions/:id/pdf
// Printable/shareable prescription PDF for clinic staff (doctor,
// pharmacist, owner) to view/print/download. Not plan-gated on its
// own — a clinic that downgrades after issuing a prescription should
// still be able to view its own historical record, same reasoning as
// the billing receipt PDF not being plan-gated either.
// ─────────────────────────────────────────────────────────────
router.get("/prescriptions/:id/pdf", async (req, res) => {
  try {
    const prescription = await Prescription.findOne({
      _id: req.params.id,
      clinic: req.actor.clinicId,
    }).populate("patient", "fullName");

    if (!prescription) {
      return res.status(404).json({ success: false, message: "Prescription not found." });
    }

    const clinic = await Clinic.findById(req.actor.clinicId);
    const doctorName = await resolveDoctorName(prescription.doctorId, prescription.doctorType);
    const pdfBuffer = await generatePrescriptionPDFBuffer(prescription, clinic, prescription.patient, doctorName);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="prescription-${prescription._id}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Prescription PDF error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/clinic/prescriptions/:id
// Doctor cancels a prescription they just sent, before anything on it
// has been dispensed — no billing reversal is needed here, unlike
// the equivalent lab cancellation, because a prescription is never
// billed at issue time in the first place (see Prescription.js —
// pharmacy charges only land on the bill at dispense time). Once any
// item has been dispensed, the whole prescription can no longer be
// cancelled wholesale; that item is a real transaction that already
// happened.
// ─────────────────────────────────────────────────────────────
router.delete("/prescriptions/:id", requireClinicalRole(), async (req, res) => {
  try {
    const prescription = await Prescription.findOne({ _id: req.params.id, clinic: req.actor.clinicId });
    if (!prescription) {
      return res.status(404).json({ success: false, message: "Prescription not found." });
    }
    if (prescription.items.some((item) => item.dispensed)) {
      return res.status(400).json({
        success: false,
        message: "This prescription already has dispensed items and can no longer be cancelled as a whole.",
      });
    }

    await prescription.deleteOne();
    res.json({ success: true, message: "Prescription cancelled." });
  } catch (error) {
    console.error("Cancel prescription error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;