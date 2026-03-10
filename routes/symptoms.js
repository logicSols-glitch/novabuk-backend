const express = require("express");
const router = express.Router();
const Symptom = require("../models/Symptom");
const { protectUser } = require("../middleware/authUser");

// All symptom routes require a logged-in patient
router.use(protectUser);

// ─────────────────────────────────────────────
// POST /api/symptoms
// Log a new symptom entry (Screen 6)
// Body: { tags[], description, severity }
// ─────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { tags, description, severity } = req.body;

    if ((!tags || tags.length === 0) && !description) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one symptom tag or describe your symptoms.",
      });
    }

    const symptom = await Symptom.create({
      user: req.user._id,
      tags: tags || [],
      description: description || "",
      severity: severity || "Mild",
    });

    res.status(201).json({
      success: true,
      message: "Symptoms logged successfully.",
      data: symptom,
    });
  } catch (error) {
    console.error("Log symptom error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/symptoms
// Get all symptom logs for logged-in user
// Supports pagination: ?page=1&limit=10
// ─────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip  = (page - 1) * limit;

    const total = await Symptom.countDocuments({ user: req.user._id });

    const symptoms = await Symptom.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("linkedVisit", "status clinic");

    res.json({
      success: true,
      count: symptoms.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: symptoms,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/symptoms/:id
// Get a single symptom log
// ─────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const symptom = await Symptom.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).populate("linkedVisit", "status clinic preferredDate");

    if (!symptom) {
      return res.status(404).json({
        success: false,
        message: "Symptom log not found.",
      });
    }

    res.json({ success: true, data: symptom });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/symptoms/:id
// Delete a symptom log
// ─────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const symptom = await Symptom.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!symptom) {
      return res.status(404).json({
        success: false,
        message: "Symptom log not found.",
      });
    }

    res.json({ success: true, message: "Symptom log deleted." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
