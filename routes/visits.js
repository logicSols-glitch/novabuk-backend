const express = require("express");
const router = express.Router();
const Visit = require("../models/Visit");
const Clinic = require("../models/Clinic");
const Symptom = require("../models/Symptom");
const User = require("../models/User");
const { protectUser } = require("../middleware/authUser");
const { sendVisitConfirmationEmail } = require("../services/emailService");

// All visit routes require a logged-in patient
router.use(protectUser);

// ─────────────────────────────────────────────
// POST /api/visits/request
// Request a clinic visit (Screen 7)
// ─────────────────────────────────────────────
router.post("/request", async (req, res) => {
  try {
    const { clinicId, symptomLogId, preferredDate, notes } = req.body;

    if (!clinicId) {
      return res
        .status(400)
        .json({ success: false, message: "Clinic is required." });
    }

    // Verify clinic exists and is active
    const clinic = await Clinic.findById(clinicId);
    if (!clinic || !clinic.isActive) {
      return res
        .status(404)
        .json({ success: false, message: "Clinic not found." });
    }

    // Verify symptom log belongs to this user (if provided)
    if (symptomLogId) {
      const symptom = await Symptom.findOne({
        _id: symptomLogId,
        user: req.user._id,
      });
      if (!symptom) {
        return res
          .status(404)
          .json({ success: false, message: "Symptom log not found." });
      }
    }

    // Snapshot user's health profile at time of request
    const healthProfileSnapshot = {
      ageRange: req.user.healthProfile?.ageRange || null,
      gender: req.user.healthProfile?.gender || null,
      existingConditions: req.user.healthProfile?.existingConditions || [],
      allergies: req.user.healthProfile?.allergies || [],
    };

    const visit = await Visit.create({
      user: req.user._id,
      clinic: clinicId,
      symptomLog: symptomLogId || null,
      preferredDate: preferredDate || null,
      notes: notes || "",
      healthProfileSnapshot,
    });

    // Link symptom log to this visit
    if (symptomLogId) {
      await Symptom.findByIdAndUpdate(symptomLogId, { linkedVisit: visit._id });
    }

    // Populate clinic info for response
    await visit.populate("clinic", "name location contactPhone");

    // ── Send visit confirmation email (non-blocking) ──────
    sendVisitConfirmationEmail({
      to: req.user.email,
      name: req.user.fullName,
      clinicName: clinic.name,
      status: "Pending",
      preferredDate: preferredDate || null,
    }).catch((err) =>
      console.error("Visit confirmation email failed:", err.message)
    );

    res.status(201).json({
      success: true,
      message: "Visit request submitted successfully.",
      data: visit,
    });
  } catch (error) {
    console.error("Request visit error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/visits/my
// Get all visits for logged-in user (Screen 8)
// Supports pagination: ?page=1&limit=10
// ─────────────────────────────────────────────
router.get("/my", async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip  = (page - 1) * limit;

    const total = await Visit.countDocuments({ user: req.user._id });

    const visits = await Visit.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("clinic", "name location contactPhone")
      .populate("symptomLog", "tags description severity");

    res.json({
      success: true,
      count: visits.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: visits,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/visits/:id
// Get a single visit detail
// ─────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const visit = await Visit.findOne({
      _id: req.params.id,
      user: req.user._id,
    })
      .populate("clinic", "name location contactPhone openingHours services")
      .populate("symptomLog", "tags description severity createdAt");

    if (!visit) {
      return res
        .status(404)
        .json({ success: false, message: "Visit not found." });
    }

    res.json({ success: true, data: visit });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/visits/:id/cancel
// Patient cancels a pending visit
// Sends cancellation email notification
// ─────────────────────────────────────────────
router.patch("/:id/cancel", async (req, res) => {
  try {
    const visit = await Visit.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).populate("clinic", "name");

    if (!visit) {
      return res
        .status(404)
        .json({ success: false, message: "Visit not found." });
    }

    if (visit.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a visit that is already ${visit.status}.`,
      });
    }

    visit.status = "Cancelled";
    await visit.save();

    // ── Send cancellation email (non-blocking) ────────────
    sendVisitConfirmationEmail({
      to: req.user.email,
      name: req.user.fullName,
      clinicName: visit.clinic.name,
      status: "Cancelled",
      preferredDate: visit.preferredDate,
    }).catch((err) =>
      console.error("Cancellation email failed:", err.message)
    );

    res.json({
      success: true,
      message: "Visit cancelled.",
      data: visit,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;

// ─────────────────────────────────────────────
// PATCH /api/visits/:id/status
// Admin/Clinic — update visit status
// Body: { status: "Confirmed" | "Completed" | "Cancelled", clinicNotes? }
// Protected — requires admin token (reuses existing admin auth middleware)
// ─────────────────────────────────────────────
const { protect } = require("../middleware/auth"); // existing admin middleware

router.patch("/:id/status", protect, async (req, res) => {
  try {
    const { status, clinicNotes } = req.body;
    const validStatuses = ["Confirmed", "Completed", "Cancelled"];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const visit = await Visit.findById(req.params.id)
      .populate("user", "fullName email notificationSettings")
      .populate("clinic", "name");

    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    visit.status = status;
    if (clinicNotes) visit.clinicNotes = clinicNotes;
    await visit.save();

    // ── Send status update email to patient (if they have it enabled) ──
    const emailEnabled = visit.user?.notificationSettings?.visitStatusUpdates !== false
                      && visit.user?.notificationSettings?.emailNotifications !== false;

    if (emailEnabled) {
      sendVisitConfirmationEmail({
        to: visit.user.email,
        name: visit.user.fullName,
        clinicName: visit.clinic.name,
        status,
        preferredDate: visit.preferredDate,
      }).catch((err) =>
        console.error("Status update email failed:", err.message)
      );
    }

    res.json({
      success: true,
      message: `Visit marked as ${status}.`,
      data: visit,
    });
  } catch (error) {
    console.error("Status update error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});
