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
 * This uses getEffectivePlanLevel() (services/subscriptionService.js)
 * instead of getEffectiveStatus() directly — the two differ specifically
 * on trial clinics. getEffectiveStatus() alone returns "TRIAL", and this
 * file used to rank TRIAL above PREMIUM so every trial clinic got full
 * access regardless of what plan they'd actually selected at signup — a
 * Growth signup could use Pro-only features (lab, pharmacy) for free
 * during the trial window. getEffectivePlanLevel() resolves TRIAL down
 * to BASIC or PREMIUM based on clinic.subscriptionPlan (whatever was
 * selected at signup, or paid for since), so a trial clinic operates as
 * whichever plan it actually picked. A genuine payment (which sets a
 * real subscriptionExpiry) still takes over immediately regardless of
 * trial status, since getEffectiveStatus() checks hasActiveSubscription
 * before ever considering the trial.
 *
 * Order matches the spec: FREE_TIER → BASIC → PREMIUM.
 *   FREE_TIER unlocks neither BASIC nor PREMIUM features.
 *   BASIC unlocks BASIC features only.
 *   PREMIUM unlocks BASIC and PREMIUM features.
 */

const Clinic = require("../models/Clinic");
const { getEffectivePlanLevel, getReactivationCTA } = require("../services/subscriptionService");
const { getPlan } = require("../config/plans");

const RANK = { FREE_TIER: 0, BASIC: 1, PREMIUM: 2 };

/**
 * requirePlan("BASIC") — Growth-or-above features (e.g. reminders,
 * multi-role staff): passes for a clinic on BASIC or PREMIUM, or on
 * TRIAL operating as either (i.e. anything but a plain FREE_TIER
 * clinic with no active subscription and no trial left).
 * requirePlan("PREMIUM") — Pro-only features (lab, pharmacy): passes
 * only for a clinic actually on PREMIUM, whether via a real Pro
 * subscription or a trial where Pro was selected.
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

      const level = getEffectivePlanLevel(clinic);
      if (RANK[level] >= RANK[minLevel]) return next();

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