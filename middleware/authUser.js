const jwt  = require("jsonwebtoken");
const User = require("../models/User");

/**
 * authUser — middleware for patient routes.
 *
 * Reading order:
 *   1. Authorization header (Bearer token) ← patient app uses localStorage
 *   2. novabuk_token cookie                ← fallback if cookie was set
 *
 * Patients use localStorage, not cookies. But the login route
 * sets both a cookie AND returns the token in the response body.
 * This middleware reads both so either method works.
 */
const protectUser = async (req, res, next) => {
  try {
    let token;

    // 1. Authorization header (primary — patient app sends this)
    if (req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    // 2. Cookie fallback
    if (!token && req.cookies && req.cookies.novabuk_token) {
      token = req.cookies.novabuk_token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated. Please log in.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Account not found.",
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "This account has been deactivated.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token. Please log in again.",
    });
  }
};

module.exports = { protectUser };