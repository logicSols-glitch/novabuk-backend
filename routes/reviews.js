const express = require("express");
const router = express.Router();
const Review = require("../models/Review");
const Visit = require("../models/Visit");
const { protectUser } = require("../middleware/authUser");

// ─────────────────────────────────────────────
// GET /api/reviews/clinic/:clinicId
// Public — get all reviews for a clinic
// (Figma — Clinic detail Reviews tab)
// ─────────────────────────────────────────────
router.get("/clinic/:clinicId", async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip  = (page - 1) * limit;

    const total = await Review.countDocuments({ clinic: req.params.clinicId });

    const reviews = await Review.find({ clinic: req.params.clinicId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "fullName"); // show reviewer name only

    res.json({
      success: true,
      count: reviews.length,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      data: reviews,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// POST /api/reviews
// Protected — submit a review for a clinic
// User must have a Completed visit to that clinic
// Body: { clinicId, visitId, rating, comment }
// ─────────────────────────────────────────────
router.post("/", protectUser, async (req, res) => {
  try {
    const { clinicId, visitId, rating, comment } = req.body;

    if (!clinicId || !visitId || !rating) {
      return res.status(400).json({
        success: false,
        message: "Clinic, visit, and rating are required.",
      });
    }

    // Verify the visit belongs to this user and is Completed
    const visit = await Visit.findOne({
      _id: visitId,
      user: req.user._id,
      clinic: clinicId,
      status: "Completed",
    });

    if (!visit) {
      return res.status(403).json({
        success: false,
        message: "You can only review a clinic after a completed visit.",
      });
    }

    // Check if already reviewed this visit
    const existing = await Review.findOne({ user: req.user._id, visit: visitId });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "You have already reviewed this visit.",
      });
    }

    const review = await Review.create({
      user: req.user._id,
      clinic: clinicId,
      visit: visitId,
      rating,
      comment: comment || "",
    });

    await review.populate("user", "fullName");

    res.status(201).json({
      success: true,
      message: "Review submitted successfully.",
      data: review,
    });
  } catch (error) {
    console.error("Review error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/reviews/:id
// Protected — delete own review
// ─────────────────────────────────────────────
router.delete("/:id", protectUser, async (req, res) => {
  try {
    const review = await Review.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    res.json({ success: true, message: "Review deleted." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;
