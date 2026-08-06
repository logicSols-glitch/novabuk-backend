const express = require("express");
const router = express.Router();
const {
  login,
  register,
  createAdmin,
  listAdmins,
  deleteAdmin,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
} = require("../controllers/adminController");
const { protect, authorize } = require("../middleware/auth");

// Public routes
router.post("/login", login);
router.post("/register", register);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);

// Protected routes
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);
router.put("/change-password", protect, changePassword);

// Admin-only: manage additional admin/editor accounts now that public
// self-registration is locked to "first admin only"
router.get("/all", protect, authorize("admin"), listAdmins);
router.post("/create", protect, authorize("admin"), createAdmin);

// MUST come last — /:id is a catch-all param route, everything above
// is a literal path that needs to be matched first.
router.delete("/:id", protect, authorize("admin"), deleteAdmin);

module.exports = router;