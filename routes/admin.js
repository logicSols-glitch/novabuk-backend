const express = require("express");
const router = express.Router();
const {
  login,
  register,
  getMe,
  updateProfile,
  changePassword,
} = require("../controllers/adminController");
const { protect, authorize } = require("../middleware/auth");

// Public routes
router.post("/login", login);
router.post("/register", register);

// Protected routes
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);
router.put("/change-password", protect, changePassword);

module.exports = router;
