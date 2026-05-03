const express = require("express");
const router  = express.Router();
const Notification = require("../models/notification");
const { protectUser } = require("../middleware/authUser");

// All routes require logged-in patient
router.use(protectUser);

// ─────────────────────────────────────────────
// GET /api/notifications
// Get all notifications for logged-in user
// Returns latest 20, sorted newest first
// ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const query = {
      $or: [{ user: req.user._id }]
    };
    if (req.user.clinicId) {
      query.$or.push({ clinic: req.user.clinicId });
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(20);

    const unreadCount = await Notification.countDocuments({
      ...query,
      read: false,
    });

    res.json({
      success: true,
      unreadCount,
      data: notifications,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/notifications/unread-count
// Lightweight — just returns the unread count
// Called by navbar badge on every page load
// ─────────────────────────────────────────────
router.get("/unread-count", async (req, res) => {
  try {
    const query = {
      $or: [{ user: req.user._id }]
    };
    if (req.user.clinicId) {
      query.$or.push({ clinic: req.user.clinicId });
    }

    const count = await Notification.countDocuments({
      ...query,
      read: false,
    });
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/notifications/:id/read
// Mark a single notification as read
// ─────────────────────────────────────────────
router.patch("/:id/read", async (req, res) => {
  try {
    const query = { _id: req.params.id };
    if (req.user.clinicId) {
      query.$or = [{ user: req.user._id }, { clinic: req.user.clinicId }];
    } else {
      query.user = req.user._id;
    }

    await Notification.findOneAndUpdate(query, { read: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/notifications/mark-all-read
// Mark ALL notifications as read
// Called when user opens the dropdown
// ─────────────────────────────────────────────
router.patch("/mark-all-read", async (req, res) => {
  try {
    const query = { read: false };
    if (req.user.clinicId) {
      query.$or = [{ user: req.user._id }, { clinic: req.user.clinicId }];
    } else {
      query.user = req.user._id;
    }

    await Notification.updateMany(query, { read: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/notifications/:id
// Delete a single notification
// ─────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;