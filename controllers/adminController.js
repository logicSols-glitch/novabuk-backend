const Admin = require("../models/Admin");
const jwt = require("jsonwebtoken");

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
