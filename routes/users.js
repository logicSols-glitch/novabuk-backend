const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { protectUser } = require("../middleware/authUser");
const { sendPasswordResetEmail, sendWelcomeEmail } = require("../services/emailService");

// Helper: generate JWT token
const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });

// ─────────────────────────────────────────────
// POST /api/users/register
// Public — create new patient account (Screen 2)
// ─────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Full name, email and password are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters.",
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const user = await User.create({ fullName, email, password });

    // Send welcome email (non-blocking — don't fail registration if email fails)
    sendWelcomeEmail({ to: email, name: fullName }).catch((err) =>
      console.error("Welcome email failed:", err.message)
    );

    res.status(201).json({
      success: true,
      message: "Account created successfully.",
      token: generateToken(user._id),
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        profileComplete: user.profileComplete,
      },
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
      "+password"
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

    res.json({
      success: true,
      message: "Login successful.",
      token: generateToken(user._id),
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        profileComplete: user.profileComplete,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// ─────────────────────────────────────────────
// GET /api/users/me
// Protected — get current user's full profile
// ─────────────────────────────────────────────
router.get("/me", protectUser, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user._id,
        fullName: req.user.fullName,
        email: req.user.email,
        phone: req.user.phone,
        dateOfBirth: req.user.dateOfBirth,
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
    const { ageRange, gender, existingConditions, allergies } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        healthProfile: { ageRange, gender, existingConditions, allergies },
        profileComplete: true, // mark onboarding done
      },
      { new: true, runValidators: true }
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
    const { fullName, email, phone, dateOfBirth, address, city, state, avatarUrl, emergencyContact } = req.body;
    const updates = {};
    if (fullName)         updates.fullName = fullName;
    if (email)            updates.email    = email.toLowerCase();
    if (phone       !== undefined) updates.phone       = phone;
    if (dateOfBirth !== undefined) updates.dateOfBirth = dateOfBirth;
    if (address     !== undefined) updates.address     = address;
    if (city        !== undefined) updates.city        = city;
    if (state       !== undefined) updates.state       = state;
    if (avatarUrl   !== undefined) updates.avatarUrl   = avatarUrl;
    if (emergencyContact !== undefined) updates.emergencyContact = emergencyContact;

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
        message: "If an account with that email exists, a reset link has been sent.",
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
   const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;

    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.fullName,
        resetUrl,
      });

      res.json({
        success: true,
        message: "If an account with that email exists, a reset link has been sent.",
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
        message: "Reset link is invalid or has expired. Please request a new one.",
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
          address: req.user.address,
          city: req.user.city,
          state: req.user.state,
          avatarUrl: req.user.avatarUrl,
          emergencyContact: req.user.emergencyContact,
          healthProfile: req.user.healthProfile,
          profileComplete: req.user.profileComplete,
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
    if (shareDataWithProviders  !== undefined) updates["privacySettings.shareDataWithProviders"]  = shareDataWithProviders;
    if (marketingCommunications !== undefined) updates["privacySettings.marketingCommunications"] = marketingCommunications;
    if (dataAnalytics           !== undefined) updates["privacySettings.dataAnalytics"]           = dataAnalytics;
    if (thirdPartyDataSharing   !== undefined) updates["privacySettings.thirdPartyDataSharing"]   = thirdPartyDataSharing;
    if (profileVisibility       !== undefined) updates["privacySettings.profileVisibility"]       = profileVisibility;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
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
    if (appointmentReminders !== undefined) updates["notificationSettings.appointmentReminders"] = appointmentReminders;
    if (healthTips           !== undefined) updates["notificationSettings.healthTips"]           = healthTips;
    if (clinicUpdates        !== undefined) updates["notificationSettings.clinicUpdates"]        = clinicUpdates;
    if (visitStatusUpdates   !== undefined) updates["notificationSettings.visitStatusUpdates"]   = visitStatusUpdates;
    if (smsNotifications     !== undefined) updates["notificationSettings.smsNotifications"]     = smsNotifications;
    if (emailNotifications   !== undefined) updates["notificationSettings.emailNotifications"]   = emailNotifications;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
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


module.exports = router;