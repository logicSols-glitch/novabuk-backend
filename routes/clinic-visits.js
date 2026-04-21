const express      = require("express");
const router       = express.Router();
const Visit        = require("../models/Visit");
const User         = require("../models/User");
const Notification = require("../models/notification");
const { protectClinic }              = require("../middleware/authClinic");
const { sendVisitConfirmationEmail } = require("../services/emailService");

// Every route in this file requires clinic staff auth
router.use(protectClinic);

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/queue
// Today's patient queue for this clinic.
// Query: ?status=Pending  (optional — filters to one tab)
// ─────────────────────────────────────────────────────────────
router.get("/queue", async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // Base filter — always scoped to THIS clinic
    const baseFilter = {
      clinic: req.clinicId,
      $or: [
        // Booked appointments for today
        { preferredDate: { $gte: startOfDay, $lte: endOfDay } },
        // Walk-ins and unscheduled active visits created today
        {
          createdAt: { $gte: startOfDay, $lte: endOfDay },
          status:    { $in: ["Pending", "Confirmed", "InProgress"] },
        },
      ],
    };

    // Apply optional status filter
    const queryFilter = { ...baseFilter };
    if (req.query.status) queryFilter.status = req.query.status;

    const visits = await Visit.find(queryFilter)
      .sort({ preferredDate: 1, createdAt: 1 })
      .populate("user",       "fullName phone email healthProfile avatarUrl")
      .populate("symptomLog", "tags description severity");

    // Count per status for tab badges — use baseFilter (no status filter)
    // so all tab counts are always correct regardless of which tab is shown
    const countResult = await Visit.aggregate([
      { $match: baseFilter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const statusCounts = {};
    countResult.forEach(item => { statusCounts[item._id] = item.count; });

    res.json({ success: true, data: visits, statusCounts });
  } catch (error) {
    console.error("Queue error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/visits/:id
// Single visit with full patient context for consultation screen.
// Also returns last 3 past visits (freemium: only 3 shown).
// ─────────────────────────────────────────────────────────────
router.get("/visits/:id", async (req, res) => {
  try {
    const visit = await Visit.findOne({
      _id:    req.params.id,
      clinic: req.clinicId,  // security scope
    })
      .populate("user",       "fullName phone email dateOfBirth healthProfile avatarUrl emergencyContact")
      .populate("symptomLog", "tags description severity createdAt")
      .populate("handledBy",  "fullName role");

    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    // Last 3 completed visits — capped at 3 for freemium
    const pastVisits = await Visit.find({
      user:   visit.user._id,
      clinic: req.clinicId,
      _id:    { $ne: visit._id },
      status: "Completed",
    })
      .sort({ completedAt: -1 })
      .limit(3)
      .select("diagnosis notes completedAt preferredDate");

    res.json({ success: true, data: visit, pastVisits });
  } catch (error) {
    console.error("Get visit error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/clinic/visits/:id/start
// Doctor clicks "Start" — marks visit as InProgress.
// ─────────────────────────────────────────────────────────────
router.patch("/visits/:id/start", async (req, res) => {
  try {
    const visit = await Visit.findOne({
      _id:    req.params.id,
      clinic: req.clinicId,
    });

    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    if (visit.status === "Completed" || visit.status === "Cancelled") {
      return res.status(400).json({
        success: false,
        message: `Cannot start a visit that is already ${visit.status}.`,
      });
    }

    visit.status    = "InProgress";
    visit.startedAt = new Date();
    visit.handledBy = req.staff._id;
    await visit.save();

    res.json({ success: true, message: "Consultation started.", data: visit });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/clinic/visits/:id/notes
// Auto-save — called every ~1.5s as doctor types.
// Only updates fields that were actually sent in the body.
// ─────────────────────────────────────────────────────────────
router.patch("/visits/:id/notes", async (req, res) => {
  try {
    const { diagnosis, prescription, testsOrdered, advice, clinicNotes } = req.body;

    const updates = {};
    if (diagnosis     !== undefined) updates.diagnosis     = diagnosis;
    if (prescription  !== undefined) updates.prescription  = prescription;
    if (testsOrdered  !== undefined) updates.testsOrdered  = testsOrdered;
    if (advice        !== undefined) updates.advice        = advice;
    if (clinicNotes   !== undefined) updates.clinicNotes   = clinicNotes;

    if (Object.keys(updates).length === 0) {
      return res.json({ success: true, savedAt: new Date() });
    }

    const visit = await Visit.findOneAndUpdate(
      { _id: req.params.id, clinic: req.clinicId },
      updates,
      { new: true }
    );

    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    res.json({ success: true, savedAt: new Date() });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/clinic/visits/:id/complete
// Doctor clicks "Complete Visit" — finalises consultation,
// notifies patient in-app and by email (if enabled).
// ─────────────────────────────────────────────────────────────
router.patch("/visits/:id/complete", async (req, res) => {
  try {
    const { diagnosis, prescription, testsOrdered, advice, clinicNotes } = req.body;

    const visit = await Visit.findOne({
      _id:    req.params.id,
      clinic: req.clinicId,
    }).populate("user", "fullName email notificationSettings");

    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    if (visit.status === "Completed") {
      return res.status(400).json({
        success: false,
        message: "This visit is already completed.",
      });
    }

    // Save final notes
    visit.status      = "Completed";
    visit.completedAt = new Date();
    if (diagnosis    !== undefined) visit.diagnosis    = diagnosis;
    if (prescription !== undefined) visit.prescription = prescription;
    if (testsOrdered !== undefined) visit.testsOrdered = testsOrdered;
    if (advice       !== undefined) visit.advice       = advice;
    if (clinicNotes  !== undefined) visit.clinicNotes  = clinicNotes;

    await visit.save();

    // In-app notification — non-blocking
    Notification.create({
      user:    visit.user._id,
      type:    "visit_completed",
      title:   "Consultation Complete",
      message: "Your consultation notes are ready. Tap to view.",
      link:    "./app-history.html",
    }).catch(err => console.error("Notification error:", err.message));

    // Email — only if patient has it on
    const emailEnabled =
      visit.user?.notificationSettings?.visitStatusUpdates !== false &&
      visit.user?.notificationSettings?.emailNotifications  !== false;

    if (emailEnabled) {
      sendVisitConfirmationEmail({
        to:            visit.user.email,
        name:          visit.user.fullName,
        clinicName:    req.staff.clinic.name,
        status:        "Completed",
        preferredDate: visit.preferredDate,
      }).catch(err => console.error("Email error:", err.message));
    }

    res.json({ success: true, message: "Consultation completed.", data: visit });
  } catch (error) {
    console.error("Complete visit error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/patients/search
// Search patients who have visited this clinic.
// Query: ?q=name or email or phone
// ─────────────────────────────────────────────────────────────
router.get("/patients/search", async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    // Only search patients who have visited THIS clinic
    const clinicPatientIds = await Visit.distinct("user", {
      clinic: req.clinicId,
    });

    if (!clinicPatientIds.length) {
      return res.json({ success: true, data: [] });
    }

    const users = await User.find({
      _id: { $in: clinicPatientIds },
      $or: [
        { fullName: { $regex: q, $options: "i" } },
        { email:    { $regex: q, $options: "i" } },
        { phone:    { $regex: q, $options: "i" } },
      ],
    })
      .select("fullName email phone avatarUrl healthProfile")
      .limit(10);

    // Add last visit date to each result — run in parallel
    const results = await Promise.all(
      users.map(async (user) => {
        const last = await Visit.findOne({
          user:   user._id,
          clinic: req.clinicId,
          status: "Completed",
        })
          .sort({ completedAt: -1 })
          .select("completedAt preferredDate");

        return {
          ...user.toObject(),
          lastVisit: last?.completedAt || last?.preferredDate || null,
        };
      })
    );

    res.json({ success: true, data: results });
  } catch (error) {
    console.error("Patient search error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/patients/:userId/visits
// All visits for one patient at this clinic (patient history).
// ─────────────────────────────────────────────────────────────
router.get("/patients/:userId/visits", async (req, res) => {
  try {
    const visits = await Visit.find({
      user:   req.params.userId,
      clinic: req.clinicId,
    })
      .sort({ createdAt: -1 })
      .populate("symptomLog", "tags description")
      .select("status preferredDate completedAt diagnosis notes clinicNotes createdAt");

    res.json({ success: true, count: visits.length, data: visits });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/clinic/walk-in
// Add a walk-in patient to today's queue.
// The patient must already have a NovaBuk account.
// Body: { userId, notes? }
// ─────────────────────────────────────────────────────────────
router.post("/walk-in", async (req, res) => {
  try {
    const { userId, notes } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Patient userId is required.",
      });
    }

    const user = await User.findById(userId)
      .select("fullName email phone healthProfile");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Patient not found. They must be registered on the NovaBuk app first.",
      });
    }

    const visit = await Visit.create({
      user:          userId,
      clinic:        req.clinicId,
      status:        "Confirmed",  // walk-ins skip Pending — they're already here
      notes:         notes || "Walk-in",
      preferredDate: new Date(),   // now — ensures it shows in today's queue
    });

    await visit.populate("user", "fullName phone email healthProfile");

    res.status(201).json({
      success: true,
      message: "Walk-in added to queue.",
      data:    visit,
    });
  } catch (error) {
    console.error("Walk-in error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;