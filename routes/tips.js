const express = require("express");
const router = express.Router();
const Tip = require("../models/Tip");
const { protectAdmin } = require("../middleware/auth");

// @desc    Get all active tips
// @route   GET /api/tips
// @access  Public
router.get("/", async (req, res) => {
  try {
    const tips = await Tip.find({ active: true }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: tips });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all tips (admin only)
// @route   GET /api/tips/admin
// @access  Private/Admin
router.get("/admin", protectAdmin, async (req, res) => {
  try {
    const tips = await Tip.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: tips });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Create a tip (admin only)
// @route   POST /api/tips
// @access  Private/Admin
router.post("/", protectAdmin, async (req, res) => {
  try {
    const tip = await Tip.create(req.body);
    res.status(201).json({ success: true, data: tip });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Update a tip (admin only)
// @route   PUT /api/tips/:id
// @access  Private/Admin
router.put("/:id", protectAdmin, async (req, res) => {
  try {
    const tip = await Tip.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    res.status(200).json({ success: true, data: tip });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Delete a tip (admin only)
// @route   DELETE /api/tips/:id
// @access  Private/Admin
router.delete("/:id", protectAdmin, async (req, res) => {
  try {
    await Tip.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: "Tip deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
