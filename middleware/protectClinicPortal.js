const jwt         = require("jsonwebtoken");
const User        = require("../models/User");
const ClinicStaff = require("../models/ClinicStaff");

/**
 * protectClinicPortal — combined auth for clinic portal routes that
 * BOTH the clinic owner (a User with role: "Doctors", Bearer token —
 * same as protectDoctor) AND their added ClinicStaff (nurses,
 * receptionists, additional doctors, pharmacists, lab techs —
 * HttpOnly cookie, same as protectClinic) need to access.
 *
 * WHY THIS EXISTS: clinic-visits.js previously only used protectDoctor,
 * which meant ClinicStaff members added via /clinic-auth/my-staff could
 * log in but had NO working access to the queue, consultations, walk-ins,
 * etc. — every request would 401. protectDoctor only reads the
 * Authorization Bearer header and only looks in the User collection;
 * it never checks for a ClinicStaff cookie at all.
 *
 * Sets req.actor = {
 *   id:        Mongo ObjectId of whoever is authenticated
 *   role:      "owner" (the User/doctor who registered the clinic) OR
 *              the ClinicStaff role ("doctor","nurse","receptionist",
 *              "pharmacist","lab_tech","admin")
 *   clinicId:  the clinic they belong to, however they authenticated
 *   fullName:  for use in notifications/emails
 *   email:     for use in notifications/emails
 *   isOwner:   true only for the clinic's registering User account
 * }
 *
 * requireRole() (see requireRole.js) reads req.actor.role and always
 * lets isOwner === true through, same way it already treats the
 * ClinicStaff "admin" role as a bypass.
 */
async function protectClinicPortal(req, res, next) {
  try {
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    // ── PRIMARY: Bearer token, checked against BOTH collections ──
    // clinic-login.html already stores the ClinicStaff's own JWT in
    // localStorage as "novabuk_token" (same mechanism the owner uses)
    // — this is same-origin and reliable. Previously this middleware
    // only checked the Bearer token against the User collection, so a
    // ClinicStaff token would silently fail here and fall through to
    // the HttpOnly cookie instead — which is a CROSS-SITE cookie
    // (frontend and backend are different domains). Cross-site cookies
    // are unreliable by nature: browsers (especially Safari, and
    // increasingly Chrome) intermittently block or drop them depending
    // on privacy settings, not because of any bug — which is exactly
    // why staff sessions were randomly getting kicked to "Log out?"
    // and why search/add-patient/etc. intermittently failed. Checking
    // ClinicStaff here too means staff auth no longer depends on the
    // cookie working at all; the cookie becomes a pure legacy fallback.
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.id);
        if (user && user.isActive && user.role === "Doctors" && user.clinicId) {
          req.actor = {
            id: user._id,
            role: "owner",
            clinicId: user.clinicId,
            fullName: user.fullName,
            email: user.email,
            isOwner: true,
          };
          req.user = user;
          req.doctorId = user._id;
          return next();
        }

        const staff = await ClinicStaff.findById(decoded.id).populate("clinic", "_id");
        if (staff) {
          if (!staff.isActive) {
            return res.status(401).json({
              success: false,
              message: "This account has been deactivated. Contact your clinic admin.",
            });
          }
          req.actor = {
            id: staff._id,
            role: staff.role,
            clinicId: staff.clinic._id,
            fullName: staff.fullName,
            email: staff.email,
            isOwner: false,
          };
          req.staff = staff;
          req.doctorId = staff._id;
          return next();
        }
        // Token decoded fine but matches neither collection — fall
        // through to try the cookie, in case that's somehow valid.
      } catch (err) {
        // Invalid/expired Bearer token — fall through to cookie attempt
      }
    }

    // ── FALLBACK: ClinicStaff cookie (legacy / no token present) ──
    let cookieToken;
    if (req.cookies && req.cookies.novabuk_clinic_token) {
      cookieToken = req.cookies.novabuk_clinic_token;
    }

    if (cookieToken) {
      const decoded = jwt.verify(cookieToken, process.env.JWT_SECRET);
      const staff = await ClinicStaff.findById(decoded.id).populate("clinic", "_id");

      if (!staff) {
        return res.status(401).json({ success: false, message: "Staff account not found." });
      }
      if (!staff.isActive) {
        return res.status(401).json({
          success: false,
          message: "This account has been deactivated. Contact your clinic admin.",
        });
      }

      req.actor = {
        id: staff._id,
        role: staff.role,
        clinicId: staff.clinic._id,
        fullName: staff.fullName,
        email: staff.email,
        isOwner: false,
      };
      req.staff = staff;
      req.doctorId = staff._id;
      return next();
    }

    // Neither auth method present
    return res.status(401).json({
      success: false,
      message: "Not authenticated. Please log in to the clinic portal.",
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Session expired or invalid. Please log in again.",
    });
  }
}

module.exports = { protectClinicPortal };