/**
 * middleware/planGate.js
 * ───────────────────────
 * Reusable "does this clinic's plan allow this feature" gate.
 *
 * Replaces the requireProPlan() function that was duplicated
 * separately in clinic-lab.js and clinic-pharmacy.js. That version
 * checked `clinic.subscriptionPlan === "Pro"` directly — which only
 * tells you what plan they LAST paid for, not whether they're
 * currently paying for it. A clinic that upgraded to Pro once and
 * then stopped paying keeps subscriptionPlan: "Pro" forever (nothing
 * ever resets that field), so the old check kept granting lab/pharmacy
 * access indefinitely after the subscription actually lapsed.
 *
 * This uses getEffectiveStatus() (services/subscriptionService.js)
 * instead, which factors in subscriptionStatus + subscriptionExpiry —
 * so access actually tracks whether the clinic is currently paying,
 * not just what plan they're nominally set to.
 *
 * Order matches the spec: TRIAL → FREE_TIER → BASIC → PREMIUM.
 *   TRIAL unlocks everything (full product experience).
 *   FREE_TIER unlocks neither BASIC nor PREMIUM features.
 *   BASIC unlocks BASIC features only.
 *   PREMIUM unlocks BASIC and PREMIUM features.
 */

const Clinic = require("../models/Clinic");
const { getEffectiveStatus, getReactivationCTA } = require("../services/subscriptionService");
const { getPlan } = require("../config/plans");

const RANK = { FREE_TIER: 0, BASIC: 1, PREMIUM: 2, TRIAL: 99 }; // TRIAL always passes

/**
 * requirePlan("BASIC") — Growth-or-above features (e.g. reminders,
 * multi-role staff), passes for BASIC, PREMIUM, or TRIAL.
 * requirePlan("PREMIUM") — Pro-only features (lab, pharmacy), passes
 * for PREMIUM or TRIAL only.
 */
function requirePlan(minLevel) {
  if (!(minLevel in RANK)) {
    throw new Error(`[planGate] Unknown plan level "${minLevel}".`);
  }

  return async (req, res, next) => {
    try {
      const clinic = req.clinic || (await Clinic.findById(req.actor.clinicId));
      if (!clinic) {
        return res.status(404).json({ success: false, message: "Clinic not found." });
      }
      req.clinic = clinic;

      const status = getEffectiveStatus(clinic);
      if (RANK[status] >= RANK[minLevel]) return next();

      const requiredPlan = getPlan(minLevel === "PREMIUM" ? "Pro" : "Growth");
      const cta = await getReactivationCTA(clinic._id);
      const message =
        cta.verb === "Renew"
          ? `Your subscription has lapsed. Renew to unlock this feature.`
          : `This feature is available on the ${requiredPlan.displayName} plan. Subscribe to unlock it.`;

      return res.status(403).json({
        success: false,
        error: "PLAN_UPGRADE_REQUIRED",
        message,
        cta: { label: cta.label, href: "./clinic-settings.html" },
      });
    } catch (err) {
      console.error("[planGate] error:", err.message);
      res.status(500).json({ success: false, message: "Server error." });
    }
  };
}

module.exports = { requirePlan };