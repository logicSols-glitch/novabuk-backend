const express = require("express");
const router = express.Router();
const Visit = require("../models/Visit");
const User = require("../models/User");
const Clinic = require("../models/Clinic");
const Notification = require("../models/notification");
const { protectDoctor } = require("../middleware/authDoctor.js");
const { sendVisitConfirmationEmail, sendWalkInWelcomeEmail } = require("../services/emailService");

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

    const mongoose = require("mongoose");
    const clinicObjectId = mongoose.Types.ObjectId.createFromHexString(clinicId);

    // Verify the clinic exists
    const clinic = await Clinic.findById(clinicObjectId);
    if (!clinic) {
      return res
        .status(404)
        .json({ success: false, message: "Clinic not found." });
    }

    // Today's date range
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const baseFilter = {
      clinic: clinicObjectId,
      $or: [
        { status: "Pending" },
        { status: "Confirmed" },
        { status: "InProgress" },
        { 
          status: "Completed", 
          completedAt: { $gte: startOfDay, $lte: endOfDay } 
        },
        // Fallback for any other visit specifically scheduled for today
        { preferredDate: { $gte: startOfDay, $lte: endOfDay } },
      ],
    };

    const queryFilter = { ...baseFilter };
    if (status) queryFilter.status = status;

    const visits = await Visit.find(queryFilter)
      .sort({ preferredDate: 1, createdAt: 1 })
      .populate("user", "fullName phone email healthProfile avatarUrl novaBukId")
      .populate("symptomLog", "tags description severity");

    // Status counts for tab badges
    const countResult = await Visit.aggregate([
      { $match: baseFilter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const statusCounts = {};
    countResult.forEach((item) => {
      statusCounts[item._id] = item.count;
    });

    res.json({
      success: true,
      data: visits,
      statusCounts,
      clinic: { id: clinic._id, name: clinic.name },
    });

    // ── Background: Generate "Patient Waiting" notifications ─────
    try {
      const now = new Date();
      for (const v of visits) {
        if (v.status === "Confirmed" && v.preferredDate) {
          const waitTimeMins = Math.floor((now - new Date(v.preferredDate)) / 60000);
          
          if (waitTimeMins >= 15) {
            // Check if we already notified about this patient's wait today
            const startOfToday = new Date();
            startOfToday.setHours(0,0,0,0);
            
            const existing = await Notification.findOne({
              clinic: clinicObjectId,
              type: "critical_alert",
              createdAt: { $gte: startOfToday },
              message: { $regex: v.user?.fullName || "Patient", $options: "i" }
            });

            if (!existing) {
              const formatWaitTime = (m) => {
                if (m < 60) return `${m} mins`;
                const hours = Math.floor(m / 60);
                const remainingMins = m % 60;
                if (hours < 24) return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
                const days = Math.floor(hours / 24);
                return `${days} day${days > 1 ? 's' : ''}+`;
              };
              const waitStr = formatWaitTime(waitTimeMins);

              await Notification.create({
                clinic: clinicObjectId,
                type: "critical_alert",
                title: `Patient waiting — ${waitStr}`,
                message: `${v.user?.fullName || "A patient"} has been waiting since ${new Date(v.preferredDate).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}. Now ${waitStr} overdue.`,
                link: "./clinic-queue.html"
              });
            }
          }
        }
      }
    } catch (err) {
      console.error("Overdue notification check failed:", err);
    }
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
      .populate(
        "user",
        "fullName phone email dateOfBirth healthProfile avatarUrl emergencyContact novaBukId",
      )
      .populate("symptomLog", "tags description severity createdAt")
      .populate("clinic", "name");

    if (!visit) {
      return res
        .status(404)
        .json({ success: false, message: "Visit not found." });
    }

    // Last 3 completed visits at this clinic
    const pastVisits = await Visit.find({
      user: visit.user._id,
      clinic: visit.clinic._id,
      _id: { $ne: visit._id },
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
// PATCH /api/clinic/visits/:id/confirm
// Accept/Confirm a pending visit.
// ─────────────────────────────────────────────────────────────
router.patch("/visits/:id/confirm", async (req, res) => {
  try {
    const visit = await Visit.findById(req.params.id)
      .populate("user", "email fullName notificationSettings")
      .populate("clinic", "name");

    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found." });
    }

    if (visit.status !== "Pending") {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm a visit with status: ${visit.status}.`,
      });
    }

    visit.status = "Confirmed";
    await visit.save();

    // ── Create in-app notification for Patient ───────────
    Notification.create({
      user: visit.user._id,
      type: "visit_confirmed",
      title: "Visit Confirmed",
      message: `Your visit to ${visit.clinic.name} has been confirmed.`,
      link: "./app-history.html",
    }).catch(() => {});

    // Send confirmation email to the patient
    if (visit.user && visit.user.email) {
      const emailEnabled = visit.user.notificationSettings?.emailNotifications !== false;
      const remindersEnabled = visit.user.notificationSettings?.appointmentReminders !== false;
      
      if (emailEnabled && remindersEnabled) {
        sendVisitConfirmationEmail({
          to:            visit.user.email,
          name:          visit.user.fullName,
          clinicName:    visit.clinic ? visit.clinic.name : "the clinic",
          status:        "Confirmed",
          preferredDate: visit.preferredDate || null,
        }).catch(err => console.error("Patient confirmation email failed:", err.message));
      }
    }

    res.json({ success: true, message: "Visit confirmed.", data: visit });
  } catch (error) {
    console.error("Confirm visit error:", error);
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
      return res
        .status(404)
        .json({ success: false, message: "Visit not found." });
    }

    if (visit.status === "Completed" || visit.status === "Cancelled") {
      return res.status(400).json({
        success: false,
        message: `Cannot start a visit with status: ${visit.status}.`,
      });
    }

    visit.status = "InProgress";
    visit.startedAt = new Date();
    visit.handledBy = req.doctorId;
    await visit.save();

    // ── Notify the Patient ─────────────────────────────
    // Fetch user and clinic info for the notification
    const vFull = await Visit.findById(visit._id)
      .populate("user", "fullName email")
      .populate("clinic", "name");

    if (vFull && vFull.user) {
      Notification.create({
        user: vFull.user._id,
        type: "visit_started",
        title: "Consultation Started",
        message: `Your consultation at ${vFull.clinic?.name || "the clinic"} has started.`,
        link: "./app-home.html", // Or a live consultation tracker if exists
      }).catch(() => {});
    }

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
    const { diagnosis, prescription, testsOrdered, advice, clinicNotes } =
      req.body;

    const updates = {};
    if (diagnosis !== undefined) updates.diagnosis = diagnosis;
    if (prescription !== undefined) updates.prescription = prescription;
    if (testsOrdered !== undefined) updates.testsOrdered = testsOrdered;
    if (advice !== undefined) updates.advice = advice;
    if (clinicNotes !== undefined) updates.clinicNotes = clinicNotes;

    if (!Object.keys(updates).length) {
      return res.json({ success: true, savedAt: new Date() });
    }

    const visit = await Visit.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    });

    if (!visit) {
      return res
        .status(404)
        .json({ success: false, message: "Visit not found." });
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
    const { diagnosis, prescription, testsOrdered, advice, clinicNotes } =
      req.body;

    const visit = await Visit.findById(req.params.id)
      .populate("user", "fullName email notificationSettings novaBukId")
      .populate("clinic", "name");

    if (!visit) {
      return res
        .status(404)
        .json({ success: false, message: "Visit not found." });
    }

    if (visit.status === "Completed") {
      return res
        .status(400)
        .json({ success: false, message: "Already completed." });
    }

    visit.status = "Completed";
    visit.completedAt = new Date();
    if (diagnosis !== undefined) visit.diagnosis = diagnosis;
    if (prescription !== undefined) visit.prescription = prescription;
    if (testsOrdered !== undefined) visit.testsOrdered = testsOrdered;
    if (advice !== undefined) visit.advice = advice;
    if (clinicNotes !== undefined) visit.clinicNotes = clinicNotes;

    await visit.save();

    // Notify patient — fire and forget
    Notification.create({
      user: visit.user._id,
      type: "visit_completed",
      title: "Consultation Complete",
      message: "Your consultation notes are ready. Tap to view.",
      link: "./app-history.html",
    }).catch(() => {});

    // ── NEW: Notify Clinic Portal ─────────────────────
    Notification.create({
      clinic: visit.clinic._id,
      type: "visit_completed",
      title: "Consultation Completed",
      message: `${visit.user?.fullName || "Patient"}'s consultation has been finalized.`,
      link: "./clinic-queue.html",
    }).catch(() => {});

    const emailOk =
      visit.user?.notificationSettings?.visitStatusUpdates !== false &&
      visit.user?.notificationSettings?.emailNotifications !== false;

    if (emailOk) {
      sendVisitConfirmationEmail({
        to: visit.user.email,
        name: visit.user.fullName,
        clinicName: visit.clinic?.name || "the clinic",
        status: "Completed",
        preferredDate: visit.preferredDate,
        // Include notes so they appear in the patient email
        diagnosis: visit.diagnosis || "",
        advice: visit.advice || "",
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: "Consultation completed.",
      data: visit,
    });
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

    // Search ALL patients across NovaBuk (Global Search)
    const users = await User.find({
      role: "Patient",
      $or: [
        { fullName: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { novaBukId: { $regex: q, $options: "i" } },
      ],
    })
      .select("fullName email phone avatarUrl healthProfile novaBukId privacySettings")
      .limit(15);

    const results = await Promise.all(
      users.map(async (user) => {
        // Auto-repair missing NovaBuk ID if found in search
        if (!user.novaBukId) {
          const random = Math.floor(1000 + Math.random() * 9000);
          user.novaBukId = `NB-${random}`;
          await user.save();
        }

        // Still check for last visit at THIS clinic to provide context to the staff
        let lastVisit = null;
        if (clinicId) {
          const last = await Visit.findOne({
            user: user._id,
            clinic: clinicId,
            status: "Completed",
          })
            .sort({ completedAt: -1 })
            .select("completedAt preferredDate");
          lastVisit = last?.completedAt || last?.preferredDate || null;
        }

        return {
          ...user.toObject(),
          lastVisit,
        };
      }),
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

    const user = await User.findById(userId).select(
      "fullName email phone healthProfile",
    );
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Patient not found.",
      });
    }

    const visit = await Visit.create({
      user: userId,
      clinic: clinicId,
      status: "Confirmed",
      notes: notes || "Walk-in",
      preferredDate: new Date(),
    });

    await visit.populate("user", "fullName phone email healthProfile notificationSettings");
    await visit.populate("clinic", "name");

    // ── Notify the Patient ─────────────────────────────
    Notification.create({
      user: userId,
      type: "visit_confirmed",
      title: "Walk-in Registered",
      message: `You have been added to the queue at ${visit.clinic?.name || "the clinic"}.`,
      link: "./app-history.html",
    }).catch(() => {});

    // ── NEW: Notify Clinic Portal ─────────────────────
    Notification.create({
      clinic: clinicId,
      type: "walk_in",
      title: "New walk-in registered",
      message: `${user.fullName} has been added to the queue. Complaint: ${notes || "General consultation"}`,
      link: "./clinic-queue.html",
    }).catch(() => {});

    // Send email if enabled
    if (user.email) {
      const emailEnabled = user.notificationSettings?.emailNotifications !== false;
      if (emailEnabled) {
        sendVisitConfirmationEmail({
          to:            user.email,
          name:          user.fullName,
          clinicName:    visit.clinic?.name || "the clinic",
          status:        "Confirmed",
          preferredDate: visit.preferredDate,
        }).catch(() => {});
      }
    }

    res.status(201).json({
      success: true,
      message: "Walk-in added to queue.",
      data: visit,
    });
  } catch (error) {
    console.error("Walk-in error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/patients/:id
// Get patient profile details for clinic staff.
// ─────────────────────────────────────────────────────────────
router.get("/patients/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      "fullName email phone dateOfBirth healthProfile avatarUrl emergencyContact address city state privacySettings"
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "Patient not found." });
    }

    // ── Enforce Privacy Settings ───────────────────────
    const canShare = user.privacySettings?.shareDataWithProviders !== false;
    
    if (!canShare) {
      // Redact sensitive clinical data if sharing is disabled
      user.healthProfile = {
        ageRange: user.healthProfile?.ageRange || null,
        gender: user.healthProfile?.gender || null,
        existingConditions: ["Restricted"],
        allergies: ["Restricted"]
      };
      user.emergencyContact = { name: "Restricted", phone: "Restricted" };
      user.address = "Restricted";
    }

    res.json({ success: true, patient: user, privacyRestricted: !canShare });
  } catch (error) {
    console.error("Get patient error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/patients/:id/history
// Get all past visits of a patient in a specific clinic.
// ─────────────────────────────────────────────────────────────
router.get("/patients/:id/history", async (req, res) => {
  try {
    const { clinicId } = req.query;
    if (!clinicId) {
      return res.status(400).json({ success: false, message: "clinicId is required." });
    }
    const visits = await Visit.find({
      user: req.params.id,
      clinic: clinicId
    }).sort({ createdAt: -1 });

    res.json({ success: true, visits });
  } catch (error) {
    console.error("Get patient history error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/clinic/walk-in-new
// Register a NEW patient AND add them to today's queue.
// Body: { fullName, email, phone, gender, age, clinicId, notes? }
// ─────────────────────────────────────────────────────────────
router.post("/walk-in-new", async (req, res) => {
  try {
    const { fullName, email, phone, gender, age, clinicId, notes } = req.body;

    if (!fullName || !clinicId) {
      return res.status(400).json({
        success: false,
        message: "fullName and clinicId are required.",
      });
    }

    // 1. Check if user already exists by email or phone
    let existingUser = null;
    if (email) {
      existingUser = await User.findOne({ email: email.toLowerCase() });
    }
    if (!existingUser && phone) {
      existingUser = await User.findOne({ phone });
    }

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "A patient with this email or phone already exists. Please search and add them as a regular walk-in.",
      });
    }

    // 2. Create new Patient user
    // Generate a temporary random password (they can reset later)
    const crypto = require("crypto");
    const tempPassword = crypto.randomBytes(8).toString("hex");

    const newUser = await User.create({
      fullName: fullName.trim(),
      email: email ? email.toLowerCase() : undefined,
      phone: phone || undefined,
      password: tempPassword,
      role: "Patient",
      profileComplete: true,
      healthProfile: {
        gender: gender || "Other",
        ageRange: age ? `${age}` : "Not specified"
      }
    });

    // 3. Create the Visit
    const visit = await Visit.create({
      user: newUser._id,
      clinic: clinicId,
      status: "Confirmed",
      notes: notes || "First-time Walk-in",
      preferredDate: new Date(),
    });

    await visit.populate("user", "fullName phone email healthProfile notificationSettings");
    await visit.populate("clinic", "name");

    // 4. Notify Clinic Portal
    Notification.create({
      clinic: clinicId,
      type: "walk_in",
      title: "New patient registered",
      message: `${newUser.fullName} has been registered and added to the queue.`,
      link: "./clinic-queue.html",
    }).catch(() => {});

    // 5. Send welcome & activation email
    if (newUser.email) {
      try {
        const crypto = require("crypto");
        const resetToken = crypto.randomBytes(32).toString("hex");
        
        newUser.passwordResetToken = crypto
          .createHash("sha256")
          .update(resetToken)
          .digest("hex");
        newUser.passwordResetExpires = Date.now() + 48 * 60 * 60 * 1000; // 48 hours
        await newUser.save();

        let finalFrontend = process.env.FRONTEND_URL || "https://www.novabuk.com";
        if (finalFrontend.includes("vercel.app") || finalFrontend.includes("novabukrepo")) {
          finalFrontend = "https://www.novabuk.com";
        }
        const activationUrl = `${finalFrontend}/app-reset-password.html?token=${resetToken}`;

        await sendWalkInWelcomeEmail({
          to: newUser.email,
          name: newUser.fullName,
          clinicName: visit.clinic?.name || "the clinic",
          activationUrl,
          novaBukId: newUser.novaBukId
        });
      } catch (err) {
        console.error("Walk-in activation email failed:", err.message);
      }
    }

    res.status(201).json({
      success: true,
      message: "New patient registered and added to queue.",
      data: visit,
    });
  } catch (error) {
    console.error("Walk-in-new error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});


// ─────────────────────────────────────────────────────────────
// GET /api/clinic/notifications
// Get notifications for the doctor's clinic.
// Uses the clinicId stored on the doctor's user document.
// ─────────────────────────────────────────────────────────────
router.get("/notifications", async (req, res) => {
  try {
    const clinicId = req.user.clinicId;

    if (!clinicId) {
      return res.status(400).json({
        success: false,
        message: "Doctor profile is not linked to a clinic. Please complete your profile setup.",
      });
    }

    const query = { clinic: clinicId };

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(30);

    const unreadCount = await Notification.countDocuments({ ...query, read: false });

    res.json({ success: true, unreadCount, data: notifications });
  } catch (error) {
    console.error("Clinic notifications error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic/notifications/unread-count
// Lightweight — just the badge count. Called on every page load.
// ─────────────────────────────────────────────────────────────
router.get("/notifications/unread-count", async (req, res) => {
  try {
    const clinicId = req.user.clinicId;
    if (!clinicId) return res.json({ success: true, count: 0 });

    const count = await Notification.countDocuments({ clinic: clinicId, read: false });
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/clinic/notifications/mark-all-read
// Mark ALL clinic notifications as read.
// NOTE: This MUST be registered before /:id/read so Express
// does not match "mark-all-read" as an :id parameter.
// ─────────────────────────────────────────────────────────────
router.patch("/notifications/mark-all-read", async (req, res) => {
  try {
    const clinicId = req.user.clinicId;
    if (!clinicId) return res.json({ success: true });

    await Notification.updateMany({ clinic: clinicId, read: false }, { read: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// PATCH /api/clinic/notifications/:id/read
// Mark a single clinic notification as read.
// ─────────────────────────────────────────────────────────────
router.patch("/notifications/:id/read", async (req, res) => {
  try {
    const clinicId = req.user.clinicId;
    await Notification.findOneAndUpdate(
      { _id: req.params.id, clinic: clinicId },
      { read: true }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
