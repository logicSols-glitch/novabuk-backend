const express     = require("express");
const router      = express.Router();
const jwt         = require("jsonwebtoken");
const ClinicStaff = require("../models/ClinicStaff");
const Clinic      = require("../models/Clinic");
const { protectClinic }  = require("../middleware/authClinic");
const { protectAdmin }   = require("../middleware/auth");

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

module.exports = router;