const express = require("express");
const router = express.Router();
const Visit = require("../models/Visit");
const Symptom = require("../models/Symptom");
const { protectUser } = require("../middleware/authUser");

// ─────────────────────────────────────────────
// GET /api/dashboard
// Protected — home screen stats (Screen 5)
// Returns counts + recent activity for dashboard
// ─────────────────────────────────────────────
router.get("/", protectUser, async (req, res) => {
  try {
    const userId = req.user._id;

    // Run all queries in parallel for speed
    const [
      totalVisits,
      pendingVisits,
      confirmedVisits,
      completedVisits,
      totalSymptoms,
      recentVisits,
      recentSymptoms,
    ] = await Promise.all([
      // Visit counts
      Visit.countDocuments({ user: userId }),
      Visit.countDocuments({ user: userId, status: "Pending" }),
      Visit.countDocuments({ user: userId, status: "Confirmed" }),
      Visit.countDocuments({ user: userId, status: "Completed" }),

      // Symptom count
      Symptom.countDocuments({ user: userId }),

      // Last 3 visits for "recent activity" on dashboard
      Visit.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(3)
        .populate("clinic", "name location isOpen"),

      // Last 3 symptom logs
      Symptom.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(3),
    ]);

    res.json({
      success: true,
      data: {
        // Greeting info
        user: {
          fullName: req.user.fullName,
          profileComplete: req.user.profileComplete,
        },
        // Stats for dashboard cards
        stats: {
          totalVisits,
          pendingVisits,
          confirmedVisits,
          completedVisits,
          totalSymptoms,
        },
        // Recent activity feed
        recentVisits,
        recentSymptoms,
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
