const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

exports.protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res
      .status(401)
      .json({ message: "Not authorized to access this route" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Re-check against the DB on every request (not just decode the JWT)
    // so a deleted/deactivated admin is rejected immediately instead of
    // staying valid for up to 7 days until the token naturally expires.
    // This is the same guarantee protectAdmin used to provide on its own —
    // folded in here now that every admin route goes through protect.
    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      return res
        .status(401)
        .json({ message: "Not authorized to access this route" });
    }

    req.user = { id: admin._id, role: admin.role };
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Not authorized to access this route" });
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Not authorized to access this route" });
    }
    next();
  };
};

// ── protectAdmin ──────────────────────────────────────────
// Correction: this IS actively used — clinics.js and users.js both
// depend on it, and specifically on the full req.admin document it
// attaches (e.g. subscription-payment review reads req.admin._id /
// req.admin.name for its audit trail). protect()/authorize() only
// attach a thin req.user = { id, role }, so those routes can't simply
// be swapped over the way admin.js/blogs.js/tips.js were. Kept exactly
// as-is; see requireAdminRole below for how role checks are layered
// on top of it instead.
exports.protectAdmin = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: "Not authorised. Admin access required." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Look up in Admin collection — if not found, token belongs to a patient
    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      return res.status(403).json({ success: false, message: "Access denied. Admin only." });
    }

    req.admin = admin;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Token invalid or expired." });
  }
};

// ── requireAdminRole ──────────────────────────────────────────
// Layers a role check on top of protectAdmin. protectAdmin only proves
// "this token belongs to some Admin document" — it never looks at
// role, so an "editor" account currently has identical power to a full
// "admin" everywhere protectAdmin alone is used (clinics, patients,
// subscription payments). Use this AFTER protectAdmin, e.g.:
//   router.delete("/:id", protectAdmin, requireAdminRole("admin"), handler)
// Checks req.admin.role (not req.user.role — that only exists on
// protect()-guarded routes).
exports.requireAdminRole = (...roles) => {
  return (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action.",
      });
    }
    next();
  };
};