const jwt         = require("jsonwebtoken");
const ClinicStaff = require("../models/ClinicStaff");

/**
 * authClinic — middleware for clinic portal routes.
 *
 * Reading order:
 *   1. HttpOnly cookie  (novabuk_clinic_token)  ← preferred
 *   2. Authorization header (Bearer token)       ← fallback for Postman/testing
 *
 * On success, attaches to the request:
 *   req.staff    → the full ClinicStaff document (with clinic populated)
 *   req.clinicId → shortcut to req.staff.clinic._id
 *
 * Every clinic route uses req.clinicId to scope DB queries.
 * This means staff at Clinic A can never access Clinic B's data.
 */
const protectClinic = async (req, res, next) => {
  try {
    let token;

    // 1. Try the HttpOnly cookie first
    if (req.cookies && req.cookies.novabuk_clinic_token) {
      token = req.cookies.novabuk_clinic_token;
    }

    // 2. Fall back to Authorization header (useful for Postman testing)
    if (!token && req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated. Please log in to the clinic portal.",
      });
    }

    // Verify the JWT — throws if invalid or expired
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Look up the staff member and populate their clinic
    const staff = await ClinicStaff.findById(decoded.id)
      .populate("clinic", "name location contactPhone isOpen isActive");

    if (!staff) {
      return res.status(401).json({
        success: false,
        message: "Staff account not found.",
      });
    }

    if (!staff.isActive) {
      return res.status(401).json({
        success: false,
        message: "This account has been deactivated. Contact your clinic admin.",
      });
    }

    // Attach to request for use in route handlers
    req.staff    = staff;
    req.clinicId = staff.clinic._id;

    next();
  } catch (error) {
    // jwt.verify throws JsonWebTokenError or TokenExpiredError
    return res.status(401).json({
      success: false,
      message: "Session expired or invalid. Please log in again.",
    });
  }
};

module.exports = { protectClinic };