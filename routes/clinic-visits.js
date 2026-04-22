const express      = require("express");
const router       = express.Router();
const Visit        = require("../models/Visit");
const User         = require("../models/User");
const Clinic       = require("../models/Clinic");
const Notification = require("../models/notification");
const { protectDoctor }              = require("../middleware/authDoctor");
const { sendVisitConfirmationEmail } = require("../services/emailService");

// All clinic routes require a logged-in Doctor
router.use(protectDoctor);

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/queue
//
// Returns today's visits for the doctor's clinic.
//
// How we know which clinic?
//   Option A (simple, current): Doctor profile has a clinicId field.
//   Option B: Pass clinicId as a query param ?clinicId=xxx
//
// We use Option B for now — the frontend passes the clinicId
// that's stored in localStorage when the doctor logs in.
// The doctor's clinicId is stored during sign-up / profile setup.
//
// Query: ?clinicId=xxx&status=Pending (status optional)
// ─────────────────────────────────────────────────────────────
router.get("/queue", async (req, res) => {
  try {
    const { clinicId, status } = req.query;

    if (!clinicId) {
      return res.status(400).json({
        success: false,
        message: "clinicId is required. Pass it as ?clinicId=xxx",
      });
    }

    // Verify the clinic exists
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) {
      return res.status(404).json({ success: false, message: "Clinic not found." });
    }

    // Today's date range
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const baseFilter = {
      clinic: clinicId,
      $or: [
        { preferredDate: { $gte: startOfDay, $lte: endOfDay } },
        {
          createdAt: { $gte: startOfDay, $lte: endOfDay },
          status: { $in: ["Pending", "Confirmed", "InProgress"] },
        },
      ],
    };

    const queryFilter = { ...baseFilter };
    if (status) queryFilter.status = status;

    const visits = await Visit.find(queryFilter)
      .sort({ preferredDate: 1, createdAt: 1 })
      .populate("user",       "fullName phone email healthProfile avatarUrl")
      .populate("symptomLog", "tags description severity");

    // Status counts for tab badges
    const countResult = await Visit.aggregate([
      { $match: { ...baseFilter, clinic: require("mongoose").Types.ObjectId.createFromHexString(clinicId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const statusCounts = {};
    countResult.forEach(item => { statusCounts[item._id] = item.count; });

    res.json({ success: true, data: visits, statusCounts, clinic: { id: clinic._id, name: clinic.name } });

  } catch (error) {
    console.error("Queue error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/visits/:id
// Full visit detail for consultation screen.
// ─────────────────────────────────────────────────────────────
router.get("/visits/:id", async (req, res) => {
  try {
    const visit = await Visit.findById(req.params.id)
      .populate("user",       "fullName phone email dateOfBirth healthProfile avatarUrl emergencyContact")
      .populate("symptomLog", "tags description severity createdAt")
      .populate("clinic",     "name");

    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    // Last 3 completed visits at this clinic
    const pastVisits = await Visit.find({
      user:   visit.user._id,
      clinic: visit.clinic._id,
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
// Mark visit as InProgress. Records who started it.
// ─────────────────────────────────────────────────────────────
router.patch("/visits/:id/start", async (req, res) => {
  try {
    const visit = await Visit.findById(req.params.id);

    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    if (visit.status === "Completed" || visit.status === "Cancelled") {
      return res.status(400).json({
        success: false,
        message: `Cannot start a visit with status: ${visit.status}.`,
      });
    }

    visit.status     = "InProgress";
    visit.startedAt  = new Date();
    // Store the doctor's User _id in handledBy
    // (Visit.handledBy ref will be updated from ClinicStaff to User below)
    visit.handledBy  = req.doctorId;
    await visit.save();

    res.json({ success: true, message: "Consultation started.", data: visit });

  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/clinic/visits/:id/notes
// Auto-save — called every ~1.5s as doctor types.
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

    if (!Object.keys(updates).length) {
      return res.json({ success: true, savedAt: new Date() });
    }

    const visit = await Visit.findByIdAndUpdate(
      req.params.id,
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
// Finalise the consultation and notify the patient.
// ─────────────────────────────────────────────────────────────
router.patch("/visits/:id/complete", async (req, res) => {
  try {
    const { diagnosis, prescription, testsOrdered, advice, clinicNotes } = req.body;

    const visit = await Visit.findById(req.params.id)
      .populate("user",   "fullName email notificationSettings")
      .populate("clinic", "name");

    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    if (visit.status === "Completed") {
      return res.status(400).json({ success: false, message: "Already completed." });
    }

    visit.status      = "Completed";
    visit.completedAt = new Date();
    if (diagnosis    !== undefined) visit.diagnosis    = diagnosis;
    if (prescription !== undefined) visit.prescription = prescription;
    if (testsOrdered !== undefined) visit.testsOrdered = testsOrdered;
    if (advice       !== undefined) visit.advice       = advice;
    if (clinicNotes  !== undefined) visit.clinicNotes  = clinicNotes;

    await visit.save();

    // Notify patient — fire and forget
    Notification.create({
      user:    visit.user._id,
      type:    "visit_completed",
      title:   "Consultation Complete",
      message: "Your consultation notes are ready. Tap to view.",
      link:    "./app-history.html",
    }).catch(() => {});

    const emailOk =
      visit.user?.notificationSettings?.visitStatusUpdates !== false &&
      visit.user?.notificationSettings?.emailNotifications  !== false;

    if (emailOk) {
      sendVisitConfirmationEmail({
        to:            visit.user.email,
        name:          visit.user.fullName,
        clinicName:    visit.clinic?.name || "the clinic",
        status:        "Completed",
        preferredDate: visit.preferredDate,
      }).catch(() => {});
    }

    res.json({ success: true, message: "Consultation completed.", data: visit });

  } catch (error) {
    console.error("Complete visit error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/patients/search
// Search patients who have visited a given clinic.
// Query: ?clinicId=xxx&q=name
// ─────────────────────────────────────────────────────────────
router.get("/patients/search", async (req, res) => {
  try {
    const { q, clinicId } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    const filter = {};
    if (clinicId) filter.clinic = clinicId;

    const patientIds = await Visit.distinct("user", filter);

    if (!patientIds.length) {
      return res.json({ success: true, data: [] });
    }

    const users = await User.find({
      _id: { $in: patientIds },
      $or: [
        { fullName: { $regex: q, $options: "i" } },
        { email:    { $regex: q, $options: "i" } },
        { phone:    { $regex: q, $options: "i" } },
      ],
    })
      .select("fullName email phone avatarUrl healthProfile")
      .limit(10);

    const results = await Promise.all(
      users.map(async (user) => {
        const last = await Visit.findOne({
          user:   user._id,
          ...(clinicId ? { clinic: clinicId } : {}),
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
// POST /api/clinic/walk-in
// Add a walk-in patient to today's queue.
// Body: { userId, clinicId, notes? }
// ─────────────────────────────────────────────────────────────
router.post("/walk-in", async (req, res) => {
  try {
    const { userId, clinicId, notes } = req.body;

    if (!userId || !clinicId) {
      return res.status(400).json({
        success: false,
        message: "userId and clinicId are required.",
      });
    }

    const user = await User.findById(userId).select("fullName email phone healthProfile");
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Patient not found.",
      });
    }

    const visit = await Visit.create({
      user:          userId,
      clinic:        clinicId,
      status:        "Confirmed",
      notes:         notes || "Walk-in",
      preferredDate: new Date(),
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