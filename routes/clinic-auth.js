const express     = require("express");
const router      = express.Router();
const jwt         = require("jsonwebtoken");
const crypto      = require("crypto");
const ClinicStaff = require("../models/ClinicStaff");
const { sendPasswordResetEmail } = require("../services/emailService");
const Clinic      = require("../models/Clinic");
const { protectClinic }  = require("../middleware/authClinic");
const { protectAdmin }   = require("../middleware/auth");
const { protectClinicPortal } = require("../middleware/protectClinicPortal");
const { requireRole } = require("../middleware/requireRole");

// Helper — generate JWT
const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });

// Helper — set the HttpOnly cookie on the response
const setClinicCookie = (res, token) => {
  res.cookie("novabuk_clinic_token", token, {
    httpOnly: true,                    // JS cannot read this — XSS protection
    secure:   process.env.NODE_ENV === "production",  // HTTPS only in prod
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    // "none" required for cross-origin (Vercel frontend → Render backend)
    // "lax" for local dev (same origin)
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
  });
};

// ─────────────────────────────────────────────────────────────
// POST /api/clinic-auth/login
// Public — clinic staff sign in
// Body: { email, password }
// ─────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    // Find staff — must select password because it's excluded by default
    const staff = await ClinicStaff.findOne({ email: email.toLowerCase() })
      .select("+password")
      .populate("clinic", "name location isOpen isActive");

    if (!staff) {
      // Return same message for wrong email or wrong password
      // Never reveal which one — security best practice
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password.",
      });
    }

    const passwordMatch = await staff.comparePassword(password);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password.",
      });
    }

    if (!staff.isActive) {
      return res.status(401).json({
        success: false,
        message: "This account has been deactivated. Contact your clinic admin.",
      });
    }

    // Powers the "Last active" column in the staff table (clinic-settings.html)
    staff.lastLoginAt = new Date();
    await staff.save({ validateBeforeSave: false });

    const token = generateToken(staff._id);

    // Set cookie — staff never see or store this token themselves
    setClinicCookie(res, token);

    res.json({
      success: true,
      // We still return the token in the body so clinic-shared.js
      // can store it in localStorage as a fallback for Authorization header
      token,
      staff: {
        id:       staff._id,
        fullName: staff.fullName,
        email:    staff.email,
        role:     staff.role,
        clinic: {
          id:   staff.clinic._id,
          name: staff.clinic.name,
        },
      },
    });
  } catch (error) {
    console.error("Clinic login error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/clinic-auth/logout
// Protected — clears the cookie
// ─────────────────────────────────────────────────────────────
router.post("/logout", (req, res) => {
  res.clearCookie("novabuk_clinic_token", {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
  res.json({ success: true, message: "Logged out." });
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic-auth/me
// Protected (clinic staff) — returns current staff profile
// Used by clinic-shared.js on page load to verify session
// ─────────────────────────────────────────────────────────────
router.get("/me", protectClinic, (req, res) => {
  res.json({
    success: true,
    staff: {
      id:       req.staff._id,
      fullName: req.staff.fullName,
      email:    req.staff.email,
      role:     req.staff.role,
      clinic: {
        id:   req.staff.clinic._id,
        name: req.staff.clinic.name,
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/clinic-auth/register-staff
// Protected (system admin only) — create a clinic staff account
// This is how doctors/nurses get accounts — no self-signup
// Body: { clinicId, fullName, email, password, role }
// ─────────────────────────────────────────────────────────────
router.post("/register-staff", protectAdmin, async (req, res) => {
  try {
    const { clinicId, fullName, email, password, role } = req.body;

    if (!clinicId || !fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "clinicId, fullName, email and password are all required.",
      });
    }

    // Verify the clinic exists
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: "Clinic not found.",
      });
    }

    // Check for duplicate email
    const existing = await ClinicStaff.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "A staff account with this email already exists.",
      });
    }

    const staff = await ClinicStaff.create({
      clinic:   clinicId,
      fullName,
      email,
      password,
      role:     role || "doctor",
    });

    res.status(201).json({
      success: true,
      message: "Staff account created successfully.",
      staff: {
        id:       staff._id,
        fullName: staff.fullName,
        email:    staff.email,
        role:     staff.role,
        clinic:   clinicId,
      },
    });
  } catch (error) {
    console.error("Register staff error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic-auth/staff
// Protected (system admin only) — list all clinic staff
// Used by the super admin dashboard
// ─────────────────────────────────────────────────────────────
router.get("/staff", protectAdmin, async (req, res) => {
  try {
    const staff = await ClinicStaff.find()
      .populate("clinic", "name")
      .sort({ createdAt: -1 })
      .select("-password");

    res.json({
      success: true,
      count:   staff.length,
      data:    staff,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/clinic-auth/forgot-password
// Public — staff request password reset
// ─────────────────────────────────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const staff = await ClinicStaff.findOne({ email: email.toLowerCase() });

    // For security, always return success message even if staff not found
    if (!staff) {
      return res.status(200).json({
        success: true,
        message: "If an account with that email exists, a reset link has been sent.",
      });
    }

    // Generate token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

    staff.passwordResetToken = hashedToken;
    staff.passwordResetExpires = Date.now() + 3600000; // 1 hour
    await staff.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.FRONTEND_URL}/clinic-reset-password.html?token=${resetToken}`;
    console.log("🔑 [DEV] Clinic Staff Password Reset URL:", resetUrl);

    try {
      await sendPasswordResetEmail({
        to: staff.email,
        name: staff.fullName,
        resetUrl,
      });

      res.status(200).json({
        success: true,
        message: "If an account with that email exists, a reset link has been sent.",
      });
    } catch (err) {
      staff.passwordResetToken = undefined;
      staff.passwordResetExpires = undefined;
      await staff.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: "Email could not be sent" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/clinic-auth/reset-password/:token
// Public — staff set new password
// ─────────────────────────────────────────────────────────────
router.post("/reset-password/:token", async (req, res) => {
  try {
    const hashedToken = crypto.createHash("sha256").update(req.params.token).digest("hex");

    console.log("🔍 [DEV] Clinic Reset Attempt - Token:", req.params.token);
    console.log("🔍 [DEV] Clinic Reset Attempt - Hash:", hashedToken);

    const staff = await ClinicStaff.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!staff) {
      const expiredStaff = await ClinicStaff.findOne({ passwordResetToken: hashedToken });
      if (expiredStaff) {
        console.log("❌ [DEV] Clinic Token found but EXPIRED.");
        return res.status(400).json({ success: false, message: "Reset link has expired" });
      }
      console.log("❌ [DEV] No staff found with that token.");
      return res.status(400).json({ success: false, message: "Invalid or expired token" });
    }

    staff.password = req.body.password;
    staff.passwordResetToken = undefined;
    staff.passwordResetExpires = undefined;
    await staff.save();

    res.status(200).json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/clinic-auth/my-staff
// Protected (Clinic Doctor) — list all staff in doctor's clinic
// ─────────────────────────────────────────────────────────────
router.get("/my-staff", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    if (!req.actor.clinicId) {
      return res.status(400).json({
        success: false,
        message: "No clinic linked to your account.",
      });
    }

    const staff = await ClinicStaff.find({ clinic: req.actor.clinicId })
      .sort({ createdAt: -1 })
      .select("-password");

    res.json({
      success: true,
      count: staff.length,
      data: staff,
    });
  } catch (error) {
    console.error("Fetch staff error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/clinic-auth/my-staff
// Protected (Clinic Doctor) — create staff for doctor's clinic (Requires Pro subscription)
// ─────────────────────────────────────────────────────────────
router.post("/my-staff", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    if (!req.actor.clinicId) {
      return res.status(400).json({
        success: false,
        message: "No clinic linked to your account.",
      });
    }

    const clinic = await Clinic.findById(req.actor.clinicId);
    if (!clinic) {
      return res.status(404).json({
        success: false,
        message: "Clinic not found.",
      });
    }

    const { fullName, email, password, role } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "fullName, email and password are required.",
      });
    }

    // Growth plan: capped at clinic.seatLimits.doctor doctors and
    // clinic.seatLimits.receptionist receptionists — no pharmacist/lab_tech/
    // extra nurse seats at all. Pro/Enterprise: no cap enforced here.
    const { checkSeatLimit } = require("../middleware/requireRole");
    const seatCheck = await checkSeatLimit(clinic, role || "nurse");
    if (!seatCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: seatCheck.message,
      });
    }

    // Check if staff email already exists
    const existing = await ClinicStaff.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "A staff account with this email already exists.",
      });
    }

    const newStaff = await ClinicStaff.create({
      clinic: req.actor.clinicId,
      fullName,
      email: email.toLowerCase(),
      password,
      role: role || "nurse",
    });

    res.status(201).json({
      success: true,
      message: "Staff member added successfully.",
      staff: {
        id: newStaff._id,
        fullName: newStaff.fullName,
        email: newStaff.email,
        role: newStaff.role,
      },
    });
  } catch (error) {
    console.error("Create staff error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/clinic-auth/my-staff/:id
// Protected (Clinic Doctor) — remove staff from doctor's clinic
// ─────────────────────────────────────────────────────────────
router.delete("/my-staff/:id", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    if (!req.actor.clinicId) {
      return res.status(400).json({
        success: false,
        message: "No clinic linked to your account.",
      });
    }

    const staff = await ClinicStaff.findById(req.params.id);
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff member not found.",
      });
    }

    // Verify staff member belongs to the same clinic
    if (staff.clinic.toString() !== req.actor.clinicId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only delete staff members belonging to your clinic.",
      });
    }

    await ClinicStaff.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Staff member removed successfully.",
    });
  } catch (error) {
    console.error("Delete staff error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/clinic-auth/my-staff/:id
// Edit an existing staff member's role (or active status).
// Same access as add/remove: owner or delegated ClinicStaff "admin" only.
// ─────────────────────────────────────────────
router.patch("/my-staff/:id", protectClinicPortal, requireRole(), async (req, res) => {
  try {
    if (!req.actor.clinicId) {
      return res.status(400).json({
        success: false,
        message: "No clinic linked to your account.",
      });
    }

    const staff = await ClinicStaff.findById(req.params.id);
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff member not found.",
      });
    }

    if (staff.clinic.toString() !== req.actor.clinicId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only edit staff members belonging to your clinic.",
      });
    }

    const { role, isActive } = req.body;

    // If the role is actually changing, re-run the same seat-limit check
    // used at creation — e.g. don't let someone get promoted to "doctor"
    // on a Growth plan that's already at its 2-doctor cap.
    if (role && role !== staff.role) {
      const clinic = await Clinic.findById(req.actor.clinicId);
      const { checkSeatLimit } = require("../middleware/requireRole");
      const seatCheck = await checkSeatLimit(clinic, role);
      if (!seatCheck.allowed) {
        return res.status(403).json({
          success: false,
          message: seatCheck.message,
        });
      }
      staff.role = role;
    }

    if (typeof isActive === "boolean") {
      staff.isActive = isActive;
    }

    await staff.save();

    res.json({
      success: true,
      message: "Staff member updated successfully.",
      data: {
        id: staff._id,
        fullName: staff.fullName,
        email: staff.email,
        role: staff.role,
        isActive: staff.isActive,
      },
    });
  } catch (error) {
    console.error("Update staff error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;