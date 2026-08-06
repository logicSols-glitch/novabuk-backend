const express = require("express");
const router = express.Router();

const LabRequest = require("../models/LabRequest");
const ClinicLabPriceList = require("../models/ClinicLabPriceList");
const Visit = require("../models/Visit");
const Clinic = require("../models/Clinic");
const PatientBill = require("../models/PatientBill");
const Notification = require("../models/notification");
const { protectClinicPortal } = require("../middleware/protectClinicPortal");
const { requireRole, requireClinicalRole } = require("../middleware/requireRole");
const { requirePlan } = require("../middleware/planGate");
const { resolveDoctorName } = require("../services/prescriptionService");

router.use(protectClinicPortal);

// PREMIUM-tier gate — checks the clinic's EFFECTIVE status (is the
// subscription actually active right now), not just the stored
// subscriptionPlan field. That field never resets once set, so a
// clinic that paid for Pro once and then let it lapse would otherwise
// keep lab/pharmacy access forever. Same fix already applied to
// clinic-pharmacy.js — this file had drifted back to the old local
// version in a later re-upload, so reapplying it here.
const requireProPlan = requirePlan("PREMIUM");

// Only doctor/nurse/owner ever see result fields — enforced here at
// the response level, not just hidden in the UI. Receptionist and
// pharmacist can still see PENDING/SAMPLE_COLLECTED status (they may
// legitimately need to know a test is in progress), just never the
// actual result content.
function canSeeLabResults(actor) {
  return actor.isOwner || actor.role === "doctor" || actor.role === "nurse";
}

function sanitizeLabRequest(labRequestDoc, actor) {
  const plain = labRequestDoc.toObject ? labRequestDoc.toObject() : { ...labRequestDoc };
  if (canSeeLabResults(actor)) return plain;

  plain.items = plain.items.map((item) => {
    const { resultText, resultFileUrl, resultEnteredAt, resultEnteredById, resultEnteredByType, ...rest } = item;
    return rest;
  });
  return plain;
}

// ─────────────────────────────────────────────────────────────
// POST /api/clinic/visits/:visitId/lab-requests
// Doctor orders tests. BILLED IMMEDIATELY, unlike prescriptions —
// see LabRequest.js for why (a collected sample has a real cost
// regardless of the eventual result).
// ─────────────────────────────────────────────────────────────
router.post("/visits/:visitId/lab-requests", requireProPlan, requireClinicalRole(), async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one test is required." });
    }

    const validSampleTypes = ["Blood", "Urine", "Stool", "Swab", "Other"];
    for (const item of items) {
      if (!item.testName || !validSampleTypes.includes(item.sampleType)) {
        return res.status(400).json({
          success: false,
          message: "Each test needs a testName and a valid sampleType.",
        });
      }
    }

    const visit = await Visit.findById(req.params.visitId);
    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    // Look up each test's price (case-insensitive, trimmed match).
    // Never blocks request creation if a price isn't configured —
    // same defensive pattern used everywhere else in this codebase.
    const priceEntries = await ClinicLabPriceList.find({ clinic: req.actor.clinicId, isActive: true });
    const priceMap = {};
    priceEntries.forEach((p) => {
      priceMap[p.testName.toLowerCase().trim()] = p.price;
    });

    const itemsWithPricing = items.map((i) => ({
      testName: i.testName,
      urgency: i.urgency || "Routine",
      sampleType: i.sampleType,
      clinicalNotes: i.clinicalNotes || "",
      priceCharged: priceMap[i.testName.toLowerCase().trim()] ?? null,
    }));

    const labRequest = await LabRequest.create({
      visit: visit._id,
      patient: visit.user,
      clinic: req.actor.clinicId,
      doctorId: req.actor.id,
      doctorType: req.actor.isOwner ? "User" : "ClinicStaff",
      items: itemsWithPricing,
    });

    // ── APPEND LAB LINE ITEMS TO THE BILL, NOW ─────────────
    const bill = await PatientBill.findOne({ visit: visit._id });
    let billWarning = null;
    const unpricedTests = [];
    if (bill && !["PAID", "WAIVED"].includes(bill.paymentStatus)) {
      let addedTotal = 0;
      itemsWithPricing.forEach((item) => {
        if (item.priceCharged === null) {
          unpricedTests.push(item.testName);
          console.warn(
            `[clinic-lab] No price configured for test "${item.testName}" at clinic ${req.actor.clinicId} — skipping bill line item.`
          );
          return;
        }
        bill.lineItems.push({
          itemType: "LAB",
          description: item.testName,
          unitPrice: item.priceCharged,
          quantity: 1,
          lineTotal: item.priceCharged,
        });
        addedTotal += item.priceCharged;
      });
      if (addedTotal > 0) {
        bill.subtotal += addedTotal;
        bill.totalAmount = bill.subtotal - bill.discount;
        await bill.save();
      }
      if (unpricedTests.length > 0) {
        billWarning = `No price is configured for: ${unpricedTests.join(", ")}. Add these in Settings → Billing → Lab Price List, then bill the patient manually for now.`;
      }
    } else if (bill) {
      billWarning = "This patient's bill is already settled, so these charges were not added automatically. They need a manual correction.";
      console.warn(`[clinic-lab] Bill ${bill._id} already settled — lab charges NOT added. Needs manual correction.`);
    } else {
      // No PatientBill exists for this visit at all — same root cause
      // as the equivalent gap in clinic-pharmacy.js: the clinic hasn't
      // configured a consultation fee for this visit type, so no bill
      // was ever auto-created. The lab request still gets created
      // (never block clinical care over a billing config gap), but the
      // charge has nowhere to attach to.
      billWarning =
        "No bill exists yet for this visit, so these charges could not be added anywhere. This usually means a consultation fee hasn't been configured for this visit type in Settings → Billing.";
      console.warn(`[clinic-lab] No PatientBill found for visit ${visit._id} — lab charges were not recorded anywhere.`);
    }

    res.status(201).json({ success: true, data: labRequest, billWarning });
  } catch (error) {
    console.error("Create lab request error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/lab-requests/pending — lab staff dashboard
// ─────────────────────────────────────────────────────────────
router.get("/lab-requests/pending", requireProPlan, requireRole("lab_tech"), async (req, res) => {
  try {
    const requests = await LabRequest.find({
      clinic: req.actor.clinicId,
      status: { $in: ["PENDING", "SAMPLE_COLLECTED"] },
    })
      .populate("patient", "fullName novaBukId")
      .sort({ createdAt: 1 });

    // Lab staff can see requests exist and their basic fields, but
    // never sees results — nothing to strip here since results don't
    // exist yet at PENDING/SAMPLE_COLLECTED anyway.
    const withDoctorNames = await Promise.all(
      requests.map(async (r) => {
        const plain = r.toObject();
        plain.doctorName = await resolveDoctorName(r.doctorId, r.doctorType);
        return plain;
      })
    );

    res.json({ success: true, data: withDoctorNames });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// GET /api/clinic/lab-requests/:id
router.get("/lab-requests/:id", requireProPlan, async (req, res) => {
  try {
    const labRequest = await LabRequest.findOne({ _id: req.params.id, clinic: req.actor.clinicId }).populate(
      "patient",
      "fullName novaBukId"
    );
    if (!labRequest) {
      return res.status(404).json({ success: false, message: "Lab request not found." });
    }
    const sanitized = sanitizeLabRequest(labRequest, req.actor);
    sanitized.doctorName = await resolveDoctorName(labRequest.doctorId, labRequest.doctorType);
    res.json({ success: true, data: sanitized });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// PATCH /api/clinic/lab-requests/:id/status — lab staff advances status
router.patch("/lab-requests/:id/status", requireProPlan, requireRole("lab_tech"), async (req, res) => {
  try {
    const { status } = req.body;
    if (!["SAMPLE_COLLECTED", "RESULT_READY"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be SAMPLE_COLLECTED or RESULT_READY." });
    }

    const labRequest = await LabRequest.findOne({ _id: req.params.id, clinic: req.actor.clinicId });
    if (!labRequest) {
      return res.status(404).json({ success: false, message: "Lab request not found." });
    }

    // Enforce the forward-only sequence PENDING → SAMPLE_COLLECTED → RESULT_READY
    const sequence = ["PENDING", "SAMPLE_COLLECTED", "RESULT_READY"];
    if (sequence.indexOf(status) <= sequence.indexOf(labRequest.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot move from ${labRequest.status} to ${status} — status only moves forward.`,
      });
    }

    labRequest.status = status;
    await labRequest.save();

    res.json({ success: true, data: labRequest });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/clinic/lab-requests/:id/items/:itemId/result
// Lab staff enters the result. Notifies the doctor in-app.
// Body: { resultText, resultFileUrl? }
// ─────────────────────────────────────────────────────────────
router.patch(
  "/lab-requests/:id/items/:itemId/result",
  requireProPlan,
  requireRole("lab_tech"),
  async (req, res) => {
    try {
      const { resultText, resultFileUrl } = req.body;
      if (!resultText || !resultText.trim()) {
        return res.status(400).json({ success: false, message: "resultText is required." });
      }

      const labRequest = await LabRequest.findOne({ _id: req.params.id, clinic: req.actor.clinicId }).populate(
        "patient",
        "fullName"
      );
      if (!labRequest) {
        return res.status(404).json({ success: false, message: "Lab request not found." });
      }

      const item = labRequest.items.id(req.params.itemId);
      if (!item) {
        return res.status(404).json({ success: false, message: "Test item not found." });
      }

      item.resultText = resultText.trim();
      item.resultFileUrl = resultFileUrl || null;
      item.resultEnteredAt = new Date();
      item.resultEnteredById = req.actor.id;
      item.resultEnteredByType = req.actor.isOwner ? "User" : "ClinicStaff";

      if (labRequest.status !== "RESULT_READY") labRequest.status = "RESULT_READY";
      await labRequest.save();

      // Notify the ordering doctor — only them, per spec
      await Notification.create({
        user: labRequest.doctorType === "User" ? labRequest.doctorId : undefined,
        clinic: labRequest.doctorType === "ClinicStaff" ? req.actor.clinicId : undefined,
        type: "general",
        title: "Lab Result Ready",
        message: `Lab result ready for ${labRequest.patient.fullName} — ${item.testName}`,
        link: "./clinic-queue.html",
      }).catch((err) => console.error("Lab result notification failed:", err.message));

      res.json({ success: true, data: labRequest });
    } catch (error) {
      console.error("Enter lab result error:", error);
      res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// LAB PRICE LIST — owner/admin only
// ─────────────────────────────────────────────────────────────
router.get("/lab-price-list", requireProPlan, async (req, res) => {
  try {
    const prices = await ClinicLabPriceList.find({ clinic: req.actor.clinicId, isActive: true });
    res.json({ success: true, data: prices });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

router.put("/lab-price-list", requireProPlan, requireRole(), async (req, res) => {
  try {
    const { tests } = req.body; // [{ testName, price }]
    if (!Array.isArray(tests) || tests.length === 0) {
      return res.status(400).json({ success: false, message: "tests array is required." });
    }

    const updated = [];
    for (const t of tests) {
      if (!t.testName || typeof t.price !== "number" || t.price < 0) {
        return res.status(400).json({ success: false, message: "Each test needs a testName and non-negative price." });
      }
      const entry = await ClinicLabPriceList.findOneAndUpdate(
        { clinic: req.actor.clinicId, testName: t.testName.trim() },
        { price: t.price, isActive: true },
        { new: true, upsert: true }
      );
      updated.push(entry);
    }

    res.json({ success: true, message: "Lab price list updated.", data: updated });
  } catch (error) {
    console.error("Update lab price list error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/visits/:visitId/lab-requests
// Existing lab request(s) tied to one visit — used by the
// consultation page to show PENDING/SAMPLE_COLLECTED/RESULT_READY
// status after the fact, mirroring the equivalent prescription
// lookup in clinic-pharmacy.js. Results are still stripped for
// non-doctor/nurse roles via sanitizeLabRequest, same as everywhere
// else in this file.
// ─────────────────────────────────────────────────────────────
router.get("/visits/:visitId/lab-requests", requireProPlan, async (req, res) => {
  try {
    const labRequests = await LabRequest.find({
      visit: req.params.visitId,
      clinic: req.actor.clinicId,
    }).sort({ createdAt: -1 });

    res.json({ success: true, data: labRequests.map((lr) => sanitizeLabRequest(lr, req.actor)) });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/clinic/lab-requests/:id
// Doctor cancels a lab request they just sent, before anything has
// actually happened at the lab — only allowed while status is still
// PENDING (no sample collected yet). Once a sample's been collected
// the lab has already done real work, so cancellation stops being
// appropriate; the doctor would need to coordinate with the lab
// directly at that point.
//
// Lab charges bill at ORDER time (unlike pharmacy, which bills at
// dispense time), so cancelling has to also reverse the charge — but
// only if the bill hasn't already been paid/waived. If it has, the
// clinical cancellation still goes through (the doctor can still tell
// the lab "don't run this"), but the money already collected stays as
// collected; that needs the bill-correction workflow instead of being
// silently undone here.
// ─────────────────────────────────────────────────────────────
router.delete("/lab-requests/:id", requireClinicalRole(), async (req, res) => {
  try {
    const labRequest = await LabRequest.findOne({ _id: req.params.id, clinic: req.actor.clinicId });
    if (!labRequest) {
      return res.status(404).json({ success: false, message: "Lab request not found." });
    }
    if (labRequest.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Only requests still awaiting sample collection can be cancelled.",
      });
    }

    const bill = await PatientBill.findOne({ visit: labRequest.visit });
    let billNote = "";
    if (bill && !["PAID", "WAIVED"].includes(bill.paymentStatus)) {
      // Best-effort removal: match each cancelled item's line item by
      // description + price (line items don't carry a back-reference
      // to the specific LabRequest item they came from). If a match
      // isn't found for some reason, skip it rather than risk removing
      // the wrong line — the bill can still be fixed via /correct.
      let removedTotal = 0;
      labRequest.items.forEach((item) => {
        if (item.priceCharged === null) return;
        const idx = bill.lineItems.findIndex(
          (li) => li.itemType === "LAB" && li.description === item.testName && li.unitPrice === item.priceCharged
        );
        if (idx !== -1) {
          removedTotal += bill.lineItems[idx].lineTotal;
          bill.lineItems.splice(idx, 1);
        }
      });
      if (removedTotal > 0) {
        bill.subtotal -= removedTotal;
        bill.totalAmount = bill.subtotal - bill.discount;
        await bill.save();
      }
    } else if (bill) {
      billNote = " This visit's bill is already settled, so the original charge was not reversed — it needs a manual correction if a refund is due.";
    }

    await labRequest.deleteOne();

    res.json({ success: true, message: `Lab request cancelled.${billNote}` });
  } catch (error) {
    console.error("Cancel lab request error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;