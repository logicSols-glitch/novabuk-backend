const jwt  = require("jsonwebtoken");
const User = require("../models/User");

/**
 * authDoctor — middleware for clinic portal routes.
 *
 * Doctors use the SAME User collection and SAME JWT as patients.
 * The only difference is we check role === "Doctors" here.
 *
 * Auth flow:
 *   Doctor signs in via /api/users/login (same as patients)
 *   Token saved to localStorage as novabuk_token
 *   Clinic pages send: Authorization: Bearer <token>
 *   This middleware verifies it AND checks the role.
 *
 * On success attaches:
 *   req.user     → the full User document
 *   req.doctorId → shortcut to req.user._id
 *
 * NOTE: We don't use HttpOnly cookies for doctors because
 * the frontend already uses localStorage for patients and
 * adding a separate cookie system adds complexity without
 * benefit at this stage. Cookies can be added later when
 * security requirements increase.
 */
const protectDoctor = async (req, res, next) => {
  try {
    let token;

    // Read from Authorization header (localStorage pattern)
    if (req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    // Also accept the cookie as fallback
    if (!token && req.cookies && req.cookies.novabuk_token) {
      token = req.cookies.novabuk_token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated. Please sign in.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Account not found or deactivated.",
      });
    }

    // Key check — only Doctors role can access clinic routes
    if (user.role !== "Doctors") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Clinic portal is for doctors only.",
      });
    }

    req.user     = user;
    req.doctorId = user._id;
    next();

  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Session expired. Please sign in again.",
    });
  }
};

module.exports = { protectDoctor };