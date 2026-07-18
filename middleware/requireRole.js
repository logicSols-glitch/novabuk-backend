/**
 * requireRole — role-gating middleware for clinic portal routes.
 *
 * Works with EITHER auth middleware that ran before it:
 *   - protectClinic        → sets req.staff (ClinicStaff routes only, e.g. clinic-auth.js)
 *   - protectClinicPortal   → sets req.actor (routes both owner + staff use, e.g. clinic-visits.js)
 *
 * The clinic owner (req.actor.isOwner === true) and ClinicStaff with
 * role "admin" always pass, regardless of the roles listed — both are
 * full-access delegates for their clinic.
 *
 * Usage:
 *   router.patch("/visits/:id/notes", protectClinicPortal, requireRole("doctor", "nurse"), handler);
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const actor = req.actor || req.staff; // req.actor from protectClinicPortal, req.staff from protectClinic

    if (!actor) {
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    if (actor.isOwner || actor.role === "admin") {
      return next();
    }

    if (!allowedRoles.includes(actor.role)) {
      return res.status(403).json({
        success: false,
        message: `This action requires one of these roles: ${allowedRoles.join(", ")}.`,
      });
    }

    next();
  };
}

/**
 * checkSeatLimit — call before creating a new ClinicStaff member.
 * Reads limits from config/plans.js — the single source of truth for
 * plan pricing/seats. Add a new plan there, not here.
 *
 * Usage inside the /my-staff POST handler, in clinic-auth.js:
 *   const seatCheck = await checkSeatLimit(clinic, req.body.role || "nurse");
 *   if (!seatCheck.allowed) {
 *     return res.status(403).json({ success: false, message: seatCheck.message });
 *   }
 */
const ClinicStaff = require("../models/ClinicStaff");
const { getPlan } = require("../config/plans");

async function checkSeatLimit(clinic, newStaffRole) {
  const plan = getPlan(clinic.subscriptionPlan);
  if (!plan) {
    return { allowed: false, message: `Unknown plan "${clinic.subscriptionPlan}" on this clinic.` };
  }

  if (plan.disallowedRoles?.includes(newStaffRole)) {
    return {
      allowed: false,
      message: `${newStaffRole} accounts are not available on the ${plan.displayName} plan. Upgrade to add this role.`,
    };
  }

  // No seatLimits object at all → unlimited (e.g. Pro)
  if (!plan.seatLimits) {
    return { allowed: true };
  }

  const limit = plan.seatLimits[newStaffRole];
  // Role isn't in the seatLimits map for this plan and wasn't disallowed
  // above → treat as unlimited for that specific role.
  if (limit === undefined) {
    return { allowed: true };
  }

  const currentCount = await ClinicStaff.countDocuments({
    clinic: clinic._id,
    role: newStaffRole,
    isActive: true,
  });

  if (currentCount >= limit) {
    return {
      allowed: false,
      message: `Your ${plan.displayName} plan allows up to ${limit} ${newStaffRole}(s). Upgrade to Pro to add more.`,
    };
  }

  return { allowed: true };
}

/**
 * requireClinicalRole — STRICTER gate for the three actions that must
 * stay doctor-only no matter what: writing consultation notes, issuing
 * lab requests, issuing prescriptions (per the Feature 1 spec: "even
 * Clinic Admin can't do these").
 *
 * Difference from requireRole(): a delegated ClinicStaff with
 * role "admin" does NOT bypass this gate — being administratively
 * promoted doesn't make someone clinically qualified.
 *
 * The clinic OWNER (req.actor.isOwner === true) DOES still pass —
 * not as an "admin bypass," but because clinics.js's /register route
 * only ever lets a User with role: "Doctors" create a clinic in the
 * first place. The owner is a doctor by construction, so they keep
 * full clinical permissions the same way any other doctor would.
 *
 * Usage:
 *   router.patch("/visits/:id/notes", protectClinicPortal, requireClinicalRole(), handler);
 *   (no roles argument needed today since "doctor" is the only
 *   clinical role that exists — accepts extra allowed roles for
 *   when nurse/other clinical roles need to be added case-by-case)
 */
function requireClinicalRole(...additionalAllowedRoles) {
  const allowed = ["doctor", ...additionalAllowedRoles];
  return (req, res, next) => {
    const actor = req.actor || req.staff;

    if (!actor) {
      return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    if (actor.isOwner) {
      return next(); // owner is a doctor by construction — not an "admin bypass"
    }

    if (!allowed.includes(actor.role)) {
      return res.status(403).json({
        success: false,
        message: `This is a clinical action restricted to: ${allowed.join(", ")}.`,
      });
    }

    next();
  };
}

module.exports = { requireRole, requireClinicalRole, checkSeatLimit };