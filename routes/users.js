const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { protectUser } = require("../middleware/authUser");
const {
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendOTPEmail,
} = require("../services/emailService");
const { OAuth2Client } = require("google-auth-library");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Helper: generate JWT token
const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });

// ─────────────────────────────────────────────
// POST /api/users/register
// Public — create new patient account (Screen 2)
// ─────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Full name, email and password are required.",
      });
    }

    // Validate email format strictly
    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const atSymbolCount = (cleanEmail.match(/@/g) || []).length;

    if (!emailRegex.test(cleanEmail) || atSymbolCount !== 1) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 15 * 60 * 1000; // 15 minutes

    const user = await User.create({
      fullName,
      email: cleanEmail,
      password,
      role: role || "Patient",
      otpCode,
      otpExpires,
      isVerified: false,
    });

    // Send OTP email - Await to ensure it's sent before responding
    try {
      await sendOTPEmail({ to: cleanEmail, name: fullName, otpCode });
    } catch (err) {
      console.error("OTP email failed:", err.message);
    }

    res.status(201).json({
      success: true,
      message:
        "Account created. Please verify with the 6-digit code sent to your email.",
      email: user.email,
      redirectTo: "./verify-otp.html",
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// POST /api/users/login
// Public — patient login (Screen 3)
// ─────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    // Explicitly select password (it's excluded by default)
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password",
    );

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password.",
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "This account has been deactivated.",
      });
    }

    if (!user.isVerified) {
      // Automatically generate and send a new OTP
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpires = Date.now() + 15 * 60 * 1000;

      user.otpCode = otpCode;
      user.otpExpires = otpExpires;
      await user.save();

      try {
        await sendOTPEmail({ to: user.email, name: user.fullName, otpCode });
      } catch (err) {
        console.error("Auto-resend OTP email failed:", err.message);
      }

      return res.status(401).json({
        success: false,
        message:
          "Please verify your email before logging in. A new code has been sent.",
        email: user.email,
        isVerified: false,
        redirectTo: "./verify-otp.html",
      });
    }

    const loginToken = generateToken(user._id);

    // Auto-repair missing NovaBuk ID
    if (user.role === "Patient" && !user.novaBukId) {
      const random = Math.floor(1000 + Math.random() * 9000);
      user.novaBukId = `NB-${random}`;
      await user.save();
    }

    res.json({
      success: true,
      message: "Login successful.",
      token: loginToken,
      redirectTo:
        user.role === "Doctors"
          ? user.clinicId
            ? "./clinic-queue.html"
            : "./clinic-register.html"
          : "./app-home.html",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        profileComplete: user.profileComplete,
        isVerified: user.isVerified,
        clinicId: user.clinicId || null,
        clinicName: user.clinicName || "",
        novaBukId: user.novaBukId,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

router.get("/me", protectUser, async (req, res) => {
  try {
    // Auto-repair missing NovaBuk ID if needed
    if (req.user.role === "Patient" && !req.user.novaBukId) {
      const random = Math.floor(1000 + Math.random() * 9000);
      req.user.novaBukId = `NB-${random}`;
      await req.user.save();
    }

    res.json({
      success: true,
      user: {
        id: req.user._id,
        fullName: req.user.fullName,
        email: req.user.email,
        phone: req.user.phone,
        dateOfBirth: req.user.dateOfBirth,
        age: req.user.age,
        address: req.user.address,
        city: req.user.city,
        state: req.user.state,
        avatarUrl: req.user.avatarUrl,
        emergencyContact: req.user.emergencyContact,
        healthProfile: req.user.healthProfile,
        privacySettings: req.user.privacySettings,
        notificationSettings: req.user.notificationSettings,
        profileComplete: req.user.profileComplete,
        createdAt: req.user.createdAt,
        novaBukId: req.user.novaBukId,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// PUT /api/users/health-profile
// Protected — save/update health profile (Screen 4 & 10)
// ─────────────────────────────────────────────
router.put("/health-profile", protectUser, async (req, res) => {
  try {
    const {
      ageRange,
      gender,
      existingConditions,
      allergies,
      dateOfBirth,
      age,
    } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        healthProfile: { ageRange, gender, existingConditions, allergies },
        dateOfBirth: dateOfBirth || req.user.dateOfBirth,
        age: age || req.user.age,
        profileComplete: true, // mark onboarding done
      },
      { new: true, runValidators: true },
    );

    res.json({
      success: true,
      message: "Health profile saved.",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        healthProfile: user.healthProfile,
        profileComplete: user.profileComplete,
      },
    });
  } catch (error) {
    console.error("Health profile update error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// PUT /api/users/update
// Protected — update name or email (Screen 10)
// ─────────────────────────────────────────────
router.put("/update", protectUser, async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      dateOfBirth,
      address,
      city,
      state,
      avatarUrl,
      emergencyContact,
    } = req.body;
    const updates = {};
    if (fullName) updates.fullName = fullName;
    if (email) updates.email = email.toLowerCase();
    if (phone !== undefined) updates.phone = phone;
    if (dateOfBirth !== undefined) updates.dateOfBirth = dateOfBirth;
    if (address !== undefined) updates.address = address;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    if (emergencyContact !== undefined)
      updates.emergencyContact = emergencyContact;

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Profile updated.",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        healthProfile: user.healthProfile,
        profileComplete: user.profileComplete,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// PUT /api/users/change-password
// Protected — change password (Screen 10)
// ─────────────────────────────────────────────
router.put("/change-password", protectUser, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current and new password are required.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters.",
      });
    }

    const user = await User.findById(req.user._id).select("+password");

    if (!(await user.comparePassword(currentPassword))) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: "Password changed successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// POST /api/users/forgot-password
// Public — request a password reset email
// ─────────────────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Always respond with success — don't reveal if email exists
    if (!user) {
      return res.json({
        success: true,
        message:
          "If an account with that email exists, a reset link has been sent.",
      });
    }

    // Generate a secure random token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash it before storing (never store raw tokens in DB)
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save({ validateBeforeSave: false });

    // Build reset URL — frontend will handle this page
    let finalFrontend = process.env.FRONTEND_URL || "https://www.novabuk.com";
    if (
      finalFrontend.includes("vercel.app") ||
      finalFrontend.includes("novabukrepo")
    ) {
      finalFrontend = "https://www.novabuk.com";
    }
    const resetUrl = `${finalFrontend}/reset-password.html?token=${resetToken}`;
    console.log("🔑 [DEV] Password Reset URL:", resetUrl);

    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.fullName,
        resetUrl,
      });

      res.json({
        success: true,
        message:
          "If an account with that email exists, a reset link has been sent.",
      });
    } catch (emailError) {
      // If email fails, clear the token so user can try again
      user.passwordResetToken = null;
      user.passwordResetExpires = null;
      await user.save({ validateBeforeSave: false });

      console.error("Reset email failed:", emailError.message);
      res.status(500).json({
        success: false,
        message: "Failed to send reset email. Please try again.",
      });
    }
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// POST /api/users/reset-password/:token
// Public — set new password using reset token
// ─────────────────────────────────────────────
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    // Hash the incoming token to compare with stored hash
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    // Find user with valid (non-expired) token
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "Reset link is invalid or has expired. Please request a new one.",
      });
    }

    // Set new password and clear reset token
    user.password = password;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    res.json({
      success: true,
      message: "Password reset successfully. You can now log in.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// POST /api/users/verify-otp
// Public — verify email with 6-digit code
// ─────────────────────────────────────────────
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otpCode } = req.body;

    if (!email || !otpCode) {
      return res
        .status(400)
        .json({ success: false, message: "Email and code are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    // Safety net: If already verified (e.g. from a different tab), just log them in
    if (user.isVerified) {
      const token = generateToken(user._id);
      return res.json({
        success: true,
        message: "Account already verified. Logging you in...",
        token,
        redirectTo:
          user.role === "Doctors"
            ? user.clinicId
              ? "./clinic-queue.html"
              : "./clinic-register.html"
            : "./app-home.html",
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          avatarUrl: user.avatarUrl,
          profileComplete: user.profileComplete,
          isVerified: true,
          clinicId: user.clinicId || null,
          clinicName: user.clinicName || "",
        },
      });
    }

    // Check if code matches and hasn't expired
    if (user.otpCode !== otpCode || user.otpExpires < Date.now()) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Invalid or expired verification code.",
        });
    }

    user.isVerified = true;
    user.otpCode = null;
    user.otpExpires = null;
    await user.save();

    // Now send the welcome email
    sendWelcomeEmail({
      to: user.email,
      name: user.fullName,
      novaBukId: user.novaBukId,
    }).catch(() => {});

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: "Email verified successfully!",
      token,
      redirectTo:
        user.role === "Doctors"
          ? user.clinicId
            ? "./clinic-queue.html"
            : "./clinic-register.html"
          : "./app-home.html",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        profileComplete: user.profileComplete,
        isVerified: user.isVerified,
        clinicId: user.clinicId || null,
        clinicName: user.clinicName || "",
      },
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// POST /api/users/google-login
// Public — Social Login Fast-track (Verified)
// ─────────────────────────────────────────────
router.post("/google-login", async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res
        .status(400)
        .json({ success: false, message: "Google token is required." });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res
        .status(500)
        .json({
          success: false,
          message: "Google sign-in is not configured on the server.",
        });
    }

    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const {
      sub: googleId,
      email,
      name: fullName,
      picture: avatarUrl,
    } = payload;

    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email not provided by Google." });
    }

    let user = await User.findOne({
      $or: [{ googleId }, { email: email.toLowerCase() }],
    });

    if (!user) {
      user = await User.create({
        googleId,
        email: email.toLowerCase(),
        password: crypto.randomBytes(16).toString("hex"),
        fullName: fullName || "NovaBuk Patient",
        avatarUrl: avatarUrl || "",
        isVerified: true,
        profileComplete: false,
      });
      sendWelcomeEmail({
        to: user.email,
        name: user.fullName,
        novaBukId: user.novaBukId,
      }).catch(() => {});
    } else {
      let updated = false;
      if (!user.googleId) {
        user.googleId = googleId;
        updated = true;
      }
      if (!user.isVerified) {
        user.isVerified = true;
        updated = true;
      }
      if (!user.avatarUrl && avatarUrl) {
        user.avatarUrl = avatarUrl;
        updated = true;
      }

      if (updated) await user.save();
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      redirectTo:
        user.role === "Doctors"
          ? user.clinicId
            ? "./clinic-queue.html"
            : "./clinic-register.html"
          : "./app-home.html",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        profileComplete: user.profileComplete,
        isVerified: user.isVerified,
        clinicId: user.clinicId || null,
        clinicName: user.clinicName || "",
        novaBukId: user.novaBukId,
      },
    });
  } catch (error) {
    console.error("Google login error:", error?.message || error);

    let userMessage = "Invalid Google token. Please try again.";
    if (error?.message?.includes("Token used too late")) {
      userMessage = "Google session expired. Please sign in again.";
    } else if (error?.message?.includes("Invalid audience")) {
      userMessage = "Google configuration error. Please contact support.";
      console.error(
        "❌ GOOGLE AUDIENCE MISMATCH — check GOOGLE_CLIENT_ID in .env matches the client_id in the frontend",
      );
    } else if (error?.message?.includes("clock")) {
      userMessage = "Server time mismatch. Please try again in a moment.";
    }

    res.status(401).json({ success: false, message: userMessage });
  }
});

// ─────────────────────────────────────────────
// POST /api/users/google-login-code
// Public — Social Login via Popup (Code Flow)
// ─────────────────────────────────────────────
router.post("/google-login-code", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code)
      return res
        .status(400)
        .json({ success: false, message: "Auth code is required." });

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res
        .status(500)
        .json({
          success: false,
          message: "Google sign-in is not configured on the server.",
        });
    }

    const { tokens } = await client.getToken({
      code,
      redirect_uri: "postmessage",
    });

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const {
      sub: googleId,
      email,
      name: fullName,
      picture: avatarUrl,
    } = payload;

    let user = await User.findOne({
      $or: [{ googleId }, { email: email.toLowerCase() }],
    });

    if (!user) {
      user = await User.create({
        googleId,
        email: email.toLowerCase(),
        password: crypto.randomBytes(16).toString("hex"),
        fullName: fullName || "NovaBuk Patient",
        avatarUrl: avatarUrl || "",
        isVerified: true,
        profileComplete: false,
      });
      sendWelcomeEmail({
        to: user.email,
        name: user.fullName,
        novaBukId: user.novaBukId,
      }).catch(() => {});
    } else {
      let updated = false;
      if (!user.googleId) {
        user.googleId = googleId;
        updated = true;
      }
      if (!user.isVerified) {
        user.isVerified = true;
        updated = true;
      }
      if (updated) await user.save();
    }

    const token = generateToken(user._id);
    res.json({
      success: true,
      token,
      redirectTo:
        user.role === "Doctors"
          ? user.clinicId
            ? "./clinic-queue.html"
            : "./clinic-register.html"
          : "./app-home.html",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        profileComplete: user.profileComplete,
        isVerified: user.isVerified,
        novaBukId: user.novaBukId,
      },
    });
  } catch (error) {
    console.error("Google code login error:", error?.message || error);
    res
      .status(401)
      .json({
        success: false,
        message: "Google authentication failed. Please try again.",
      });
  }
});

// ─────────────────────────────────────────────
// POST /api/users/resend-otp
// Public — resend verification code
// ─────────────────────────────────────────────
router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email is required." });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal if user exists for security, but we know they exist if they are on the OTP page
      return res.json({
        success: true,
        message: "If an account exists, a new code has been sent.",
      });
    }

    if (user.isVerified) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Account already verified. Please log in.",
        });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 15 * 60 * 1000;

    user.otpCode = otpCode;
    user.otpExpires = otpExpires;
    await user.save();

    await sendOTPEmail({ to: user.email, name: user.fullName, otpCode });

    res.json({ success: true, message: "New verification code sent!" });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/users/settings
// Protected — get all settings in one call
// (privacy + notifications + profile)
// ─────────────────────────────────────────────
router.get("/settings", protectUser, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        profile: {
          fullName: req.user.fullName,
          email: req.user.email,
          phone: req.user.phone,
          dateOfBirth: req.user.dateOfBirth,
          age: req.user.age,
          address: req.user.address,
          city: req.user.city,
          state: req.user.state,
          avatarUrl: req.user.avatarUrl,
          emergencyContact: req.user.emergencyContact,
          healthProfile: req.user.healthProfile,
          profileComplete: req.user.profileComplete,
          novaBukId: req.user.novaBukId,
        },
        privacySettings: req.user.privacySettings,
        notificationSettings: req.user.notificationSettings,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// PUT /api/users/profile
// Protected — save ALL profile data in one call
// (personal info + health profile + emergency contact + avatar)
// ─────────────────────────────────────────────
router.put("/profile", protectUser, async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      dateOfBirth,
      age,
      address,
      city,
      state,
      avatarUrl,
      emergencyContact,
      // health profile fields
      ageRange,
      gender,
      existingConditions,
      allergies,
    } = req.body;
    const baseVersion = req.header("X-Base-Version");

    // ── CONFLICT GUARD ─────────────────────────────────────────
    if (baseVersion && req.user.updatedAt) {
      const clientTime = new Date(baseVersion).getTime();
      const serverTime = new Date(req.user.updatedAt).getTime();
      if (serverTime > clientTime + 1000) {
        return res.status(409).json({
          success: false,
          message:
            "CONFLICT: Your profile was updated on another device. Please refresh to load the latest info.",
          conflict: true,
        });
      }
    }

    // Build personal info updates
    const updates = {};
    if (fullName) updates.fullName = fullName;
    if (email) updates.email = email.toLowerCase();
    if (phone !== undefined) updates.phone = phone;
    if (dateOfBirth !== undefined) updates.dateOfBirth = dateOfBirth;
    if (age !== undefined) updates.age = age;
    if (address !== undefined) updates.address = address;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
    if (emergencyContact !== undefined)
      updates.emergencyContact = emergencyContact;

    // Always update health profile fields if any were sent
    const hasHealthData =
      ageRange !== undefined ||
      gender !== undefined ||
      existingConditions !== undefined ||
      allergies !== undefined;
    if (hasHealthData) {
      // Fetch existing health profile to avoid wiping fields not sent
      const current = await User.findById(req.user._id);
      const hp = current.healthProfile || {};
      updates.healthProfile = {
        ageRange: ageRange !== undefined ? ageRange : hp.ageRange,
        gender: gender !== undefined ? gender : hp.gender,
        existingConditions:
          existingConditions !== undefined
            ? existingConditions
            : hp.existingConditions,
        allergies: allergies !== undefined ? allergies : hp.allergies,
      };
      updates.profileComplete = true;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Profile saved successfully.",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        healthProfile: user.healthProfile,
        profileComplete: user.profileComplete,
      },
    });
  } catch (error) {
    console.error("Unified profile save error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// PUT /api/users/privacy-settings
// Protected — update privacy settings toggles
// (Figma — Privacy Settings screen)
// ─────────────────────────────────────────────
router.put("/privacy-settings", protectUser, async (req, res) => {
  try {
    const {
      shareDataWithProviders,
      marketingCommunications,
      dataAnalytics,
      thirdPartyDataSharing,
      profileVisibility,
    } = req.body;

    // Build update object — only update fields that were sent
    const updates = {};
    if (shareDataWithProviders !== undefined)
      updates["privacySettings.shareDataWithProviders"] =
        shareDataWithProviders;
    if (marketingCommunications !== undefined)
      updates["privacySettings.marketingCommunications"] =
        marketingCommunications;
    if (dataAnalytics !== undefined)
      updates["privacySettings.dataAnalytics"] = dataAnalytics;
    if (thirdPartyDataSharing !== undefined)
      updates["privacySettings.thirdPartyDataSharing"] = thirdPartyDataSharing;
    if (profileVisibility !== undefined)
      updates["privacySettings.profileVisibility"] = profileVisibility;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true },
    );

    res.json({
      success: true,
      message: "Privacy settings updated.",
      data: user.privacySettings,
    });
  } catch (error) {
    console.error("Privacy settings error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// PUT /api/users/notification-settings
// Protected — update notification preferences
// (Figma — Notification Settings screen)
// ─────────────────────────────────────────────
router.put("/notification-settings", protectUser, async (req, res) => {
  try {
    const {
      appointmentReminders,
      healthTips,
      clinicUpdates,
      visitStatusUpdates,
      smsNotifications,
      emailNotifications,
    } = req.body;

    // Build update object — only update fields that were sent
    const updates = {};
    if (appointmentReminders !== undefined)
      updates["notificationSettings.appointmentReminders"] =
        appointmentReminders;
    if (healthTips !== undefined)
      updates["notificationSettings.healthTips"] = healthTips;
    if (clinicUpdates !== undefined)
      updates["notificationSettings.clinicUpdates"] = clinicUpdates;
    if (visitStatusUpdates !== undefined)
      updates["notificationSettings.visitStatusUpdates"] = visitStatusUpdates;
    if (smsNotifications !== undefined)
      updates["notificationSettings.smsNotifications"] = smsNotifications;
    if (emailNotifications !== undefined)
      updates["notificationSettings.emailNotifications"] = emailNotifications;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true },
    );

    res.json({
      success: true,
      message: "Notification settings updated.",
      data: user.notificationSettings,
    });
  } catch (error) {
    console.error("Notification settings error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/users/account
// Protected — deactivate account (soft delete)
// ─────────────────────────────────────────────
router.delete("/account", protectUser, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { isActive: false });
    res.json({
      success: true,
      message: "Account deactivated successfully.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// Admin: Get total count (patient count)
const { protectAdmin } = require("../middleware/auth");
router.get("/admin/count", protectAdmin, async (req, res) => {
  try {
    const count = await User.countDocuments({ role: "Patient" });
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Admin: Get all users (patient list)
router.get("/admin/all", protectAdmin, async (req, res) => {
  try {
    const users = await User.find({ role: "Patient" }).sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Admin: Toggle user status
router.patch("/admin/:id/toggle", protectAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      success: true,
      message: `User ${user.isActive ? "activated" : "deactivated"}`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Admin: Generate missing NovaBuk IDs
router.post("/admin/generate-ids", protectAdmin, async (req, res) => {
  try {
    const users = await User.find({
      role: "Patient",
      novaBukId: { $exists: false },
    });
    let count = 0;

    for (const user of users) {
      if (!user.novaBukId) {
        const random = Math.floor(1000 + Math.random() * 9000);
        user.novaBukId = `NB-${random}`;
        await user.save();
        count++;
      }
    }

    res.json({
      success: true,
      message: `Successfully generated IDs for ${count} users.`,
    });
  } catch (error) {
    console.error("ID Generation Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error during ID generation." });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/users/fcm-token
// Save the patient's device push token (Feature 2 — Appointment &
// Medication Reminders). Called from the frontend once the patient
// grants notification permission and Firebase hands back a token.
// ─────────────────────────────────────────────
router.patch("/fcm-token", protectUser, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ success: false, message: "fcmToken is required." });
    }
    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    res.json({ success: true, message: "Push notifications enabled." });
  } catch (error) {
    console.error("Save FCM token error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/users/google-calendar/connect
// Returns the Google OAuth consent URL for the patient to visit.
// This is a SEPARATE OAuth client from the "Sign in with Google"
// login flow above (GOOGLE_CLIENT_ID) — this one is
// GOOGLE_CALENDAR_CLIENT_ID, scoped to Calendar access, not identity.
//
// `state` carries the user's ID as a short-lived signed JWT, since
// Google's redirect back to our callback is a plain browser
// navigation — it can't carry an Authorization header, so we can't
// use protectUser on the callback route itself. Signing the state
// prevents someone from forging a callback for a different user.
// ─────────────────────────────────────────────
router.get("/google-calendar/connect", protectUser, async (req, res) => {
  try {
    const state = jwt.sign({ userId: req.user._id.toString() }, process.env.JWT_SECRET, {
      expiresIn: "10m",
    });

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID,
      redirect_uri: process.env.GOOGLE_CALENDAR_REDIRECT_URI, // e.g. https://www.novabuk.com/api/users/google-calendar/callback
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events",
      access_type: "offline", // required to receive a refresh_token
      prompt: "consent", // forces a refresh_token even on repeat connections
      state,
    });

    const consentUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.json({ success: true, url: consentUrl });
  } catch (error) {
    console.error("Google Calendar connect error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/users/google-calendar/callback
// Google redirects here after the patient approves/denies consent.
// NOT behind protectUser — see note above. Identifies the user via
// the signed `state` param instead.
// ─────────────────────────────────────────────
router.get("/google-calendar/callback", async (req, res) => {
  const FRONTEND_SETTINGS_URL = `${process.env.FRONTEND_URL || "https://www.novabuk.com"}/app-setting.html?tab=notification`;

  try {
    const { code, state, error: googleError } = req.query;

    if (googleError) {
      // Patient clicked "Deny" on Google's consent screen
      return res.redirect(`${FRONTEND_SETTINGS_URL}&calendar=denied`);
    }

    if (!code || !state) {
      return res.redirect(`${FRONTEND_SETTINGS_URL}&calendar=error`);
    }

    let decoded;
    try {
      decoded = jwt.verify(state, process.env.JWT_SECRET);
    } catch (err) {
      return res.redirect(`${FRONTEND_SETTINGS_URL}&calendar=invalid_state`);
    }

    const { exchangeGoogleAuthCode } = require("../services/reminderService");
    const { accessToken, refreshToken } = await exchangeGoogleAuthCode(code);

    await User.findByIdAndUpdate(decoded.userId, {
      "googleCalendar.accessToken": accessToken,
      "googleCalendar.refreshToken": refreshToken,
      "googleCalendar.connected": true,
    });

    return res.redirect(`${FRONTEND_SETTINGS_URL}&calendar=connected`);
  } catch (error) {
    console.error("Google Calendar callback error:", error);
    return res.redirect(`${FRONTEND_SETTINGS_URL}&calendar=error`);
  }
});

// ─────────────────────────────────────────────
// DELETE /api/users/google-calendar/disconnect
// ─────────────────────────────────────────────
router.delete("/google-calendar/disconnect", protectUser, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      "googleCalendar.accessToken": null,
      "googleCalendar.refreshToken": null,
      "googleCalendar.connected": false,
    });
    res.json({ success: true, message: "Google Calendar disconnected." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

module.exports = router;

// ─────────────────────────────────────────────
// POST /api/users/logout
// ─────────────────────────────────────────────
router.post("/logout", (req, res) => {
  res.clearCookie("novabuk_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
  res.json({ success: true, message: "Logged out." });
});

module.exports = router;