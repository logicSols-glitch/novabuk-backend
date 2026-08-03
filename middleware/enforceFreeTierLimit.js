/**
 * middleware/enforceFreeTierLimit.js
 * ─────────────────────────────────────
 * Feature 3 (Free Degraded Tier) — caps the two named actions
 * (patient history searches, new walk-in patients) at 10/month for
 * any clinic whose effective status is FREE_TIER. TRIAL and any
 * actively-paid clinic (BASIC/PREMIUM) are never limited on these.
 *
 * Built as one reusable middleware factory rather than duplicated
 * per-route logic, per the spec's own note: "Build the action
 * counter as a reusable middleware function — not hardcoded per
 * endpoint — so it can be extended to other limits later." Adding a
 * third limited action later is just one more entry in LIMITS below
 * plus a matching field on models/ClinicUsage.js.
 *
 * See models/ClinicUsage.js for why there's no monthly reset cron —
 * each calendar month gets its own row, so "reset" is just "the row
 * doesn't exist yet."
 */

const Clinic = require("../models/Clinic");
const ClinicUsage = require("../models/ClinicUsage");
const { getEffectiveStatus, getReactivationCTA } = require("../services/subscriptionService");
const { getPlan } = require("../config/plans");

const LIMITS = {
  patientHistorySearches: 10,
  newWalkinPatients: 10,
};

const ACTION_LABEL = {
  patientHistorySearches: "patient history searches",
  newWalkinPatients: "new walk-in patients",
};

function currentBillingMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Atomically checks-and-increments one field on this month's usage
 * row. Same trick models/Counter.js already uses elsewhere in this
 * codebase (an atomic conditional $inc), so two simultaneous requests
 * can never both sneak past the limit — the DB itself resolves the race.
 */
async function checkAndIncrement(clinicId, billingMonth, field, limit) {
  // Ensure this month's row exists first. Upsert + the unique index on
  // {clinic, billingMonth} in ClinicUsage.js means MongoDB resolves a
  // concurrent "first action this month" race, not application logic.
  try {
    await ClinicUsage.updateOne(
      { clinic: clinicId, billingMonth },
      {
        $setOnInsert: {
          clinic: clinicId,
          billingMonth,
          patientHistorySearches: 0,
          newWalkinPatients: 0,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    if (err.code !== 11000) throw err; // lost the insert race — row exists now either way, continue
  }

  // The actual limit check: only increments if still under the cap.
  const usage = await ClinicUsage.findOneAndUpdate(
    { clinic: clinicId, billingMonth, [field]: { $lt: limit } },
    { $inc: { [field]: 1 } },
    { new: true }
  );
  if (usage) return { allowed: true, count: usage[field] };

  const current = await ClinicUsage.findOne({ clinic: clinicId, billingMonth });
  return { allowed: false, count: current ? current[field] : limit };
}

function enforceFreeTierLimit(field) {
  const limit = LIMITS[field];
  if (!limit) throw new Error(`[enforceFreeTierLimit] Unknown action "${field}".`);

  return async (req, res, next) => {
    try {
      const clinic = req.clinic || (await Clinic.findById(req.actor.clinicId));
      if (!clinic) {
        return res.status(404).json({ success: false, message: "Clinic not found." });
      }
      req.clinic = clinic;

      const status = getEffectiveStatus(clinic);
      if (status !== "FREE_TIER") return next();

      const billingMonth = currentBillingMonth();
      const { allowed } = await checkAndIncrement(clinic._id, billingMonth, field, limit);
      if (allowed) return next();

      const growth = getPlan("Growth");
      const cta = await getReactivationCTA(clinic._id);
      const message =
        cta.verb === "Renew"
          ? `You've used your ${limit} free ${ACTION_LABEL[field]} this month. Your subscription has lapsed — renew to continue.`
          : `You've used your ${limit} free ${ACTION_LABEL[field]} this month. Subscribe to ${growth.displayName} to continue — \u20a6${growth.priceMonthly.toLocaleString()}/month.`;

      return res.status(403).json({
        success: false,
        error: "FREE_TIER_LIMIT_REACHED",
        message,
        cta: { label: cta.label, href: "./clinic-settings.html" },
      });
    } catch (err) {
      console.error("[enforceFreeTierLimit] error:", err.message);
      res.status(500).json({ success: false, message: "Server error." });
    }
  };
}

module.exports = { enforceFreeTierLimit, currentBillingMonth };