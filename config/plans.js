/**
 * config/plans.js
 * ─────────────────
 * Single source of truth for clinic subscription plans.
 * Matches the public pricing on services.html — keep these in sync
 * if you ever change pricing there.
 *
 * TO ADD A NEW PLAN LATER (e.g. "Enterprise"):
 *   Just add a new entry below. Nothing else in the codebase needs
 *   to change — checkSeatLimit(), /clinics/register, and /clinics/upgrade
 *   all read from this file rather than hardcoding plan names.
 */

const PLANS = {
  Growth: {
    displayName: "Clinic Growth",
    priceMonthly: 25000,   // NGN
    priceAnnual: 20000,    // NGN, per month when billed annually
    // "Up to 3 Doctors/Staff" on the pricing page — enforced here as a
    // specific role composition: 2 doctor seats + 1 receptionist seat.
    seatLimits: {
      doctor: 2,
      receptionist: 1,
    },
    // Roles that CANNOT be added at all on this plan, regardless of seat count
    disallowedRoles: ["pharmacist", "lab_tech", "nurse"],
  },
  Pro: {
    displayName: "Clinic Pro",
    priceMonthly: 60000,
    priceAnnual: 48000,
    seatLimits: null, // no cap — "Unlimited Doctors/Staff"
    disallowedRoles: [],
  },
  // Enterprise: not sold yet. Add here when ready — e.g.:
  // Enterprise: {
  //   displayName: "Clinic Enterprise",
  //   priceMonthly: null, // custom quote — see "Contact Sales"
  //   priceAnnual: null,
  //   seatLimits: null,
  //   disallowedRoles: [],
  // },
};

function getPlan(planKey) {
  return PLANS[planKey] || null;
}

function isValidPlan(planKey) {
  return Object.prototype.hasOwnProperty.call(PLANS, planKey);
}

module.exports = { PLANS, getPlan, isValidPlan };