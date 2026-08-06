const Admin = require("../models/Admin");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sendPasswordResetEmail } = require("../services/emailService");

// Generate JWT Token
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

// @desc    Admin Login
// @route   POST /api/admin/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Please provide email and password" });
    }

    // Check for user
    const admin = await Admin.findOne({ email }).select("+password");

    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    // Check if password matches
    const isMatch = await admin.matchPassword(password);

    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const token = generateToken(admin._id, admin.role);

    res.status(200).json({
      success: true,
      token,
      admin: {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get current logged in admin
// @route   GET /api/admin/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user.id);

    res.status(200).json({
      success: true,
      data: admin,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create admin user (only 1st admin during setup)
// @route   POST /api/admin/register
// @access  Public (only if no admin exists)
exports.register = async (req, res) => {
  try {
    // Check if admin already exists
    const existingAdmin = await Admin.findOne();

    if (existingAdmin) {
      return res.status(403).json({
        success: false,
        message:
          "Admin already exists. Contact system administrator to create more users.",
      });
    }

    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: "Please provide email, password, and name",
      });
    }

    // Create admin
    const admin = await Admin.create({
      email,
      password,
      name,
      role: "admin",
    });

    const token = generateToken(admin._id, admin.role);

    res.status(201).json({
      success: true,
      token,
      message: "Admin account created successfully",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    List all admin/editor accounts (admin only)
// @route   GET /api/admin/all
// @access  Private/Admin
exports.listAdmins = async (req, res) => {
  try {
    const admins = await Admin.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: admins });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create an additional admin/editor account (existing admin only)
// @route   POST /api/admin/create
// @access  Private/Admin
exports.createAdmin = async (req, res) => {
  try {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: "Please provide email, password, and name",
      });
    }

    const allowedRoles = ["admin", "editor"];
    const assignedRole = allowedRoles.includes(role) ? role : "editor";

    const existing = await Admin.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "An account with that email already exists",
      });
    }

    const admin = await Admin.create({
      email,
      password,
      name,
      role: assignedRole,
    });

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      data: {
        id: admin._id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update admin profile
// @route   PUT /api/admin/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;

    const admin = await Admin.findByIdAndUpdate(
      req.user.id,
      { name, email },
      { new: true, runValidators: true },
    );

    res.status(200).json({
      success: true,
      data: admin,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Change password
// @route   PUT /api/admin/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const admin = await Admin.findById(req.user.id).select("+password");

    // Check current password
    const isMatch = await admin.matchPassword(currentPassword);

    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Current password is incorrect" });
    }

    admin.password = newPassword;
    await admin.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Forgot Password
// @route   POST /api/admin/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });

    // For security, always return success message even if admin not found
    if (!admin) {
      return res.status(200).json({
        success: true,
        message: "If an account with that email exists, a reset link has been sent.",
      });
    }

    // Generate token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

    admin.passwordResetToken = hashedToken;
    admin.passwordResetExpires = Date.now() + 3600000; // 1 hour
    await admin.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.FRONTEND_URL}/admin-reset-password.html?token=${resetToken}`;
    // Never log a live, usable reset token/URL outside local dev — anyone
    // with access to production logs could use it to take over an admin
    // account before it expires.
    if (process.env.NODE_ENV !== "production") {
      console.log("🔑 [DEV] Admin Password Reset URL:", resetUrl);
    }

    try {
      await sendPasswordResetEmail({
        to: admin.email,
        name: admin.name,
        resetUrl,
      });

      res.status(200).json({
        success: true,
        message: "If an account with that email exists, a reset link has been sent.",
      });
    } catch (err) {
      admin.passwordResetToken = undefined;
      admin.passwordResetExpires = undefined;
      await admin.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: "Email could not be sent" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Reset Password
// @route   POST /api/admin/reset-password/:token
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const hashedToken = crypto.createHash("sha256").update(req.params.token).digest("hex");

    if (process.env.NODE_ENV !== "production") {
      console.log("🔍 [DEV] Reset Attempt - Token:", req.params.token);
      console.log("🔍 [DEV] Reset Attempt - Hash:", hashedToken);
    }

    const admin = await Admin.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!admin) {
      const expiredAdmin = await Admin.findOne({ passwordResetToken: hashedToken });
      if (expiredAdmin) {
        if (process.env.NODE_ENV !== "production") {
          console.log("❌ [DEV] Token found but EXPIRED.");
        }
        return res.status(400).json({ success: false, message: "Reset link has expired" });
      }
      if (process.env.NODE_ENV !== "production") {
        console.log("❌ [DEV] No admin found with that token.");
      }
      return res.status(400).json({ success: false, message: "Invalid or expired token" });
    }

    admin.password = req.body.password;
    admin.passwordResetToken = undefined;
    admin.passwordResetExpires = undefined;
    await admin.save();

    res.status(200).json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Remove an admin/editor account (admin only)
// @route   DELETE /api/admin/:id
// @access  Private/Admin
exports.deleteAdmin = async (req, res) => {
  try {
    if (req.params.id === String(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot remove your own account.",
      });
    }

    const totalAdmins = await Admin.countDocuments({ role: "admin" });
    const target = await Admin.findById(req.params.id);

    if (!target) {
      return res.status(404).json({ success: false, message: "Account not found" });
    }

    if (target.role === "admin" && totalAdmins <= 1) {
      return res.status(400).json({
        success: false,
        message: "Cannot remove the last remaining admin account.",
      });
    }

    await Admin.findByIdAndDelete(req.params.id);

    res.status(200).json({ success: true, message: "Account removed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};