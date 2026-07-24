const express = require("express");
const router = express.Router();

const Prescription = require("../models/Prescription");
const Visit = require("../models/Visit");
const PatientBill = require("../models/PatientBill");
const Notification = require("../models/notification");
const Clinic = require("../models/Clinic");
const { protectClinicPortal } = require("../middleware/protectClinicPortal");
const { requireRole, requireClinicalRole } = require("../middleware/requireRole");
const { generatePrescriptionPDFBuffer, resolveDoctorName } = require("../services/prescriptionService");

router.use(protectClinicPortal);

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

    // doctorId/doctorType is either a User (owner) or ClinicStaff — resolve
    // to a display name here so the pharmacist dashboard doesn't need to
    // know about that split at all.
    const withDoctorNames = await Promise.all(
      prescriptions.map(async (p) => {
        const plain = p.toObject();
        plain.doctorName = await resolveDoctorName(p.doctorId, p.doctorType);
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

      // ── APPEND PHARMACY LINE ITEM TO THE BILL ──────────────
      const bill = await PatientBill.findOne({ visit: prescription.visit });
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
        console.warn(
          `[clinic-pharmacy] Bill ${bill._id} already settled — dispensed drug NOT added to bill. Needs manual follow-up/correction.`
        );
      }

      res.json({ success: true, message: "Item dispensed.", data: prescription });
    } catch (error) {
      console.error("Dispense item error:", error);
      res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/visits/:visitId/prescriptions
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

module.exports = router;